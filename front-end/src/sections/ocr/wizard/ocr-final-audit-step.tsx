import type { OmOcrSessionSummary } from '../om-ocr-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------
// Final Audit & Seed — OM-Record-Upload prototype (operator-confirmed seed UX).

const SEED_STAGES = [
  'Preparing records',
  'Checking duplicates',
  'Writing sacramental records',
  'Verifying inserted records',
  'Finalizing audit',
] as const;

type SeedState = 'idle' | 'seeding' | 'success';

type Props = {
  summary?: OmOcrSessionSummary;
  onUploadMore?: () => void;
  onGoToRecords?: () => void;
};

export function OcrFinalAuditStep({ summary, onUploadMore, onGoToRecords }: Props) {
  const safeSummary = summary ?? {
    totalImages: 0,
    readyForReview: 0,
    completed: 0,
    failed: 0,
    processing: 0,
    recordsFound: 0,
  };

  const [expanded, setExpanded] = useState({ auto: true, corrected: true, failed: true });
  const [seedState, setSeedState] = useState<SeedState>('idle');
  const [seedStage, setSeedStage] = useState(0);
  const [seedTimestamp, setSeedTimestamp] = useState('');

  useEffect(() => {
    if (seedState !== 'seeding') return undefined;
    const timer = window.setTimeout(() => {
      if (seedStage >= SEED_STAGES.length - 1) {
        setSeedTimestamp(new Date().toLocaleString());
        setSeedState('success');
        return;
      }
      setSeedStage((s) => s + 1);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [seedStage, seedState]);

  const autoCount = safeSummary.completed;
  const correctedCount = safeSummary.readyForReview;
  const failedCount = safeSummary.failed;
  const seedPct =
    seedState === 'seeding'
      ? Math.round(((seedStage + 0.5) / SEED_STAGES.length) * 100)
      : seedState === 'success'
        ? 100
        : 0;

  const groups = [
    {
      id: 'auto' as const,
      title: 'Auto-reviewed',
      status: 'Will be seeded',
      description: 'Valid at the required confidence threshold and internal validation.',
      icon: 'eva:checkmark-fill',
      count: autoCount,
      color: 'success' as const,
    },
    {
      id: 'corrected' as const,
      title: 'Parish-reviewed / corrected',
      status: 'Will be seeded',
      description: 'Reviewed, corrected, or explicitly resolved during record review.',
      icon: 'solar:eye-bold',
      count: correctedCount,
      color: 'warning' as const,
    },
    {
      id: 'failed' as const,
      title: 'Failed / unresolved',
      status: 'Excluded',
      description: 'Did not make the cut — these will NOT be written to the database.',
      icon: 'eva:close-fill',
      count: failedCount,
      color: 'error' as const,
    },
  ];

  const startSeed = () => {
    setSeedStage(0);
    setSeedState('seeding');
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5">Final Audit &amp; Seed to Parish Database</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            A final once-over before approved records are written. Nothing is auto-seeded.
          </Typography>
        </Box>
        <Label color="info" variant="soft" startIcon={<Iconify icon={'eva:info-fill' as any} width={16} />}>
          Operator confirmation required
        </Label>
      </Stack>

      <Stack spacing={2}>
        {groups.map((group) => (
          <Card key={group.id} variant="outlined">
            <Button
              fullWidth
              color="inherit"
              onClick={() => setExpanded((e) => ({ ...e, [group.id]: !e[group.id] }))}
              sx={{
                p: 2,
                justifyContent: 'flex-start',
                textAlign: 'left',
                borderRadius: 0,
              }}
            >
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  mr: 2,
                  flexShrink: 0,
                  borderRadius: 1,
                  bgcolor: `${group.color}.lighter`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Iconify icon={group.icon as any} width={20} sx={{ color: `${group.color}.dark` }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">{group.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {group.status}
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ mx: 2 }}>
                {group.count}
              </Typography>
              <Iconify
                icon="eva:arrow-ios-downward-fill"
                sx={{
                  transform: expanded[group.id] ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            </Button>
            <Collapse in={expanded[group.id]}>
              <Box sx={{ px: 2, pb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {group.description}
                </Typography>
                {group.count === 0 ? (
                  <Typography variant="caption" color="text.disabled">
                    No records in this group for this batch.
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {group.count} record{group.count === 1 ? '' : 's'} in this category.
                  </Typography>
                )}
              </Box>
            </Collapse>
          </Card>
        ))}
      </Stack>

      {seedState === 'seeding' && (
        <Card sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
            <CircularProgress size={28} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6">Adding approved records</Typography>
              <Typography variant="body2" color="text.secondary">
                Records are validated and verified before the batch is marked complete.
              </Typography>
            </Box>
            <Typography variant="h6">{seedPct}%</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={seedPct} sx={{ mb: 2 }} />
          <Stack spacing={1}>
            {SEED_STAGES.map((label, index) => {
              const done = index < seedStage;
              const active = index === seedStage;
              return (
                <Stack key={label} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {done ? (
                    <Iconify icon="eva:checkmark-fill" width={18} sx={{ color: 'success.main' }} />
                  ) : active ? (
                    <CircularProgress size={16} />
                  ) : (
                    <Box sx={{ width: 18, height: 18 }} />
                  )}
                  <Typography variant="body2" color={active ? 'text.primary' : 'text.secondary'}>
                    {label}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Card>
      )}

      {seedState === 'success' && (
        <Card sx={{ p: 3, textAlign: 'center', bgcolor: 'success.lighter' }}>
          <Iconify icon={'solar:check-circle-bold' as any} width={48} sx={{ color: 'success.main', mb: 1 }} />
          <Typography variant="h6">Batch seeding complete</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {seedTimestamp ? `Completed at ${seedTimestamp}` : 'Records were written to the parish database.'}
          </Typography>
        </Card>
      )}

      {seedState === 'idle' && (
        <Card sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography variant="subtitle1">
                {safeSummary.recordsFound > 0
                  ? `${safeSummary.recordsFound} record${safeSummary.recordsFound === 1 ? '' : 's'} approved for seeding`
                  : 'Review processing results before seeding'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Seeding requires explicit confirmation — the backend agent pipeline will run on the server.
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="large"
              startIcon={<Iconify icon={'solar:database-bold' as any} />}
              disabled={autoCount + correctedCount === 0}
              onClick={startSeed}
            >
              Seed approved records
            </Button>
          </Stack>
        </Card>
      )}

      <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        {onUploadMore && (
          <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:add-circle-bold" />} onClick={onUploadMore}>
            Upload more
          </Button>
        )}
        {onGoToRecords && (
          <Button variant="contained" endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />} onClick={onGoToRecords}>
            Go to Upload Records
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
