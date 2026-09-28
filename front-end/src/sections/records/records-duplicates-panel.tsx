import type { DuplicateGroup, ParishSearchAst } from './om-records-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fDate } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';

import { parishSearchApi } from './om-records-api';

// ----------------------------------------------------------------------

const CLASS_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = { 'Exact duplicate': 'error', 'Strong duplicate candidate': 'warning', 'Possible duplicate': 'info', 'Possible person match': 'info', 'Not enough evidence': 'default' };

/** Duplicate detection results with review / merge (keep one, soft-delete the rest) / not-duplicates / restore. */
export function RecordsDuplicatesPanel({ churchId, ast, canManage, onBack }: { churchId: number; ast: ParishSearchAst; canManage: boolean; onBack: () => void }) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [merge, setMerge] = useState<DuplicateGroup | null>(null);
  const [keep, setKeep] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setGroups(null);
    try { const r = await parishSearchApi.execute(ast); setGroups(r.groups ?? []); setTotal(r.totalAffectedRecords ?? r.total); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load duplicates'); setGroups([]); }
  }, [ast]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  const openMerge = async (g: DuplicateGroup) => {
    setMerge(g); setNotes(''); setPreview(null);
    const survivor = g.recommendedSurvivorId ?? Number(g.records[0]?.sourceRecordId);
    setKeep(survivor);
    if (g.recordType !== 'cross_record') {
      parishSearchApi.previewRemoval(g.signature, { churchId, recordType: g.recordType, survivorId: survivor, removeIds: g.records.map((r) => Number(r.sourceRecordId)).filter((id) => id !== survivor) }).then(setPreview).catch(() => setPreview(null));
    }
  };

  const doMerge = async () => {
    if (!merge || !keep || merge.recordType === 'cross_record') return;
    const removeIds = merge.records.map((r) => Number(r.sourceRecordId)).filter((id) => id !== keep);
    await act(`merge-${merge.signature}`, () => parishSearchApi.resolveDuplicates(merge.signature, { churchId, recordType: merge.recordType, keepRecordId: keep, removeRecordIds: removeIds, reviewNotes: notes || undefined, reason: 'confirmed_duplicate' }), `Kept #${keep}; ${removeIds.length} duplicate${removeIds.length === 1 ? '' : 's'} removed (restorable)`);
    setMerge(null);
  };

  if (groups === null) return <Card sx={{ p: 3 }}><LinearProgress /></Card>;

  return (
    <>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Label variant="soft" color="warning">Duplicate detection</Label>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>{groups.length} group{groups.length === 1 ? '' : 's'} · {total} records involved</Typography>
        <Button size="small" color="inherit" startIcon={<Iconify icon="mingcute:close-line" />} onClick={onBack}>Back to list</Button>
      </Box>

      {!groups.length && <Card><EmptyContent filled title="No duplicates found" description="Nothing matched at this level — try a looser match level from Advanced search." sx={{ py: 10 }} /></Card>}

      <Stack spacing={2}>
        {groups.map((g) => (
          <Card key={g.signature} sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <Label variant="soft" color={CLASS_COLOR[g.classification] || 'default'}>{g.classification}</Label>
              <Label variant="outlined" sx={{ textTransform: 'capitalize' }}>{g.recordType.replace('_', ' ')}</Label>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{Math.round(g.confidence * 100)}% · matched {g.matchedFields.join(', ') || '—'}{g.differingFields.length ? ` · differs ${g.differingFields.join(', ')}` : ''}</Typography>
              <Box sx={{ flexGrow: 1 }} />
              {g.reviewStatus !== 'unreviewed' && <Label variant="soft" color={g.reviewStatus === 'not_a_duplicate' ? 'success' : 'info'} sx={{ textTransform: 'capitalize' }}>{g.reviewStatus.replace(/_/g, ' ')}</Label>}
            </Box>

            <Stack divider={<Divider sx={{ borderStyle: 'dashed' }} />}>
              {g.records.map((r) => (
                <Box key={`${r.recordType}-${r.sourceRecordId}`} sx={{ py: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="subtitle2" component={RouterLink} href={paths.dashboard.records.details(r.recordType, r.sourceRecordId)} sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>{r.primaryName}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>#{r.sourceRecordId} · {r.canonicalEventDateDisplay || (r.canonicalEventDate ? fDate(r.canonicalEventDate) : 'no date')} · {r.clergy || '—'}{r.location ? ` · ${r.location}` : ''}</Typography>
                  </Box>
                  {r.deletedAt ? (
                    <>
                      <Label variant="soft" color="error">Deleted</Label>
                      {canManage && <Button size="small" variant="soft" loading={busy === `restore-${r.sourceRecordId}`} onClick={() => act(`restore-${r.sourceRecordId}`, () => parishSearchApi.restore({ churchId, recordType: r.recordType, recordIds: [Number(r.sourceRecordId)] }), 'Record restored')}>Restore</Button>}
                    </>
                  ) : g.recommendedSurvivorId === Number(r.sourceRecordId) ? <Label variant="soft" color="success">Recommended keep</Label> : null}
                </Box>
              ))}
            </Stack>

            {canManage && (
              <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {g.recordType !== 'cross_record' && g.records.filter((r) => !r.deletedAt).length > 1 && (
                  <Button size="small" variant="contained" color="warning" startIcon={<Iconify icon="solar:copy-bold" />} onClick={() => openMerge(g)}>Merge — keep one</Button>
                )}
                <Button size="small" variant="soft" color="success" loading={busy === `nd-${g.signature}`} onClick={() => act(`nd-${g.signature}`, () => parishSearchApi.notDuplicates(g.signature, { churchId, recordType: g.recordType, recordIds: g.sourceRecordIds, classification: g.classification }), 'Marked as not duplicates')}>Not duplicates</Button>
                <Button size="small" variant="soft" color="inherit" loading={busy === `inv-${g.signature}`} onClick={() => act(`inv-${g.signature}`, () => parishSearchApi.reviewDuplicate(g.signature, { churchId, recordType: g.recordType, recordIds: g.sourceRecordIds, classification: g.classification, reviewStatus: 'needs_investigation' }), 'Flagged for investigation')}>Needs investigation</Button>
              </Box>
            )}
          </Card>
        ))}
      </Stack>

      <Dialog fullWidth maxWidth="sm" open={!!merge} onClose={() => setMerge(null)}>
        <DialogTitle>Merge duplicates</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Choose the record to keep. The others are soft-deleted (restorable from search) and the action is written to the audit history.</Typography>
          {merge?.records.filter((r) => !r.deletedAt).map((r) => (
            <Box key={String(r.sourceRecordId)} onClick={() => setKeep(Number(r.sourceRecordId))} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: 1, cursor: 'pointer', border: (t) => `1px solid ${keep === Number(r.sourceRecordId) ? t.vars.palette.primary.main : t.vars.palette.divider}` }}>
              <Radio size="small" checked={keep === Number(r.sourceRecordId)} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2">{r.primaryName} <Typography component="span" variant="caption" sx={{ color: 'text.disabled' }}>#{r.sourceRecordId}</Typography></Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.canonicalEventDateDisplay || r.canonicalEventDate || 'no date'} · {r.clergy || '—'} · {r.status || '—'}</Typography>
              </Box>
            </Box>
          ))}
          {preview?.warnings?.length > 0 && <Alert severity="warning">{preview.warnings.join(' ')}</Alert>}
          {preview?.missingData?.length > 0 && <Alert severity="info">Fields only present on records being removed: {preview.missingData.join(', ')}</Alert>}
          <TextField size="small" label="Review notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} multiline rows={2} />
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setMerge(null)}>Cancel</Button>
          <Button variant="contained" color="warning" disabled={!keep} loading={!!busy} onClick={doMerge}>Merge and keep #{keep}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
