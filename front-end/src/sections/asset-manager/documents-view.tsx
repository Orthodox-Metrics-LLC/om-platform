import type { OmDocument, OmDocumentAudit, OmDocumentLifecycle } from './om-documents-api';

import { useBoolean } from 'minimal-shared/hooks';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Upload } from 'src/components/upload';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { omDocumentsApi, DOCUMENT_LIFECYCLES } from './om-documents-api';

// ----------------------------------------------------------------------

const LIFECYCLE_COLOR: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error' | 'primary' | 'secondary'> = {
  inbox: 'info', working: 'primary', review: 'warning', approved: 'success', published: 'success', archived: 'default', quarantined: 'error',
};
const isText = (d: OmDocument) => /^(text\/|application\/(json|xml|x-yaml|javascript))/.test(d.mimeType || '') || /\.(md|txt|json|ya?ml|csv|html?)$/i.test(d.primaryFile || '');

/** Documents section: OM Documents Manager (`/api/documents`) in Minimal UI. */
export function DocumentsView() {
  const [lifecycle, setLifecycle] = useState<OmDocumentLifecycle | 'all'>('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<OmDocument[]>([]);
  const [counts, setCounts] = useState<Partial<Record<OmDocumentLifecycle, number>>>({});
  const [waiting, setWaiting] = useState<OmDocument[]>([]);
  const [horizons, setHorizons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<OmDocument | null>(null);
  const uploadDialog = useBoolean();
  const pasteDialog = useBoolean();

  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, w] = await Promise.all([omDocumentsApi.list({ lifecycle, q: search, limit: 200 }), omDocumentsApi.waitingToFile().catch(() => [])]);
      setItems(r.items); setCounts(r.counts); setWaiting(w); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load documents'); } finally { setLoading(false); }
  }, [lifecycle, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { omDocumentsApi.horizons().then(setHorizons).catch(() => {}); }, []);

  const total = Object.values(counts).reduce((n, v) => n + (v || 0), 0);

  return (
    <>
      <Box sx={{ mb: 2, gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" slotProps={{ input: { startAdornment: <InputAdornment position="start"><Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} /></InputAdornment> } }} sx={{ minWidth: 260, flexGrow: 1, maxWidth: 420 }} />
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:file-text-bold" />} onClick={pasteDialog.onTrue}>New from text</Button>
        <Button variant="contained" startIcon={<Iconify icon="eva:cloud-upload-fill" />} onClick={uploadDialog.onTrue}>Upload</Button>
      </Box>

      {waiting.length > 0 && (
        <Card sx={{ p: 2, mb: 2, bgcolor: 'warning.lighter', color: 'warning.darker' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Filing approvals waiting ({waiting.length})</Typography>
          <Stack spacing={1}>
            {waiting.map((d) => (
              <Box key={d.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>{d.title} → <code>{d.proposedTargetDocsPath || d.proposedCategory || 'docs'}</code></Typography>
                {d.filingReceipt && (
                  <>
                    <Button size="small" variant="soft" color="success" onClick={() => omDocumentsApi.filingApprove(d.filingReceipt!).then(() => { toast.success('Approved'); load(); }).catch((e) => toast.error(e.message))}>Approve</Button>
                    <Button size="small" variant="soft" color="inherit" onClick={() => omDocumentsApi.filingFile(d.filingReceipt!).then(() => { toast.success('Filed'); load(); }).catch((e) => toast.error(e.message))}>File now</Button>
                    <Button size="small" variant="soft" color="error" onClick={() => omDocumentsApi.filingReject(d.filingReceipt!).then(() => { toast.success('Rejected'); load(); }).catch((e) => toast.error(e.message))}>Reject</Button>
                  </>
                )}
              </Box>
            ))}
          </Stack>
        </Card>
      )}

      <Card>
        <Tabs value={lifecycle} onChange={(_, v) => setLifecycle(v)} variant="scrollable" sx={{ px: 2, boxShadow: (t) => `inset 0 -2px 0 0 ${t.vars.palette.divider}` }}>
          {DOCUMENT_LIFECYCLES.map((l) => (
            <Tab key={l.value} value={l.value} iconPosition="end" label={l.label} icon={<Label variant={l.value === lifecycle || l.value === 'all' ? 'filled' : 'soft'} color={l.value === 'all' ? 'default' : LIFECYCLE_COLOR[l.value]}>{l.value === 'all' ? total : counts[l.value as OmDocumentLifecycle] ?? 0}</Label>} />
          ))}
        </Tabs>

        {loading && <LinearProgress />}
        {error ? <EmptyContent filled title={error} sx={{ py: 8 }} /> : !loading && !items.length ? <EmptyContent filled title="No documents" sx={{ py: 8 }} /> : (
          <TableContainer><Scrollbar>
            <Table size="small" sx={{ minWidth: 880 }}>
              <TableHead><TableRow><TableCell>Document</TableCell><TableCell>Lifecycle</TableCell><TableCell>Source</TableCell><TableCell>Horizon</TableCell><TableCell>Filing</TableCell><TableCell align="right">Size</TableCell><TableCell>Updated</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {items.map((d) => (
                  <TableRow key={d.id} hover sx={{ cursor: 'pointer' }} onClick={() => setCurrent(d)}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <FileThumbnail file={d.primaryFile || d.title} sx={{ width: 32, height: 32 }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap sx={{ maxWidth: 380 }}>{d.title}</Typography>
                          <Typography variant="caption" noWrap sx={{ color: 'text.disabled', display: 'block' }}>{d.documentId}{d.primaryFile ? ` · ${d.primaryFile}` : ''}</Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell><Label variant="soft" color={LIFECYCLE_COLOR[d.lifecycle]} sx={{ textTransform: 'capitalize' }}>{d.lifecycle}</Label></TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{d.source}<Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>{d.producer}</Typography></TableCell>
                    <TableCell>{d.horizon || '—'}</TableCell>
                    <TableCell>{d.filingState !== 'none' ? <Label variant="outlined" sx={{ textTransform: 'capitalize' }}>{d.filingState.replace(/_/g, ' ')}</Label> : '—'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{d.sizeBytes ? fData(d.sizeBytes) : '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fDateTime(d.updatedAt)}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" component="a" href={omDocumentsApi.downloadUrl(d.documentId)} title="Download"><Iconify icon="eva:cloud-download-fill" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Scrollbar></TableContainer>
        )}
      </Card>

      <DocumentDrawer doc={current} horizons={horizons} onClose={() => setCurrent(null)} onChanged={load} />
      <DocumentUploadDialog open={uploadDialog.value} onClose={uploadDialog.onFalse} horizons={horizons} onDone={load} />
      <DocumentPasteDialog open={pasteDialog.value} onClose={pasteDialog.onFalse} horizons={horizons} onDone={load} />
    </>
  );
}

// ----------------------------------------------------------------------

function DocumentDrawer({ doc, horizons, onClose, onChanged }: { doc: OmDocument | null; horizons: string[]; onClose: () => void; onChanged: () => void }) {
  const [full, setFull] = useState<OmDocument | null>(null);
  const [audit, setAudit] = useState<OmDocumentAudit[]>([]);
  const [form, setForm] = useState({ title: '', description: '', horizon: '' });
  const [content, setContent] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const attach = useBoolean();
  const [attachFiles, setAttachFiles] = useState<(File | string)[]>([]);

  useEffect(() => {
    setFull(null); setAudit([]); setContent(null); setEditingContent(false);
    if (!doc) return;
    omDocumentsApi.get(doc.documentId).then((r) => { setFull(r.document); setAudit(r.audit ?? []); setForm({ title: r.document.title, description: r.document.description ?? '', horizon: r.document.horizon ?? '' }); }).catch((e) => toast.error(e.message));
    if (isText(doc)) omDocumentsApi.fileContent(doc.documentId).then(setContent).catch(() => setContent(null));
  }, [doc]);

  const d = full ?? doc;
  if (!d) return null;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); onChanged(); const r = await omDocumentsApi.get(d.documentId); setFull(r.document); setAudit(r.audit ?? []); } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  const prop = (label: string, value: React.ReactNode) => (
    <Box key={label} sx={{ gap: 2, display: 'flex', typography: 'caption' }}><Box component="span" sx={{ width: 96, flexShrink: 0, color: 'text.secondary' }}>{label}</Box><Box component="span" sx={{ wordBreak: 'break-all' }}>{value ?? '—'}</Box></Box>
  );

  return (
    <Drawer open={!!doc} onClose={onClose} anchor="right" slotProps={{ backdrop: { invisible: true }, paper: { sx: { width: { xs: 1, sm: 520 } } } }}>
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }} noWrap>{d.title}</Typography>
        <Label variant="soft" color={LIFECYCLE_COLOR[d.lifecycle]} sx={{ textTransform: 'capitalize' }}>{d.lifecycle}</Label>
        <IconButton onClick={onClose}><Iconify icon="mingcute:close-line" /></IconButton>
      </Box>
      <Scrollbar>
        <Stack spacing={2} sx={{ px: 2.5, pb: 2 }}>
          <TextField size="small" label="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          <TextField size="small" label="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} multiline rows={2} />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField select size="small" label="Horizon" value={form.horizon} onChange={(e) => setForm((p) => ({ ...p, horizon: e.target.value }))} sx={{ flexGrow: 1 }}><MenuItem value="">None</MenuItem>{horizons.map((h) => <MenuItem key={h} value={h}>{h}</MenuItem>)}</TextField>
            <Button variant="contained" loading={busy === 'save'} onClick={() => run('save', () => omDocumentsApi.update(d.documentId, { title: form.title, description: form.description || null, horizon: form.horizon || null }), 'Saved')}>Save</Button>
          </Box>

          <Divider sx={{ borderStyle: 'dashed' }} />
          <Typography variant="subtitle2">Lifecycle</Typography>
          <Box sx={{ gap: 0.75, display: 'flex', flexWrap: 'wrap' }}>
            {DOCUMENT_LIFECYCLES.filter((l) => l.value !== 'all' && l.value !== d.lifecycle && l.value !== 'quarantined' && l.value !== 'archived').map((l) => (
              <Button key={l.value} size="small" variant="soft" color={LIFECYCLE_COLOR[l.value] === 'default' ? 'inherit' : LIFECYCLE_COLOR[l.value] as any} loading={busy === `move-${l.value}`} onClick={() => run(`move-${l.value}`, () => omDocumentsApi.move(d.documentId, { lifecycle: l.value as OmDocumentLifecycle }), `Moved to ${l.label}`)}>→ {l.label}</Button>
            ))}
            {d.lifecycle !== 'archived' && <Button size="small" variant="soft" color="inherit" loading={busy === 'archive'} onClick={() => run('archive', () => omDocumentsApi.archive(d.documentId), 'Archived')}>Archive</Button>}
          </Box>
          {d.lifecycle !== 'quarantined' && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField size="small" placeholder="Quarantine reason" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ flexGrow: 1 }} />
              <Button size="small" variant="soft" color="error" disabled={!reason.trim()} loading={busy === 'q'} onClick={() => run('q', () => omDocumentsApi.quarantine(d.documentId, reason.trim()), 'Quarantined')}>Quarantine</Button>
            </Box>
          )}
          {d.quarantineReason && <Typography variant="caption" color="error">Quarantined: {d.quarantineReason}</Typography>}

          <Divider sx={{ borderStyle: 'dashed' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>File</Typography>
            <Button size="small" variant="soft" component="a" href={omDocumentsApi.downloadUrl(d.documentId)} startIcon={<Iconify icon="eva:cloud-download-fill" />}>Download</Button>
            <Button size="small" variant="soft" color="inherit" startIcon={<Iconify icon="eva:attach-2-fill" />} onClick={attach.onToggle}>Attach</Button>
          </Box>
          {attach.value && (
            <Box>
              <Upload multiple value={attachFiles} onDrop={(f) => setAttachFiles((p) => [...p, ...f])} onRemove={(f) => setAttachFiles((p) => p.filter((x) => x !== f))} />
              <Button size="small" variant="contained" disabled={!attachFiles.length} loading={busy === 'attach'} sx={{ mt: 1 }} onClick={() => { const fd = new FormData(); attachFiles.forEach((f) => f instanceof File && fd.append('attachments', f)); run('attach', () => omDocumentsApi.addAttachments(d.documentId, fd), 'Attachments added').then(() => { setAttachFiles([]); attach.onFalse(); }); }}>Upload attachments</Button>
            </Box>
          )}
          {content !== null && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }}>{d.primaryFile}</Typography>
                {editingContent ? (
                  <>
                    <Button size="small" color="inherit" onClick={() => setEditingContent(false)}>Cancel</Button>
                    <Button size="small" variant="contained" loading={busy === 'content'} onClick={() => run('content', () => omDocumentsApi.saveFileContent(d.documentId, content), 'File saved').then(() => setEditingContent(false))}>Save file</Button>
                  </>
                ) : <Button size="small" variant="soft" startIcon={<Iconify icon="solar:pen-bold" />} onClick={() => setEditingContent(true)}>Edit</Button>}
              </Box>
              <TextField fullWidth multiline minRows={8} maxRows={24} value={content} onChange={(e) => setContent(e.target.value)} slotProps={{ input: { readOnly: !editingContent, sx: { fontFamily: 'monospace', fontSize: 12 } } }} />
            </Box>
          )}

          <Divider sx={{ borderStyle: 'dashed' }} />
          <Typography variant="subtitle2">Properties</Typography>
          {prop('ID', d.documentId)}
          {prop('Source', `${d.source} · ${d.producer}`)}
          {prop('Path', d.relativePath)}
          {prop('MIME', d.mimeType)}
          {prop('Size', d.sizeBytes ? fData(d.sizeBytes) : '—')}
          {prop('SHA-256', d.sha256 ? `${d.sha256.slice(0, 16)}…` : '—')}
          {prop('Filing', d.filingState !== 'none' ? `${d.filingState.replace(/_/g, ' ')}${d.filedDocsPath ? ` → ${d.filedDocsPath}` : d.proposedTargetDocsPath ? ` → ${d.proposedTargetDocsPath}` : ''}` : '—')}
          {prop('Created', `${fDateTime(d.createdAt)}${d.createdBy?.name ? ` · ${d.createdBy.name}` : ''}`)}
          {prop('Updated', fDateTime(d.updatedAt))}
          {prop('Viewed', d.viewedAt ? fDateTime(d.viewedAt) : '—')}
          {prop('Downloaded', d.downloadedAt ? fDateTime(d.downloadedAt) : '—')}

          {!!audit.length && (
            <>
              <Divider sx={{ borderStyle: 'dashed' }} />
              <Typography variant="subtitle2">Audit trail</Typography>
              {audit.slice(0, 20).map((a) => (
                <Box key={a.id} sx={{ typography: 'caption' }}>
                  <strong>{a.action}</strong>{a.actor_name || a.actor_email ? ` · ${a.actor_name || a.actor_email}` : ''} · <span style={{ opacity: 0.6 }}>{fDateTime(a.created_at)}</span>
                </Box>
              ))}
            </>
          )}
        </Stack>
      </Scrollbar>
    </Drawer>
  );
}

// ----------------------------------------------------------------------

function DocumentUploadDialog({ open, onClose, horizons, onDone }: { open: boolean; onClose: () => void; horizons: string[]; onDone: () => void }) {
  const [files, setFiles] = useState<(File | string)[]>([]);
  const [attachments, setAttachments] = useState<(File | string)[]>([]);
  const [form, setForm] = useState({ title: '', description: '', horizon: '', source: 'HUMAN' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setFiles([]); setAttachments([]); setForm({ title: '', description: '', horizon: '', source: 'HUMAN' }); } }, [open]);
  const file = files.find((f): f is File => f instanceof File);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      attachments.forEach((a) => a instanceof File && fd.append('attachments', a));
      fd.append('title', form.title || file.name);
      if (form.description) fd.append('description', form.description);
      if (form.horizon) fd.append('horizon', form.horizon);
      fd.append('source', form.source);
      fd.append('producer', 'manual');
      await omDocumentsApi.upload(fd);
      toast.success('Document uploaded');
      onDone(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed'); } finally { setBusy(false); }
  };

  return (
    <Dialog fullWidth maxWidth="sm" open={open} onClose={onClose}>
      <DialogTitle>Upload document</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Upload value={files} onDrop={(f) => setFiles(f.slice(0, 1))} onDelete={() => setFiles([])} />
        <TextField size="small" label="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder={file?.name} />
        <TextField size="small" label="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} multiline rows={2} />
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField select size="small" label="Horizon" value={form.horizon} onChange={(e) => setForm((p) => ({ ...p, horizon: e.target.value }))} sx={{ flex: 1 }}><MenuItem value="">None</MenuItem>{horizons.map((h) => <MenuItem key={h} value={h}>{h}</MenuItem>)}</TextField>
          <TextField select size="small" label="Source" value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))} sx={{ flex: 1 }}>{['HUMAN', 'OMDEV', 'WORKSHOP', 'OPS', 'SYSTEM'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}</TextField>
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Attachments (optional)</Typography>
        <Upload multiple value={attachments} onDrop={(f) => setAttachments((p) => [...p, ...f])} onRemove={(f) => setAttachments((p) => p.filter((x) => x !== f))} sx={{ '& .mnl__upload__placeholder': { py: 2 } }} />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!file} loading={busy} onClick={submit}>Upload</Button>
      </DialogActions>
    </Dialog>
  );
}

