import { useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableHead from '@mui/material/TableHead';
import TableCell from '@mui/material/TableCell';
import TableBody from '@mui/material/TableBody';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Pagination from '@mui/material/Pagination';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { fetchOcrJobs, type OmOcrJob } from './om-ocr-api';

// ----------------------------------------------------------------------

type Props = {
  churchId: number | null;
};

const PAGE_SIZE = 25;

function statusColor(status: string): 'default' | 'primary' | 'success' | 'warning' | 'error' {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'complete' || s === 'seeded') return 'success';
  if (s === 'processing' || s === 'pending') return 'warning';
  if (s === 'error' || s === 'cancelled') return 'error';
  return 'default';
}

export function OcrListView({ churchId }: Props) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<OmOcrJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!churchId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchOcrJobs(churchId, { limit: 200 });
      setJobs(rows);
    } catch (err: any) {
      setError(err?.message || 'Failed to load OCR jobs');
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh every 10s while jobs are still pending/processing.
  useEffect(() => {
    if (!jobs.some((j) => /pending|processing/i.test(j.status))) return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const pageCount = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const pageJobs = jobs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading="OCR Uploads"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'OCR Uploads' }]}
        action={
          <Button
            variant="contained"
            startIcon={<Iconify icon={'solar:add-circle-bold' as any} />}
            onClick={() => navigate(paths.dashboard.ocr.upload)}
          >
            New upload
          </Button>
        }
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      {!churchId && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Select a parish to view OCR uploads.
        </Typography>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <Card>
        <TableContainer component={Scrollbar}>
          <Table size="small" sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell>Filename</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Confidence</TableCell>
                <TableCell>Records</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : pageJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    No OCR uploads yet.
                  </TableCell>
                </TableRow>
              ) : (
                pageJobs.map((job) => (
                  <TableRow key={job.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2" noWrap sx={{ maxWidth: 260 }}>
                        {job.original_filename || job.filename}
                      </Typography>
                    </TableCell>
                    <TableCell>{job.record_type || '—'}</TableCell>
                    <TableCell>
                      <Label color={statusColor(job.status)}>{job.status}</Label>
                    </TableCell>
                    <TableCell>
                      {job.confidence_score ? `${Math.round(job.confidence_score * 100)}%` : '—'}
                    </TableCell>
                    <TableCell>{job.records_count ?? '—'}</TableCell>
                    <TableCell>{fDateTime(job.created_at)}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => navigate(paths.dashboard.ocr.details(job.id))}
                      >
                        <Iconify icon={'solar:eye-bold' as any} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {pageCount > 1 && (
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
            <Pagination page={page} count={pageCount} onChange={(_, next) => setPage(next)} />
          </Box>
        )}
      </Card>
    </Box>
  );
}
