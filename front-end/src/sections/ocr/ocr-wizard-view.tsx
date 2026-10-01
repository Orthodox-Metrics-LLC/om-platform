import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { OcrReviewStep } from './wizard/ocr-review-step';
import { OcrUploadStep } from './wizard/ocr-upload-step';
import { OcrWizardSteps } from './wizard/ocr-wizard-steps';
import { OcrResultsStep } from './wizard/ocr-results-step';
import { OcrProcessingStep } from './wizard/ocr-processing-step';
import { fetchOcrJobs, type OmOcrJob, summarizeOcrSession } from './om-ocr-api';
import { OcrConfigureStep, type OcrWizardConfig } from './wizard/ocr-configure-step';

// ----------------------------------------------------------------------
// Configure -> Upload -> Review Pages -> Processing -> Results.
// Recreates the old portal's five-step OCR upload wizard using real
// Minimal UI components (stepper, Upload, cards) instead of the old
// Tailwind/blueprint components.

type Props = {
  churchId: number | null;
};

function makeBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function OcrWizardView({ churchId }: Props) {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [config, setConfig] = useState<OcrWizardConfig>({
    recordType: 'baptism',
    language: 'en',
    layoutMode: 'auto',
  });
  const [batchId] = useState(makeBatchId);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [finalJobs, setFinalJobs] = useState<OmOcrJob[]>([]);

  const summary = useMemo(() => summarizeOcrSession(finalJobs), [finalJobs]);

  const handleDone = async () => {
    if (churchId) {
      const all = await fetchOcrJobs(churchId, { limit: 200 });
      setFinalJobs(all.filter((job) => jobIds.includes(String(job.id))));
    }
    setActiveStep(4);
  };

  const restart = () => {
    setActiveStep(0);
    setJobIds([]);
    setFinalJobs([]);
  };

  return (
    <DashboardContent maxWidth="md">
      <CustomBreadcrumbs
        heading="New OCR upload"
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'Upload Records', href: paths.dashboard.ocr.root },
          { name: 'New upload' },
        ]}
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      <OcrWizardSteps activeStep={activeStep} />

      {activeStep === 0 && (
        <OcrConfigureStep config={config} onChange={setConfig} onNext={() => setActiveStep(1)} />
      )}

      {activeStep === 1 && (
        <OcrUploadStep
          churchId={churchId}
          config={config}
          batchId={batchId}
          onBack={() => setActiveStep(0)}
          onUploaded={(ids) => {
            setJobIds(ids);
            setActiveStep(2);
          }}
        />
      )}

      {activeStep === 2 && (
        <OcrReviewStep
          churchId={churchId}
          jobIds={jobIds}
          onBack={() => setActiveStep(1)}
          onNext={() => setActiveStep(3)}
        />
      )}

      {activeStep === 3 && (
        <OcrProcessingStep churchId={churchId} jobIds={jobIds} onDone={handleDone} />
      )}

      {activeStep === 4 && (
        <OcrResultsStep
          summary={summary}
          onUploadMore={restart}
          onGoToUploadRecords={() => navigate(paths.dashboard.ocr.root)}
        />
      )}
    </DashboardContent>
  );
}
