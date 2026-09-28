import type { OmFileItem } from '../om-files-api';
import type { IFileFilters } from 'src/types/file';

import { useState, useEffect, useCallback } from 'react';
import { useBoolean, useSetState } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import ToggleButton from '@mui/material/ToggleButton';
import LinearProgress from '@mui/material/LinearProgress';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { useRouter, useSearchParams } from 'src/routes/hooks';

import { fData } from 'src/utils/format-number';
import { fIsAfter, fIsBetween } from 'src/utils/format-time';

import { FILE_TYPE_OPTIONS } from 'src/_mock';
import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { useTable, getComparator } from 'src/components/table';
import { detectFileFormat } from 'src/components/file-thumbnail';

import { FileManagerTable } from '../file-manager-table';
import { FileManagerFilters } from '../file-manager-filters';
import { FileManagerGridView } from '../file-manager-grid-view';
import { useOmFiles, OmFilesProvider } from '../om-files-context';
import { FileManagerFiltersResult } from '../file-manager-filters-result';
import { FileManagerCreateFolderDialog } from '../file-manager-create-folder-dialog';

// ----------------------------------------------------------------------

type ViewProps = {
  /** Admin views pass an explicit church; church roles browse their own. */
  churchId?: number | null;
  heading?: string;
  embedded?: boolean;
};

export function FileManagerView({ churchId = null, heading = 'File manager', embedded = false }: ViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderParam = searchParams.get('folder');
  const initialFolder = folderParam ? Number(folderParam) : null;

  const syncUrl = useCallback(
    (id: number | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (id) sp.set('folder', String(id));
      else sp.delete('folder');
      router.replace(`${window.location.pathname}${sp.toString() ? `?${sp}` : ''}`);
    },
    [router, searchParams]
  );

  return (
    <OmFilesProvider churchId={churchId} initialFolderId={initialFolder} onFolderChange={syncUrl}>
      <FileManagerContent heading={heading} embedded={embedded} />
    </OmFilesProvider>
  );
}

// ----------------------------------------------------------------------

