import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

import {
  fetchOcrJobs,
  isJobTerminal,
  type OmOcrJob,
  WIZARD_PROCESSING_STEPS,
  wizardProcessingStepIndex,
} from '../om-ocr-api';

// ----------------------------------------------------------------------
// Processing — pipeline stages with running/complete/pending states,
// metrics sidebar showing images remaining and records found.

type PipelineState = 'pending' | 'running' | 'complete' | 'warning' | 'failed';

function stageState(stageIndex: number, activeStage: number, hasFailed: boolean): PipelineState {
  if (hasFailed && stageIndex === activeStage) return 'failed';
  if (stageIndex < activeStage) return 'complete';
  if (stageIndex === activeStage) return 'running';
  return 'pending';
}

function stageIcon(state: PipelineState) {
  switch (state) {
    case 'complete': return <Iconify icon="eva:checkmark-fill" width={16} sx={{ color: 'white' }} />;
    case 'running': return <CircularProgress size={16} thickness={4} />;
    case 'failed': return <Iconify icon={'eva:close-fill' as any} width={16} sx={{ color: 'white' }} />;
    case 'warning': return <Iconify icon={'eva:alert-triangle-fill' as any} width={16} />;
    default: return <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'grey.400' }} />;
  }
}

function stageBgColor(state: PipelineState): string {
  switch (state) {
    case 'complete': return 'success.main';
    case 'running': return 'primary.lighter';
    case 'failed': return 'error.main';
    case 'warning': return 'warning.lighter';
    default: return 'transparent';
  }
}

function stageBorderColor(state: PipelineState): string {
  switch (state) {
    case 'complete': return 'success.main';
    case 'running': return 'primary.main';
    case 'failed': return 'error.main';
    case 'warning': return 'warning.main';
    default: return 'grey.300';
  }
}

type Props = {
  churchId: number | null;
  jobIds: string[];
  onDone: () => void;
};

