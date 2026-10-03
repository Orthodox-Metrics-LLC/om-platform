import type { Slide } from 'yet-another-react-lightbox';
import type { IFileFilters } from 'src/types/file';
import type { CloudFileEntry } from './om-assets-api';
import type { IDatePickerControl } from 'src/types/common';
import type { TableHeadCellProps } from 'src/components/table';

import { varAlpha } from 'minimal-shared/utils';
import { useLightboxState } from 'yet-another-react-lightbox';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { usePopover, useBoolean, useSetState } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import ToggleButton from '@mui/material/ToggleButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { tablePaginationClasses } from '@mui/material/TablePagination';

import { fData } from 'src/utils/format-number';
import { fIsAfter, fDateTime, fIsBetween, fDateRangeShortLabel } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Lightbox } from 'src/components/lightbox';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';
import { CustomPopover } from 'src/components/custom-popover';
import { CustomDateRangePicker } from 'src/components/custom-date-range-picker';
import { FileThumbnail, detectFileFormat } from 'src/components/file-thumbnail';
import { chipProps, FiltersBlock, FiltersResult } from 'src/components/filters-result';
import { useTable, getComparator, TableHeadCustom, TablePaginationCustom } from 'src/components/table';

import { deleteCloudFileScreenshot, fetchCloudFilesScreenshots } from './om-assets-api';

// ----------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi)$/i;
const VIDEO_MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', avi: 'video/x-msvideo' };

const isImageEntry = (e: CloudFileEntry) => e.type === 'file' && IMAGE_EXT.test(e.name);
const isVideoEntry = (e: CloudFileEntry) => e.type === 'file' && VIDEO_EXT.test(e.name);
const videoMime = (name: string) => VIDEO_MIME[name.split('.').pop()?.toLowerCase() ?? ''] || 'video/mp4';

const CLOUD_TYPE_OPTIONS = ['folder', 'image', 'video', 'txt', 'zip', 'audio', 'word', 'excel', 'powerpoint', 'pdf'];

const TABLE_HEAD: TableHeadCellProps[] = [
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size', width: 120, align: 'right' },
  { id: 'type', label: 'Type', width: 120 },
  { id: 'modified_at', label: 'Modified', width: 160 },
  { id: '', width: 100 },
];

// Cloud entry type detection for filtering
function cloudEntryType(entry: CloudFileEntry): string {
  if (entry.type === 'directory') return 'folder';
  return detectFileFormat(entry.name) as string;
}

function applyCloudFilter({
  inputData,
  comparator,
  filters,
  dateError,
}: {
  inputData: CloudFileEntry[];
  comparator: (a: any, b: any) => number;
  filters: IFileFilters;
  dateError: boolean;
}) {
  const { name, type, startDate, endDate } = filters;

  // Sort: group folders first, then apply comparator
  const stabilized = inputData.map((el, index) => [el, index] as const);
  stabilized.sort((a, b) => {
    if (a[0].type !== b[0].type) return a[0].type === 'directory' ? -1 : 1;
    const order = comparator(a[0], b[0]);
    return order !== 0 ? order : a[1] - b[1];
  });
  let result = stabilized.map((el) => el[0]);

  // Name filter
  if (name.trim()) {
    const q = name.trim().toLowerCase();
    result = result.filter((e) => e.name.toLowerCase().includes(q));
  }

  // Type filter
  if (type.length) {
    result = result.filter((e) =>
      e.type === 'directory' ? type.includes('folder') : type.includes(cloudEntryType(e))
    );
  }

  // Date range filter
  if (!dateError && startDate && endDate) {
    result = result.filter((e) => fIsBetween(e.modified_at, startDate, endDate));
  }

  return result;
}

// ----------------------------------------------------------------------

/**
 * Cloud Files: real-time browse of the \\192.168.1.79\screenshots SMB share
 * (mounted at /mnt/storage/screenshots). Lists the live filesystem on every
 * load/navigation — not the om_assets DB, so it always matches exactly
 * what's physically on the share right now. Not a managed/recoverable Asset
 * Manager resource: delete here removes the real file from the share, with
 * no Archive-style undo tier.
 */
