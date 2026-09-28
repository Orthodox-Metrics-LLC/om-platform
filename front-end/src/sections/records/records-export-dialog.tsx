import type { ParishSearchAst } from './om-records-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import ToggleButton from '@mui/material/ToggleButton';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { parishSearchApi } from './om-records-api';

// ----------------------------------------------------------------------

type Format = 'pdf' | 'csv' | 'xlsx' | 'xml';
const FORMATS: { value: Format; label: string; icon: string }[] = [
  { value: 'pdf', label: 'PDF', icon: 'solar:file-text-bold' },
  { value: 'csv', label: 'CSV', icon: 'solar:file-bold-duotone' },
  { value: 'xlsx', label: 'Excel', icon: 'solar:bill-list-bold' },
  { value: 'xml', label: 'XML', icon: 'solar:file-corrupted-bold-duotone' },
];

/** Export the current selection / filter / search as PDF, CSV, Excel or XML via the governed export service. */
export function RecordsExportDialog({ open, onClose, ast, count }: { open: boolean; onClose: () => void; ast: ParishSearchAst; count: number }) {
  const [format, setFormat] = useState<Format>('pdf');
  const [summary, setSummary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ id: number; status: string; recordCount?: number; errorMessage?: string; downloadUrl?: string } | null>(null);

  useEffect(() => { if (!open) { setJob(null); setBusy(false); } }, [open]);

  useEffect(() => {
    if (!job || ['completed', 'failed'].includes(job.status)) return undefined;
    const t = setInterval(async () => {
      try { const j = await parishSearchApi.exportJob(job.id); setJob({ ...j, id: job.id }); } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(t);
  }, [job]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await parishSearchApi.export({ ast, format, includeQuerySummary: summary });
      if (r.async) { setJob({ id: r.jobId, status: 'pending' }); toast.info(r.message || 'Large export queued — we will notify you when it is ready.'); }
      else { toast.success(`Exported ${r.count || count} records to ${r.filename}`); onClose(); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>Export records</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Export format</Typography>
          <ToggleButtonGroup fullWidth exclusive value={format} onChange={(_, v) => v && setFormat(v)}>
            {FORMATS.map((f) => <ToggleButton key={f.value} value={f.value} sx={{ gap: 1 }}><Iconify icon={f.icon as any} width={18} />{f.label}</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>
        <FormControlLabel control={<Switch checked={summary} onChange={(e) => setSummary(e.target.checked)} />} label="Include query summary header" />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{count} record{count === 1 ? '' : 's'} will be exported{ast.scope.recordTypes.length > 1 ? ` across ${ast.scope.recordTypes.join(', ')}` : ''}.</Typography>
        {job && (
          <Alert severity={job.status === 'failed' ? 'error' : job.status === 'completed' ? 'success' : 'info'}>
            {job.status === 'failed' ? job.errorMessage || 'Export failed' : job.status === 'completed' ? <>Export ready{job.recordCount ? ` · ${job.recordCount} records` : ''}. {job.downloadUrl && <Button size="small" component="a" href={job.downloadUrl}>Download</Button>}</> : <>Preparing export… <LinearProgress sx={{ mt: 1 }} /></>}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" loading={busy} onClick={run} startIcon={<Iconify icon="solar:export-bold" />}>Export</Button>
      </DialogActions>
    </Dialog>
  );
}
