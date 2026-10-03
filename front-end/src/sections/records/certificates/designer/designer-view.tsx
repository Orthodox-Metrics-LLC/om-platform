import type { StudioMeta, LayoutJson, CertificateType, CertificateTemplate } from '../om-certificates-api';

import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';
import FormControlLabel from '@mui/material/FormControlLabel';

import { paths } from 'src/routes/paths';
import { useRouter, useParams } from 'src/routes/hooks';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { useDesigner } from './use-designer';
import { DesignerCanvas } from './designer-canvas';
import { useRecordsChurch } from '../../use-records-church';
import { DesignerLeftPanel, DesignerRightPanel } from './designer-panels';
import { pdfObjectUrl, omCertificatesApi, CERTIFICATE_TYPES } from '../om-certificates-api';

// ----------------------------------------------------------------------

const PAGE = { letter: { width: 612, height: 792 }, a4: { width: 595.28, height: 841.89 } };
const dims = (t: Pick<CertificateTemplate, 'canvas_size' | 'orientation' | 'custom_width' | 'custom_height'>) => {
  if (t.canvas_size === 'custom' && t.custom_width && t.custom_height) return { width: Number(t.custom_width), height: Number(t.custom_height) };
  const b = PAGE[t.canvas_size as 'letter' | 'a4'] || PAGE.letter;
  return t.orientation === 'landscape' ? { width: b.height, height: b.width } : b;
};
const EMPTY: LayoutJson = { version: 2, margins: { top: 36, right: 36, bottom: 36, left: 36 }, bleed: 0, showGuides: true, layers: [] };

