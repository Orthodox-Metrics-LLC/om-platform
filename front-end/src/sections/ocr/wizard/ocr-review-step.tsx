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

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

import {
  fetchOcrJobs,
  type OmOcrJob,
  ocrJobImageUrl,
  mapJobToWizardStatus,
} from '../om-ocr-api';

// ----------------------------------------------------------------------

type Props = {
  churchId: number | null;
  jobIds: string[];
  onBack: () => void;
  onNext: () => void;
};

function statusColor(status: string): 'default' | 'primary' | 'success' | 'warning' | 'error' {
  if (status === 'completed' || status === 'already-exists') return 'success';
  if (status === 'ready-for-review') return 'primary';
  if (status === 'processing' || status === 'ready-for-image-review') return 'warning';
  if (status === 'failed' || status === 'not-church-record') return 'error';
  return 'default';
}

export function OcrReviewStep({ churchId, jobIds, onBack, onNext }: Props) {
  const [jobs, setJobs] = useState<OmOcrJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!churchId) return;
    try {
      const all = await fetchOcrJobs(churchId, { limit: 200 });
      setJobs(all.filter((job) => jobIds.includes(String(job.id))));
    } finally {
      setLoading(false);
    }
  }, [churchId, jobIds]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack spacing={3}>
      <Card>
        <CardHeader
          title="Review the images you uploaded"
          subheader="Confirm these are the pages you want processed before OCR starts"
        />
        <CardContent>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : jobs.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No images found for this upload.
            </Typography>
          ) : (
            <Grid container spacing={2}>
              {jobs.map((job) => {
                const status = mapJobToWizardStatus(job);
                return (
                  <Grid key={job.id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
                      <Box
                        component="img"
                        src={churchId ? ocrJobImageUrl(churchId, job.id) : ''}
                        alt={job.original_filename}
                        sx={{ width: 1, height: 180, objectFit: 'cover', bgcolor: 'background.neutral' }}
                      />
                      <Box sx={{ p: 1.5 }}>
                        <Typography variant="subtitle2" noWrap>
                          {job.original_filename}
                        </Typography>
                        <Label color={statusColor(status)} variant="soft" sx={{ mt: 1 }}>
                          {status.replace(/-/g, ' ')}
                        </Label>
                      </Box>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </CardContent>
      </Card>

      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Button color="inherit" variant="outlined" size="large" startIcon={<Iconify icon="eva:arrow-ios-back-fill" />} onClick={onBack}>
          Back
        </Button>
        <Button variant="contained" size="large" endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />} onClick={onNext}>
          Start processing
        </Button>
      </Stack>
    </Stack>
  );
}
