import { useNavigate } from 'react-router';
import { useRef, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import Divider from '@mui/material/Divider';
import TableRow from '@mui/material/TableRow';
import Checkbox from '@mui/material/Checkbox';
import MenuItem from '@mui/material/MenuItem';
import TableHead from '@mui/material/TableHead';
import TableCell from '@mui/material/TableCell';
import TableBody from '@mui/material/TableBody';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { fDateTime } from 'src/utils/format-time';

import { useWorkspaces } from 'src/layouts/components/use-active-church';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { OcrUploadPanel } from './ocr-upload-panel';
import {
  fetchOcrJobs,
  ocrJobImageUrl,
  mapJobsToBatchRows,
  type OmOcrBatchRow,
  processingModeLabel,
  batchProcessingLabel,
  setOcrBatchReviewReady,
  type OmOcrWizardStatus,
} from './om-ocr-api';

// ----------------------------------------------------------------------

const ICON_EYE = 'solar:eye-bold' as any;
const ICON_LOCK = 'solar:lock-keyhole-bold' as any;
const ICON_SEARCH = 'eva:search-fill' as any;

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingReadyId, setPendingReadyId] = useState<string | null>(null);
  const uploadPanelRef = useRef<HTMLDivElement>(null);

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

  const filteredRows = rows.filter((row) => {
    if (typeFilter !== 'all' && row.recordType !== typeFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return row.displayName.toLowerCase().includes(q) || (row.originalName || '').toLowerCase().includes(q);
  });

  const allSelected = filteredRows.length > 0 && filteredRows.every((r) => selectedIds.includes(r.id));

  const churchSubtitle = activeChurch
    ? `${activeChurch.name}${activeChurch.city ? ` — ${activeChurch.city}, ${activeChurch.state || ''}`.trim() : ''} (#${activeChurch.id})`
    : null;

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading="Upload Records"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'Upload Records' }]}
        action={
          <Button
            variant="contained"
            startIcon={<Iconify icon={'solar:add-circle-bold' as any} />}
            onClick={() => uploadPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
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

      <Card sx={{ mb: 3 }}>
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
                <TableCell sx={{ minWidth: 180 }}>Processing</TableCell>
                <TableCell sx={{ minWidth: 200 }}>Review readiness</TableCell>
                <TableCell sx={{ minWidth: 160 }}>Review action / progress</TableCell>
                <TableCell align="right">Actions</TableCell>
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
                      ? 'No uploads yet. Use New Upload below to get started.'
                      : 'No uploads match your search.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => {
                  const pct = row.totalImages > 0
                    ? Math.round((row.completedImages / row.totalImages) * 100)
                    : 0;
                  const reviewEnabled = row.allProcessed && row.reviewReady;
                  const selected = selectedIds.includes(row.id);
                  return (
                    <TableRow key={row.id} hover selected={selected}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selected}
                          onChange={(e) =>
                            setSelectedIds((prev) =>
                              e.target.checked ? [...prev, row.id] : prev.filter((id) => id !== row.id)
                            )
                          }
                        />
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
                        <Label color={statusColor(row.status)} sx={{ textTransform: 'capitalize' }}>
                          {row.recordType}
                        </Label>
                      </TableCell>
                      <TableCell>{fDateTime(row.date)}</TableCell>
                      <TableCell>{row.totalImages}</TableCell>
                      <TableCell>{row.recordsDetected || '—'}</TableCell>
                      <TableCell>
                        <Label color="info" variant="soft">
                          {processingModeLabel(row.mode)}
                        </Label>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 600, color: row.allProcessed ? 'success.main' : 'text.primary' }}
                        >
                          {batchProcessingLabel(row)}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          color={row.allProcessed ? 'success' : 'primary'}
                          sx={{ mt: 0.5, height: 6, borderRadius: 1 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                          <Checkbox
                            size="small"
                            checked={row.reviewReady}
                            disabled={!row.allProcessed || !row.batchId || pendingReadyId === row.id}
                            onChange={(e) => handleToggleReady(row, e.target.checked)}
                          />
                          <Box>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              Ready for Image Review
                            </Typography>
                            {row.reviewReady && row.readyByName ? (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                By {row.readyByName}
                              </Typography>
                            ) : !row.allProcessed ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                              >
                                <Iconify icon={ICON_LOCK} width={12} /> Available once processing completes
                              </Typography>
                            ) : null}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          fullWidth
                          variant={reviewEnabled ? 'contained' : 'outlined'}
                          color={reviewEnabled ? 'primary' : 'inherit'}
                          disabled={!reviewEnabled}
                          onClick={() => navigate(paths.dashboard.ocr.details(row.primaryJobId))}
                        >
                          Review Images
                        </Button>
                        {row.recordsDetected > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            {row.recordsConfirmed} of {row.recordsDetected}{' '}
                            {row.needsReview > 0 ? `· ${row.needsReview} need attention` : 'auto-added'}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => navigate(paths.dashboard.ocr.details(row.primaryJobId))}
                        >
                          <Iconify icon={ICON_EYE} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Card ref={uploadPanelRef}>
        <CardHeader title="New Upload" subheader="Add images or PDFs for OCR processing" />
        <CardContent>
          <OcrUploadPanel churchId={churchId} onUploaded={load} />
        </CardContent>
      </Card>
    </Box>
  );
}
