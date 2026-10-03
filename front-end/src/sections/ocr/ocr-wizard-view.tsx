import { useNavigate } from 'react-router';
import { useMemo, useState, useCallback } from 'react';

import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { OcrReviewStep } from './wizard/ocr-review-step';
import { OcrWizardSteps } from './wizard/ocr-wizard-steps';
import { OcrResultsStep } from './wizard/ocr-results-step';
import { OcrProcessingStep } from './wizard/ocr-processing-step';
import { fetchOcrJobs, type OmOcrJob, summarizeOcrSession } from './om-ocr-api';
import { OcrConfigureStep, type OcrWizardConfig } from './wizard/ocr-configure-step';

// ----------------------------------------------------------------------
// Upload -> Image Review -> Processing -> Record Review -> Final Audit
// Five-step OCR upload wizard with clickable back-navigation in the
// stepper. Each step only becomes reachable once the user first visits it.

type Props = {
  churchId: number | null;
};

function makeBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function OcrWizardView({ churchId }: Props) {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [config, setConfig] = useState<OcrWizardConfig>({
    recordType: 'baptism',
    language: 'en',
    layoutMode: 'auto',
  });
  const [batchId] = useState(makeBatchId);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [finalJobs, setFinalJobs] = useState<OmOcrJob[]>([]);

  const summary = useMemo(() => summarizeOcrSession(finalJobs), [finalJobs]);

  const goTo = useCallback(
    (step: number) => {
      setActiveStep(step);
      setMaxReached((prev) => Math.max(prev, step));
    },
    [],
  );

  const handleDone = async () => {
    if (churchId) {
      const all = await fetchOcrJobs(churchId, { limit: 200 });
      setFinalJobs(all.filter((job) => jobIds.includes(String(job.id))));
    }
    goTo(4);
  };

  const restart = () => {
    setActiveStep(0);
    setMaxReached(0);
    setJobIds([]);
    setFinalJobs([]);
  };

  const navigateWorkflow = useCallback(
    (step: number) => {
      if (step <= maxReached) setActiveStep(step);
    },
    [maxReached],
  );

  return (
    <DashboardContent maxWidth="lg">
      <CustomBreadcrumbs
        heading="New OCR upload"
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'Upload Records', href: paths.dashboard.ocr.root },
          { name: 'New upload' },
        ]}
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      <OcrWizardSteps
        activeStep={activeStep}
        maxReached={maxReached}
        onNavigate={navigateWorkflow}
      />

      {activeStep === 0 && (
        <OcrConfigureStep
          churchId={churchId}
          config={config}
          onChange={setConfig}
          batchId={batchId}
          onUploaded={(ids) => {
            setJobIds(ids);
            goTo(1);
          }}
          onViewRecords={() => navigate(paths.dashboard.ocr.root)}
        />
      )}

      {activeStep === 1 && (
        <OcrReviewStep
          churchId={churchId}
          jobIds={jobIds}
          onBack={() => setActiveStep(0)}
          onNext={() => goTo(2)}
        />
      )}

      {activeStep === 2 && (
        <OcrProcessingStep
          churchId={churchId}
          jobIds={jobIds}
          onDone={() => goTo(3)}
        />
      )}

      {activeStep === 3 && (
        <OcrResultsStep
          churchId={churchId}
          jobIds={jobIds}
          onBack={() => setActiveStep(2)}
          onNext={handleDone}
        />
      )}

      {activeStep === 4 && (
        <OcrResultsStep
          churchId={churchId}
          jobIds={jobIds}
          isFinalAudit
          summary={summary}
          onUploadMore={restart}
          onGoToRecords={() => navigate(paths.dashboard.ocr.root)}
        />
      )}
    </DashboardContent>
  );
}