export function CloudFilesView() {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<CloudFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [lightboxEpoch, setLightboxEpoch] = useState(0);
  const [displayMode, setDisplayMode] = useState<'list' | 'grid'>('grid');

  const table = useTable({ defaultRowsPerPage: 25, defaultDense: true, defaultOrderBy: 'name' });
  const dateRange = useBoolean();
  const foldersCollapse = useBoolean();
  const filesCollapse = useBoolean();

  const filters = useSetState<IFileFilters>({ name: '', type: [], startDate: null, endDate: null });
  const { state: currentFilters, resetState: resetFilters } = filters;
  const dateError = fIsAfter(currentFilters.startDate, currentFilters.endDate);

  const canReset = !!currentFilters.name || !!currentFilters.type.length || (!!currentFilters.startDate && !!currentFilters.endDate);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await fetchCloudFilesScreenshots(p);
      setEntries(res.entries);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load share contents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(path);
    resetFilters();
    table.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, load]);

  const dataFiltered = useMemo(
    () => applyCloudFilter({
      inputData: entries,
      comparator: getComparator(table.order, table.orderBy),
      filters: currentFilters,
      dateError,
    }),
    [entries, table.order, table.orderBy, currentFilters, dateError]
  );

  // Reset page on filter or sort changes
  useEffect(() => {
    table.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFilters.name, currentFilters.type, currentFilters.startDate, currentFilters.endDate, table.order, table.orderBy]);

  const folders = useMemo(() => dataFiltered.filter((e) => e.type === 'directory'), [dataFiltered]);
  const files = useMemo(() => dataFiltered.filter((e) => e.type !== 'directory'), [dataFiltered]);

  const paginatedFiles = useMemo(
    () => files.slice(table.page * table.rowsPerPage, table.page * table.rowsPerPage + table.rowsPerPage),
    [files, table.page, table.rowsPerPage]
  );

  const previewableEntries = useMemo(
    () => dataFiltered.filter((e) => isImageEntry(e) || isVideoEntry(e)),
    [dataFiltered]
  );

  const lightboxSlides: Slide[] = useMemo(
    () =>
      previewableEntries.map((e): Slide =>
        isVideoEntry(e)
          ? { type: 'video', sources: [{ src: e.file_url || '', type: videoMime(e.name) }], title: e.name }
          : { src: e.file_url || '', title: e.name }
      ),
    [previewableEntries]
  );

  const removeEntry = useCallback((filePath: string) => {
    setEntries((prev) => prev.filter((e) => e.path !== filePath));
  }, []);

  const deleteFile = useCallback(
    async (entry: CloudFileEntry) => {
      try {
        await deleteCloudFileScreenshot(entry.path);
        removeEntry(entry.path);
        toast.success(`Deleted ${entry.name}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not delete file');
      }
    },
    [removeEntry]
  );

  const deleteFromPreview = useCallback(
    (entry: CloudFileEntry, viewedIndex: number) => {
      const newLength = previewableEntries.length - 1;
      setLightboxIndex(newLength <= 0 ? -1 : Math.min(viewedIndex, newLength - 1));
      setLightboxEpoch((e) => e + 1);
      deleteFile(entry);
    },
    [deleteFile, previewableEntries.length]
  );

  const openEntry = (entry: CloudFileEntry) => {
    if (entry.type === 'directory') { setPath(entry.path); return; }
    if (isImageEntry(entry) || isVideoEntry(entry)) {
      const idx = previewableEntries.findIndex((e) => e.path === entry.path);
      if (idx >= 0) setLightboxIndex(idx);
    }
  };

  const crumbs = path ? path.split('/').filter(Boolean) : [];
  const notFound = !dataFiltered.length && !loading;

  const grid = { gap: 3, display: 'grid', gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' } } as const;

  return (
    <>
      {/* Breadcrumbs + share label */}
      <Box sx={{ mb: 2, gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip
          size="small"
          variant="soft"
          color="info"
          icon={<Iconify icon="eva:cloud-upload-fill" width={16} />}
          label="\\192.168.1.79\screenshots"
        />
        <Breadcrumbs separator={<Iconify icon="carbon:chevron-right" width={14} />}>
          <Typography
            component="button"
            onClick={() => setPath('')}
            sx={{ border: 'none', bgcolor: 'transparent', cursor: 'pointer', typography: 'body2', color: path ? 'text.secondary' : 'text.primary', fontWeight: path ? 400 : 600 }}
          >
            screenshots
          </Typography>
          {crumbs.map((part, i) => {
            const crumbPath = crumbs.slice(0, i + 1).join('/');
            const isLast = i === crumbs.length - 1;
            return (
              <Typography
                key={crumbPath}
                component="button"
                onClick={() => setPath(crumbPath)}
                sx={{ border: 'none', bgcolor: 'transparent', cursor: 'pointer', typography: 'body2', color: isLast ? 'text.primary' : 'text.secondary', fontWeight: isLast ? 600 : 400 }}
              >
                {part}
              </Typography>
            );
          })}
        </Breadcrumbs>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" variant="outlined" color="inherit" startIcon={<Iconify icon="solar:restart-bold" />} onClick={() => load(path)}>
          Refresh
        </Button>
      </Box>

      {/* Filter bar: search + date range + type dropdown + display toggle */}
      <Box sx={{ my: { xs: 2, md: 3 } }}>
        <Box sx={{ gap: 1, width: 1, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-end', md: 'center' } }}>
          <CloudFilesSearch filters={filters} onResetPage={table.onResetPage} />
          <Box sx={{ gap: 1, flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <CloudFilesDateFilter
              filters={filters}
              dateError={dateError}
              onResetPage={table.onResetPage}
              openDateRange={dateRange.value}
              onOpenDateRange={dateRange.onTrue}
              onCloseDateRange={dateRange.onFalse}
            />
            <CloudFilesTypeFilter filters={filters} onResetPage={table.onResetPage} />
            <ToggleButtonGroup size="small" value={displayMode} exclusive onChange={(_, v) => v && setDisplayMode(v)}>
              <ToggleButton value="list"><Iconify icon="solar:list-bold" /></ToggleButton>
              <ToggleButton value="grid"><Iconify icon="mingcute:dot-grid-fill" /></ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        {canReset && (
          <Box sx={{ mt: 2 }}>
            <CloudFilesFilterChips filters={filters} totalResults={dataFiltered.length} onResetPage={table.onResetPage} />
          </Box>
        )}
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <EmptyContent filled title={error} sx={{ py: 6 }} />}

      {!loading && !error && (
        <>
          {notFound ? (
            <EmptyContent filled title={canReset ? 'No files match' : 'Nothing on the share yet'} sx={{ py: 10 }} />
          ) : displayMode === 'grid' ? (
            /* ---- Grid / card mode (Screenshot 4 layout) ---- */
            <>
              {/* Folders section */}
              {folders.length > 0 && (
                <>
                  <CloudFilesPanel title="Folders" subtitle={`${folders.length} folders`} collapse={foldersCollapse.value} onCollapse={foldersCollapse.onToggle} />
                  <Collapse in={!foldersCollapse.value} unmountOnExit>
                    <Box sx={grid}>
                      {folders.map((folder) => (
                        <CloudFolderCard key={folder.path} entry={folder} onClick={() => openEntry(folder)} />
                      ))}
                    </Box>
                  </Collapse>
                </>
              )}

              {/* Files section */}
              {files.length > 0 && (
                <Box sx={{ mt: folders.length ? 4 : 0 }}>
                  <CloudFilesPanel title="Files" subtitle={`${files.length} files`} collapse={filesCollapse.value} onCollapse={filesCollapse.onToggle} />
                  <Collapse in={!filesCollapse.value} unmountOnExit>
                    <CloudFilesTable
                      entries={paginatedFiles}
                      table={table}
                      totalCount={files.length}
                      onOpenEntry={openEntry}
                      onDeleteFile={deleteFile}
                    />
                  </Collapse>
                </Box>
              )}
            </>
          ) : (
            /* ---- List mode: single table with everything ---- */
            <CloudFilesTable
              entries={dataFiltered.slice(table.page * table.rowsPerPage, table.page * table.rowsPerPage + table.rowsPerPage)}
              table={table}
              totalCount={dataFiltered.length}
              onOpenEntry={openEntry}
              onDeleteFile={deleteFile}
            />
          )}
        </>
      )}

      <Lightbox
        key={`${lightboxIndex}-${lightboxEpoch}`}
        open={lightboxIndex >= 0}
        close={() => setLightboxIndex(-1)}
        slides={lightboxSlides}
        index={Math.max(lightboxIndex, 0)}
        disableTotal={false}
        thumbnails={{ position: 'end' }}
        toolbarExtraButtons={[
          <CloudFileDeleteButton key="delete-from-preview" entries={previewableEntries} onDelete={deleteFromPreview} />,
        ]}
      />
    </>
  );
}

// ----------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------

/** Collapsible section header matching FileManagerPanel's layout */
function CloudFilesPanel({ title, subtitle, collapse, onCollapse }: { title: string; subtitle?: string; collapse?: boolean; onCollapse?: () => void }) {
  return (
    <Box sx={{ mb: 3, display: 'flex', alignItems: 'center' }}>
      <Box sx={{ flex: '1 1 auto' }}>
        <Box sx={{ gap: 1, display: 'flex', typography: 'h6', alignItems: 'center' }}>{title}</Box>
        {subtitle && <Box sx={{ typography: 'body2', color: 'text.disabled', mt: 0.5 }}>{subtitle}</Box>}
      </Box>
      {onCollapse && (
        <IconButton onClick={onCollapse}>
          <Iconify icon={collapse ? 'eva:arrow-ios-downward-fill' : 'eva:arrow-ios-upward-fill'} />
        </IconButton>
      )}
    </Box>
  );
}

/** Folder card matching Screenshot 4's folder card appearance */
function CloudFolderCard({ entry, onClick }: { entry: CloudFileEntry; onClick: () => void }) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={(theme) => ({
        p: 2.5,
        gap: 1,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover', boxShadow: theme.vars.customShadows?.z8 ?? theme.customShadows?.z8 },
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <FileThumbnail file="folder" sx={{ width: 36, height: 36 }} />
      </Box>
      <Typography variant="subtitle2" noWrap>{entry.name}</Typography>
      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
        {entry.modified_at ? fDateTime(entry.modified_at) : ''}
      </Typography>
    </Paper>
  );
}

/** File table with sortable column headers and pagination */
function CloudFilesTable({
  entries,
  table,
  totalCount,
  onOpenEntry,
  onDeleteFile,
}: {
  entries: CloudFileEntry[];
  table: ReturnType<typeof useTable>;
  totalCount: number;
  onOpenEntry: (e: CloudFileEntry) => void;
  onDeleteFile: (e: CloudFileEntry) => void;
}) {
  return (
    <>
      <TableContainer sx={{ border: (theme) => `1px solid ${theme.vars.palette.divider}`, borderRadius: 1.5 }}>
        <Scrollbar>
          <Table size={table.dense ? 'small' : 'medium'} sx={{ minWidth: 720 }}>
            <TableHeadCustom
              order={table.order}
              orderBy={table.orderBy}
              headCells={TABLE_HEAD}
              onSort={table.onSort}
            />
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.path}
                  hover
                  sx={{ cursor: entry.type === 'directory' || isImageEntry(entry) || isVideoEntry(entry) ? 'pointer' : 'default' }}
                  onClick={() => onOpenEntry(entry)}
                >
                  <TableCell>
                    <Box sx={{ gap: 1.5, display: 'flex', alignItems: 'center' }}>
                      <FileThumbnail
                        file={entry.type === 'directory' ? 'folder' : entry.name}
                        showImage
                        previewUrl={entry.type === 'file' ? (entry.thumb_url ?? entry.file_url ?? undefined) : undefined}
                        sx={{ width: 28, height: 28 }}
                      />
                      <Typography variant="body2" noWrap>{entry.name}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{entry.size != null ? fData(entry.size) : '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                    {entry.type === 'directory' ? 'folder' : cloudEntryType(entry)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{fDateTime(entry.modified_at)}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {entry.type === 'file' && (
                      <>
                        <Tooltip title="Download">
                          <IconButton size="small" component="a" href={entry.file_url ?? undefined} download={entry.name}>
                            <Iconify icon="eva:cloud-download-fill" width={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete from share">
                          <IconButton size="small" color="error" onClick={() => onDeleteFile(entry)}>
                            <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!entries.length && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyContent title="No files" sx={{ py: 6 }} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Scrollbar>
      </TableContainer>

      <TablePaginationCustom
        page={table.page}
        dense={table.dense}
        rowsPerPage={table.rowsPerPage}
        count={totalCount}
        onPageChange={table.onChangePage}
        onChangeDense={table.onChangeDense}
        onRowsPerPageChange={table.onChangeRowsPerPage}
        rowsPerPageOptions={[25, 50, 100]}
        sx={{ [`& .${tablePaginationClasses.toolbar}`]: { borderTopColor: 'transparent' } }}
      />
    </>
  );
}

// ----------------------------------------------------------------------
// Filter sub-components (replicating FileManagerFilters patterns)
// ----------------------------------------------------------------------

function CloudFilesSearch({ filters, onResetPage }: { filters: ReturnType<typeof useSetState<IFileFilters>>; onResetPage: () => void }) {
  const { state: currentFilters, setState: updateFilters } = filters;
  const handleFilterName = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => { onResetPage(); updateFilters({ name: event.target.value }); },
    [onResetPage, updateFilters]
  );
  return (
    <TextField
      value={currentFilters.name}
      onChange={handleFilterName}
      placeholder="Search..."
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} /></InputAdornment> } }}
      sx={{ width: { xs: 1, md: 260 } }}
    />
  );
}

function CloudFilesTypeFilter({ filters, onResetPage }: { filters: ReturnType<typeof useSetState<IFileFilters>>; onResetPage: () => void }) {
  const menuActions = usePopover();
  const { state: currentFilters, setState: updateFilters } = filters;
  const displayLabel = currentFilters.type.length ? currentFilters.type.slice(0, 2).join(',') : 'All type';

  const handleFilterType = useCallback(
    (newValue: string) => {
      const checked = currentFilters.type.includes(newValue)
        ? currentFilters.type.filter((value) => value !== newValue)
        : [...currentFilters.type, newValue];
      updateFilters({ type: checked });
    },
    [updateFilters, currentFilters.type]
  );

  const handleResetType = useCallback(() => { menuActions.onClose(); updateFilters({ type: [] }); }, [menuActions, updateFilters]);

  return (
    <>
      <Button
        color="inherit"
        onClick={menuActions.onOpen}
        endIcon={<Iconify icon={menuActions.open ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'} sx={{ ml: -0.5 }} />}
      >
        {displayLabel}
        {currentFilters.type.length > 2 && <Label color="info" sx={{ ml: 1 }}>+{currentFilters.type.length - 2}</Label>}
      </Button>
      <CustomPopover open={menuActions.open} anchorEl={menuActions.anchorEl} onClose={menuActions.onClose} slotProps={{ paper: { sx: { p: 2.5 } } }}>
        <Box sx={{ gap: 1, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' } }}>
          {CLOUD_TYPE_OPTIONS.map((type) => {
            const selected = currentFilters.type.includes(type);
            return (
              <ButtonBase
                key={type}
                onClick={() => handleFilterType(type)}
                sx={[(theme) => ({
                  p: 1,
                  gap: 1,
                  borderRadius: 1,
                  typography: 'caption',
                  textTransform: 'capitalize',
                  justifyContent: 'flex-start',
                  border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.08)}`,
                  ...(selected && { bgcolor: 'action.selected', fontWeight: 'fontWeightSemiBold' }),
                })]}
              >
                <FileThumbnail file={type} sx={{ width: 24, height: 24 }} />
                {type}
              </ButtonBase>
            );
          })}
        </Box>
        <Box sx={{ mt: 2.5, gap: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button variant="outlined" color="inherit" onClick={handleResetType}>Clear</Button>
          <Button variant="contained" onClick={menuActions.onClose}>Apply</Button>
        </Box>
      </CustomPopover>
    </>
  );
}

