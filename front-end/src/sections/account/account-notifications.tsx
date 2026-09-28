import type { CardProps } from '@mui/material/Card';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Switch from '@mui/material/Switch';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';

import { toast } from 'src/components/snackbar';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/** Row of `GET /api/notifications/preferences` (prod: api/notifications.js). */
type OmPreference = {
  type_name: string;
  category: string;
  email_enabled: boolean | 0 | 1;
  push_enabled: boolean | 0 | 1;
  in_app_enabled: boolean | 0 | 1;
  sms_enabled: boolean | 0 | 1;
  frequency: string;
};

/** Categories shown to church users; admin/dev-only categories are hidden. */
const CATEGORY_META: Record<string, { title: string; caption: string }> = {
  user: { title: 'Activity', caption: 'Friend requests, mentions, messages and shared notes' },
  security: { title: 'Security', caption: 'Sign-in alerts, password resets and account locks' },
  certificates: { title: 'Certificates', caption: 'Certificate generation and expiry reminders' },
  billing: { title: 'Billing', caption: 'Invoices and payment confirmations' },
  system: { title: 'System', caption: 'Maintenance windows and data exports' },
};

const HIDDEN_TYPES = new Set(['build_started', 'build_completed', 'build_failed']);

const labelFor = (typeName: string) =>
  typeName.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ----------------------------------------------------------------------

export function AccountNotifications({ sx, ...other }: CardProps) {
  const [prefs, setPrefs] = useState<OmPreference[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await omApiFetch('/api/notifications/preferences');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || `Failed (${res.status})`);
      setPrefs(json.preferences ?? []);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load preferences');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (typeName: string, key: 'email_enabled' | 'in_app_enabled') => {
    setPrefs((prev) =>
      prev.map((p) => (p.type_name === typeName ? { ...p, [key]: !p[key] } : p))
    );
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await omApiFetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: prefs.map((p) => ({
            type_name: p.type_name,
            email_enabled: !!p.email_enabled,
            push_enabled: !!p.push_enabled,
            in_app_enabled: !!p.in_app_enabled,
            sms_enabled: !!p.sms_enabled,
            frequency: p.frequency || 'immediate',
          })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || `Failed (${res.status})`);
      toast.success('Notification preferences saved');
      setDirty(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <Card sx={{ p: 3 }}>
        <Typography color="error">{error}</Typography>
      </Card>
    );
  }

  const groups = Object.entries(CATEGORY_META)
    .map(([category, meta]) => ({
      category,
      ...meta,
      items: prefs.filter((p) => p.category === category && !HIDDEN_TYPES.has(p.type_name)),
    }))
    .filter((g) => g.items.length);

  return (
    <Card
      sx={[
        { p: 3, gap: 3, display: 'flex', flexDirection: 'column' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {groups.map((group) => (
        <Grid key={group.category} container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <ListItemText
              primary={group.title}
              secondary={group.caption}
              slotProps={{
                primary: { sx: { typography: 'h6' } },
                secondary: { sx: { mt: 0.5 } },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Box
              sx={{
                p: 3,
                gap: 1,
                borderRadius: 2,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.neutral',
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 72px 72px',
                  typography: 'caption',
                  color: 'text.disabled',
                  px: 1,
                  mb: 0.5,
                }}
              >
                <span />
                <Box sx={{ textAlign: 'center' }}>Email</Box>
                <Box sx={{ textAlign: 'center' }}>In-app</Box>
              </Box>

              {group.items.map((item) => (
                <Box
                  key={item.type_name}
                  sx={{
                    px: 1,
                    display: 'grid',
                    alignItems: 'center',
                    gridTemplateColumns: '1fr 72px 72px',
                  }}
                >
                  <Typography variant="body2">{labelFor(item.type_name)}</Typography>
                  <Box sx={{ textAlign: 'center' }}>
                    <Switch
                      size="small"
                      checked={!!item.email_enabled}
                      onChange={() => toggle(item.type_name, 'email_enabled')}
                      slotProps={{ input: { 'aria-label': `Email ${labelFor(item.type_name)}` } }}
                    />
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Switch
                      size="small"
                      checked={!!item.in_app_enabled}
                      onChange={() => toggle(item.type_name, 'in_app_enabled')}
                      slotProps={{ input: { 'aria-label': `In-app ${labelFor(item.type_name)}` } }}
                    />
                  </Box>
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>
      ))}

      {!groups.length && (
        <Typography variant="body2" sx={{ color: 'text.disabled', textAlign: 'center', py: 4 }}>
          Loading preferences…
        </Typography>
      )}

      <Button
        variant="contained"
        onClick={save}
        loading={saving}
        disabled={!dirty}
        sx={{ ml: 'auto' }}
      >
        Save changes
      </Button>
    </Card>
  );
}
