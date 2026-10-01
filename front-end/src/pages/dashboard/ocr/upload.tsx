import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { OcrUploadView } from 'src/sections/ocr';

// ----------------------------------------------------------------------

export default function OcrUploadPage() {
  const churchId = useActiveChurchId();
  return <OcrUploadView churchId={churchId} />;
}
