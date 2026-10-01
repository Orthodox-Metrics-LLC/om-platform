import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import {
  fetchOcrJob,
  ocrJobImageUrl,
  type OmOcrJobDetail,
} from './om-ocr-api';

// ----------------------------------------------------------------------

type Props = {
  churchId: number | null;
};

function statusColor(status: string): 'default' | 'primary' | 'success' | 'warning' | 'error' {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'complete' || s === 'seeded') return 'success';
  if (s === 'processing' || s === 'pending') return 'warning';
  if (s === 'error' || s === 'cancelled') return 'error';
  return 'default';
}

export function OcrDetailView({ churchId }: Props) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<OmOcrJobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!churchId || !id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOcrJob(churchId, id);
      setJob(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load OCR job');
    } finally {
      setLoading(false);
    }
  }, [churchId, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!job || !/pending|processing/i.test(job.status)) return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [job, load]);

  const imageUrl = job && churchId ? ocrJobImageUrl(churchId, job.id) : '';

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading="OCR job"
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'OCR Uploads', href: paths.dashboard.ocr.root },
          { name: job?.original_filename || 'Job detail' },
        ]}
        action={
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<Iconify icon={'solar:arrow-left-bold' as any} />}
            onClick={() => navigate(paths.dashboard.ocr.root)}
          >
            Back
          </Button>
        }
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      {!churchId && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Select a parish to view OCR details.
        </Typography>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {loading && !job && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {job && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={3}>
              <Card>
                <CardHeader title="Summary" />
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Status
                      </Typography>
                      <Label color={statusColor(job.status)}>{job.status}</Label>
                    </Stack>
                    {job.review_status && (
                      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                        <Typography variant="body2" color="text.secondary">
                          Review
                        </Typography>
                        <Typography variant="body2">{job.review_status}</Typography>
                      </Stack>
                    )}
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Type
                      </Typography>
                      <Typography variant="body2">{job.record_type || '—'}</Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Confidence
                      </Typography>
                      <Typography variant="body2">
                        {job.confidence_score ? `${Math.round(job.confidence_score * 100)}%` : '—'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Records
                      </Typography>
                      <Typography variant="body2">{job.records_count ?? '—'}</Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Created
                      </Typography>
                      <Typography variant="body2">{fDateTime(job.created_at)}</Typography>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Box
                    component="img"
                    src={imageUrl}
                    alt={job.original_filename}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                    sx={{
                      width: '100%',
                      height: 'auto',
                      borderRadius: 1,
                      bgcolor: 'background.neutral',
                    }}
                  />
                </CardContent>
              </Card>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Card sx={{ height: 1 }}>
              <CardHeader title="Extracted text" />
              <CardContent>
                {job.ocr_text ? (
                  <Scrollbar sx={{ maxHeight: 640 }}>
                    <Box
                      component="pre"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        typography: 'body2',
                        fontFamily: 'monospace',
                        m: 0,
                      }}
                    >
                      {job.ocr_text}
                    </Box>
                  </Scrollbar>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {/pending|processing/i.test(job.status)
                      ? 'OCR is still processing...'
                      : 'No extracted text available.'}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
