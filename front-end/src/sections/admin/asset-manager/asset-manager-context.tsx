import type {
  OmAsset,
  OmAssetScope,
  AssetSortField,
  OmAssetCollection,
  OmAssetSourceType,
  OmAssetVisibility,
  OmAssetSimilarGroup,
  OmAssetDuplicateGroup,
} from './om-assets-api';

import { useMemo, useState, useEffect, useContext, useCallback, createContext } from 'react';

import { toast } from 'src/components/snackbar';

import {
  copyOmAsset,
  deleteOmAsset,
  updateOmAsset,
  fetchOmAssetTags,
  bulkMoveOmAssets,
  bulkDeleteOmAssets,
  bulkSetOmAssetTags,
  fetchOmAssetDuplicates,
  createOmAssetDirectory,
  bulkChangeOmAssetScope,
  fetchOmAssetCollections,
  fetchOmAssetsCursorPage,
  fetchOmAssetDirectories,
  deleteOmAssetCollection,
  createOmAssetCollection,
  updateOmAssetCollection,
  fetchOmAssetSimilarGroups,
  assignOmAssetsToCollection,
  bulkDeleteOmAssetDuplicates,
  removeOmAssetsFromCollection,
} from './om-assets-api';

// ----------------------------------------------------------------------

export type AssetNavLocation = 'all' | 'duplicates' | 'similar' | 'collection';

export type AssetFilters = {
  scope: OmAssetScope | '';
  visibility: OmAssetVisibility | '';
  category: string;
  search: string;
  sort: AssetSortField;
  directory: string;
  tag: string;
  sourceType: OmAssetSourceType | '';
  churchId: number | null;
  collectionId: number | null;
};

const DEFAULT_FILTERS: AssetFilters = {
  scope: '', visibility: '', category: '', search: '', sort: 'created_desc', directory: '', tag: '', sourceType: '', churchId: null, collectionId: null,
};

const PAGE_SIZE = 48;

type State = {
  filters: AssetFilters;
  setFilters: (patch: Partial<AssetFilters>) => void;
  resetFilters: () => void;
  navLocation: AssetNavLocation;
  setNavLocation: (l: AssetNavLocation) => void;

  assets: OmAsset[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;

  scopeCounts: Partial<Record<OmAssetScope, number>>;
  folderCounts: Record<string, number>;
  directories: string[];
  tags: string[];
  collections: OmAssetCollection[];
  duplicateGroups: OmAssetDuplicateGroup[];
  similarGroups: OmAssetSimilarGroup[];
  reloadMeta: () => Promise<void>;

  selected: Set<number>;
  toggleSelect: (id: number, exclusive?: boolean) => void;
  selectMany: (ids: number[], on: boolean) => void;
  clearSelection: () => void;

  actions: {
    update: (id: number, payload: Parameters<typeof updateOmAsset>[1]) => Promise<OmAsset>;
    archive: (ids: number[]) => Promise<void>;
    moveToDirectory: (ids: number[], directory: string) => Promise<void>;
    applyTags: (ids: number[], tags: string[], mode: 'add' | 'remove' | 'set') => Promise<void>;
    changeScope: (ids: number[], scope: OmAssetScope, churchId?: number | null) => Promise<void>;
    copy: (id: number, payload: Parameters<typeof copyOmAsset>[1]) => Promise<void>;
    createDirectory: (scope: OmAssetScope, path: string, churchId?: number | null) => Promise<void>;
    deleteDuplicates: () => Promise<void>;
    collections: {
      create: (payload: Partial<OmAssetCollection> & { name: string }) => Promise<OmAssetCollection>;
      update: (id: number, payload: Partial<OmAssetCollection>) => Promise<void>;
      remove: (id: number) => Promise<void>;
      assign: (collectionId: number, ids: number[]) => Promise<void>;
      unassign: (collectionId: number, ids: number[]) => Promise<void>;
    };
    replaceAsset: (asset: OmAsset) => void;
  };
};

const Ctx = createContext<State | null>(null);

export function useAssetManager() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssetManager must be used inside <AssetManagerProvider>');
  return v;
}

