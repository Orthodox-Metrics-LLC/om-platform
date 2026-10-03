import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { fDateTime } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import {
  fetchOcrJob,
  fetchOcrJobs,
  isJobTerminal,
  type OmOcrJob,
  ocrJobImageUrl,
  type OmOcrPage,
  type OmOcrJobDetail,
  mapJobToWizardStatus,
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

/** Flattens a table-extraction JSON blob into readable rows, when present. */
function renderStructuredRows(page: OmOcrPage): { headers: string[]; rows: string[][] } | null {
  const data: any = page.tableExtractionJson || page.recordCandidates;
  if (!data) return null;

  const records: any[] | null = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows
    : Array.isArray(data?.records) ? data.records : null;
  if (!records || records.length === 0) return null;

  const headerSet = new Set<string>();
  records.forEach((r) => {
    if (r && typeof r === 'object') Object.keys(r).forEach((k) => headerSet.add(k));
  });
  const headers = [...headerSet].slice(0, 8);
  if (headers.length === 0) return null;

  const rows = records.slice(0, 50).map((r) => headers.map((h) => {
    const v = r?.[h];
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }));

  return { headers, rows };
}

export function OcrDetailView({ churchId }: Props) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<OmOcrJobDetail | null>(null);
  const [siblings, setSiblings] = useState<OmOcrJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!churchId || !id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOcrJob(churchId, id);
      setJob(data);
      if (data.batch_id) {
        try {
          const all = await fetchOcrJobs(churchId, { limit: 200 });
          setSiblings(all.filter((j) => j.batch_id === data.batch_id));
        } catch {
          setSiblings([]);
        }
      } else {
        setSiblings([]);
      }
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
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [job, load]);

  const imageUrl = job && churchId ? ocrJobImageUrl(churchId, job.id) : '';
  const pages = job?.pages && job.pages.length > 0 ? job.pages : [];
  const reviewStatus = job ? mapJobToWizardStatus(job) : null;

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading="OCR upload"
        links={[
          { name: 'Portal', href: paths.portal.root },
          { name: 'Upload Records', href: paths.portal.ocr.root },
          { name: job?.original_filename || 'Upload detail' },
        ]}
        action={
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<Iconify icon={'solar:arrow-left-bold' as any} />}
            onClick={() => navigate(paths.portal.ocr.root)}
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
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Review stage
                      </Typography>
                      <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                        {(reviewStatus || '').replace(/-/g, ' ') || 'Pending'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Type
                      </Typography>
                      <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                        {job.record_type || 'Not set'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Confidence
                      </Typography>
                      <Typography variant="body2">
                        {job.confidence_score
                          ? `${Math.round(Number(job.confidence_score) * (Number(job.confidence_score) <= 1 ? 100 : 1))}%`
                          : isJobTerminal(job) ? '—' : 'Pending'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Records found
                      </Typography>
                      <Typography variant="body2">{job.records_count ?? '—'}</Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Uploaded
                      </Typography>
                      <Typography variant="body2">{fDateTime(job.created_at)}</Typography>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              {siblings.length > 1 && (
                <Card>
                  <CardHeader title={`Images in this upload (${siblings.length})`} />
                  <CardContent>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                      {siblings.map((s) => (
                        <Chip
                          key={s.id}
                          label={`#${s.id}`}
                          size="small"
                          color={String(s.id) === String(job.id) ? 'primary' : 'default'}
                          onClick={() => navigate(paths.portal.ocr.details(s.id))}
                        />
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              )}

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
            <Stack spacing={3}>
              {pages.length > 0 ? (
                pages.map((page) => {
                  const structured = renderStructuredRows(page);
                  return (
                    <Card key={page.pageId}>
                      <CardHeader
                        title={`Page ${page.pageIndex + 1}`}
                        subheader={page.ocrConfidence ? `Confidence: ${Math.round(page.ocrConfidence * 100)}%` : undefined}
                      />
                      <CardContent>
                        {structured ? (
                          <Scrollbar sx={{ maxHeight: 420 }}>
                            <Box component="table" sx={{ width: 1, borderCollapse: 'collapse', typography: 'body2' }}>
                              <Box component="thead">
                                <Box component="tr">
                                  {structured.headers.map((h) => (
                                    <Box
                                      component="th"
                                      key={h}
                                      sx={{ textAlign: 'left', p: 1, borderBottom: '2px solid', borderColor: 'divider', textTransform: 'capitalize' }}
                                    >
                                      {h.replace(/_/g, ' ')}
                                    </Box>
                                  ))}
                                </Box>
                              </Box>
                              <Box component="tbody">
                                {structured.rows.map((r, i) => (
                                   
                                  <Box component="tr" key={i}>
                                    {r.map((cell, j) => (
                                       
                                      <Box component="td" key={j} sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                                        {cell}
                                      </Box>
                                    ))}
                                  </Box>
                                ))}
                              </Box>
                            </Box>
                          </Scrollbar>
                        ) : page.rawText ? (
                          <Scrollbar sx={{ maxHeight: 420 }}>
                            <Box
                              component="pre"
                              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', typography: 'body2', fontFamily: 'monospace', m: 0 }}
                            >
                              {page.rawText}
                            </Box>
                          </Scrollbar>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            No extracted text for this page yet.
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <Card>
                  <CardHeader title="Extracted text" />
                  <CardContent>
                    {job.ocr_text ? (
                      <Scrollbar sx={{ maxHeight: 640 }}>
                        <Box
                          component="pre"
                          sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', typography: 'body2', fontFamily: 'monospace', m: 0 }}
                        >
                          {job.ocr_text}
                        </Box>
                      </Scrollbar>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {/pending|processing/i.test(job.status)
                          ? 'OCR is still processing…'
                          : 'No extracted text is available for this upload.'}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              )}

              {job.error_regions && (
                <>
                  <Divider />
                  <Typography variant="caption" color="error">
                    {job.error_regions}
                  </Typography>
                </>
              )}
            </Stack>
          </Grid>
        </Grid>
      )}
    </DashboardContent>
  );
}
