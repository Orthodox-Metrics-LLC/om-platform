import type { StudioRecord, HistoryEntry, CertificateType, CertificateTemplate } from './certificates/om-certificates-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import LinearProgress from '@mui/material/LinearProgress';
import TablePagination from '@mui/material/TablePagination';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';
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
import { pdfObjectUrl, omCertificatesApi, CERTIFICATE_TYPES } from './certificates/om-certificates-api';

// ----------------------------------------------------------------------

const recordLabel = (type: CertificateType, r: StudioRecord) => {
  if (type === 'marriage') return `${[r.fname_groom, r.lname_groom].filter(Boolean).join(' ')} & ${[r.fname_bride, r.lname_bride].filter(Boolean).join(' ')}${r.mdate ? ` · ${r.mdate}` : ''} · #${r.id}`;
  return `${[r.first_name, r.last_name].filter(Boolean).join(' ')}${r.date_of_baptism || r.reception_date ? ` · ${r.date_of_baptism || r.reception_date}` : ''} · #${r.id}`;
};

/**
 * Generate certificates: sacrament → template (OM or parish) → record → live PDF preview → Generate.
 * Generated PDFs are filed in the parish File manager under Documents › Certificates.
 * `?type=&record=` preselects; `?records=1,2,3` runs a bulk batch; `?template=` preselects a template.
 */
