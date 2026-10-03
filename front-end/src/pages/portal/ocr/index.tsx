import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { OcrListView } from 'src/sections/ocr';

// ----------------------------------------------------------------------

export default function OcrListPage() {
  const churchId = useActiveChurchId();
  return <OcrListView churchId={churchId} />;
}