function FileManagerContent({ heading, embedded }: { heading: string; embedded: boolean }) {
  const { info, items, loading, error, breadcrumbs, filters: serverFilters, setFilters: setServerFilters, openFolder, canWrite, actions } = useOmFiles();

  const table = useTable({ defaultRowsPerPage: 10 });
  const dateRange = useBoolean();
  const confirmDialog = useBoolean();
  const uploadDialog = useBoolean();
  const folderDialog = useBoolean();
  const [displayMode, setDisplayMode] = useState('grid');

  const filters = useSetState<IFileFilters>({ name: '', type: [], startDate: null, endDate: null });
  const { state: currentFilters } = filters;
  const dateError = fIsAfter(currentFilters.startDate, currentFilters.endDate);

  // Name search is server-side (searches the whole church); type/date are client-side.
  useEffect(() => {
    const t = setTimeout(() => setServerFilters({ q: currentFilters.name }), 300);
    return () => clearTimeout(t);
  }, [currentFilters.name, setServerFilters]);

  const dataFiltered = applyFilter({ inputData: items, comparator: getComparator(table.order, table.orderBy), filters: currentFilters, dateError });

  const canReset = !!currentFilters.name || currentFilters.type.length > 0 || (!!currentFilters.startDate && !!currentFilters.endDate) || serverFilters.favorites || serverFilters.shared;
  const notFound = !loading && !dataFiltered.length;

  const handleDeleteItems = useCallback(async () => {
    await actions.removeMany(table.selected).catch(() => {});
    table.onSelectAllRows(false, []);
  }, [actions, table]);

  const Wrapper = embedded ? Box : DashboardContent;

  const usedPct = info ? Math.min(100, Math.round((info.used_bytes / info.quota_bytes) * 100)) : 0;

  return (
    <>
      <Wrapper>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h4">{heading}</Typography>
            {info && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {info.church.name}
                {info.church.jurisdiction ? ` · ${info.church.jurisdiction}` : ''}
              </Typography>
            )}
          </Box>
          {canWrite && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="outlined" color="inherit" startIcon={<Iconify icon="mingcute:add-line" />} onClick={folderDialog.onTrue}>
                New folder
              </Button>
              <Button variant="contained" startIcon={<Iconify icon="eva:cloud-upload-fill" />} onClick={uploadDialog.onTrue}>
                Upload
              </Button>
            </Box>
          )}
        </Box>

        {info && (
          <Box sx={{ mt: 2, maxWidth: 420 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', typography: 'caption', color: 'text.secondary', mb: 0.5 }}>
              <span>{fData(info.used_bytes)} used</span>
              <span>{fData(info.quota_bytes)} plan · {usedPct}%</span>
            </Box>
            <LinearProgress variant="determinate" value={usedPct} color={usedPct > 90 ? 'error' : usedPct > 75 ? 'warning' : 'primary'} sx={{ height: 6, borderRadius: 1 }} />
          </Box>
        )}

        <Breadcrumbs sx={{ mt: 3, typography: 'body2' }} separator={<Iconify icon="eva:arrow-ios-forward-fill" width={16} />}>
          <Link component="button" underline="hover" color={breadcrumbs.length ? 'text.secondary' : 'text.primary'} onClick={() => openFolder(null)} sx={{ typography: 'body2' }}>
            All folders
          </Link>
          {breadcrumbs.map((b, i) => (
            <Link key={b.id} component="button" underline="hover" color={i === breadcrumbs.length - 1 ? 'text.primary' : 'text.secondary'} onClick={() => openFolder(b.id)} sx={{ typography: 'body2', fontWeight: i === breadcrumbs.length - 1 ? 'fontWeightSemiBold' : undefined }}>
              {b.name}
            </Link>
          ))}
        </Breadcrumbs>

        <Stack spacing={2.5} sx={{ my: { xs: 3, md: 4 } }}>
          <Box sx={{ gap: 2, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-end', md: 'center' } }}>
            <FileManagerFilters filters={filters} dateError={dateError} onResetPage={table.onResetPage} openDateRange={dateRange.value} onOpenDateRange={dateRange.onTrue} onCloseDateRange={dateRange.onFalse} options={{ types: FILE_TYPE_OPTIONS }} />
            <Chip label="Favorites" icon={<Iconify icon="eva:star-fill" width={16} />} variant={serverFilters.favorites ? 'filled' : 'outlined'} color={serverFilters.favorites ? 'warning' : 'default'} onClick={() => setServerFilters({ favorites: !serverFilters.favorites, shared: false })} />
            <Chip label="Shared with me" icon={<Iconify icon="solar:share-bold" width={16} />} variant={serverFilters.shared ? 'filled' : 'outlined'} color={serverFilters.shared ? 'info' : 'default'} onClick={() => setServerFilters({ shared: !serverFilters.shared, favorites: false })} />
            <ToggleButtonGroup size="small" value={displayMode} exclusive onChange={(_, v) => v && setDisplayMode(v)}>
              <ToggleButton value="list"><Iconify icon="solar:list-bold" /></ToggleButton>
              <ToggleButton value="grid"><Iconify icon="mingcute:dot-grid-fill" /></ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {canReset && !serverFilters.favorites && !serverFilters.shared && <FileManagerFiltersResult filters={filters} totalResults={dataFiltered.length} onResetPage={table.onResetPage} />}
        </Stack>

        {error ? (
          <EmptyContent filled title={error} sx={{ py: 10 }} />
        ) : loading && !items.length ? (
          <LinearProgress />
        ) : notFound ? (
          <EmptyContent filled title={canReset ? 'No matches' : 'This folder is empty'} description={canWrite && !canReset ? 'Upload files or create a folder to get started.' : undefined} sx={{ py: 10 }} />
        ) : displayMode === 'list' ? (
          <FileManagerTable table={table} dataFiltered={dataFiltered} notFound={notFound} onOpenConfirm={confirmDialog.onTrue} />
        ) : (
          <FileManagerGridView table={table} dataFiltered={dataFiltered} onOpenConfirm={confirmDialog.onTrue} />
        )}
      </Wrapper>

      <FileManagerCreateFolderDialog open={uploadDialog.value} onClose={uploadDialog.onFalse} />
      <FileManagerCreateFolderDialog open={folderDialog.value} onClose={folderDialog.onFalse} mode="folder" />

      <ConfirmDialog
        open={confirmDialog.value}
        onClose={confirmDialog.onFalse}
        title="Delete"
        content={<>Are you sure you want to delete <strong>{table.selected.length}</strong> items?</>}
        action={
          <Button variant="contained" color="error" onClick={() => { handleDeleteItems(); confirmDialog.onFalse(); }}>
            Delete
          </Button>
        }
      />
    </>
  );
}

// ----------------------------------------------------------------------

type ApplyFilterProps = { dateError: boolean; inputData: OmFileItem[]; filters: IFileFilters; comparator: (a: any, b: any) => number };

function applyFilter({ inputData, comparator, filters, dateError }: ApplyFilterProps) {
  const { type, startDate, endDate } = filters;
  const stabilized = inputData.map((el, index) => [el, index] as const);
  stabilized.sort((a, b) => {
    // folders (system roots first) always before files
    if (a[0].kind !== b[0].kind) return a[0].kind === 'folder' ? -1 : 1;
    const order = comparator(a[0], b[0]);
    return order !== 0 ? order : a[1] - b[1];
  });
  let out = stabilized.map((el) => el[0]);
  if (type.length) out = out.filter((f) => f.kind === 'folder' ? type.includes('folder') : type.includes(detectFileFormat(f.name)));
  if (!dateError && startDate && endDate) out = out.filter((f) => fIsBetween(f.createdAt, startDate, endDate));
  return out;
}
