import { useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import TableRow from '@mui/material/TableRow';
import Checkbox from '@mui/material/Checkbox';
import TableHead from '@mui/material/TableHead';
import TableCell from '@mui/material/TableCell';
import TableBody from '@mui/material/TableBody';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { OcrUploadPanel } from './ocr-upload-panel';
import {
  statusLabel,
  fetchOcrJobs,
  mapJobsToBatchRows,
  type OmOcrBatchRow,
  batchProcessingLabel,
  setOcrBatchReviewReady,
  type OmOcrWizardStatus,
} from './om-ocr-api';

// ----------------------------------------------------------------------

const ICON_ADD = 'solar:add-circle-bold' as any;
const ICON_EYE = 'solar:eye-bold' as any;
const ICON_LOCK = 'solar:lock-keyhole-bold' as any;

type Props = {
  churchId: number | null;
};

function statusColor(status: OmOcrWizardStatus): 'default' | 'primary' | 'success' | 'warning' | 'error' {
  if (status === 'completed' || status === 'already-exists') return 'success';
  if (status === 'ready-for-review') return 'primary';
  if (status === 'processing' || status === 'ready-for-image-review') return 'warning';
  if (status === 'failed' || status === 'not-church-record') return 'error';
  return 'default';
}

export function OcrListView({ churchId }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<OmOcrBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
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

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading="Upload Records"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'Upload Records' }]}
        action={
          <Button
            variant="contained"
            startIcon={<Iconify icon={ICON_ADD} />}
            onClick={() => setShowUpload((v) => !v)}
          >
            New Upload
          </Button>
        }
        sx={{ mb: { xs: 3, md: 5 } }}
      />

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

      <Collapse in={showUpload} unmountOnExit sx={{ mb: 3 }}>
        <Card>
          <CardHeader title="Upload new images or PDFs" />
          <CardContent>
            <OcrUploadPanel
              churchId={churchId}
              onUploaded={() => {
                setShowUpload(false);
                load();
              }}
            />
          </CardContent>
        </Card>
      </Collapse>

      <Card>
        <TableContainer component={Scrollbar}>
          <Table size="small" sx={{ minWidth: 960 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Upload</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Pages</TableCell>
                <TableCell sx={{ minWidth: 180 }}>Processing</TableCell>
                <TableCell sx={{ minWidth: 220 }}>Ready for image review</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    No uploads yet. Click &quot;New Upload&quot; to get started.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const pct = row.totalImages > 0
                    ? Math.round((row.completedImages / row.totalImages) * 100)
                    : 0;
                  const reviewEnabled = row.allProcessed && row.reviewReady;
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell padding="checkbox">
                        <Checkbox disabled />
                      </TableCell>
                      <TableCell>
                        <Typography variant="subtitle2" noWrap sx={{ maxWidth: 240 }}>
                          {row.displayName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.submittedBy}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Label color={statusColor(row.status)} sx={{ textTransform: 'capitalize' }}>
                          {row.recordType}
                        </Label>
                      </TableCell>
                      <TableCell>{fDateTime(row.date)}</TableCell>
                      <TableCell>{row.totalImages}</TableCell>
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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant={reviewEnabled ? 'contained' : 'outlined'}
                          color={reviewEnabled ? 'primary' : 'inherit'}
                          disabled={!reviewEnabled}
                          onClick={() => navigate(paths.dashboard.ocr.details(row.primaryJobId))}
                          sx={{ mr: 1 }}
                        >
                          Review
                        </Button>
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

      {rows.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Statuses: {Array.from(new Set(rows.map((r) => r.status))).map(statusLabel).join(' · ')}
        </Typography>
      )}
    </Box>
  );
}
