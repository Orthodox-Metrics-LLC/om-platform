import React, { useState, useEffect } from 'react';

/**
 * OCR preferences for the signed-in parish. Reads and writes /api/my/ocr-preferences.
 */
import {
  Box,
  Chip,
  Alert,
  Paper,
  Stack,
  Button,
  Select,
  Slider,
  Switch,
  Divider,
  MenuItem,
  TextField,
  InputLabel,
  Typography,
  FormControl,
  CircularProgress,
  FormControlLabel,
} from '@mui/material';

import { omApiFetch } from 'src/auth/context/om-auth';

import { TuneIcon, ImageIcon, TranslateIcon, DeleteSweepIcon, DescriptionIcon, SaveOutlinedIcon, DocumentScannerIcon } from './parish-icons';

interface OcrPreferences {
  language: string;
  confidenceThreshold: number;
  deskew: boolean;
  removeNoise: boolean;
  preprocessImages: boolean;
  useRecordSnippets: boolean;
  documentProcessing: {
    spellingCorrection: string;
    extractAllText: string;
    improveFormatting: string;
  };
  documentDeletion: {
    deleteAfter: number;
    deleteUnit: string;
  };
}

const DEFAULT_PREFS: OcrPreferences = {
  language: 'eng',
  confidenceThreshold: 75,
  deskew: true,
  removeNoise: true,
  preprocessImages: true,
  useRecordSnippets: true,
  documentProcessing: {
    spellingCorrection: 'fix',
    extractAllText: 'yes',
    improveFormatting: 'yes',
  },
  documentDeletion: {
    deleteAfter: 7,
    deleteUnit: 'days',
  },
};

const LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'ell', label: 'Greek (Modern)' },
  { code: 'grc', label: 'Greek (Ancient)' },
  { code: 'rus', label: 'Russian' },
  { code: 'ron', label: 'Romanian' },
  { code: 'srp', label: 'Serbian' },
  { code: 'bul', label: 'Bulgarian' },
  { code: 'ukr', label: 'Ukrainian' },
] as const;

function SectionCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: React.ElementType;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Paper
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: (theme) => theme.shadows[1],
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
        <Box sx={{ p: 0.75, borderRadius: 1.5, bgcolor: 'primary.lighter', display: 'inline-flex' }}>
          <Icon sx={{ fontSize: 18, color: 'primary.main' }} />
        </Box>
        <Typography variant="subtitle2">{title}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>
      {children}
    </Paper>
  );
}