function DocumentPasteDialog({ open, onClose, horizons, onDone }: { open: boolean; onClose: () => void; horizons: string[]; onDone: () => void }) {
  const [form, setForm] = useState({ title: '', content: '', description: '', horizon: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setForm({ title: '', content: '', description: '', horizon: '' }); }, [open]);
  const submit = async () => {
    setBusy(true);
    try { await omDocumentsApi.paste({ title: form.title.trim(), content: form.content, description: form.description || undefined, horizon: form.horizon || undefined }); toast.success('Document created'); onDone(); onClose(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  return (
    <Dialog fullWidth maxWidth="md" open={open} onClose={onClose}>
      <DialogTitle>New document from text</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField size="small" label="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} sx={{ flex: 2 }} />
          <TextField select size="small" label="Horizon" value={form.horizon} onChange={(e) => setForm((p) => ({ ...p, horizon: e.target.value }))} sx={{ flex: 1 }}><MenuItem value="">None</MenuItem>{horizons.map((h) => <MenuItem key={h} value={h}>{h}</MenuItem>)}</TextField>
        </Box>
        <TextField size="small" label="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        <TextField label="Content (Markdown)" value={form.content} onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))} multiline minRows={12} slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }} />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!form.title.trim() || !form.content.trim()} loading={busy} onClick={submit}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}
