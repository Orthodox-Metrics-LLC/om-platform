import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/** Row shape of `GET /api/user/sessions` (prod: routes/user-sessions.js). */
type OmSession = {
  id: number;
  is_current: boolean;
  status: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
};

function describeAgent(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

export function AccountSessions() {
  const [sessions, setSessions] = useState<OmSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | 'others' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await omApiFetch('/api/user/sessions');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error?.message || `Failed (${res.status})`);
      setSessions(json.data?.sessions ?? json.sessions ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (id: number) => {
    setBusy(id);
    try {
      const res = await omApiFetch(`/api/user/sessions/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error?.message || 'Could not sign out session');
      toast.success('Session signed out');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out session');
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy('others');
    try {
      const res = await omApiFetch('/api/user/sessions/revoke-others', { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error?.message || 'Could not sign out sessions');
      toast.success('All other sessions signed out');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out sessions');
    } finally {
      setBusy(null);
    }
  };

  const others = sessions.filter((s) => !s.is_current).length;

  return (
    <Card>
      <CardHeader
        title="Active sessions"
        subheader="Devices currently signed in to your account"
        action={
          <Button
            size="small"
            color="error"
            variant="soft"
            disabled={!others}
            loading={busy === 'others'}
            onClick={revokeOthers}
            startIcon={<Iconify icon="ic:round-power-settings-new" />}
          >
            Sign out other sessions
          </Button>
        }
        sx={{ mb: 2 }}
      />

      <Scrollbar>
        <Table sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow>
              <TableCell>Device</TableCell>
              <TableCell>IP address</TableCell>
              <TableCell>Signed in</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">{describeAgent(s.user_agent)}</Typography>
                    {s.is_current && (
                      <Label color="success" variant="soft">
                        This device
                      </Label>
                    )}
                  </Box>
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{s.ip_address ?? '—'}</TableCell>
                <TableCell>{fDateTime(s.created_at)}</TableCell>
                <TableCell>{fDateTime(s.expires_at)}</TableCell>
                <TableCell align="right">
                  {!s.is_current && (
                    <Button
                      size="small"
                      color="inherit"
                      variant="outlined"
                      loading={busy === s.id}
                      onClick={() => revoke(s.id)}
                    >
                      Sign out
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}

            {!loading && !sessions.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.disabled' }}>
                  No active sessions found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Scrollbar>
    </Card>
  );
}
