import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { OcrWizardView } from 'src/sections/ocr';

// ----------------------------------------------------------------------

export default function OcrUploadPage() {
  const churchId = useActiveChurchId();
  return <OcrWizardView churchId={churchId} />;
}
