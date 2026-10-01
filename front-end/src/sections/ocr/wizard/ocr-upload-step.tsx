import type { OcrWizardConfig } from './ocr-configure-step';

import { useState } from 'react';

import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';

import { Upload } from 'src/components/upload';
import { Iconify } from 'src/components/iconify';

import { uploadOcrFiles } from '../om-ocr-api';

// ----------------------------------------------------------------------
// Uses the real Minimal UI multi-file Upload component (illustration +
// "Drop or select files" + horizontal thumbnail previews + built-in
// Remove All / Upload actions) instead of a bespoke drop zone.

type Props = {
  churchId: number | null;
  config: OcrWizardConfig;
  batchId: string;
  onBack: () => void;
  onUploaded: (jobIds: string[]) => void;
};

export function OcrUploadStep({ churchId, config, batchId, onBack, onUploaded }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!churchId || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadOcrFiles(churchId, files, {
        recordType: config.recordType,
        language: config.language,
        recordLayoutMode: config.layoutMode,
        batchId,
      });
      onUploaded(result.jobs.map((job) => String(job.id)));
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Card>
        <CardHeader title="Upload images or PDFs" subheader="JPEG, PNG, TIFF, and PDF are supported" />
        <CardContent>
          {error && (
            <Typography color="error" variant="body2" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}
          {!churchId && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              Select a parish before uploading.
            </Typography>
          )}
          <Upload
            multiple
            value={files}
            disabled={uploading}
            accept={{
              'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.tiff', '.webp'],
              'application/pdf': ['.pdf'],
            }}
            onDrop={(accepted: File[]) => setFiles((prev) => [...prev, ...accepted])}
            onRemove={(file) => setFiles((prev) => prev.filter((f) => f !== file))}
            onRemoveAll={() => setFiles([])}
            onUpload={!uploading && files.length > 0 && !!churchId ? handleUpload : undefined}
            loading={uploading}
          />
        </CardContent>
      </Card>

      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Button
          color="inherit"
          variant="outlined"
          size="large"
          startIcon={<Iconify icon="eva:arrow-ios-back-fill" />}
          onClick={onBack}
          disabled={uploading}
        >
          Back
        </Button>
        <Button
          variant="contained"
          size="large"
          endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
          disabled={!churchId || files.length === 0 || uploading}
          loading={uploading}
          onClick={handleUpload}
        >
          Upload and continue
        </Button>
      </Stack>
    </Stack>
  );
}
