/**
 * Settings page chrome — Minimal-aligned (Public Sans / theme tokens).
 */
import type { ReactNode } from 'react';

import { Box, Alert, Paper, Button, Typography, CircularProgress } from '@mui/material';

import { SaveOutlinedIcon } from './parish-icons';

export interface SettingsPageHeaderProps {
  title: string;
  subtitle: string;
  saving: boolean;
  dirty: boolean;
  loading: boolean;
  onSave: () => void;
}

export function SettingsPageHeader({ title, subtitle, saving, dirty, loading, onSave }: SettingsPageHeaderProps) {
  return (
    <Box
      sx={{
        mb: 3,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      </Box>
      <Button
        variant="contained"
        size="large"
        startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
        disabled={saving || !dirty || loading}
        onClick={onSave}
      >
        {saving ? 'Saving...' : dirty ? 'Save Changes' : 'Saved'}
      </Button>
    </Box>
  );
}

export function SettingsErrorAlert({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      {error}
    </Alert>
  );
}

export function SettingsLoadingSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

export interface SettingsCardSectionProps {
  title?: string;
  icon?: React.ElementType;
  children: ReactNode;
  sx?: object;
}

export function SettingsCardSection({ title, icon: Icon, children, sx }: SettingsCardSectionProps) {
  return (
    <Paper
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: (theme) => theme.shadows[1],
        ...sx,
      }}
    >
      {(title || Icon) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          {Icon && (
            <Box
              sx={{
                p: 0.75,
                borderRadius: 1.5,
                bgcolor: 'primary.lighter',
                display: 'inline-flex',
              }}
            >
              <Icon sx={{ fontSize: 18, color: 'primary.main' }} />
            </Box>
          )}
          {title && (
            <Typography variant="subtitle2" color="text.primary">
              {title}
            </Typography>
          )}
        </Box>
      )}
      {children}
    </Paper>
  );
}
