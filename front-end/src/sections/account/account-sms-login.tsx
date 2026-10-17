import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

type SecurityStatus = {
  enabled: boolean;
  phone_ready: boolean;
  phone_hint: string | null;
};

export function AccountSmsLogin() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await omApiFetch('/api/user/profile/security');
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.message || 'Could not load security settings.');
    setStatus({ enabled: !!data.enabled, phone_ready: !!data.phone_ready, phone_hint: data.phone_hint || null });
  }, []);

  useEffect(() => {
    load().catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load security settings.'));
  }, [load]);

  const startEnable = async () => {
    setBusy(true);
    try {
      const res = await omApiFetch('/api/user/profile/security/sms', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Could not send the text.');
      setChallengeId(data.challenge_id);
      setCode('');
      toast.success(`Confirmation code sent to ${data.phone_hint}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the text.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    if (!challengeId) return;
    setBusy(true);
    try {
      const res = await omApiFetch('/api/user/profile/security/sms/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || 'That code could not be confirmed.');
      setChallengeId(null);
      setCode('');
      setStatus({ enabled: true, phone_ready: true, phone_hint: data.phone_hint || status?.phone_hint || null });
      toast.success('Text sign-in is on.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That code could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const res = await omApiFetch('/api/user/profile/security/sms/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Could not turn text sign-in off.');
      setPassword('');
      setStatus((current) => current && { ...current, enabled: false });
      toast.success('Text sign-in is off.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not turn text sign-in off.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Iconify icon="solar:phone-bold" width={28} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6">Text sign-in code</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {status?.phone_ready
              ? `After your password, Orthodox Metrics texts a 6-digit code to ${status.phone_hint}. Sign-in waits for that code.`
              : 'Add a mobile number on General before text sign-in can be turned on.'}
          </Typography>
        </Box>
      </Stack>

      {!status?.phone_ready && (
        <Button component={RouterLink} href={paths.dashboard.user.account} sx={{ mt: 2 }} color="inherit">
          Add a phone number
        </Button>
      )}

      {status?.phone_ready && !status.enabled && !challengeId && (
        <FormControlLabel
          sx={{ mt: 2, ml: 0 }}
          control={<Switch checked={false} disabled={busy} onChange={startEnable} />}
          label="Text me a code when I sign in"
        />
      )}

      {challengeId && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
          <TextField
            label="Confirmation code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            autoComplete="one-time-code"
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
          />
          <Button variant="contained" disabled={busy || code.length !== 6} onClick={confirmEnable}>Turn on</Button>
          <Button color="inherit" disabled={busy} onClick={() => { setChallengeId(null); setCode(''); }}>Cancel</Button>
        </Stack>
      )}

      {status?.enabled && (
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <FormControlLabel control={<Switch checked disabled />} label="Text sign-in is on" />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              type="password"
              label="Current password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            <Button color="inherit" variant="outlined" disabled={busy || !password} onClick={disable}>Turn off</Button>
          </Stack>
        </Stack>
      )}
    </Card>
  );
}
