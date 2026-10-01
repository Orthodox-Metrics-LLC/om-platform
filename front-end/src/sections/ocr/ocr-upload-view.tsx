import { useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';

import { Upload } from 'src/components/upload';
import { Iconify } from 'src/components/iconify';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import {
  uploadOcrFiles,
  fetchOcrSettings,
  type OmOcrRecordType,
} from './om-ocr-api';

// ----------------------------------------------------------------------

const ICON_UPLOAD = 'solar:cloud-upload-bold' as any;

type Props = {
  churchId: number | null;
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
  { value: 'sr', label: 'Serbian' },
];

export function OcrUploadView({ churchId }: Props) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<(File | string)[]>([]);
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
    const rawFiles = files.filter((f): f is File => f instanceof File);
    if (rawFiles.length === 0) {
      setError('Add at least one file.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await uploadOcrFiles(churchId, rawFiles, {
        recordType,
        language,
        recordLayoutMode: layoutMode,
      });
      if (result.jobs?.length) {
        navigate(paths.dashboard.ocr.details(result.jobs[0].id));
      } else {
        navigate(paths.dashboard.ocr.root);
      }
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading="New OCR upload"
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'OCR Uploads', href: paths.dashboard.ocr.root },
          { name: 'New upload' },
        ]}
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      {!churchId && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Select a parish before uploading.
        </Typography>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardHeader title="Upload files" />
            <CardContent>
              <Upload
                multiple
                value={files}
                accept={{ 'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.tiff', '.webp'], 'application/pdf': ['.pdf'] }}
                onDrop={(acceptedFiles) => setFiles((prev) => [...prev, ...acceptedFiles])}
                onRemove={(file) => setFiles((prev) => prev.filter((f) => f !== file))}
                onRemoveAll={() => setFiles([])}
                onUpload={files.length > 0 && !uploading ? handleUpload : undefined}
                loading={uploading}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={3}>
            <Card>
              <CardHeader title="Configuration" />
              <CardContent>
                <Stack spacing={3}>
                  <TextField
                    select
                    fullWidth
                    label="Record type"
                    value={recordType}
                    onChange={(e) => setRecordType(e.target.value as OmOcrRecordType)}
                    slotProps={{ select: { native: false } }}
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
                    label="Language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    slotProps={{ select: { native: false } }}
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
                    label="Layout mode"
                    value={layoutMode}
                    onChange={(e) => setLayoutMode(e.target.value)}
                    slotProps={{ select: { native: false } }}
                  >
                    <MenuItem value="auto">Auto-detect</MenuItem>
                    <MenuItem value="single">Single record</MenuItem>
                    <MenuItem value="ledger">Ledger / table</MenuItem>
                    <MenuItem value="spread">Multi-record spread</MenuItem>
                  </TextField>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<Iconify icon={ICON_UPLOAD} />}
                    disabled={files.length === 0 || uploading || !churchId}
                    onClick={handleUpload}
                  >
                    Start OCR
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    size="large"
                    onClick={() => navigate(paths.dashboard.ocr.root)}
                  >
                    Cancel
                  </Button>
                  {uploading && <LinearProgress />}
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
