import type { DropzoneOptions } from 'react-dropzone';

import { useDropzone } from 'react-dropzone';
import { useRef, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { Iconify } from 'src/components/iconify';
import { MultiFilePreview } from 'src/components/upload';

import { uploadOcrFiles, fetchOcrSettings, type OmOcrRecordType } from './om-ocr-api';

// ----------------------------------------------------------------------

const ACCEPT: DropzoneOptions['accept'] = {
  'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.tiff', '.webp'],
  'application/pdf': ['.pdf'],
};

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
 * "Upload Records" drop zone + Upload Queue, matching the old portal's
 * Parish Uploader layout: dashed drop zone with Choose Files/Scan Pages on
 * the left, queued-file list + processing config on the right.
 */
export function OcrUploadPanel({ churchId, onUploaded }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [recordType, setRecordType] = useState<OmOcrRecordType>('baptism');
  const [language, setLanguage] = useState('en');
  const [layoutMode, setLayoutMode] = useState('auto');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: ACCEPT,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDrop,
  });

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
          <Paper
            {...getRootProps()}
            variant="outlined"
            sx={{
              p: 4,
              gap: 1.5,
              display: 'flex',
              textAlign: 'center',
              alignItems: 'center',
              borderRadius: 1.5,
              borderStyle: 'dashed',
              flexDirection: 'column',
              bgcolor: (theme) => (isDragActive ? theme.vars.palette.action.hover : 'transparent'),
              borderColor: (theme) => (isDragActive ? 'primary.main' : theme.vars.palette.divider),
              transition: (theme) => theme.transitions.create(['background-color', 'border-color']),
            }}
          >
            <input ref={inputRef} {...getInputProps()} />
            <Iconify icon={'solar:cloud-upload-bold' as any} width={48} sx={{ color: 'text.disabled' }} />
            <Typography variant="h6">Drag and drop files here</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Supports JPEG, PNG, TIFF, and PDF
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
              <Button
                variant="contained"
                startIcon={<Iconify icon={'solar:file-text-bold' as any} />}
                onClick={open}
              >
                Choose Files
              </Button>
              <Tooltip title="Camera capture is coming soon">
                <span>
                  <Button
                    variant="outlined"
                    color="inherit"
                    disabled
                    startIcon={<Iconify icon={'solar:camera-bold' as any} />}
                  >
                    Scan Pages
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: 1, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Upload Queue
            </Typography>

            {files.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
                No files in the queue.
              </Typography>
            ) : (
              <Box sx={{ flexGrow: 1, overflow: 'auto', mb: 2 }}>
                <MultiFilePreview
                  files={files}
                  orientation="vertical"
                  onRemove={(file) => setFiles((prev) => prev.filter((f) => f !== file))}
                />
              </Box>
            )}

            <Stack spacing={2} sx={{ mt: 2 }}>
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

              <Button
                variant="contained"
                size="large"
                startIcon={<Iconify icon={'solar:cloud-upload-bold' as any} />}
                disabled={files.length === 0 || uploading || !churchId}
                onClick={handleUpload}
              >
                {uploading ? 'Uploading…' : `Start OCR${files.length ? ` (${files.length})` : ''}`}
              </Button>

              {uploading && <LinearProgress />}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
