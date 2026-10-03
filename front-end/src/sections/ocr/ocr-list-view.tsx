import { useNavigate } from 'react-router';
import { usePopover } from 'minimal-shared/hooks';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Select from '@mui/material/Select';
import Divider from '@mui/material/Divider';
import TableRow from '@mui/material/TableRow';
import Checkbox from '@mui/material/Checkbox';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import TableHead from '@mui/material/TableHead';
import TableCell from '@mui/material/TableCell';
import TableBody from '@mui/material/TableBody';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';
import FormControlLabel from '@mui/material/FormControlLabel';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { fDateTime } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';
import { useWorkspaces } from 'src/layouts/components/use-active-church';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomPopover } from 'src/components/custom-popover';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import {
  retryOcrJob,
  fetchOcrJobs,
  deleteOcrJobs,
  ocrJobImageUrl,
  renameOcrBatch,
  ocrJobDownloadUrl,
  setOcrJobArchived,
  mapJobsToBatchRows,
  type OmOcrBatchRow,
  processingModeLabel,
  setOcrBatchArchived,
  batchProcessingLabel,
  type OmOcrRecordType,
  setOcrBatchReviewReady,
  updateOcrJobRecordType,
  type OmOcrWizardStatus,
} from './om-ocr-api';

// ----------------------------------------------------------------------

const ICON_LOCK = 'solar:lock-keyhole-bold' as any;
const ICON_SEARCH = 'eva:search-fill' as any;
const ICON_MORE = 'eva:more-vertical-fill' as any;

type Props = {
  churchId: number | null;
};

const RECORD_TYPE_FILTERS = [
  { value: 'all', label: 'All Record Types' },
  { value: 'baptism', label: 'Baptism' },
  { value: 'marriage', label: 'Marriage' },
  { value: 'funeral', label: 'Funeral' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready-for-review', label: 'Needs Review' },
  { value: 'pending', label: 'Pending' },
];

const MOVE_TYPE_OPTIONS: { value: OmOcrRecordType; label: string }[] = [
  { value: 'baptism', label: 'Baptism' },
  { value: 'marriage', label: 'Marriage' },
  { value: 'funeral', label: 'Funeral' },
  { value: 'custom', label: 'Custom' },
];

type ColumnKey = 'images' | 'detected' | 'mode';
const OPTIONAL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'images', label: 'Images' },
  { key: 'detected', label: 'Detected records' },
  { key: 'mode', label: 'Processing mode' },
];

function statusColor(status: OmOcrWizardStatus): 'default' | 'primary' | 'success' | 'warning' | 'error' {
  if (status === 'completed' || status === 'already-exists') return 'success';
  if (status === 'ready-for-review') return 'primary';
  if (status === 'processing' || status === 'ready-for-image-review') return 'warning';
  if (status === 'failed' || status === 'not-church-record') return 'error';
  return 'default';
}

function BatchThumb({ churchId, jobId }: { churchId: number | null; jobId: string }) {
  const [failed, setFailed] = useState(false);
  const src = churchId && jobId ? ocrJobImageUrl(churchId, jobId) : '';
  if (!src || failed) {
    return (
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          display: 'flex',
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.neutral',
        }}
      >
        <Iconify icon={'solar:gallery-bold' as any} sx={{ color: 'text.disabled' }} />
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={src}
      onError={() => setFailed(true)}
      sx={{ width: 40, height: 40, borderRadius: 1, objectFit: 'cover', flexShrink: 0, bgcolor: 'background.neutral' }}
    />
  );
}

