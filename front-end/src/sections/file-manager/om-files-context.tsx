import type { OmFile, OmFolder, OmFileItem, OmFilesContextInfo } from './om-files-api';

import { useMemo, useState, useEffect, useContext, useCallback, createContext } from 'react';

import { toast } from 'src/components/snackbar';

import { omFilesApi } from './om-files-api';

// ----------------------------------------------------------------------

type Filters = { q: string; types: string[]; favorites: boolean; shared: boolean };

type OmFilesState = {
  churchId: number | null;
  info: OmFilesContextInfo | null;
  folderId: number | null;
  breadcrumbs: { id: number; name: string; systemKey: string | null }[];
  folders: OmFolder[];
  files: OmFile[];
  items: OmFileItem[];
  loading: boolean;
  error: string | null;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  openFolder: (id: number | null) => void;
  refresh: () => Promise<void>;
  canWrite: boolean;
  actions: {
    createFolder: (name: string) => Promise<void>;
    upload: (files: File[]) => Promise<void>;
    rename: (item: OmFileItem, name: string) => Promise<void>;
    remove: (item: OmFileItem) => Promise<void>;
    removeMany: (ids: string[]) => Promise<void>;
    toggleFavorite: (item: OmFileItem) => Promise<void>;
    setShares: (item: OmFileItem, users: { user_id: number; permission: 'view' | 'edit' }[]) => Promise<void>;
    copyLink: (item: OmFileItem) => void;
  };
};

const Ctx = createContext<OmFilesState | null>(null);

export function useOmFiles() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOmFiles must be used inside <OmFilesProvider>');
  return v;
}

type ProviderProps = {
  children: React.ReactNode;
  /** super_admin/admin browsing a specific church; church roles leave this undefined */
  churchId?: number | null;
  initialFolderId?: number | null;
  onFolderChange?: (id: number | null) => void;
};

export function OmFilesProvider({ children, churchId = null, initialFolderId = null, onFolderChange }: ProviderProps) {
  const [info, setInfo] = useState<OmFilesContextInfo | null>(null);
  const [folderId, setFolderId] = useState<number | null>(initialFolderId);
  const [breadcrumbs, setBreadcrumbs] = useState<OmFilesState['breadcrumbs']>([]);
  const [folders, setFolders] = useState<OmFolder[]>([]);
  const [files, setFiles] = useState<OmFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<Filters>({ q: '', types: [], favorites: false, shared: false });

  const setFilters = useCallback((patch: Partial<Filters>) => setFiltersState((prev) => ({ ...prev, ...patch })), []);

  useEffect(() => {
    setFolderId(initialFolderId);
  }, [initialFolderId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ctx, list] = await Promise.all([
        omFilesApi.context(churchId),
        omFilesApi.items({ churchId, folderId, q: filters.q, types: filters.types, favorites: filters.favorites, shared: filters.shared }),
      ]);
      setInfo(ctx);
      setBreadcrumbs(list.breadcrumbs);
      setFolders(list.folders);
      setFiles(list.files);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load files');
    } finally {
      setLoading(false);
    }
  }, [churchId, folderId, filters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openFolder = useCallback(
    (id: number | null) => {
      setFolderId(id);
      setFiltersState((p) => ({ ...p, q: '', favorites: false, shared: false, types: [] }));
      onFolderChange?.(id);
    },
    [onFolderChange]
  );

  const guard = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
      throw e;
    }
  };

  const actions = useMemo<OmFilesState['actions']>(
    () => ({
      createFolder: (name) => guard(async () => { await omFilesApi.createFolder(churchId, name, folderId); }, 'Folder created'),
      upload: (list) => guard(async () => { await omFilesApi.upload(churchId, folderId, list); }, `${list.length} file${list.length === 1 ? '' : 's'} uploaded`),
      rename: (item, name) => guard(async () => { await omFilesApi.update(churchId, item.id, { name }); }, 'Renamed'),
      remove: (item) => guard(async () => { await omFilesApi.remove(churchId, item.id); }, 'Deleted'),
      removeMany: (ids) =>
        guard(async () => {
          const results = await Promise.allSettled(ids.map((id) => omFilesApi.remove(churchId, id)));
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (failed) throw new Error(`${failed} of ${ids.length} could not be deleted`);
        }, 'Deleted'),
      toggleFavorite: (item) => guard(async () => { await omFilesApi.toggleFavorite(churchId, item.id); }),
      setShares: (item, users) => guard(async () => { await omFilesApi.setShares(churchId, item.id, users); }, 'Sharing updated'),
      copyLink: (item) => {
        const url = item.kind === 'file' ? `${window.location.origin}${item.url}` : `${window.location.origin}/portal/file-manager?folder=${item.rawId}${churchId ? `&church=${churchId}` : ''}`;
        navigator.clipboard?.writeText(url).then(() => toast.success('Link copied')).catch(() => toast.error('Could not copy'));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [churchId, folderId, refresh]
  );

  const value = useMemo<OmFilesState>(
    () => ({
      churchId,
      info,
      folderId,
      breadcrumbs,
      folders,
      files,
      items: [...folders, ...files],
      loading,
      error,
      filters,
      setFilters,
      openFolder,
      refresh,
      canWrite: !!info?.can_write,
      actions,
    }),
    [churchId, info, folderId, breadcrumbs, folders, files, loading, error, filters, setFilters, openFolder, refresh, actions]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