const AccountOcrPreferencesPage: React.FC = () => {
  const [prefs, setPrefs] = useState<OcrPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await omApiFetch('/api/my/ocr-preferences');
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
        if (!cancelled && json?.preferences) {
          setPrefs({ ...DEFAULT_PREFS, ...json.preferences });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load OCR preferences');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = <K extends keyof OcrPreferences>(key: K, value: OcrPreferences[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const updateDocProcessing = (key: keyof OcrPreferences['documentProcessing'], value: string) => {
    setPrefs((prev) => ({
      ...prev,
      documentProcessing: { ...prev.documentProcessing, [key]: value },
    }));
    setDirty(true);
  };

  const updateDocDeletion = (key: keyof OcrPreferences['documentDeletion'], value: string | number) => {
    setPrefs((prev) => ({
      ...prev,
      documentDeletion: { ...prev.documentDeletion, [key]: value },
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await omApiFetch('/api/my/ocr-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save OCR preferences');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 880, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}>
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <DocumentScannerIcon sx={{ color: 'primary.main' }} />
            <Typography variant="h5">OCR Preferences</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Church-scoped OCR language, confidence, preprocessing, and retention settings
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="large"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
        >
          {saving ? 'Saving…' : dirty ? 'Save Changes' : 'Saved'}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {savedFlash && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Preferences saved.
        </Alert>
      )}

      <Stack spacing={2.5}>
        <SectionCard
          title="Document Language"
          icon={TranslateIcon}
          description="Default language used when running OCR on uploaded documents."
        >
          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel>Language</InputLabel>
            <Select
              value={prefs.language}
              label="Language"
              onChange={(e) => updateField('language', e.target.value)}
            >
              {LANGUAGES.map((lang) => (
                <MenuItem key={lang.code} value={lang.code}>
                  {lang.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </SectionCard>

        <SectionCard
          title="Confidence Threshold"
          icon={TuneIcon}
          description="Minimum OCR confidence before a result is accepted without review."
        >
          <Stack direction="row" spacing={3} sx={{ alignItems: 'center', maxWidth: 520 }}>
            <Slider
              value={prefs.confidenceThreshold}
              onChange={(_, val) => updateField('confidenceThreshold', val as number)}
              min={0}
              max={100}
              step={5}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${v}%`}
              marks={[
                { value: 0, label: '0%' },
                { value: 50, label: '50%' },
                { value: 75, label: '75%' },
                { value: 100, label: '100%' },
              ]}
              sx={{ flex: 1 }}
            />
            <Chip
              label={`${prefs.confidenceThreshold}%`}
              color={prefs.confidenceThreshold >= 75 ? 'success' : prefs.confidenceThreshold >= 50 ? 'warning' : 'error'}
              size="small"
            />
          </Stack>
        </SectionCard>

        <SectionCard
          title="Image Preprocessing"
          icon={ImageIcon}
          description="Improve scan quality before OCR runs."
        >
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={prefs.preprocessImages}
                  onChange={(e) => updateField('preprocessImages', e.target.checked)}
                  size="small"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Enable preprocessing
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Master toggle for deskew and noise removal
                  </Typography>
                </Box>
              }
            />
            <Divider />
            <FormControlLabel
              control={
                <Switch
                  checked={prefs.deskew}
                  onChange={(e) => updateField('deskew', e.target.checked)}
                  size="small"
                  disabled={!prefs.preprocessImages}
                />
              }
              label={<Typography variant="body2">Auto deskew</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={prefs.removeNoise}
                  onChange={(e) => updateField('removeNoise', e.target.checked)}
                  size="small"
                  disabled={!prefs.preprocessImages}
                />
              }
              label={<Typography variant="body2">Noise removal</Typography>}
            />
          </Stack>
        </SectionCard>

        <SectionCard
          title="Document Processing"
          icon={DescriptionIcon}
          description="Post-OCR text cleanup and extraction behavior."
        >
          <Stack spacing={2.5} sx={{ maxWidth: 360 }}>
            <FormControl size="small">
              <InputLabel>Spelling correction</InputLabel>
              <Select
                value={prefs.documentProcessing.spellingCorrection}
                label="Spelling correction"
                onChange={(e) => updateDocProcessing('spellingCorrection', e.target.value)}
              >
                <MenuItem value="fix">Auto-fix</MenuItem>
                <MenuItem value="suggest">Suggest only</MenuItem>
                <MenuItem value="off">Off</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>Extract all text</InputLabel>
              <Select
                value={prefs.documentProcessing.extractAllText}
                label="Extract all text"
                onChange={(e) => updateDocProcessing('extractAllText', e.target.value)}
              >
                <MenuItem value="yes">Yes</MenuItem>
                <MenuItem value="no">No</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>Improve formatting</InputLabel>
              <Select
                value={prefs.documentProcessing.improveFormatting}
                label="Improve formatting"
                onChange={(e) => updateDocProcessing('improveFormatting', e.target.value)}
              >
                <MenuItem value="yes">Yes</MenuItem>
                <MenuItem value="no">No</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={prefs.useRecordSnippets}
                  onChange={(e) => updateField('useRecordSnippets', e.target.checked)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Use record snippets</Typography>}
            />
          </Stack>
        </SectionCard>

        <SectionCard
          title="Document Retention"
          icon={DeleteSweepIcon}
          description="How long OCR working documents are kept before deletion."
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ maxWidth: 420 }}>
            <TextField
              size="small"
              type="number"
              label="Delete after"
              value={prefs.documentDeletion.deleteAfter}
              onChange={(e) => updateDocDeletion('deleteAfter', Number(e.target.value) || 0)}
              slotProps={{ htmlInput: { min: 1, max: 365 } }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Unit</InputLabel>
              <Select
                value={prefs.documentDeletion.deleteUnit}
                label="Unit"
                onChange={(e) => updateDocDeletion('deleteUnit', e.target.value)}
              >
                <MenuItem value="days">Days</MenuItem>
                <MenuItem value="weeks">Weeks</MenuItem>
                <MenuItem value="months">Months</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </SectionCard>
      </Stack>
    </Box>
  );
};

export default AccountOcrPreferencesPage;
