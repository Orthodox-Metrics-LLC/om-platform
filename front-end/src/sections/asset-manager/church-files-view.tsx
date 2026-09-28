import type { OmAdminChurchStorage } from 'src/sections/file-manager/om-files-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fToNow } from 'src/utils/format-time';
import { fData } from 'src/utils/format-number';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';

import { omFilesApi } from 'src/sections/file-manager/om-files-api';
import { FileManagerView } from 'src/sections/file-manager/view/file-manager-view';

// ----------------------------------------------------------------------

/**
 * Church Files: super_admin/admin view of every tenant's file manager.
 * Pick a jurisdiction → church, then browse/manage that church's storage inline.
 */
export function ChurchFilesView() {
  const [churches, setChurches] = useState<OmAdminChurchStorage[]>([]);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [jurisdiction, setJurisdiction] = useState('');
  const [churchId, setChurchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await omFilesApi.adminChurches(jurisdiction || undefined);
      setChurches(r.churches);
      setJurisdictions(r.jurisdictions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load churches');
    } finally {
      setLoading(false);
    }
  }, [jurisdiction]);

  useEffect(() => { load(); }, [load]);

  const selected = churches.find((c) => c.id === churchId) ?? null;

  return (
    <>
      <Box sx={{ mb: 2, gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField select size="small" label="Jurisdiction / affiliation" value={jurisdiction} onChange={(e) => { setJurisdiction(e.target.value); setChurchId(null); }} sx={{ minWidth: 260 }}>
          <MenuItem value="">All jurisdictions</MenuItem>
          {jurisdictions.map((j) => <MenuItem key={j} value={j}>{j}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Church" value={churchId ?? ''} onChange={(e) => setChurchId(e.target.value === '' ? null : Number(e.target.value))} sx={{ minWidth: 280 }}>
          <MenuItem value="">Select a church…</MenuItem>
          {churches.map((c) => <MenuItem key={c.id} value={c.id}>{c.name} · #{c.id}</MenuItem>)}
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:restart-bold" />} onClick={load}>Refresh</Button>
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <EmptyContent filled title={error} sx={{ py: 6 }} />}

      {!selected ? (
        <Card>
          <TableContainer><Scrollbar>
            <Table size="small" sx={{ minWidth: 800 }}>
              <TableHead><TableRow><TableCell>Church</TableCell><TableCell>Jurisdiction</TableCell><TableCell>Storage</TableCell><TableCell align="right">Files</TableCell><TableCell>Last activity</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {churches.map((c) => {
                  const pct = c.quota_bytes ? Math.round((c.used_bytes / c.quota_bytes) * 100) : 0;
                  return (
                    <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => setChurchId(c.id)}>
                      <TableCell>
                        <Typography variant="subtitle2">{c.name}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.disabled' }}>#{c.id} · {c.database_name}{c.city ? ` · ${c.city}${c.state_province ? `, ${c.state_province}` : ''}` : ''}</Typography>
                      </TableCell>
                      <TableCell>{c.jurisdiction || '—'}</TableCell>
                      <TableCell sx={{ minWidth: 220 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', typography: 'caption', color: 'text.secondary' }}><span>{fData(c.used_bytes)}</span><span>{fData(c.quota_bytes)} · {pct}%</span></Box>
                        <LinearProgress variant="determinate" value={pct} color={pct > 90 ? 'error' : pct > 75 ? 'warning' : 'primary'} sx={{ height: 6, borderRadius: 1 }} />
                        {c.error && <Label variant="soft" color="error" sx={{ mt: 0.5 }}>{c.error}</Label>}
                      </TableCell>
                      <TableCell align="right">{c.file_count}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.last_activity ? fToNow(c.last_activity) : '—'}</TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Button size="small" variant="soft" component={RouterLink} href={`${paths.dashboard.general.file}?church=${c.id}`} startIcon={<Iconify icon="solar:chart-square-outline" />}>Overview</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && !churches.length && <TableRow><TableCell colSpan={6}><EmptyContent title="No provisioned churches" sx={{ py: 6 }} /></TableCell></TableRow>}
              </TableBody>
            </Table>
          </Scrollbar></TableContainer>
        </Card>
      ) : (
        <Card sx={{ p: 3 }}>
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" color="inherit" startIcon={<Iconify icon="eva:arrow-ios-back-fill" />} onClick={() => setChurchId(null)}>All churches</Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" variant="soft" component={RouterLink} href={`${paths.dashboard.general.file}?church=${selected.id}`} startIcon={<Iconify icon="solar:chart-square-outline" />}>Storage overview</Button>
          </Box>
          <FileManagerView key={selected.id} churchId={selected.id} heading={selected.name} embedded />
        </Card>
      )}
    </>
  );
}
