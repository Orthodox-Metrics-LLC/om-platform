import type { OmAssetScope, SmartUploadSuggestion } from './om-assets-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import DialogTitle from '@mui/material/DialogTitle';
import Autocomplete from '@mui/material/Autocomplete';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';

import { fData } from 'src/utils/format-number';

import { Upload } from 'src/components/upload';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { AssetChurchSelect } from './asset-church-select';
import { uploadOmAsset, analyzeUploadAssets } from './om-assets-api';
import { ASSET_TYPES, ASSET_SCOPES, useAssetManager, ASSET_TAG_VOCAB, ASSET_VISIBILITIES } from './asset-manager-context';

// ----------------------------------------------------------------------

type Row = {
  file: File;
  name: string;
  title: string;
  category: string;
  primary_tag: string;
  secondary_tag: string;
  folder: string;
  tags: string[];
  alt_text: string;
  caption: string;
  description: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  suggestion?: SmartUploadSuggestion;
};

const readDims = (file: File) =>
  new Promise<{ width: number | null; height: number | null }>((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve({ width: null, height: null });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: null, height: null }); URL.revokeObjectURL(url); };
    img.src = url;
  });

/** Upload one or more assets with destination + per-file metadata; Smart Upload Assist proposes names/categories/tags. */
export function AssetUploadDialog({ open, onClose, initialFiles = [] }: { open: boolean; onClose: () => void; initialFiles?: File[] }) {
  const { filters, reload, reloadMeta, collections, directories, tags: allTags } = useAssetManager();
  const [rows, setRows] = useState<Row[]>([]);
  const [scope, setScope] = useState<OmAssetScope>('public');
  const [visibility, setVisibility] = useState('');
  const [churchId, setChurchId] = useState<number | null>(null);
  const [collectionId, setCollectionId] = useState<number | ''>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setScope((filters.scope || 'public') as OmAssetScope);
      setChurchId(filters.churchId);
      setCollectionId(filters.collectionId ?? '');
      setVisibility('');
      setAnalysisNote(null);
      setRows(initialFiles.map(toRow));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = useCallback((accepted: File[]) => setRows((p) => [...p, ...accepted.map(toRow)]), []);

  const analyze = async () => {
    if (!rows.length) return;
    setAnalyzing(true);
    try {
      const inputs = await Promise.all(rows.map(async (r) => ({ original_filename: r.file.name, mime: r.file.type, size: r.file.size, ...(await readDims(r.file)) })));
      const res = await analyzeUploadAssets({ scope, church_id: churchId, collection_id: collectionId === '' ? null : Number(collectionId), folder: filters.directory || undefined, files: inputs });
      if (!res.destination.permitted) setAnalysisNote(res.destination.error || 'This destination is not permitted for your role.');
      else setAnalysisNote(`Suggestions applied${res.vision_enabled ? ' (vision enabled)' : ''}. Review before uploading.`);
      setRows((p) => p.map((r) => {
        const s = res.suggestions.find((x) => x.original_filename === r.file.name);
        return s ? { ...r, suggestion: s, name: s.stored_filename || r.name, title: s.title || r.title, category: s.category || r.category, primary_tag: s.primary_tag || r.primary_tag, secondary_tag: s.secondary_tag || r.secondary_tag, folder: s.folder || r.folder, tags: s.tags?.length ? s.tags : r.tags, alt_text: s.alt_text || r.alt_text, caption: s.caption || r.caption, description: s.description || r.description } : r;
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Smart assist unavailable');
    } finally {
      setAnalyzing(false);
    }
  };

  const upload = async () => {
    if (scope === 'church' && !churchId) {
      toast.error('Choose a church for church-scoped assets');
      return;
    }
    setUploading(true);
    let ok = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (r.status === 'done') continue;
      setRows((p) => p.map((x, j) => (j === i ? { ...x, status: 'uploading', progress: 0 } : x)));
      const fd = new FormData();
      fd.append('file', r.file);
      fd.append('scope', scope);
      if (visibility) fd.append('visibility', visibility);
      if (scope === 'church' && churchId) fd.append('church_id', String(churchId));
      if (collectionId !== '') fd.append('collection_id', String(collectionId));
      fd.append('category', r.category || 'image');
      if (r.primary_tag) fd.append('primary_tag', r.primary_tag);
      if (r.secondary_tag) fd.append('secondary_tag', r.secondary_tag);
      if (r.name) fd.append('name', r.name);
      if (r.title) fd.append('title', r.title);
      if (r.folder) fd.append('folder', r.folder);
      if (r.alt_text) fd.append('alt_text', r.alt_text);
      if (r.caption) fd.append('caption', r.caption);
      if (r.description) fd.append('description', r.description);
      if (r.tags.length) fd.append('tags', JSON.stringify(r.tags));
      try {
        await uploadOmAsset(fd, (pct) => setRows((p) => p.map((x, j) => (j === i ? { ...x, progress: pct } : x))));
        ok += 1;
        setRows((p) => p.map((x, j) => (j === i ? { ...x, status: 'done', progress: 100 } : x)));
      } catch (e) {
        setRows((p) => p.map((x, j) => (j === i ? { ...x, status: 'error', error: e instanceof Error ? e.message : 'Upload failed' } : x)));
      }
    }
    setUploading(false);
    if (ok) toast.success(`${ok} asset${ok === 1 ? '' : 's'} uploaded`);
    await Promise.all([reload(), reloadMeta()]);
    if (ok === rows.length) onClose();
  };

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Dialog fullWidth maxWidth="md" open={open} onClose={uploading ? undefined : onClose}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Upload assets
        <IconButton onClick={onClose} disabled={uploading}><Iconify icon="mingcute:close-line" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' } }}>
          <TextField select size="small" label="Scope" value={scope} onChange={(e) => setScope(e.target.value as OmAssetScope)}>{ASSET_SCOPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}</TextField>
          {scope === 'church' ? <AssetChurchSelect size="small" value={churchId} onChange={setChurchId} /> : <TextField select size="small" label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}><MenuItem value="">Default</MenuItem>{ASSET_VISIBILITIES.map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}</TextField>}
          <TextField select size="small" label="Collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value === '' ? '' : Number(e.target.value))}><MenuItem value="">None</MenuItem>{collections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>
          <Button variant="soft" color="info" startIcon={<Iconify icon="solar:atom-bold-duotone" />} loading={analyzing} disabled={!rows.length || uploading} onClick={analyze}>Smart assist</Button>
        </Box>

        {analysisNote && <Alert severity="info" onClose={() => setAnalysisNote(null)}>{analysisNote}</Alert>}

        <Upload multiple value={rows.map((r) => r.file)} onDrop={handleDrop} onRemove={(f) => setRows((p) => p.filter((r) => r.file !== f))} onRemoveAll={() => setRows([])} disabled={uploading} sx={{ '& .mnl__upload__preview': { display: 'none' } }} />

        {rows.map((r, i) => (
          <Box key={`${r.file.name}-${i}`} sx={{ p: 1.5, borderRadius: 1.5, border: (t) => `1px solid ${t.vars.palette.divider}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Iconify icon={r.status === 'done' ? 'solar:check-circle-bold' : r.status === 'error' ? 'solar:danger-bold' : 'solar:file-bold-duotone'} width={22} sx={{ color: r.status === 'done' ? 'success.main' : r.status === 'error' ? 'error.main' : 'text.disabled' }} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="subtitle2" noWrap>{r.name || r.file.name}</Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>{fData(r.file.size)} · {[r.category, r.primary_tag, r.secondary_tag].filter(Boolean).join(' · ') || 'image'}{r.folder ? ` · ${r.folder}` : ''}{r.suggestion ? ` · ${Math.round(r.suggestion.category_confidence * 100)}% ${r.suggestion.classification_source}` : ''}</Typography>
                {r.error && <Typography variant="caption" color="error">{r.error}</Typography>}
              </Box>
              <Button size="small" color="inherit" onClick={() => setExpanded(expanded === i ? null : i)} endIcon={<Iconify icon={expanded === i ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'} />}>Details</Button>
              <IconButton size="small" disabled={uploading} onClick={() => setRows((p) => p.filter((_, j) => j !== i))}><Iconify icon="mingcute:close-line" width={18} /></IconButton>
            </Box>
            {r.status === 'uploading' && <LinearProgress variant="determinate" value={r.progress} sx={{ mt: 1 }} />}
            {expanded === i && (
              <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
                <TextField size="small" label="File name" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
                <TextField size="small" label="Title" value={r.title} onChange={(e) => patch(i, { title: e.target.value })} />
                <TextField select size="small" label="Type" value={r.category} onChange={(e) => patch(i, { category: e.target.value })}>{ASSET_TYPES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}</TextField>
                <Autocomplete freeSolo size="small" options={ASSET_TAG_VOCAB} value={r.primary_tag} onInputChange={(_, v) => patch(i, { primary_tag: v })} renderInput={(p) => <TextField {...p} label="Primary tag" />} />
                <Autocomplete freeSolo size="small" options={ASSET_TAG_VOCAB} value={r.secondary_tag} onInputChange={(_, v) => patch(i, { secondary_tag: v })} renderInput={(p) => <TextField {...p} label="Secondary tag" />} />
                <Autocomplete freeSolo size="small" options={directories} value={r.folder} onInputChange={(_, v) => patch(i, { folder: v })} renderInput={(p) => <TextField {...p} label="Folder" />} />
                <Autocomplete multiple freeSolo size="small" options={allTags} value={r.tags} onChange={(_, v) => patch(i, { tags: v as string[] })} renderValue={(sel, getTagProps) => sel.map((o, k) => <Chip {...getTagProps({ index: k })} key={String(o)} size="small" label={String(o)} />)} renderInput={(p) => <TextField {...p} label="Tags" />} sx={{ gridColumn: '1 / -1' }} />
                <TextField size="small" label="Alt text" value={r.alt_text} onChange={(e) => patch(i, { alt_text: e.target.value })} />
                <TextField size="small" label="Caption" value={r.caption} onChange={(e) => patch(i, { caption: e.target.value })} />
                <TextField size="small" label="Description" value={r.description} onChange={(e) => patch(i, { description: e.target.value })} multiline rows={2} sx={{ gridColumn: '1 / -1' }} />
                {r.suggestion?.explanation && <Alert severity="info" icon={<Iconify icon="solar:atom-bold-duotone" />} sx={{ gridColumn: '1 / -1' }}>{r.suggestion.explanation}{r.suggestion.warnings?.length ? ` — ${r.suggestion.warnings.join('; ')}` : ''}</Alert>}
              </Box>
            )}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" sx={{ color: 'text.disabled', flexGrow: 1, pl: 1 }}>{rows.length} file{rows.length === 1 ? '' : 's'} · {fData(rows.reduce((n, r) => n + r.file.size, 0))}</Typography>
        <Button variant="outlined" color="inherit" onClick={onClose} disabled={uploading}>Close</Button>
        <Button variant="contained" startIcon={<Iconify icon="eva:cloud-upload-fill" />} loading={uploading} disabled={!rows.some((r) => r.status !== 'done')} onClick={upload}>Upload</Button>
      </DialogActions>
    </Dialog>
  );
}

function toRow(file: File): Row {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const guess = /^(mp4|webm|mov|m4v)$/.test(ext) ? 'video' : /^(woff2?|ttf|otf)$/.test(ext) ? 'font' : /^(pdf|docx?|xlsx?|pptx?|txt|md|html?|zip)$/.test(ext) ? 'document' : 'image';
  return { file, name: file.name, title: '', category: guess, primary_tag: '', secondary_tag: '', folder: '', tags: [], alt_text: '', caption: '', description: '', progress: 0, status: 'pending' };
}