export function OcrProcessingStep({ churchId, jobIds, onDone }: Props) {
  const [jobs, setJobs] = useState<OmOcrJob[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!churchId) return;
    const all = await fetchOcrJobs(churchId, { limit: 200 });
    setJobs(all.filter((job) => jobIds.includes(String(job.id))));
  }, [churchId, jobIds]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (jobs.length > 0 && jobs.every((job) => isJobTerminal(job))) {
      onDone();
      return undefined;
    }
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [jobs, load, onDone]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startTime]);

  const activeStage = wizardProcessingStepIndex(jobs);
  const completedImages = jobs.filter((job) => isJobTerminal(job)).length;
  const totalImages = jobs.length;
  const pct = totalImages > 0 ? Math.round((completedImages / totalImages) * 100) : 0;
  const hasFailed = jobs.some((j) => j.status === 'failed' || j.status === 'error');
  const allDone = totalImages > 0 && completedImages === totalImages;
  const recordsFound = jobs.reduce((sum, j) => sum + (typeof j.records_count === 'number' ? j.records_count : 0), 0);

  const formatElapsed = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <Stack spacing={3}>
      {/* Status chip */}
      <Box>
        <Label
          color={allDone ? 'success' : hasFailed ? 'error' : 'primary'}
          variant="soft"
          sx={{ fontSize: 12, py: 0.75, px: 2 }}
        >
          {allDone ? 'Processing complete' : hasFailed ? 'Processing failed' : 'Processing in progress'}
          {!allDone && !hasFailed && (
            <CircularProgress size={12} thickness={5} sx={{ ml: 1 }} />
          )}
        </Label>
      </Box>

      {/* Batch summary bar */}
      <Card sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, overflow: 'hidden' }}>
        {[
          { label: 'Record type', value: jobs[0]?.record_type || '—', icon: 'solar:document-text-bold' },
          { label: 'Language', value: jobs[0]?.language || '—', icon: 'solar:global-bold' },
          { label: 'Total images', value: String(totalImages), icon: 'solar:gallery-bold' },
          { label: 'Elapsed', value: formatElapsed(elapsed), icon: 'solar:clock-circle-bold' },
        ].map((item) => (
          <Stack
            key={item.label}
            direction="row"
            spacing={1.5}
            sx={{ p: 2, alignItems: 'center', borderRight: '1px solid', borderColor: 'divider', '&:last-child': { borderRight: 0 } }}
          >
            <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'primary.lighter', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Iconify icon={item.icon as any} width={20} sx={{ color: 'primary.dark' }} />
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, fontSize: '0.6rem' }}>
                {item.label}
              </Typography>
              <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>{item.value}</Typography>
            </Box>
          </Stack>
        ))}
      </Card>

      {/* Main layout — pipeline + sidebar */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.8fr 1fr' }, gap: 3 }}>
        {/* Pipeline stages */}
        <Card sx={{ p: 0, overflow: 'hidden' }}>
          <Stack direction="row" sx={{ alignItems: 'center', p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box>
              <Typography variant="subtitle1">Processing pipeline</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Stage {Math.min(activeStage + 1, WIZARD_PROCESSING_STEPS.length)} of {WIZARD_PROCESSING_STEPS.length}
              </Typography>
            </Box>
          </Stack>

          {hasFailed && (
            <Alert
              severity="error"
              action={
                <Button size="small" color="error" variant="outlined" onClick={load}>
                  Retry
                </Button>
              }
              sx={{ m: 2, borderRadius: 1 }}
            >
              A processing stage encountered an error. You can retry or contact support.
            </Alert>
          )}

          <Box sx={{ p: 3 }}>
            {WIZARD_PROCESSING_STEPS.map((label, index) => {
              const state = stageState(index, activeStage, hasFailed && index === activeStage);
              const isLast = index === WIZARD_PROCESSING_STEPS.length - 1;
              return (
                <Box key={label} sx={{ display: 'grid', gridTemplateColumns: '38px 1fr', minHeight: 60 }}>
                  {/* Rail */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                    <Box
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: stageBgColor(state),
                        border: state === 'pending' ? '2px solid' : 'none',
                        borderColor: stageBorderColor(state),
                        boxShadow: state === 'running' ? (theme: any) => `0 0 0 5px ${theme.vars?.palette?.primary?.lighter || 'rgba(0,167,111,0.12)'}` : 'none',
                        zIndex: 1,
                      }}
                    >
                      {stageIcon(state)}
                    </Box>
                    {!isLast && (
                      <Box
                        sx={{
                          width: 2,
                          flexGrow: 1,
                          bgcolor: state === 'complete' ? 'success.main' : state === 'running' ? 'primary.main' : 'grey.300',
                          mt: '-1px',
                        }}
                      />
                    )}
                  </Box>
                  {/* Copy */}
                  <Box sx={{ pb: 2, pl: 1 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        color: state === 'running' ? 'primary.dark' : state === 'failed' ? 'error.dark' : state === 'pending' ? 'text.disabled' : 'text.primary',
                      }}
                    >
                      {label}
                    </Typography>
                    {state === 'running' && (
                      <>
                        <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
                          In progress...
                        </Typography>
                        <LinearProgress
                          sx={{ height: 4, borderRadius: 2, mt: 1, maxWidth: 280 }}
                        />
                      </>
                    )}
                    {state === 'complete' && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Complete</Typography>
                    )}
                    {state === 'failed' && (
                      <Typography variant="caption" sx={{ color: 'error.dark' }}>Failed — check logs</Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Card>

        {/* Sidebar metrics */}
        <Stack spacing={2}>
          {/* Images remaining */}
          <Card sx={{ p: 2.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="subtitle1">Images remaining</Typography>
              <Typography variant="body2" color="text.secondary">{formatElapsed(elapsed)}</Typography>
            </Stack>
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
              <Typography variant="h3">{totalImages - completedImages}</Typography>
              <Typography variant="body2" color="text.secondary">of {totalImages} images</Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={pct}
              color={allDone ? 'success' : 'primary'}
              sx={{ height: 7, borderRadius: 1, mt: 1.5 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {completedImages} image{completedImages !== 1 ? 's' : ''} processed — {pct}% complete
            </Typography>
          </Card>

          {/* Records found */}
          <Card sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>Records detected</Typography>
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
              <Typography variant="h3" sx={{ color: 'warning.dark' }}>{recordsFound}</Typography>
              <Typography variant="body2" color="text.secondary">records found so far</Typography>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mt: 2 }}>
              {[
                { label: 'Auto', value: jobs.filter((j) => j.confirmed_count).length, color: 'success' },
                { label: 'Review', value: jobs.filter((j) => !isJobTerminal(j) && !j.confirmed_count && j.records_count).length, color: 'warning' },
                { label: 'Failed', value: jobs.filter((j) => j.status === 'failed' || j.status === 'error').length, color: 'error' },
              ].map((item) => (
                <Card
                  key={item.label}
                  variant="outlined"
                  sx={{ p: 1, textAlign: 'center', bgcolor: 'background.neutral' }}
                >
                  <Typography variant="h6">{item.value}</Typography>
                  <Typography variant="caption" sx={{ color: `${item.color}.dark`, fontWeight: 700, textTransform: 'uppercase', fontSize: '0.6rem' }}>
                    {item.label}
                  </Typography>
                </Card>
              ))}
            </Box>
          </Card>

          {/* Current stage info */}
          <Card sx={{ p: 2, bgcolor: 'primary.lighter' }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'primary.light', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Iconify icon={'solar:play-bold' as any} width={18} sx={{ color: 'primary.dark' }} />
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'primary.dark', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Current stage
                </Typography>
                <Typography variant="subtitle2" sx={{ mt: 0.25 }}>
                  {WIZARD_PROCESSING_STEPS[Math.min(activeStage, WIZARD_PROCESSING_STEPS.length - 1)]}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
                  {allDone
                    ? 'All stages complete. Review your records next.'
                    : 'Processing continues in the background — you can leave this page.'}
                </Typography>
              </Box>
            </Stack>
          </Card>

          {allDone && (
            <Button
              variant="contained"
              size="large"
              fullWidth
              endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
              onClick={onDone}
            >
              Continue to record review
            </Button>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
