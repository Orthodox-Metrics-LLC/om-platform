import type { OmAdminChurchStorage } from './om-files-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { useRouter } from 'src/routes/hooks';

import { fToNow } from 'src/utils/format-time';
import { fData } from 'src/utils/format-number';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';

import { omFilesApi } from './om-files-api';

// ----------------------------------------------------------------------

/**
 * Shown to super_admin/admin (no church_id of their own) on Overview → File and
 * File manager when no `?church=` is given: pick a tenant to inspect.
 */
export function FileManagerChurchPicker({ heading, basePath }: { heading: string; basePath: string }) {
  const router = useRouter();
  const [churches, setChurches] = useState<OmAdminChurchStorage[]>([]);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [jurisdiction, setJurisdiction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    omFilesApi
      .adminChurches(jurisdiction || undefined)
      .then((r) => { setChurches(r.churches); setJurisdictions(r.jurisdictions); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load churches'))
      .finally(() => setLoading(false));
  }, [jurisdiction]);

  return (
    <DashboardContent>
      <Typography variant="h4">{heading}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        Platform administrators are not tied to a parish — choose the church whose storage you want to view.
      </Typography>

      <TextField select size="small" label="Jurisdiction / affiliation" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} sx={{ minWidth: 280, mb: 3 }}>
        <MenuItem value="">All jurisdictions</MenuItem>
        {jurisdictions.map((j) => <MenuItem key={j} value={j}>{j}</MenuItem>)}
      </TextField>

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <EmptyContent filled title={error} sx={{ py: 8 }} />}
      {!loading && !error && !churches.length && <EmptyContent filled title="No provisioned churches" sx={{ py: 8 }} />}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
        {churches.map((c) => {
          const pct = c.quota_bytes ? Math.round((c.used_bytes / c.quota_bytes) * 100) : 0;
          return (
            <Card key={c.id} onClick={() => router.push(`${basePath}?church=${c.id}`)} sx={{ p: 2.5, cursor: 'pointer', '&:hover': { boxShadow: (t) => t.vars.customShadows.z16 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <Iconify icon="custom:cross-bold" width={28} sx={{ color: 'primary.main' }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" noWrap>{c.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>#{c.id} · {c.jurisdiction || 'No jurisdiction'}</Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', typography: 'caption', color: 'text.secondary', mb: 0.5 }}>
                <span>{fData(c.used_bytes)} · {c.file_count} files</span><span>{pct}% of {fData(c.quota_bytes)}</span>
              </Box>
              <LinearProgress variant="determinate" value={pct} color={pct > 90 ? 'error' : pct > 75 ? 'warning' : 'primary'} sx={{ height: 6, borderRadius: 1 }} />
              <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1 }}>{c.last_activity ? `Last activity ${fToNow(c.last_activity)}` : 'No activity yet'}</Typography>
            </Card>
          );
        })}
      </Box>
    </DashboardContent>
  );
}
