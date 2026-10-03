import 'src/sections/ocr/ocr-upload-flow.css';
import { RecordUploadApp } from 'src/sections/ocr/ocr-upload-flow';

// ----------------------------------------------------------------------
// New OCR upload wizard (Upload -> Image Review -> Processing -> Record
// Review -> Final Audit). Mounted inside the dashboard shell; "View records"
// navigates back to the real Records list at /portal/ocr.

export default function OcrUploadPage() {
  return (
    <div className="om-record-upload">
      <RecordUploadApp embedded />
    </div>
  );
}