export function AssetManagerProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFiltersState] = useState<AssetFilters>(DEFAULT_FILTERS);
  const [navLocation, setNavLocationState] = useState<AssetNavLocation>('all');

  const [assets, setAssets] = useState<OmAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scopeCounts, setScopeCounts] = useState<Partial<Record<OmAssetScope, number>>>({});
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const [directories, setDirectories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [collections, setCollections] = useState<OmAssetCollection[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<OmAssetDuplicateGroup[]>([]);
  const [similarGroups, setSimilarGroups] = useState<OmAssetSimilarGroup[]>([]);

  const [selected, setSelected] = useState<Set<number>>(new Set());

  const setFilters = useCallback((patch: Partial<AssetFilters>) => setFiltersState((p) => ({ ...p, ...patch })), []);
  const resetFilters = useCallback(() => setFiltersState(DEFAULT_FILTERS), []);
  const setNavLocation = useCallback((l: AssetNavLocation) => {
    setNavLocationState(l);
    if (l !== 'collection') setFiltersState((p) => ({ ...p, collectionId: null }));
  }, []);

  const params = useMemo(
    () => ({
      scope: filters.scope || undefined,
      visibility: filters.visibility || undefined,
      category: filters.category || undefined,
      search: filters.search || undefined,
      sort: filters.sort,
      directory: filters.directory || undefined,
      tag: filters.tag || undefined,
      source_type: filters.sourceType || undefined,
      church_id: filters.churchId ?? undefined,
      collection_id: filters.collectionId ?? undefined,
    }),
    [filters]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchOmAssetsCursorPage({ ...params, limit: PAGE_SIZE });
      setAssets(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setTotal(page.total ?? page.items.length);
      if (page.scopeCounts) setScopeCounts(page.scopeCounts);
      if (page.folderCounts) setFolderCounts(page.folderCounts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load assets');
    } finally {
      setLoading(false);
    }
  }, [params]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchOmAssetsCursorPage({ ...params, limit: PAGE_SIZE, cursor });
      setAssets((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load more');
    } finally {
      setLoadingMore(false);
    }
  }, [params, cursor, hasMore, loadingMore]);

  const reloadMeta = useCallback(async () => {
    const scopeArg = filters.scope ? { scope: filters.scope, church_id: filters.churchId ?? undefined } : undefined;
    const [dirs, tg, cols, dups, sims] = await Promise.allSettled([
      fetchOmAssetDirectories(scopeArg),
      fetchOmAssetTags(scopeArg),
      fetchOmAssetCollections(),
      fetchOmAssetDuplicates(),
      fetchOmAssetSimilarGroups(),
    ]);
    if (dirs.status === 'fulfilled') setDirectories(dirs.value);
    if (tg.status === 'fulfilled') setTags(tg.value);
    if (cols.status === 'fulfilled') setCollections(cols.value);
    if (dups.status === 'fulfilled') setDuplicateGroups(dups.value);
    if (sims.status === 'fulfilled') setSimilarGroups(sims.value);
  }, [filters.scope, filters.churchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    reloadMeta();
  }, [reloadMeta]);

  const toggleSelect = useCallback((id: number, exclusive = false) => {
    setSelected((prev) => {
      if (exclusive) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectMany = useCallback((ids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const run = async <T,>(fn: () => Promise<T>, ok?: string, refreshMeta = false): Promise<T> => {
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      await reload();
      if (refreshMeta) await reloadMeta();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
      throw e;
    }
  };

  const actions = useMemo<State['actions']>(
    () => ({
      update: (id, payload) => run(() => updateOmAsset(id, payload), 'Asset updated', true),
      archive: (ids) => run(async () => { if (ids.length === 1) await deleteOmAsset(ids[0]); else await bulkDeleteOmAssets(ids); setSelected(new Set()); }, `${ids.length === 1 ? 'Asset' : `${ids.length} assets`} archived`, true),
      moveToDirectory: (ids, directory) => run(async () => { await bulkMoveOmAssets(ids, directory); }, 'Moved', true),
      applyTags: (ids, tg, mode) => run(async () => { await bulkSetOmAssetTags(ids, tg, mode); }, 'Tags updated', true),
      changeScope: (ids, scope, churchId) => run(async () => { await bulkChangeOmAssetScope(ids, scope, churchId); }, 'Scope changed', true),
      copy: (id, payload) => run(async () => { await copyOmAsset(id, payload); }, 'Asset copied', true),
      createDirectory: (scope, path, churchId) => run(async () => { await createOmAssetDirectory(scope, path, churchId); }, 'Folder created', true),
      deleteDuplicates: () => run(async () => { await bulkDeleteOmAssetDuplicates(); }, 'Duplicates removed', true),
      collections: {
        create: (payload) => run(() => createOmAssetCollection(payload), 'Collection created', true),
        update: (id, payload) => run(async () => { await updateOmAssetCollection(id, payload); }, 'Collection updated', true),
        remove: (id) => run(async () => { await deleteOmAssetCollection(id); }, 'Collection deleted', true),
        assign: (collectionId, ids) => run(async () => { await assignOmAssetsToCollection(collectionId, ids); }, 'Added to collection', true),
        unassign: (collectionId, ids) => run(async () => { await removeOmAssetsFromCollection(collectionId, ids); }, 'Removed from collection', true),
      },
      replaceAsset: (asset) => setAssets((prev) => prev.map((a) => (a.id === asset.id ? asset : a))),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reload, reloadMeta]
  );

  const value = useMemo<State>(
    () => ({
      filters, setFilters, resetFilters, navLocation, setNavLocation,
      assets, total, hasMore, loading, loadingMore, error, loadMore, reload,
      scopeCounts, folderCounts, directories, tags, collections, duplicateGroups, similarGroups, reloadMeta,
      selected, toggleSelect, selectMany, clearSelection, actions,
    }),
    [filters, setFilters, resetFilters, navLocation, setNavLocation, assets, total, hasMore, loading, loadingMore, error, loadMore, reload, scopeCounts, folderCounts, directories, tags, collections, duplicateGroups, similarGroups, reloadMeta, selected, toggleSelect, selectMany, clearSelection, actions]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ----------------------------------------------------------------------

export const ASSET_SCOPES: { value: OmAssetScope; label: string; description: string }[] = [
  { value: 'public', label: 'Public', description: 'Public website and marketing' },
  { value: 'church', label: 'Church', description: 'Parish-scoped assets' },
  { value: 'site', label: 'Site', description: 'Authenticated platform UI' },
  { value: 'internal', label: 'Internal', description: 'Staff only' },
];

export const ASSET_VISIBILITIES: { value: OmAssetVisibility; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'authenticated', label: 'Authenticated' },
  { value: 'internal_only', label: 'Internal only' },
];

export const ASSET_SOURCE_TYPES: { value: OmAssetSourceType; label: string }[] = [
  { value: 'upload', label: 'Upload' }, { value: 'import', label: 'Import' }, { value: 'legacy', label: 'Legacy' },
  { value: 'generated', label: 'Generated' }, { value: 'screenshot', label: 'Screenshot' }, { value: 'promote_copy', label: 'Promoted copy' },
  { value: 'quarantine', label: 'Quarantine' },
];

export const ASSET_CATEGORIES: { value: string; label: string; group: string }[] = [
  ...['layout', 'border', 'cross', 'seal', 'header', 'background', 'icon', 'watermark', 'signature', 'font', 'divider', 'branding', 'logo', 'content', 'template'].map((v) => ({ value: v, label: v.replace(/_/g, ' '), group: 'Design' })),
  ...['diagram', 'infrastructure', 'ui_reference', 'screenshot', 'church_photo', 'clergy', 'certificate', 'map', 'document_scan', 'marketing', 'social_media', 'misc'].map((v) => ({ value: v, label: v.replace(/_/g, ' '), group: 'Content' })),
  { value: 'document', label: 'document', group: 'Documents' },
  { value: 'flagged', label: 'flagged', group: 'Quarantine' },
];

export const isImageAsset = (a: OmAsset) => /^image\//.test(a.mime_type || '') || /^(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(a.file_type || '');
export const isVideoAsset = (a: OmAsset) => /^video\//.test(a.mime_type || '') || /^(mp4|webm|mov|m4v)$/i.test(a.file_type || '');