/** Certificate designer — full-window WYSIWYG editor for OM and parish templates. */
export function CertificateDesignerView() {
  const { id = 'new' } = useParams();
  const router = useRouter();
  const { churchId, platform } = useRecordsChurch();
  const [meta, setMeta] = useState<StudioMeta | null>(null);
  const [tpl, setTpl] = useState<CertificateTemplate | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [busy, setBusy] = useState<'save' | 'publish' | 'preview' | 'dup' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [publishAsk, setPublishAsk] = useState(false);
  const [newDlg, setNewDlg] = useState(id === 'new');
  const [draft, setDraft] = useState<{ name: string; certificate_type: CertificateType; scope: 'global' | 'church'; canvas_size: 'letter' | 'a4'; orientation: 'portrait' | 'landscape' }>({ name: '', certificate_type: 'baptism', scope: 'church', canvas_size: 'letter', orientation: 'portrait' });

  const page = useMemo(() => (tpl ? dims(tpl) : dims({ canvas_size: draft.canvas_size, orientation: draft.orientation, custom_width: null, custom_height: null })), [tpl, draft]);
  const d = useDesigner(EMPTY, page);
  const sampleValues = useMemo(() => ({ ...(meta?.sample.church ?? {}), ...(meta?.sample[tpl?.certificate_type ?? draft.certificate_type] ?? {}) }), [meta, tpl, draft.certificate_type]);

  useEffect(() => { omCertificatesApi.meta(churchId).then((m) => { setMeta(m); setDraft((p) => ({ ...p, scope: m.canDesignParish ? 'church' : 'global' })); }).catch((e) => setError(e.message)); }, [churchId]);

  const load = useCallback(async (templateId: string) => {
    try {
      const r = await omCertificatesApi.template(templateId, churchId);
      setTpl(r.template); setCanEdit(r.canEdit); d.setLayout(r.template.layout_json); setLoaded(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Template not found'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId]);
  useEffect(() => { if (id !== 'new') load(id); else setLoaded(true); }, [id, load]);

  // leave-guard
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (d.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [d.dirty]);

  const create = async () => {
    setBusy('save');
    try {
      const t = await omCertificatesApi.create({ scope: draft.scope, church_id: churchId, certificate_type: draft.certificate_type, name: draft.name.trim() || 'Untitled template', canvas_size: draft.canvas_size, orientation: draft.orientation });
      setNewDlg(false);
      router.replace(`${paths.portal.records.certificateDesigner(t.id)}${platform && churchId ? `?church=${churchId}` : ''}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create template'); } finally { setBusy(null); }
  };

  const save = async (): Promise<CertificateTemplate | null> => {
    if (!tpl) return null;
    setBusy('save');
    try {
      const t = await omCertificatesApi.update(tpl.id, { church_id: churchId, name: tpl.name, description: tpl.description ?? undefined, canvas_size: tpl.canvas_size, orientation: tpl.orientation, layout_json: d.layout });
      setTpl((p) => ({ ...(p as CertificateTemplate), ...t, layout_json: p?.layout_json })); d.setDirty(false);
      toast.success(t.status === 'active' ? 'Saved — the live template now uses this layout' : 'Draft saved');
      return t;
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); return null; } finally { setBusy(null); }
  };

  const publish = async (makeDefault: boolean) => {
    if (!tpl) return;
    setPublishAsk(false);
    if (d.dirty && !(await save())) return;
    setBusy('publish');
    try { const t = await omCertificatesApi.publish(tpl.id, { church_id: churchId, make_default: makeDefault }); setTpl((p) => ({ ...(p as CertificateTemplate), ...t, layout_json: p?.layout_json })); toast.success(`Published${makeDefault ? ' and set as the default' : ''}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Publish failed'); } finally { setBusy(null); }
  };

  const doPreview = async () => {
    if (!tpl) return;
    setBusy('preview');
    try { setPreview(pdfObjectUrl(await omCertificatesApi.preview({ template_id: tpl.id, church_id: churchId, use_sample_data: true, layout_json: d.layout }))); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Preview failed'); } finally { setBusy(null); }
  };

  const duplicate = async () => {
    if (!tpl) return;
    setBusy('dup');
    try { const t = await omCertificatesApi.duplicate(tpl.id, { church_id: churchId, scope: tpl.scope === 'global' && meta?.canDesignGlobal && !churchId ? 'global' : 'church' }); toast.success(`Copied as "${t.name}"`); router.push(`${paths.portal.records.certificateDesigner(t.id)}${platform && churchId ? `?church=${churchId}` : ''}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Duplicate failed'); } finally { setBusy(null); }
  };

  if (error) return <DashboardContent><EmptyContent filled title={error} action={<Button variant="contained" onClick={() => router.push(paths.portal.records.certificateTemplates)}>Back to templates</Button>} sx={{ py: 10 }} /></DashboardContent>;
  if (!loaded || !meta) return <DashboardContent><LinearProgress /></DashboardContent>;

  const readOnly = !!tpl && !canEdit;
  const statusColor = tpl?.status === 'active' ? 'success' : tpl?.status === 'archived' ? 'default' : 'warning';

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.drawer + 2, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* toolbar */}
      <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: (t) => `1px solid ${t.vars.palette.divider}`, bgcolor: 'background.paper', flexWrap: 'wrap' }}>
        <Tooltip title="Back to templates"><IconButton onClick={() => router.push(`${paths.portal.records.certificateTemplates}${platform && churchId ? `?church=${churchId}` : ''}`)}><Iconify icon="eva:arrow-ios-back-fill" /></IconButton></Tooltip>
        <TextField size="small" variant="standard" value={tpl?.name ?? ''} disabled={readOnly} onChange={(e) => { setTpl((p) => (p ? { ...p, name: e.target.value } : p)); d.setDirty(true); }} placeholder="Template name" slotProps={{ input: { disableUnderline: true, sx: { typography: 'h6' } } }} sx={{ minWidth: 220 }} />
        {tpl && <Label variant="soft" color={statusColor}>{tpl.status}</Label>}
        {tpl && <Label variant="outlined" color={tpl.scope === 'global' ? 'info' : 'primary'}>{tpl.scope === 'global' ? 'Orthodox Metrics' : 'Parish'}</Label>}
        {tpl && <Label variant="soft" color={CERTIFICATE_TYPES.find((t) => t.value === tpl.certificate_type)?.color ?? 'default'} sx={{ textTransform: 'capitalize' }}>{tpl.certificate_type}</Label>}
        {tpl?.is_default && <Label variant="soft" color="success">Default</Label>}
        {d.dirty && <Typography variant="caption" sx={{ color: 'warning.main' }}>Unsaved changes</Typography>}

        <Box sx={{ flexGrow: 1 }} />
        <TextField select size="small" value={tpl?.canvas_size ?? 'letter'} disabled={readOnly} onChange={(e) => { setTpl((p) => (p ? { ...p, canvas_size: e.target.value as any } : p)); d.setDirty(true); }} sx={{ width: 110 }}><MenuItem value="letter">Letter</MenuItem><MenuItem value="a4">A4</MenuItem></TextField>
        <TextField select size="small" value={tpl?.orientation ?? 'portrait'} disabled={readOnly} onChange={(e) => { setTpl((p) => (p ? { ...p, orientation: e.target.value as any } : p)); d.setDirty(true); }} sx={{ width: 130 }}><MenuItem value="portrait">Portrait</MenuItem><MenuItem value="landscape">Landscape</MenuItem></TextField>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton size="small" onClick={() => d.setZoom((z) => Math.max(0.25, z - 0.1))}><Iconify icon="eva:minus-circle-fill" /></IconButton>
          <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center' }}>{Math.round(d.zoom * 100)}%</Typography>
          <IconButton size="small" onClick={() => d.setZoom((z) => Math.min(2, z + 0.1))}><Iconify icon="solar:add-circle-bold" /></IconButton>
        </Box>
        <Tooltip title="Grid"><IconButton size="small" color={showGrid ? 'primary' : 'default'} onClick={() => setShowGrid((v) => !v)}><Iconify icon="solar:chart-square-outline" /></IconButton></Tooltip>
        <FormControlLabel sx={{ mr: 0 }} control={<Switch size="small" checked={d.snap} onChange={(e) => d.setSnap(e.target.checked)} />} label={<Typography variant="caption">Snap</Typography>} />
        <Tooltip title="Undo (⌘Z)"><span><IconButton size="small" disabled={!d.canUndo} onClick={d.undo}><Iconify icon="solar:restart-bold" sx={{ transform: 'scaleX(-1)' }} /></IconButton></span></Tooltip>
        <Tooltip title="Redo (⇧⌘Z)"><span><IconButton size="small" disabled={!d.canRedo} onClick={d.redo}><Iconify icon="solar:restart-bold" /></IconButton></span></Tooltip>

        <Button variant="outlined" color="inherit" size="small" loading={busy === 'preview'} onClick={doPreview} startIcon={<Iconify icon="solar:eye-bold" />}>Preview PDF</Button>
        {tpl && <Button variant="outlined" color="inherit" size="small" loading={busy === 'dup'} onClick={duplicate} startIcon={<Iconify icon="solar:copy-bold" />}>{tpl.scope === 'global' && !meta.canDesignGlobal ? 'Copy to parish' : 'Duplicate'}</Button>}
        {!readOnly && <Button variant="outlined" size="small" loading={busy === 'save'} disabled={!d.dirty} onClick={save} startIcon={<Iconify icon="solar:check-circle-bold" />}>Save</Button>}
        {!readOnly && tpl?.status !== 'active' && <Button variant="contained" size="small" loading={busy === 'publish'} onClick={() => setPublishAsk(true)} startIcon={<Iconify icon="solar:verified-check-bold" />}>Publish</Button>}
      </Box>

      {readOnly && <Box sx={{ px: 2, py: 0.75, bgcolor: 'info.lighter', color: 'info.darker', typography: 'caption' }}>This is an Orthodox Metrics template — read-only for parishes. Use <b>Copy to parish</b> to make an editable version in your own church database.</Box>}

      {/* body */}
      <Box sx={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <DesignerLeftPanel d={d} meta={meta} certificateType={tpl?.certificate_type ?? draft.certificate_type} churchId={churchId} page={page} />
        <DesignerCanvas d={d} page={page} meta={meta} sampleValues={sampleValues} showGrid={showGrid} />
        <DesignerRightPanel d={d} meta={meta} page={page} />
      </Box>

      {/* preview */}
      <Dialog fullWidth maxWidth="md" open={!!preview} onClose={() => { if (preview) URL.revokeObjectURL(preview); setPreview(null); }}>
        <DialogTitle>PDF preview <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.disabled' }}>sample data · exactly what will be generated</Typography></DialogTitle>
        <DialogContent sx={{ height: '78vh', p: 0 }}>{preview && <Box component="iframe" title="Preview" src={`${preview}#toolbar=1&view=FitH`} sx={{ width: 1, height: 1, border: 0 }} />}</DialogContent>
        <DialogActions><Button component="a" href={preview ?? '#'} target="_blank" rel="noopener" color="inherit">Open in new tab</Button><Button variant="contained" onClick={() => { if (preview) URL.revokeObjectURL(preview); setPreview(null); }}>Close</Button></DialogActions>
      </Dialog>

      <ConfirmDialog open={publishAsk} onClose={() => setPublishAsk(false)} title="Publish template" content={<>Publishing makes <strong>{tpl?.name}</strong> available for generating certificates{tpl?.scope === 'global' ? ' at every parish' : ' in your parish'}. {d.dirty && 'Your unsaved changes will be saved first.'}</>}
        action={<><Button variant="outlined" onClick={() => publish(false)}>Publish</Button><Button variant="contained" onClick={() => publish(true)}>Publish & make default</Button></>} />

      <Dialog open={newDlg} onClose={() => router.push(paths.portal.records.certificateTemplates)} fullWidth maxWidth="xs">
        <DialogTitle>New certificate template</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField autoFocus label="Name" value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Ss. Peter & Paul — Baptism 2026" />
          <TextField select label="Sacrament" value={draft.certificate_type} onChange={(e) => setDraft((p) => ({ ...p, certificate_type: e.target.value as CertificateType }))}>{CERTIFICATE_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}</TextField>
          {meta.canDesignGlobal && meta.canDesignParish && (
            <TextField select label="Owner" value={draft.scope} onChange={(e) => setDraft((p) => ({ ...p, scope: e.target.value as any }))}><MenuItem value="church">This parish (om_church database)</MenuItem><MenuItem value="global">Orthodox Metrics (shared with all parishes)</MenuItem></TextField>
          )}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
            <TextField select label="Page" value={draft.canvas_size} onChange={(e) => setDraft((p) => ({ ...p, canvas_size: e.target.value as any }))}><MenuItem value="letter">Letter</MenuItem><MenuItem value="a4">A4</MenuItem></TextField>
            <TextField select label="Orientation" value={draft.orientation} onChange={(e) => setDraft((p) => ({ ...p, orientation: e.target.value as any }))}><MenuItem value="portrait">Portrait</MenuItem><MenuItem value="landscape">Landscape</MenuItem></TextField>
          </Box>
        </DialogContent>
        <DialogActions><Button color="inherit" onClick={() => router.push(paths.portal.records.certificateTemplates)}>Cancel</Button><Button variant="contained" loading={busy === 'save'} onClick={create} disabled={!meta.canDesignGlobal && !meta.canDesignParish}>Create & open designer</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
