import { useState } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';

import { Label } from 'src/components/label';
import { Upload } from 'src/components/upload';
import { Iconify } from 'src/components/iconify';

import {
  uploadOcrFiles,
  WIZARD_RECORD_TYPES,
  type OmOcrRecordType,
  WIZARD_LAYOUT_OPTIONS,
  WIZARD_LANGUAGE_OPTIONS,
} from '../om-ocr-api';

// ----------------------------------------------------------------------

export type OcrWizardConfig = {
  recordType: OmOcrRecordType;
  language: string;
  layoutMode: string;
};

type Props = {
  churchId: number | null;
  config: OcrWizardConfig;
  onChange: (config: OcrWizardConfig) => void;
  batchId: string;
  onUploaded: (jobIds: string[]) => void;
  onViewRecords: () => void;
};

export function OcrConfigureStep({ churchId, config, onChange, batchId, onUploaded, onViewRecords }: Props) {
  const set = (patch: Partial<OcrWizardConfig>) => onChange({ ...config, ...patch });
  const activeLayout = WIZARD_LAYOUT_OPTIONS.find((option) => option.value === config.layoutMode);

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
      {/* Record type selection */}
      <Card>
        <CardHeader title="Record type" subheader="What kind of register are you uploading?" />
        <CardContent>
          <Grid container spacing={2}>
            {WIZARD_RECORD_TYPES.map((type) => {
              const selected = config.recordType === type.value;
              return (
                <Grid key={type.value} size={{ xs: 6, sm: 3 }}>
                  <Card
                    variant="outlined"
                    onClick={() => set({ recordType: type.value })}
                    sx={{
                      p: 2,
                      gap: 1,
                      display: 'flex',
                      cursor: 'pointer',
                      textAlign: 'center',
                      alignItems: 'center',
                      flexDirection: 'column',
                      borderColor: selected ? 'primary.main' : 'divider',
                      bgcolor: selected ? 'primary.lighter' : 'transparent',
                      borderWidth: selected ? 2 : 1,
                      transition: 'all 0.15s ease',
                      '&:hover': { borderColor: 'primary.light', bgcolor: 'primary.lighter' },
                    }}
                  >
                    {selected && (
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          bgcolor: 'primary.main',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Iconify icon="eva:checkmark-fill" width={14} sx={{ color: 'white' }} />
                      </Box>
                    )}
                    <Iconify
                      icon={type.icon as any}
                      width={40}
                      sx={{ color: selected ? 'primary.main' : 'text.secondary' }}
                    />
                    <Typography variant="subtitle2">{type.label}</Typography>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </CardContent>
      </Card>

      {/* Language selection */}
      <Card>
        <CardHeader title="Language" subheader="Language the handwritten or typed text is in" />
        <CardContent>
          <TextField
            select
            fullWidth
            value={config.language}
            onChange={(e) => set({ language: e.target.value })}
            sx={{ maxWidth: 320 }}
          >
            {WIZARD_LANGUAGE_OPTIONS.map((lang) => (
              <MenuItem key={lang.value} value={lang.value}>
                {lang.label}
              </MenuItem>
            ))}
          </TextField>
        </CardContent>
      </Card>

      {/* Document layout */}
      <Card>
        <CardHeader title="Document layout" subheader="How the notebook pages appear in each photo" />
        <CardContent>
          <Stack spacing={1.5}>
            {WIZARD_LAYOUT_OPTIONS.map((option) => {
              const selected = config.layoutMode === option.value;
              return (
                <Card
                  key={option.value}
                  variant="outlined"
                  onClick={() => set({ layoutMode: option.value })}
                  sx={{
                    p: 2,
                    cursor: 'pointer',
                    borderColor: selected ? 'primary.main' : 'divider',
                    borderWidth: selected ? 2 : 1,
                    transition: 'all 0.15s ease',
                    '&:hover': { borderColor: 'primary.light' },
                  }}
                >
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                    <Box
                      sx={{
                        mt: 0.25,
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        borderRadius: '50%',
                        border: 2,
                        borderColor: selected ? 'primary.main' : 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {selected && (
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main' }} />
                      )}
                    </Box>
                    <Box>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="subtitle2">{option.label}</Typography>
                        {option.recommended && <Label color="primary" variant="soft">Recommended</Label>}
                      </Stack>
                      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                        {option.description}
                      </Typography>
                      {selected && option.guidance && (
                        <Typography variant="caption" sx={{ color: 'primary.main', mt: 0.5, display: 'block' }}>
                          {option.guidance}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </Card>
              );
            })}
          </Stack>
          {activeLayout?.guidance && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 2, display: 'block' }}>
              Tip: {activeLayout.guidance}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* File upload */}
      <Card>
        <CardHeader title="Upload images or PDFs" subheader="JPEG, PNG, TIFF, and PDF are supported" />
        <CardContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {!churchId && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Select a parish before uploading.
            </Alert>
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

      {/* Actions */}
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<Iconify icon={'solar:document-text-bold' as any} />}
          onClick={onViewRecords}
        >
          View records
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
