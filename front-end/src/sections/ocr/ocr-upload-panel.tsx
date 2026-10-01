import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { Upload } from 'src/components/upload';
import { Iconify } from 'src/components/iconify';

import { uploadOcrFiles, fetchOcrSettings, type OmOcrRecordType } from './om-ocr-api';

// ----------------------------------------------------------------------

const ICON_UPLOAD = 'solar:cloud-upload-bold' as any;

type Props = {
  churchId: number | null;
  onUploaded: () => void;
};

const RECORD_TYPES: { value: OmOcrRecordType; label: string }[] = [
  { value: 'baptism', label: 'Baptism' },
  { value: 'marriage', label: 'Marriage' },
  { value: 'funeral', label: 'Funeral' },
  { value: 'custom', label: 'Custom' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'el', label: 'Greek' },
  { value: 'ru', label: 'Russian' },
  { value: 'ro', label: 'Romanian' },
];

/**
 * Shared "New Upload" panel — drag-and-drop zone + record type / language /
 * layout config, mirroring the old portal's Upload Records page. Used both
 * inline (list view) and as the standalone /dashboard/ocr/upload page.
 */
export function OcrUploadPanel({ churchId, onUploaded }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [recordType, setRecordType] = useState<OmOcrRecordType>('baptism');
  const [language, setLanguage] = useState('en');
  const [layoutMode, setLayoutMode] = useState('auto');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!churchId) return;
    try {
      const settings = await fetchOcrSettings(churchId);
      if (settings.defaultLanguage) setLanguage(settings.defaultLanguage);
      if (settings.documentProcessing?.recordLayoutMode) {
        setLayoutMode(settings.documentProcessing.recordLayoutMode);
      }
    } catch {
      // defaults are fine
    }
  }, [churchId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleUpload = async () => {
    if (!churchId) {
      setError('Select a parish first.');
      return;
    }
    if (files.length === 0) {
      setError('Add at least one file.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadOcrFiles(churchId, files, {
        recordType,
        language,
        recordLayoutMode: layoutMode,
      });
      setFiles([]);
      onUploaded();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      {error && (
        <Typography color="error" variant="body2" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Upload
            multiple
            value={files}
            accept={{
              'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.tiff', '.webp'],
              'application/pdf': ['.pdf'],
            }}
            onDrop={(accepted) => setFiles((prev) => [...prev, ...accepted])}
            onRemove={(file) => setFiles((prev) => prev.filter((f) => f !== file))}
            onRemoveAll={() => setFiles([])}
            loading={uploading}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2} sx={{ height: 1 }}>
            <Typography variant="subtitle2">Upload Queue</Typography>

            <TextField
              select
              fullWidth
              size="small"
              label="Record type"
              value={recordType}
              onChange={(e) => setRecordType(e.target.value as OmOcrRecordType)}
            >
              {RECORD_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              size="small"
              label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <MenuItem key={l.value} value={l.value}>
                  {l.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              size="small"
              label="Layout mode"
              value={layoutMode}
              onChange={(e) => setLayoutMode(e.target.value)}
            >
              <MenuItem value="auto">Auto-detect</MenuItem>
              <MenuItem value="single">Single record</MenuItem>
              <MenuItem value="ledger">Ledger / table</MenuItem>
              <MenuItem value="multi_record_split">Multi-record spread</MenuItem>
            </TextField>

            {files.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {files.length} file{files.length === 1 ? '' : 's'} ready to upload.
              </Typography>
            )}

            <Button
              variant="contained"
              size="large"
              startIcon={<Iconify icon={ICON_UPLOAD} />}
              disabled={files.length === 0 || uploading || !churchId}
              onClick={handleUpload}
            >
              {uploading ? 'Uploading…' : 'Start OCR'}
            </Button>

            {uploading && <LinearProgress />}
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
