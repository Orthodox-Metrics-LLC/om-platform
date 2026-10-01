import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Step from '@mui/material/Step';
import Stack from '@mui/material/Stack';
import Stepper from '@mui/material/Stepper';
import StepLabel from '@mui/material/StepLabel';
import Typography from '@mui/material/Typography';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';

import {
  fetchOcrJobs,
  isJobTerminal,
  type OmOcrJob,
  WIZARD_PROCESSING_STEPS,
  wizardProcessingStepIndex,
} from '../om-ocr-api';

// ----------------------------------------------------------------------

type Props = {
  churchId: number | null;
  jobIds: string[];
  onDone: () => void;
};

export function OcrProcessingStep({ churchId, jobIds, onDone }: Props) {
  const [jobs, setJobs] = useState<OmOcrJob[]>([]);

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

  const activeStep = wizardProcessingStepIndex(jobs);
  const completedImages = jobs.filter((job) => isJobTerminal(job)).length;
  const pct = jobs.length > 0 ? Math.round((completedImages / jobs.length) * 100) : 0;

  return (
    <Card>
      <CardHeader title="Processing your upload" subheader="This usually takes a minute or two per image" />
      <CardContent>
        <Stepper activeStep={activeStep} orientation="vertical">
          {WIZARD_PROCESSING_STEPS.map((label, index) => (
            <Step key={label} completed={index < activeStep}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ mt: 4 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {completedImages} of {jobs.length} images processed
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {pct}%
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 1 }} />
        </Box>
      </CardContent>
    </Card>
  );
}
