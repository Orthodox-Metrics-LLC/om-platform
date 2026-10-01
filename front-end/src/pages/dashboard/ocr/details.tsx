import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { OcrDetailView } from 'src/sections/ocr';

// ----------------------------------------------------------------------

export default function OcrDetailsPage() {
  const churchId = useActiveChurchId();
  return <OcrDetailView churchId={churchId} />;
}