export function OcrListView({ churchId }: Props) {
  const navigate = useNavigate();
  const { active: activeChurch } = useWorkspaces(!!churchId);
  const [rows, setRows] = useState<OmOcrBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>({
    images: true,
    detected: true,
    mode: true,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingReadyId, setPendingReadyId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [moveTypeRow, setMoveTypeRow] = useState<OmOcrBatchRow | null>(null);
  const [confirmPurgeOpen, setConfirmPurgeOpen] = useState(false);
  const [confirmPurgeTarget, setConfirmPurgeTarget] = useState<OmOcrBatchRow | 'selected' | null>(null);

  const columnsPopover = usePopover();
  const filtersPopover = usePopover();

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!churchId) return;
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const jobs = await fetchOcrJobs(churchId, { limit: 200 });
      setRows(mapJobsToBatchRows(jobs));
    } catch (err: any) {
      setError(err?.message || 'Failed to load OCR uploads');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [churchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll (silently) while any batch is still processing, so the list keeps
  // moving forward without the user needing to manually refresh.
  useEffect(() => {
    if (!rows.some((r) => !r.allProcessed)) return undefined;
    const t = setInterval(() => load({ silent: true }), 5000);
    return () => clearInterval(t);
  }, [rows, load]);

  const handleToggleReady = async (row: OmOcrBatchRow, ready: boolean) => {
    if (!churchId || !row.batchId) return;
    setPendingReadyId(row.id);
    try {
      await setOcrBatchReviewReady(churchId, row.batchId, ready);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not update Ready for Image Review');
    } finally {
      setPendingReadyId(null);
    }
  };

  const handleRename = async (row: OmOcrBatchRow) => {
    if (!churchId || !row.batchId) return;
    const name = window.prompt('Rename this upload', row.displayName);
    if (!name || !name.trim()) return;
    try {
      await renameOcrBatch(churchId, row.batchId, name.trim());
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not rename upload');
    }
  };

  const runRowAction = async (row: OmOcrBatchRow, fn: () => Promise<void>, successMsg: string) => {
    if (!churchId) return;
    setBusyRowId(row.id);
    try {
      await fn();
      toast.success(successMsg);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Action failed');
    } finally {
      setBusyRowId(null);
    }
  };

  const handleRetryJobs = (row: OmOcrBatchRow, label: string) =>
    runRowAction(
      row,
      async () => {
        if (!churchId) return;
        await Promise.all(row.jobIds.map((jobId) => retryOcrJob(churchId, jobId)));
      },
      label,
    );

  const handleDownload = (row: OmOcrBatchRow) => {
    if (!churchId) return;
    window.open(ocrJobDownloadUrl(churchId, row.primaryJobId, 'txt'), '_blank', 'noopener');
  };

  const handleArchiveRow = (row: OmOcrBatchRow) =>
    runRowAction(
      row,
      async () => {
        if (!churchId) return;
        if (row.batchId) await setOcrBatchArchived(churchId, row.batchId, true);
        else await setOcrJobArchived(churchId, row.primaryJobId, true);
      },
      'Batch archived',
    );

  const handleDeleteRow = async (row: OmOcrBatchRow) => {
    if (!churchId) return;
    try {
      await deleteOcrJobs(churchId, row.jobIds);
      toast.success('Batch deleted');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete upload');
    } finally {
      setConfirmPurgeOpen(false);
      setConfirmPurgeTarget(null);
    }
  };

  const handleMoveType = async (newType: OmOcrRecordType) => {
    if (!churchId || !moveTypeRow) return;
    try {
      await Promise.all(moveTypeRow.jobIds.map((jobId) => updateOcrJobRecordType(churchId, jobId, newType)));
      toast.success('Record type updated');
      setMoveTypeRow(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not change record type');
    }
  };

  const handleExportSelected = () => {
    const toExport = rows.filter((r) => selectedIds.includes(r.id));
    const header = ['Batch', 'Record Type', 'Submitted', 'Images', 'Detected Records', 'Processing Mode', 'Status'];
    const lines = toExport.map((r) => [
      r.displayName,
      r.recordType,
      fDateTime(r.date),
      String(r.totalImages),
      String(r.recordsDetected),
      processingModeLabel(r.mode),
      r.status,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-records-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${toExport.length} record${toExport.length === 1 ? '' : 's'}`);
  };

  const handleArchiveSelected = async () => {
    if (!churchId) return;
    const toArchive = rows.filter((r) => selectedIds.includes(r.id));
    try {
      await Promise.all(
        toArchive.map((row) => (row.batchId
          ? setOcrBatchArchived(churchId, row.batchId, true)
          : setOcrJobArchived(churchId, row.primaryJobId, true))),
      );
      toast.success('Selected batches archived');
      setSelectedIds([]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not archive selected batches');
    }
  };

  const handlePurgeSelected = async () => {
    if (!churchId) return;
    const toDelete = rows.filter((r) => selectedIds.includes(r.id));
    try {
      await deleteOcrJobs(churchId, toDelete.flatMap((r) => r.jobIds));
      toast.success('Selected batches deleted');
      setSelectedIds([]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete selected batches');
    } finally {
      setConfirmPurgeOpen(false);
      setConfirmPurgeTarget(null);
    }
  };

  const filteredRows = rows.filter((row) => {
    if (typeFilter !== 'all' && row.recordType !== typeFilter) return false;
    if (statusFilter !== 'all') {
      const s = row.status;
      if (statusFilter === 'completed' && s !== 'completed' && s !== 'already-exists') return false;
      if (statusFilter === 'processing' && s !== 'processing' && s !== 'ready-for-image-review') return false;
      if (statusFilter === 'ready-for-review' && s !== 'ready-for-review') return false;
      if (statusFilter === 'pending' && s !== 'returned' && row.allProcessed) return false;
    }
    if (needsReviewOnly && row.needsReview === 0) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return row.displayName.toLowerCase().includes(q) || (row.originalName || '').toLowerCase().includes(q);
  });

  const allSelected = filteredRows.length > 0 && filteredRows.every((r) => selectedIds.includes(r.id));

  const churchSubtitle = activeChurch
    ? `${activeChurch.name}${activeChurch.city ? ` — ${activeChurch.city}, ${activeChurch.state || ''}`.trim() : ''} (#${activeChurch.id})`
    : null;

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading="Records"
        links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Records' }]}
        action={
          <Button
            variant="contained"
            startIcon={<Iconify icon={'solar:upload-bold' as any} />}
            onClick={() => navigate(paths.portal.ocr.upload)}
          >
            Upload batch
          </Button>
        }
        sx={{ mb: 1 }}
      />

      <Stack1 refreshing={refreshing}>
        Track OCR processing and review parish records.
      </Stack1>
      {churchSubtitle && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {churchSubtitle}
        </Typography>
      )}
      {!churchSubtitle && <Box sx={{ mb: 3 }} />}

      {!churchId && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Select a parish to view uploaded records.
        </Typography>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <Card>
        <Box
          sx={{
            p: 2,
            gap: 2,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Box
            sx={{
              px: 1.5,
              flexGrow: 1,
              minWidth: 240,
              height: 40,
              gap: 1,
              display: 'flex',
              borderRadius: 1,
              alignItems: 'center',
              border: (theme) => `solid 1px ${theme.vars.palette.divider}`,
            }}
          >
            <Iconify icon={ICON_SEARCH} sx={{ color: 'text.disabled' }} />
            <InputBase
              fullWidth
              placeholder="Search batches, filenames, or IDs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Box>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              {RECORD_TYPE_FILTERS.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            color={Object.values(visibleColumns).some((v) => !v) ? 'primary' : 'inherit'}
            startIcon={<Iconify icon={"solar:sort-horizontal-bold" as any} />}
            onClick={columnsPopover.onOpen}
          >
            Columns
          </Button>
          <Button
            color={needsReviewOnly ? 'primary' : 'inherit'}
            startIcon={<Iconify icon="ic:round-filter-list" />}
            onClick={filtersPopover.onOpen}
          >
            Filters
          </Button>

          <CustomPopover open={columnsPopover.open} anchorEl={columnsPopover.anchorEl} onClose={columnsPopover.onClose}>
            <MenuList sx={{ p: 1 }}>
              {OPTIONAL_COLUMNS.map((col) => (
                <MenuItem key={col.key} onClick={() => setVisibleColumns((prev) => ({ ...prev, [col.key]: !prev[col.key] }))}>
                  <Checkbox checked={visibleColumns[col.key]} size="small" sx={{ mr: 1 }} />
                  {col.label}
                </MenuItem>
              ))}
            </MenuList>
          </CustomPopover>

          <CustomPopover open={filtersPopover.open} anchorEl={filtersPopover.anchorEl} onClose={filtersPopover.onClose}>
            <Box sx={{ p: 2, minWidth: 240 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={needsReviewOnly}
                    onChange={(e) => setNeedsReviewOnly(e.target.checked)}
                  />
                }
                label="Needs review only"
              />
            </Box>
          </CustomPopover>
        </Box>

        {selectedIds.length > 0 && (
          <>
            <Divider />
            <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="subtitle2">{selectedIds.length} selected</Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Button size="small" startIcon={<Iconify icon={"eva:download-fill" as any} />} onClick={handleExportSelected}>
                Export
              </Button>
              <Button size="small" startIcon={<Iconify icon={"solar:archive-bold" as any} />} onClick={handleArchiveSelected}>
                Archive
              </Button>
              <Button
                size="small"
                color="error"
                startIcon={<Iconify icon="solar:trash-bin-trash-bold" />}
                onClick={() => { setConfirmPurgeTarget('selected'); setConfirmPurgeOpen(true); }}
              >
                Purge
              </Button>
              <Button size="small" color="inherit" onClick={() => setSelectedIds([])}>
                Clear
              </Button>
            </Box>
          </>
        )}

        <Divider />

        <TableContainer component={Scrollbar}>
          <Table size="small" sx={{ minWidth: 1080 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selectedIds.length > 0 && !allSelected}
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? filteredRows.map((r) => r.id) : [])
                    }
                  />
                </TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Record type</TableCell>
                <TableCell>Submitted</TableCell>
                {visibleColumns.images && <TableCell>Images</TableCell>}
                {visibleColumns.detected && <TableCell>Detected records</TableCell>}
                {visibleColumns.mode && <TableCell>Processing mode</TableCell>}
                <TableCell sx={{ minWidth: 180 }}>Processing status</TableCell>
                <TableCell sx={{ minWidth: 200 }}>Review readiness</TableCell>
                <TableCell sx={{ minWidth: 120 }}>Review action</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 6 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    {rows.length === 0
                      ? 'No uploads yet. Use Upload batch above to get started.'
                      : 'No uploads match your search.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => (
                  <OcrBatchRow
                    key={row.id}
                    row={row}
                    churchId={churchId}
                    selected={selectedIds.includes(row.id)}
                    pendingReady={pendingReadyId === row.id}
                    busy={busyRowId === row.id}
                    onToggleSelected={(checked) =>
                      setSelectedIds((prev) => (checked ? [...prev, row.id] : prev.filter((id) => id !== row.id)))
                    }
                    onToggleReady={(ready) => handleToggleReady(row, ready)}
                    onRename={() => handleRename(row)}
                    onRetryOcr={() => handleRetryJobs(row, 'OCR re-run started')}
                    onReprocessBatch={() => handleRetryJobs(row, 'Batch reprocessing started')}
                    onDownload={() => handleDownload(row)}
                    onMoveType={() => setMoveTypeRow(row)}
                    onArchive={() => handleArchiveRow(row)}
                    onDelete={() => { setConfirmPurgeTarget(row); setConfirmPurgeOpen(true); }}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Divider />
        <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Showing {filteredRows.length} of {rows.length} records
          </Typography>
          {selectedIds.length > 0 && (
            <Typography variant="body2" color="primary.main" sx={{ fontWeight: 600 }}>
              {selectedIds.length} selected
            </Typography>
          )}
        </Box>
      </Card>

      <MoveTypeDialog
        row={moveTypeRow}
        onClose={() => setMoveTypeRow(null)}
        onConfirm={handleMoveType}
      />

      <ConfirmDialog
        open={confirmPurgeOpen}
        onClose={() => { setConfirmPurgeOpen(false); setConfirmPurgeTarget(null); }}
        title="Delete batch"
        content={
          confirmPurgeTarget === 'selected'
            ? `Permanently delete ${selectedIds.length} selected batch(es) and all their images? This cannot be undone.`
            : confirmPurgeTarget
              ? `Permanently delete "${confirmPurgeTarget.displayName}" and its ${confirmPurgeTarget.totalImages} image(s)? This cannot be undone.`
              : ''
        }
        action={
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (confirmPurgeTarget === 'selected') handlePurgeSelected();
              else if (confirmPurgeTarget) handleDeleteRow(confirmPurgeTarget);
            }}
          >
            Delete
          </Button>
        }
      />
    </DashboardContent>
  );
}

// ----------------------------------------------------------------------
// Small helper so the subtitle line can show a subtle "syncing" spinner
// next to the copy without restructuring the layout above.

function Stack1({ children, refreshing }: { children: React.ReactNode; refreshing: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {children}
      </Typography>
      {refreshing && <CircularProgress size={12} thickness={6} />}
    </Box>
  );
}

// ----------------------------------------------------------------------

type RowProps = {
  row: OmOcrBatchRow;
  churchId: number | null;
  selected: boolean;
  pendingReady: boolean;
  busy: boolean;
  onToggleSelected: (checked: boolean) => void;
  onToggleReady: (ready: boolean) => void;
  onRename: () => void;
  onRetryOcr: () => void;
  onReprocessBatch: () => void;
  onDownload: () => void;
  onMoveType: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

function OcrBatchRow({
  row,
  churchId,
  selected,
  pendingReady,
  busy,
  onToggleSelected,
  onToggleReady,
  onRename,
  onRetryOcr,
  onReprocessBatch,
  onDownload,
  onMoveType,
  onArchive,
  onDelete,
}: RowProps) {
  const navigate = useNavigate();
  const menu = usePopover();
  const pct = row.totalImages > 0 ? Math.round((row.completedImages / row.totalImages) * 100) : 0;
  const isProcessing = !row.allProcessed;

  // Routes into the upload wizard at a specific step for this existing
  // batch, instead of the plain job-detail/debug page.
  const goToStep = (step: 'image-review' | 'processing' | 'record-review') => {
    const jobIds = row.jobIds.join(',');
    navigate(`${paths.portal.ocr.upload}?jobIds=${encodeURIComponent(jobIds)}&step=${step}`);
  };

  return (
    <>
      <TableRow hover selected={selected}>
        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onChange={(e) => onToggleSelected(e.target.checked)} />
        </TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <BatchThumb churchId={churchId} jobId={row.primaryJobId} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap sx={{ maxWidth: 220 }}>
                {row.displayName} {row.totalImages > 1 ? `(${row.totalImages} images)` : ''}
              </Typography>
              {row.originalName && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 220 }}>
                  {row.originalName}
                </Typography>
              )}
              {row.batchId && (
                <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block', maxWidth: 220 }}>
                  {row.batchId}
                </Typography>
              )}
            </Box>
          </Box>
        </TableCell>
        <TableCell>
          <Label
            color={row.recordType === 'baptism' ? 'info' : row.recordType === 'marriage' ? 'primary' : row.recordType === 'funeral' ? 'warning' : 'default'}
            variant="soft"
            sx={{ textTransform: 'capitalize' }}
          >
            {row.recordType}
          </Label>
        </TableCell>
        <TableCell>{fDateTime(row.date)}</TableCell>
        <TableCell><Typography variant="subtitle2">{row.totalImages}</Typography></TableCell>
        <TableCell><Typography variant="subtitle2">{row.recordsDetected || '—'}</Typography></TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: row.mode === 'automatic' ? 'primary.main' : 'text.secondary',
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {processingModeLabel(row.mode)}
            </Typography>
          </Box>
        </TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Label
              color={statusColor(row.status)}
              variant="soft"
              sx={{ flexShrink: 0 }}
            >
              {batchProcessingLabel(row)}
            </Label>
            {isProcessing && <CircularProgress size={12} thickness={6} />}
            <Typography variant="caption" color="text.secondary">{pct}%</Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={pct}
            color={row.allProcessed ? 'success' : row.status === 'failed' ? 'error' : 'primary'}
            sx={{ mt: 0.5, height: 5, borderRadius: 1 }}
          />
        </TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: row.reviewReady ? 'success.lighter' : !row.allProcessed ? 'grey.100' : 'warning.lighter',
                flexShrink: 0,
              }}
            >
              <Iconify
                icon={row.reviewReady ? ('eva:checkmark-circle-2-fill' as any) : !row.allProcessed ? (ICON_LOCK as any) : ('solar:clock-circle-bold' as any)}
                width={18}
                sx={{ color: row.reviewReady ? 'success.dark' : !row.allProcessed ? 'text.disabled' : 'warning.dark' }}
              />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                {row.reviewReady ? 'Ready for review' : !row.allProcessed ? 'Not ready' : 'Needs review'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {row.reviewReady && row.readyByName
                  ? `OCR processing complete`
                  : !row.allProcessed
                    ? 'Processing in progress'
                    : row.needsReview > 0
                      ? `${row.needsReview} issues detected`
                      : 'OCR processing complete'}
              </Typography>
            </Box>
          </Box>
        </TableCell>
        <TableCell>
          <Button
            size="small"
            fullWidth
            variant={row.allProcessed ? 'contained' : 'outlined'}
            color={row.allProcessed ? 'primary' : 'inherit'}
            disabled={!row.allProcessed && !row.batchId && row.jobIds.length === 0}
            loading={pendingReady}
            onClick={row.allProcessed ? () => goToStep('image-review') : () => onToggleReady(true)}
          >
            {row.allProcessed ? 'Review images' : 'View progress'}
          </Button>
        </TableCell>
        <TableCell align="right" sx={{ pr: 1 }} onClick={(e) => e.stopPropagation()}>
          <IconButton color={menu.open ? 'inherit' : 'default'} onClick={menu.onOpen} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : <Iconify icon={ICON_MORE} />}
          </IconButton>
        </TableCell>
      </TableRow>

      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose}>
        <MenuList>
          <MenuItem onClick={() => { menu.onClose(); goToStep('image-review'); }}>
            <Iconify icon={"solar:folder-open-bold" as any} />
            Open batch
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); goToStep('record-review'); }}>
            <Iconify icon={"solar:document-text-bold" as any} />
            Review records
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); goToStep('image-review'); }}>
            <Iconify icon="solar:gallery-wide-bold" />
            View source images
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); goToStep('processing'); }}>
            <Iconify icon={"solar:chart-2-bold" as any} />
            View processing details
          </MenuItem>
          <Divider sx={{ borderStyle: 'dashed' }} />
          <MenuItem onClick={() => { menu.onClose(); onRetryOcr(); }}>
            <Iconify icon={"solar:refresh-bold" as any} />
            Re-run OCR
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); onReprocessBatch(); }}>
            <Iconify icon={"eva:repeat-fill" as any} />
            Reprocess batch
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); onDownload(); }}>
            <Iconify icon={"eva:download-fill" as any} />
            Download
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); onMoveType(); }}>
            <Iconify icon={"solar:transfer-horizontal-bold" as any} />
            Move / change record type
          </MenuItem>
          <Divider sx={{ borderStyle: 'dashed' }} />
          <MenuItem onClick={() => { menu.onClose(); onRename(); }}>
            <Iconify icon="solar:pen-bold" />
            Rename
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); onArchive(); }}>
            <Iconify icon={"solar:archive-bold" as any} />
            Archive batch
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); onDelete(); }} sx={{ color: 'error.main' }}>
            <Iconify icon="solar:trash-bin-trash-bold" />
            Delete batch
          </MenuItem>
        </MenuList>
      </CustomPopover>
    </>
  );
}

// ----------------------------------------------------------------------

function MoveTypeDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: OmOcrBatchRow | null;
  onClose: () => void;
  onConfirm: (type: OmOcrRecordType) => void;
}) {
  const [value, setValue] = useState<OmOcrRecordType>('baptism');

  useEffect(() => {
    if (row) setValue((row.recordType as OmOcrRecordType) || 'baptism');
  }, [row]);

  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Change record type</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Applies to every image in &quot;{row?.displayName}&quot;.
        </Typography>
        <FormControl fullWidth size="small">
          <Select value={value} onChange={(e) => setValue(e.target.value as OmOcrRecordType)}>
            {MOVE_TYPE_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onConfirm(value)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
