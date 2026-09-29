import type { OmRecord, RecordType, RecordHistoryEntry } from './om-records-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Timeline from '@mui/lab/Timeline';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TimelineDot from '@mui/lab/TimelineDot';
import TextField from '@mui/material/TextField';
import TimelineItem from '@mui/lab/TimelineItem';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import TimelineContent from '@mui/lab/TimelineContent';
import LinearProgress from '@mui/material/LinearProgress';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { fDate, fDateTime } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { STATUS_COLOR } from './records-list-view';
import { useRecordsChurch } from './use-records-church';
import { RecordsExportDialog } from './records-export-dialog';
import { recordsAst, omRecordsApi, RECORD_TYPES, RECORD_STATUSES } from './om-records-api';

// ----------------------------------------------------------------------

const HISTORY_COLOR: Record<string, 'success' | 'info' | 'warning' | 'error' | 'grey'> = { create: 'success', update: 'info', merge: 'warning', delete: 'error', restore: 'success' };

/** Record details + full audit history (product details pattern). */
export function RecordDetailsView({ type }: { type: RecordType }) {
  const { id } = useParams();
  const { churchId, platform, canManage, canChangeStatus } = useRecordsChurch();
  const meta = RECORD_TYPES.find((t) => t.value === type)!;
  const [record, setRecord] = useState<OmRecord | null>(null);
  const [history, setHistory] = useState<RecordHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const suffix = platform && churchId ? `?church=${churchId}` : '';

  const load = useCallback(async () => {
    if (!churchId || !id) return;
    try {
      const [r, h] = await Promise.all([omRecordsApi.get(type, Number(id), churchId), omRecordsApi.history(type, Number(id), churchId).catch(() => [])]);
      setRecord(r); setHistory(h); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Record not found'); }
  }, [churchId, id, type]);
  useEffect(() => { load(); }, [load]);

  const changeStatus = async (status: string) => {
    if (!record || !churchId) return;
    setStatusBusy(true);
    try { await omRecordsApi.setStatus(type, record.id, churchId, status); toast.success(`Status set to ${status.replace(/_/g, ' ')}`); load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not change status'); } finally { setStatusBusy(false); }
  };

  if (error) return <DashboardContent><EmptyContent filled title={error} action={<Button component={RouterLink} href={paths.dashboard.records.list(type)} variant="contained">Back to records</Button>} sx={{ py: 10 }} /></DashboardContent>;
  if (!record) return <DashboardContent><LinearProgress /></DashboardContent>;

  const r = record.raw;
  const fields: [string, React.ReactNode][] = type === 'baptism'
    ? [['First name', r.first_name], ['Last name', r.last_name], ['Date of birth', r.birth_date ? fDate(r.birth_date) : '—'], ['Baptism date', r.reception_date ? fDate(r.reception_date) : '—'], ['Received by', r.entry_type], ['Birthplace', r.birthplace], ['Parents', r.parents], ['Sponsors', r.sponsors], ['Clergy', r.clergy]]
    : type === 'marriage'
      ? [['Groom', [r.fname_groom, r.lname_groom].filter(Boolean).join(' ')], ["Groom's parents", r.parentsg], ['Bride', [r.fname_bride, r.lname_bride].filter(Boolean).join(' ')], ["Bride's parents", r.parentsb], ['Marriage date', r.mdate ? fDate(r.mdate) : '—'], ['License', r.mlicense], ['Witnesses', r.witness], ['Celebrant', r.clergy]]
      : [['First name', r.name], ['Last name', r.lastname], ['Date of death', r.deceased_date ? fDate(r.deceased_date) : '—'], ['Burial date', r.burial_date ? fDate(r.burial_date) : '—'], ['Age', r.age], ['Burial place', r.burial_location], ['Clergy', r.clergy]];

  return (
    <>
      <DashboardContent>
        <CustomBreadcrumbs
          heading={record.title}
          links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Records', href: `${paths.dashboard.records.list(type)}${suffix}` }, { name: meta.plural, href: `${paths.dashboard.records.list(type)}${suffix}` }, { name: `#${record.id}` }]}
          action={
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:export-bold" />} onClick={() => setExportOpen(true)}>Export</Button>
              {type !== 'funeral' && <Button variant="outlined" color="inherit" component={RouterLink} href={`${paths.dashboard.records.certificates}?type=${type}&record=${record.id}${platform ? `&church=${churchId}` : ''}`} startIcon={<Iconify icon="solar:verified-check-bold" />}>Certificate</Button>}
              {canManage && <Button variant="contained" component={RouterLink} href={`${paths.dashboard.records.edit(type, record.id)}${suffix}`} startIcon={<Iconify icon="solar:pen-bold" />}>Edit</Button>}
            </Box>
          }
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Card>
              <CardHeader title={`${meta.label} record`} subheader={record.eventDate ? `${type === 'baptism' ? 'Baptized' : type === 'marriage' ? 'Married' : 'Buried'} ${fDate(record.eventDate)}` : undefined} action={<Label variant="soft" color={STATUS_COLOR[record.status] || 'default'} sx={{ textTransform: 'capitalize' }}>{record.status.replace(/_/g, ' ')}</Label>} />
              <Box sx={{ p: 3, display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
                {fields.map(([label, value]) => (
                  <Box key={label}><Typography variant="caption" sx={{ color: 'text.disabled' }}>{label}</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>{value || '—'}</Typography></Box>
                ))}
                {r.notes && <Box sx={{ gridColumn: '1 / -1' }}><Typography variant="caption" sx={{ color: 'text.disabled' }}>Notes</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{r.notes}</Typography></Box>}
              </Box>
              <Divider sx={{ borderStyle: 'dashed' }} />
              <Box sx={{ p: 3, display: 'flex', gap: 3, flexWrap: 'wrap', typography: 'caption', color: 'text.disabled' }}>
                <span>Record #{record.id}</span>
                {r.created_at && <span>Created {fDateTime(r.created_at)}</span>}
                {r.updated_at && <span>Updated {fDateTime(r.updated_at)}</span>}
                {r.verified_by && <span>Verified by #{r.verified_by}{r.verified_at ? ` on ${fDate(r.verified_at)}` : ''}</span>}
                {r.source_scan_id && <span>From scan #{r.source_scan_id}{r.ocr_confidence ? ` · OCR ${Math.round(Number(r.ocr_confidence) * 100)}%` : ''}</span>}
              </Box>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={3}>
              {canChangeStatus && (
                <Card sx={{ p: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Register status</Typography>
                  <TextField select fullWidth size="small" value={record.status} disabled={statusBusy} onChange={(e) => changeStatus(e.target.value)}>
                    {[...new Set([...RECORD_STATUSES, record.status])].map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</MenuItem>)}
                  </TextField>
                  <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.disabled' }}>Status changes are recorded in the audit history.</Typography>
                </Card>
              )}

              <Card>
                <CardHeader title="Audit history" subheader={history ? `${history.length} event${history.length === 1 ? '' : 's'}` : undefined} />
                <Box sx={{ p: 3, pt: 1 }}>
                  {!history ? <LinearProgress /> : !history.length ? (
                    <Typography variant="body2" sx={{ color: 'text.disabled' }}>No changes recorded since this record was migrated.</Typography>
                  ) : (
                    <Timeline sx={{ p: 0, m: 0, '& .MuiTimelineItem-root::before': { display: 'none' } }}>
                      {history.map((h, i) => (
                        <TimelineItem key={h.id}>
                          <TimelineSeparator><TimelineDot color={HISTORY_COLOR[h.type] || 'grey'} />{i < history.length - 1 && <TimelineConnector />}</TimelineSeparator>
                          <TimelineContent sx={{ pb: 2.5 }}>
                            <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>{h.type}{h.source ? <Typography component="span" variant="caption" sx={{ color: 'text.disabled' }}> · {h.source}</Typography> : null}</Typography>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{h.description}</Typography>
                            {h.changedFields?.length > 0 && <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>{h.changedFields.map((f) => <Label key={f} variant="outlined">{f}</Label>)}</Box>}
                            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 0.5 }}>{fDateTime(h.timestamp)}{h.actor ? ` · ${h.actor}` : ''}</Typography>
                          </TimelineContent>
                        </TimelineItem>
                      ))}
                    </Timeline>
                  )}
                </Box>
              </Card>
            </Stack>
          </Grid>
        </Grid>
      </DashboardContent>

      {churchId && <RecordsExportDialog open={exportOpen} onClose={() => setExportOpen(false)} ast={recordsAst(churchId, [type], { filters: { operator: 'and', conditions: [{ field: 'source_record_id', operator: 'in', value: [record.id] }] } })} count={1} />}
    </>
  );
}
