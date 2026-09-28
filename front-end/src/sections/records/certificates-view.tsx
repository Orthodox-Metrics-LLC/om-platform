import type { RawRecord, RecordType, CertificateHistory, CertificateTemplate } from './om-records-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { useSearchParams } from 'src/routes/hooks';

import { fDateTime } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { FileManagerChurchPicker } from 'src/sections/file-manager/file-manager-church-picker';

import { useRecordsChurch } from './use-records-church';
import { RECORD_TYPES, certificateApi, normalizeRecord } from './om-records-api';

// ----------------------------------------------------------------------

/**
 * Certificate generator on Certificate Studio: choose a template and a record,
 * preview the PDF, render it (stored + audited in generation history), download.
 * `?type=&record=` preselects; `?records=1,2,3` runs a bulk batch.
 */
export function CertificatesView() {
  const params = useSearchParams();
  const { churchId, platform } = useRecordsChurch();
  const [type, setType] = useState<RecordType>((params.get('type') as RecordType) || 'baptism');
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [records, setRecords] = useState<RawRecord[]>([]);
  const [search, setSearch] = useState('');
  const [record, setRecord] = useState<RawRecord | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'render' | 'bulk' | null>(null);
  const [history, setHistory] = useState<CertificateHistory[]>([]);
  const [bulk, setBulk] = useState<{ ids: number[]; done: { id: number; historyId?: number; error?: string }[] } | null>(() => {
    const ids = (params.get('records') || '').split(',').map(Number).filter(Boolean);
    return ids.length ? { ids, done: [] } : null;
  });

  const loadHistory = useCallback(() => certificateApi.history(type, 25).then(setHistory).catch(() => setHistory([])), [type]);

  useEffect(() => {
    certificateApi.templates(type).then((t) => { setTemplates(t); const def = t.find((x) => x.is_default) ?? t[0]; setTemplateId(def?.id ?? ''); }).catch(() => setTemplates([]));
    loadHistory();
    setPreview(null);
  }, [type, loadHistory]);

  useEffect(() => {
    if (!churchId) return undefined;
    const t = setTimeout(() => certificateApi.records(type, churchId, search).then(setRecords).catch(() => setRecords([])), 250);
    return () => clearTimeout(t);
  }, [type, churchId, search]);

  // preselect record from ?record=
  useEffect(() => {
    const rid = Number(params.get('record'));
    if (!rid || !churchId) return;
    certificateApi.records(type, churchId, undefined, rid).then((rs) => { const r = rs.find((x) => x.id === rid) ?? rs[0]; if (r) setRecord(r); }).catch(() => {});
  }, [params, type, churchId]);

  const doPreview = async () => {
    if (!templateId) return;
    setBusy('preview');
    try {
      const r = await certificateApi.preview({ template_id: Number(templateId), certificate_type: type, record_id: record?.id, use_sample_data: !record, church_id: churchId! });
      const bytes = Uint8Array.from(atob(r.pdf_base64), (ch) => ch.charCodeAt(0));
      setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); });
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Preview failed'); } finally { setBusy(null); }
  };

  const doRender = async () => {
    if (!templateId || !record) return;
    setBusy('render');
    try {
      const r = await certificateApi.render({ template_id: Number(templateId), certificate_type: type, record_id: record.id, church_id: churchId! });
      toast.success('Certificate generated');
      window.open(r.download_url, '_blank');
      loadHistory();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Render failed'); } finally { setBusy(null); }
  };

  const doBulk = async () => {
    if (!bulk || !templateId) return;
    setBusy('bulk');
    const done: typeof bulk.done = [];
    for (const id of bulk.ids) {
      try { const r = await certificateApi.render({ template_id: Number(templateId), certificate_type: type, record_id: id, church_id: churchId! }); done.push({ id, historyId: r.history_id }); }
      catch (e) { done.push({ id, error: e instanceof Error ? e.message : 'failed' }); }
      setBulk({ ids: bulk.ids, done: [...done] });
    }
    setBusy(null);
    toast.success(`${done.filter((d) => !d.error).length} of ${bulk.ids.length} certificates generated`);
    loadHistory();
  };

  if (platform && !churchId) return <FileManagerChurchPicker heading="Certificates" basePath={paths.dashboard.records.certificates} />;
  if (!churchId) return <DashboardContent><EmptyContent filled title="Your account is not assigned to a church" sx={{ py: 10 }} /></DashboardContent>;

  const meta = RECORD_TYPES.find((t) => t.value === type)!;
  const label = (r: RawRecord) => { const n = normalizeRecord(type, r); return `${n.title}${r.reception_date || r.mdate || r.burial_date || r.date_of_baptism ? ` · ${r.date_of_baptism || r.reception_date || r.mdate || r.burial_date}` : ''} · #${r.id}`; };

  return (
    <DashboardContent maxWidth="xl">
      <CustomBreadcrumbs heading="Certificates" links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Records', href: paths.dashboard.records.root }, { name: 'Certificates' }]} sx={{ mb: 3 }} />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={3}>
            <Card>
              <CardHeader title="Certificate" subheader="Pick the sacrament, template and record" />
              <Stack spacing={2.5} sx={{ p: 3 }}>
                <TextField select label="Sacrament" value={type} onChange={(e) => { setType(e.target.value as RecordType); setRecord(null); setBulk(null); }}>{RECORD_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}</TextField>
                <TextField select label="Template" value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))} helperText={!templates.length ? 'No active templates for this sacrament — create one in Certificate Studio.' : undefined}>
                  {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}{t.is_default ? ' · default' : ''}{t.church_id ? '' : ' · global'}</MenuItem>)}
                </TextField>
                {!bulk && (
                  <Autocomplete options={records} value={record} onChange={(_, v) => setRecord(v)} onInputChange={(_, v, reason) => { if (reason === 'input') setSearch(v); }} getOptionLabel={label} isOptionEqualToValue={(a, b) => a.id === b.id} renderInput={(p) => <TextField {...p} label={`${meta.label} record`} placeholder="Search by name…" />} />
                )}
                {bulk && (
                  <Alert severity="info" action={<Button size="small" color="inherit" onClick={() => setBulk(null)}>Clear</Button>}>Bulk batch: {bulk.ids.length} {meta.label.toLowerCase()} records selected from the list.</Alert>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button variant="outlined" color="inherit" loading={busy === 'preview'} disabled={!templateId} onClick={doPreview} startIcon={<Iconify icon="solar:eye-bold" />}>Preview{record ? '' : ' (sample)'}</Button>
                  {bulk ? (
                    <Button variant="contained" loading={busy === 'bulk'} disabled={!templateId} onClick={doBulk} startIcon={<Iconify icon="solar:verified-check-bold" />}>Generate {bulk.ids.length}</Button>
                  ) : (
                    <Button variant="contained" loading={busy === 'render'} disabled={!templateId || !record} onClick={doRender} startIcon={<Iconify icon="solar:verified-check-bold" />}>Generate PDF</Button>
                  )}
                </Box>
                {bulk && bulk.done.length > 0 && (
                  <Stack spacing={0.5}>
                    <LinearProgress variant="determinate" value={(bulk.done.length / bulk.ids.length) * 100} />
                    {bulk.done.map((d) => (
                      <Box key={d.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, typography: 'caption' }}>
                        <Iconify icon={d.error ? 'solar:danger-bold' : 'solar:check-circle-bold'} width={16} sx={{ color: d.error ? 'error.main' : 'success.main' }} />
                        <span>#{d.id}</span>{d.error ? <span style={{ opacity: 0.7 }}>{d.error}</span> : d.historyId ? <Button size="small" component="a" href={certificateApi.downloadUrl(d.historyId)} target="_blank">Download</Button> : null}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>

            <Card>
              <CardHeader title="Recently generated" subheader="Every render is kept in the certificate history" />
              <Stack divider={<Box sx={{ borderBottom: (t) => `1px dashed ${t.vars.palette.divider}` }} />} sx={{ px: 3, pb: 2 }}>
                {history.map((h) => (
                  <Box key={h.id} sx={{ py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography variant="body2" noWrap>{meta.label} #{h.record_id} · {h.template_name || `template ${h.template_id}`}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>{fDateTime(h.created_at)}</Typography>
                    </Box>
                    <Button size="small" variant="soft" component="a" href={certificateApi.downloadUrl(h.id)} target="_blank" startIcon={<Iconify icon="eva:cloud-download-fill" />}>PDF</Button>
                  </Box>
                ))}
                {!history.length && <Typography variant="caption" sx={{ py: 2, color: 'text.disabled' }}>Nothing generated yet.</Typography>}
              </Stack>
            </Card>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: 1, minHeight: 720, display: 'flex', flexDirection: 'column' }}>
            <CardHeader title="Preview" action={preview && <Label variant="soft" color="info">{record ? `${normalizeRecord(type, record).title}` : 'Sample data'}</Label>} />
            <Box sx={{ flexGrow: 1, m: 3, mt: 1, borderRadius: 1.5, bgcolor: 'background.neutral', overflow: 'hidden' }}>
              {busy === 'preview' && <LinearProgress />}
              {preview ? <Box component="iframe" title="Certificate preview" src={preview} sx={{ width: 1, height: 1, minHeight: 680, border: 0 }} /> : <EmptyContent title="No preview yet" description="Choose a template and record, then click Preview." sx={{ py: 12 }} />}
            </Box>
          </Card>
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
