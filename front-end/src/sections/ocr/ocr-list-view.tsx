import { useNavigate } from 'react-router';
import { usePopover } from 'minimal-shared/hooks';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
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
import FormControl from '@mui/material/FormControl';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { fDateTime } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';
import { useWorkspaces } from 'src/layouts/components/use-active-church';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomPopover } from 'src/components/custom-popover';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import {
  fetchOcrJobs,
  deleteOcrJobs,
  ocrJobImageUrl,
  renameOcrBatch,
  mapJobsToBatchRows,
  type OmOcrBatchRow,
  processingModeLabel,
  batchProcessingLabel,
  setOcrBatchReviewReady,
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
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingReadyId, setPendingReadyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!churchId) return;
    setLoading(true);
    setError(null);
    try {
      const jobs = await fetchOcrJobs(churchId, { limit: 200 });
      setRows(mapJobsToBatchRows(jobs));
    } catch (err: any) {
      setError(err?.message || 'Failed to load OCR uploads');
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while any batch is still processing.
  useEffect(() => {
    if (!rows.some((r) => !r.allProcessed)) return undefined;
    const t = setInterval(load, 8000);
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
      setError(err?.message || 'Could not rename upload');
    }
  };

  const handleDelete = async (row: OmOcrBatchRow) => {
    if (!churchId) return;
    if (!window.confirm(`Delete "${row.displayName}" and its ${row.totalImages} image(s)? This cannot be undone.`)) return;
    try {
      await deleteOcrJobs(churchId, row.jobIds);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not delete upload');
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
        heading="Upload Records"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'Upload Records' }]}
        action={
          <Button
            variant="contained"
            startIcon={<Iconify icon={'solar:add-circle-bold' as any} />}
            onClick={() => navigate(paths.dashboard.ocr.upload)}
          >
            New Upload
          </Button>
        }
        sx={{ mb: 1 }}
      />

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
        Parish upload batches — start a new upload or return to a prior one.
      </Typography>
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
              placeholder="Search uploads…"
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

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Checkbox
              checked={allSelected}
              indeterminate={selectedIds.length > 0 && !allSelected}
              onChange={(e) =>
                setSelectedIds(e.target.checked ? filteredRows.map((r) => r.id) : [])
              }
            />
            <Typography variant="body2">Select all</Typography>
          </Box>
        </Box>

        <Divider />

        <TableContainer component={Scrollbar}>
          <Table size="small" sx={{ minWidth: 1080 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Batch</TableCell>
                <TableCell>Record type</TableCell>
                <TableCell>Submitted</TableCell>
                <TableCell>Images</TableCell>
                <TableCell>Detected records</TableCell>
                <TableCell>Processing mode</TableCell>
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
                      ? 'No uploads yet. Use New Upload above to get started.'
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
                    onToggleSelected={(checked) =>
                      setSelectedIds((prev) => (checked ? [...prev, row.id] : prev.filter((id) => id !== row.id)))
                    }
                    onToggleReady={(ready) => handleToggleReady(row, ready)}
                    onView={() => navigate(paths.dashboard.ocr.details(row.primaryJobId))}
                    onRename={() => handleRename(row)}
                    onDelete={() => handleDelete(row)}
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
    </DashboardContent>
  );
}

// ----------------------------------------------------------------------

type RowProps = {
  row: OmOcrBatchRow;
  churchId: number | null;
  selected: boolean;
  pendingReady: boolean;
  onToggleSelected: (checked: boolean) => void;
  onToggleReady: (ready: boolean) => void;
  onView: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function OcrBatchRow({
  row,
  churchId,
  selected,
  pendingReady,
  onToggleSelected,
  onToggleReady,
  onView,
  onRename,
  onDelete,
}: RowProps) {
  const menu = usePopover();
  const pct = row.totalImages > 0 ? Math.round((row.completedImages / row.totalImages) * 100) : 0;

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
            disabled={!row.allProcessed}
            onClick={onView}
          >
            {row.allProcessed ? 'Review images' : 'View progress'}
          </Button>
        </TableCell>
        <TableCell align="right" sx={{ pr: 1 }} onClick={(e) => e.stopPropagation()}>
          <IconButton color={menu.open ? 'inherit' : 'default'} onClick={menu.onOpen}>
            <Iconify icon={ICON_MORE} />
          </IconButton>
        </TableCell>
      </TableRow>

      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose}>
        <MenuList>
          <MenuItem onClick={() => { menu.onClose(); onView(); }}>
            <Iconify icon="solar:eye-bold" />
            View
          </MenuItem>
          <MenuItem onClick={() => { menu.onClose(); onRename(); }}>
            <Iconify icon="solar:pen-bold" />
            Rename
          </MenuItem>
          <Divider sx={{ borderStyle: 'dashed' }} />
          <MenuItem onClick={() => { menu.onClose(); onDelete(); }} sx={{ color: 'error.main' }}>
            <Iconify icon="solar:trash-bin-trash-bold" />
            Delete
          </MenuItem>
        </MenuList>
      </CustomPopover>
    </>
  );
}
