import 'src/sections/ocr/figma/record-upload.css';
import { RecordUploadApp } from 'src/sections/ocr/figma/record-upload-app';

// ----------------------------------------------------------------------
// OM-Record-Upload Figma Make prototype (the zip under prod/tmp/9-30-26).
// Mounted inside the dashboard shell; the prototype's own sidebar is omitted
// because the app nav is already there.

export default function OcrUploadPage() {
  return (
    <div className="om-record-upload">
      <RecordUploadApp embedded />
    </div>
  );
}