function CloudFilesDateFilter({
  filters,
  dateError,
  onResetPage,
  openDateRange,
  onOpenDateRange,
  onCloseDateRange,
}: {
  filters: ReturnType<typeof useSetState<IFileFilters>>;
  dateError: boolean;
  onResetPage: () => void;
  openDateRange: boolean;
  onOpenDateRange: () => void;
  onCloseDateRange: () => void;
}) {
  const { state: currentFilters, setState: updateFilters } = filters;

  const handleFilterStartDate = useCallback(
    (newValue: IDatePickerControl) => { onResetPage(); updateFilters({ startDate: newValue }); },
    [onResetPage, updateFilters]
  );
  const handleFilterEndDate = useCallback(
    (newValue: IDatePickerControl) => { updateFilters({ endDate: newValue }); },
    [updateFilters]
  );

  return (
    <>
      <Button
        color="inherit"
        onClick={onOpenDateRange}
        endIcon={<Iconify icon={openDateRange ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'} sx={{ ml: -0.5 }} />}
      >
        {!!currentFilters.startDate && !!currentFilters.endDate
          ? fDateRangeShortLabel(currentFilters.startDate, currentFilters.endDate)
          : 'Select date'}
      </Button>
      <CustomDateRangePicker
        variant="calendar"
        startDate={currentFilters.startDate}
        endDate={currentFilters.endDate}
        onChangeStartDate={handleFilterStartDate}
        onChangeEndDate={handleFilterEndDate}
        open={openDateRange}
        onClose={onCloseDateRange}
        selected={!!currentFilters.startDate && !!currentFilters.endDate}
        error={dateError}
      />
    </>
  );
}

function CloudFilesFilterChips({ filters, totalResults, onResetPage }: { filters: ReturnType<typeof useSetState<IFileFilters>>; totalResults: number; onResetPage: () => void }) {
  const { state: currentFilters, setState: updateFilters, resetState: resetFilters } = filters;

  const handleRemoveKeyword = useCallback(() => { onResetPage(); updateFilters({ name: '' }); }, [onResetPage, updateFilters]);
  const handleRemoveTypes = useCallback(
    (inputValue: string) => { onResetPage(); updateFilters({ type: currentFilters.type.filter((item) => item !== inputValue) }); },
    [onResetPage, updateFilters, currentFilters.type]
  );
  const handleRemoveDate = useCallback(() => { onResetPage(); updateFilters({ startDate: null, endDate: null }); }, [onResetPage, updateFilters]);
  const handleReset = useCallback(() => { onResetPage(); resetFilters(); }, [onResetPage, resetFilters]);

  return (
    <FiltersResult totalResults={totalResults} onReset={handleReset}>
      <FiltersBlock label="Types:" isShow={!!currentFilters.type.length}>
        {currentFilters.type.map((item) => (
          <Chip {...chipProps} key={item} label={item} onDelete={() => handleRemoveTypes(item)} sx={{ textTransform: 'capitalize' }} />
        ))}
      </FiltersBlock>
      <FiltersBlock label="Date:" isShow={Boolean(currentFilters.startDate && currentFilters.endDate)}>
        <Chip {...chipProps} label={fDateRangeShortLabel(currentFilters.startDate, currentFilters.endDate)} onDelete={handleRemoveDate} />
      </FiltersBlock>
      <FiltersBlock label="Keyword:" isShow={!!currentFilters.name}>
        <Chip {...chipProps} label={currentFilters.name} onDelete={handleRemoveKeyword} />
      </FiltersBlock>
    </FiltersResult>
  );
}

// ----------------------------------------------------------------------

/** Lightbox toolbar button: deletes the slide currently being viewed from the share right away. */
function CloudFileDeleteButton({
  entries,
  onDelete,
}: {
  entries: CloudFileEntry[];
  onDelete: (entry: CloudFileEntry, viewedIndex: number) => void;
}) {
  const { currentIndex } = useLightboxState();
  const entry = entries[currentIndex];

  if (!entry) return null;

  return (
    <Tooltip title="Delete this">
      <IconButton className="yarl__button" onClick={() => onDelete(entry, currentIndex)} sx={{ color: 'common.white' }}>
        <Iconify icon="solar:trash-bin-trash-bold" width={22} />
      </IconButton>
    </Tooltip>
  );
}