export function CertificatesView() {
  const params = useSearchParams();
  const { churchId, platform } = useRecordsChurch();
  const paramType = params.get('type');
  const [type, setType] = useState<CertificateType>(paramType === 'marriage' ? 'marriage' : paramType === 'reception' ? 'reception' : 'baptism');
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(params.get('template') || '');
  const [records, setRecords] = useState<StudioRecord[]>([]);
  const [search, setSearch] = useState('');
  const [record, setRecord] = useState<StudioRecord | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState<string>('');
  const [busy, setBusy] = useState<'preview' | 'render' | 'bulk' | null>(null);
  const [history, setHistory] = useState<{ rows: HistoryEntry[]; total: number }>({ rows: [], total: 0 });
  const [hPage, setHPage] = useState(0);
  const [hLimit, setHLimit] = useState(6);
  const [lastFile, setLastFile] = useState<{ name: string; url: string } | null>(null);
  const [bulk, setBulk] = useState<{ ids: number[]; done: { id: number; name?: string; url?: string; error?: string }[] } | null>(() => { const ids = (params.get('records') || '').split(',').map(Number).filter(Boolean); return ids.length ? { ids, done: [] } : null; });
  const suffix = platform && churchId ? `?church=${churchId}` : '';

  const loadHistory = useCallback(() => omCertificatesApi.history({ churchId, type, page: hPage + 1, limit: hLimit }).then((r) => setHistory({ rows: r.history, total: r.total })).catch(() => setHistory({ rows: [], total: 0 })), [churchId, type, hPage, hLimit]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    omCertificatesApi.templates({ churchId, type }).then((r) => {
      const active = r.templates.filter((t) => t.status === 'active');
      setTemplates(active);
      setTemplateId((cur) => (cur && active.some((t) => t.id === cur) ? cur : (active.find((t) => t.scope === 'church' && t.is_default) ?? active.find((t) => t.is_default) ?? active[0])?.id ?? ''));
    }).catch(() => setTemplates([]));
    setPreview(null);
  }, [type, churchId]);

  useEffect(() => {
    if (!churchId) return undefined;
    const t = setTimeout(() => omCertificatesApi.records(type, churchId, search).then(setRecords).catch(() => setRecords([])), 250);
    return () => clearTimeout(t);
  }, [type, churchId, search]);

  useEffect(() => {
    const rid = Number(params.get('record'));
    if (!rid || !churchId) return;
    omCertificatesApi.records(type, churchId, undefined, rid).then((rs) => { const r = rs.find((x) => x.id === rid) ?? rs[0]; if (r) setRecord(r); }).catch(() => {});
  }, [params, type, churchId]);

  // Live preview: re-render whenever template or record changes
  useEffect(() => {
    if (!templateId || !churchId) return undefined;
    const key = `${templateId}|${record?.id ?? 'sample'}`;
    if (key === previewFor) return undefined;
    let cancelled = false;
    setBusy('preview');
    omCertificatesApi.preview({ template_id: templateId, church_id: churchId, record_id: record?.id ?? null, use_sample_data: !record })
      .then((b64) => { if (cancelled) return; setPreview((p) => { if (p) URL.revokeObjectURL(p); return pdfObjectUrl(b64); }); setPreviewFor(key); })
      .catch((e) => { if (!cancelled) toast.error(e instanceof Error ? e.message : 'Preview failed'); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, record, churchId]);

  const generate = async () => {
    if (!templateId || !record) return;
    setBusy('render');
    try {
      const r = await omCertificatesApi.generate({ template_id: templateId, church_id: churchId, record_id: record.id });
      setLastFile({ name: r.file.name, url: r.file.download_url });
      toast.success(`Saved to Documents › Certificates as “${r.file.name}”`);
      setHPage(0); loadHistory();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Generate failed'); } finally { setBusy(null); }
  };

  const generateBulk = async () => {
    if (!bulk || !templateId) return;
    setBusy('bulk');
    const done: typeof bulk.done = [];
    for (const id of bulk.ids) {
      try { const r = await omCertificatesApi.generate({ template_id: templateId, church_id: churchId, record_id: id }); done.push({ id, name: r.file.name, url: r.file.download_url }); }
      catch (e) { done.push({ id, error: e instanceof Error ? e.message : 'failed' }); }
      setBulk({ ids: bulk.ids, done: [...done] });
    }
    setBusy(null);
    toast.success(`${done.filter((x) => !x.error).length} of ${bulk.ids.length} certificates saved to Documents › Certificates`);
    setHPage(0); loadHistory();
  };

  if (platform && !churchId) return <FileManagerChurchPicker heading="Certificates" basePath={paths.portal.records.certificates} />;
  if (!churchId) return <DashboardContent><EmptyContent filled title="Your account is not assigned to a church" sx={{ py: 10 }} /></DashboardContent>;

  const tpl = templates.find((t) => t.id === templateId);
  const meta = CERTIFICATE_TYPES.find((t) => t.value === type)!;

  return (
    <DashboardContent maxWidth="xl">
      <CustomBreadcrumbs heading="Certificates" links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Records', href: paths.portal.records.root }, { name: 'Certificates' }]}
        action={<Button component={RouterLink} href={`${paths.portal.records.certificateTemplates}${suffix}`} variant="outlined" color="inherit" startIcon={<Iconify icon="solar:pen-bold" />}>Templates & designer</Button>} sx={{ mb: 3 }} />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={3}>
            <Card>
              <CardHeader title="Certificate" subheader="Sacrament, template and record" />
              <Stack spacing={2.5} sx={{ p: 3 }}>
                <TextField select label="Sacrament" value={type} onChange={(e) => { setType(e.target.value as CertificateType); setRecord(null); setBulk(null); setHPage(0); }}>{CERTIFICATE_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}</TextField>
                <TextField select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} helperText={!templates.length ? 'No published templates for this sacrament — open Templates & designer.' : undefined}>
                  {templates.map((t) => <MenuItem key={t.id} value={t.id}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: 1 }}><span style={{ flexGrow: 1 }}>{t.name}</span><Label variant="soft" color={t.scope === 'church' ? 'primary' : 'info'}>{t.scope === 'church' ? 'Parish' : 'OM'}</Label>{t.is_default && <Label variant="soft" color="success">default</Label>}</Box></MenuItem>)}
                </TextField>
                {!bulk && (
                  <Autocomplete options={records} value={record} onChange={(_, v) => setRecord(v)} onInputChange={(_, v, reason) => { if (reason === 'input') setSearch(v); }} getOptionLabel={(r) => recordLabel(type, r)} isOptionEqualToValue={(a, b) => a.id === b.id} renderInput={(p) => <TextField {...p} label={`${meta.label} record`} placeholder="Search by name…" />} />
                )}
                {bulk && <Alert severity="info" action={<Button size="small" color="inherit" onClick={() => setBulk(null)}>Clear</Button>}>Bulk batch: {bulk.ids.length} {meta.label.toLowerCase()} records selected from the list.</Alert>}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {bulk ? (
                    <Button variant="contained" loading={busy === 'bulk'} disabled={!templateId} onClick={generateBulk} startIcon={<Iconify icon="solar:verified-check-bold" />}>Generate {bulk.ids.length} certificates</Button>
                  ) : (
                    <Button variant="contained" loading={busy === 'render'} disabled={!templateId || !record} onClick={generate} startIcon={<Iconify icon="solar:verified-check-bold" />}>Generate & save</Button>
                  )}
                </Box>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>Generated PDFs are saved to <b>File manager › Documents › Certificates</b> as “{meta.label} Certificate — Name — Date.pdf”.</Typography>
                {lastFile && <Alert severity="success" action={<Button size="small" component="a" href={lastFile.url} target="_blank" rel="noopener">Open</Button>}>Saved “{lastFile.name}”</Alert>}
                {bulk && bulk.done.length > 0 && (
                  <Stack spacing={0.5}>
                    <LinearProgress variant="determinate" value={(bulk.done.length / bulk.ids.length) * 100} />
                    {bulk.done.map((x) => (
                      <Box key={x.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, typography: 'caption' }}>
                        <Iconify icon={x.error ? 'solar:danger-bold' : 'solar:check-circle-bold'} width={16} sx={{ color: x.error ? 'error.main' : 'success.main' }} />
                        <Box component="span" sx={{ minWidth: 0, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.error ? `#${x.id} — ${x.error}` : x.name}</Box>
                        {x.url && <Button size="small" component="a" href={x.url} target="_blank" rel="noopener">Open</Button>}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>

            <Card>
              <CardHeader title="Recently generated" subheader={`${history.total} ${meta.label.toLowerCase()} certificate${history.total === 1 ? '' : 's'} on file`} />
              <Stack divider={<Divider sx={{ borderStyle: 'dashed' }} />} sx={{ px: 3 }}>
                {history.rows.map((h) => (
                  <Box key={h.id} sx={{ py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography variant="body2" noWrap>{h.person || `${meta.label} #${h.record_id}`}</Typography>
                      <Typography variant="caption" noWrap sx={{ color: 'text.disabled', display: 'block' }}>{h.template_name} · {fDateTime(h.generated_at)}{h.generated_by ? ` · ${h.generated_by}` : ''}</Typography>
                    </Box>
                    <Button size="small" variant="soft" component="a" href={h.download_url} target="_blank" rel="noopener" startIcon={<Iconify icon="eva:cloud-download-fill" />}>PDF</Button>
                  </Box>
                ))}
                {!history.rows.length && <Typography variant="caption" sx={{ py: 2, color: 'text.disabled' }}>Nothing generated yet.</Typography>}
              </Stack>
              {history.total > 0 && <TablePagination component="div" count={history.total} page={hPage} rowsPerPage={hLimit} rowsPerPageOptions={[6, 12, 24]} onPageChange={(_, p) => setHPage(p)} onRowsPerPageChange={(e) => { setHLimit(Number(e.target.value)); setHPage(0); }} />}
            </Card>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: 1, minHeight: 860, display: 'flex', flexDirection: 'column' }}>
            <CardHeader title="Preview" subheader={tpl ? `${tpl.name} · ${record ? recordLabel(type, record).replace(/ · #\d+$/, '') : 'sample data'}` : 'Choose a template'}
              action={preview && <Button component="a" href={preview} target="_blank" rel="noopener" size="small" color="inherit" startIcon={<Iconify icon="solar:full-screen-square-outline" />}>Open full size</Button>} />
            <Box sx={{ flexGrow: 1, m: 3, mt: 1, borderRadius: 1.5, bgcolor: 'grey.800', overflow: 'hidden', position: 'relative' }}>
              {busy === 'preview' && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }} />}
              {preview ? <Box component="iframe" title="Certificate preview" src={`${preview}#toolbar=0&navpanes=0&view=Fit`} sx={{ width: 1, height: 1, minHeight: 800, border: 0, display: 'block' }} /> : <EmptyContent title="No preview yet" description="Pick a template — the preview renders the exact PDF that will be generated." sx={{ py: 12 }} />}
            </Box>
          </Card>
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
