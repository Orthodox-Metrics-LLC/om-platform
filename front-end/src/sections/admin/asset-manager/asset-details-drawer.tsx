import type { OmAsset } from './om-assets-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Autocomplete from '@mui/material/Autocomplete';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { omAssetDirectUrl } from './om-assets-api';
import { AssetThumb, SCOPE_COLOR } from './asset-card';
import { AssetChurchSelect } from './asset-church-select';
import { ASSET_SCOPES, isImageAsset, useAssetManager, ASSET_CATEGORIES, ASSET_VISIBILITIES } from './asset-manager-context';

// ----------------------------------------------------------------------

type Props = {
  asset: OmAsset | null;
  open: boolean;
  editing: boolean;
  onClose: () => void;
  onTransform: () => void;
  onSplit: () => void;
  onCopyTo: () => void;
  onWorkshop: () => void;
  onArchive: () => void;
  onPurge: () => void;
};

export function AssetDetailsDrawer({ asset, open, editing: editingProp, onClose, onTransform, onSplit, onCopyTo, onWorkshop, onArchive, onPurge }: Props) {
  const { actions, tags: allTags, collections, directories } = useAssetManager();
  const [editing, setEditing] = useState(editingProp);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(editingProp);
    if (asset) {
      setForm({
        name: asset.name, title: asset.title ?? '', description: asset.description ?? '', alt_text: asset.alt_text ?? '', caption: asset.caption ?? '', credit: asset.credit ?? '',
        category: asset.category, scope: asset.scope, visibility: asset.visibility ?? '', church_id: asset.church_id, collection_id: asset.collection_id ?? '',
        folder: asset.folder ?? asset.directory ?? '', tags: asset.tags ?? [], licensing_note: asset.licensing_note ?? '',
      });
    }
  }, [asset, editingProp, open]);

  if (!asset) return null;
  const set = (k: string) => (e: any) => setForm((p: any) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      const updated = await actions.update(asset.id, {
        name: form.name, title: form.title || null, description: form.description || null, alt_text: form.alt_text || null, caption: form.caption || null, credit: form.credit || null,
        category: form.category, scope: form.scope, visibility: form.visibility || undefined, church_id: form.scope === 'church' ? form.church_id : null,
        collection_id: form.collection_id === '' ? null : Number(form.collection_id), folder: form.folder || null, tags: form.tags, licensing_note: form.licensing_note || null,
      } as any);
      actions.replaceAsset(updated);
      setEditing(false);
    } catch { /* toast */ } finally { setBusy(false); }
  };

  const copyUrl = () => navigator.clipboard.writeText(omAssetDirectUrl(asset)).then(() => toast.success('URL copied')).catch(() => toast.error('Could not copy'));

  const prop = (label: string, value: React.ReactNode) => (
    <Box key={label} sx={{ gap: 2, display: 'flex', typography: 'caption' }}>
      <Box component="span" sx={{ width: 96, flexShrink: 0, color: 'text.secondary' }}>{label}</Box>
      <Box component="span" sx={{ wordBreak: 'break-all' }}>{value ?? '—'}</Box>
    </Box>
  );

  return (
    <Drawer open={open} onClose={onClose} anchor="right" slotProps={{ backdrop: { invisible: true }, paper: { sx: { width: { xs: 1, sm: 420 } } } }}>
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>{editing ? 'Edit asset' : 'Asset'}</Typography>
        {!editing && <Button size="small" variant="soft" startIcon={<Iconify icon="solar:pen-bold" />} onClick={() => setEditing(true)}>Edit</Button>}
        <IconButton onClick={onClose}><Iconify icon="mingcute:close-line" /></IconButton>
      </Box>

      <Scrollbar>
        <Stack spacing={2.5} sx={{ p: 2.5, bgcolor: 'background.neutral' }}>
          <AssetThumb asset={asset} ratio="16/9" />
          {!editing && (
            <>
              <Typography variant="subtitle1" sx={{ wordBreak: 'break-word' }}>{asset.title || asset.name}</Typography>
              <Box sx={{ gap: 0.75, display: 'flex', flexWrap: 'wrap' }}>
                <Label variant="soft" color={SCOPE_COLOR[asset.scope]} sx={{ textTransform: 'capitalize' }}>{asset.scope}{asset.church_name ? ` · ${asset.church_name}` : asset.church_id ? ` #${asset.church_id}` : ''}</Label>
                <Label variant="outlined" sx={{ textTransform: 'capitalize' }}>{asset.category.replace(/_/g, ' ')}</Label>
                {asset.visibility && <Label variant="outlined">{asset.visibility}</Label>}
                {asset.status === 'archived' && <Label variant="soft" color="error">Archived</Label>}
              </Box>
              {asset.description && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{asset.description}</Typography>}
              {!!asset.tags?.length && <Box sx={{ gap: 0.5, display: 'flex', flexWrap: 'wrap' }}>{asset.tags.map((t) => <Chip key={t} size="small" variant="soft" label={t} />)}</Box>}
            </>
          )}
        </Stack>

        {editing ? (
          <Stack spacing={2} sx={{ p: 2.5 }}>
            <TextField label="File name" value={form.name} onChange={set('name')} />
            <TextField label="Title" value={form.title} onChange={set('title')} />
            <TextField label="Description" value={form.description} onChange={set('description')} multiline rows={2} />
            <TextField label="Alt text" value={form.alt_text} onChange={set('alt_text')} />
            <TextField label="Caption" value={form.caption} onChange={set('caption')} />
            <TextField label="Credit" value={form.credit} onChange={set('credit')} />
            <TextField select label="Category" value={form.category} onChange={set('category')}>{ASSET_CATEGORIES.map((c) => <MenuItem key={c.value} value={c.value} sx={{ textTransform: 'capitalize' }}>{c.label}</MenuItem>)}</TextField>
            <TextField select label="Scope" value={form.scope} onChange={set('scope')}>{ASSET_SCOPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}</TextField>
            {form.scope === 'church' && <AssetChurchSelect value={form.church_id} onChange={(id) => setForm((p: any) => ({ ...p, church_id: id }))} />}
            <TextField select label="Visibility" value={form.visibility} onChange={set('visibility')}><MenuItem value="">Default</MenuItem>{ASSET_VISIBILITIES.map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}</TextField>
            <TextField select label="Collection" value={form.collection_id} onChange={set('collection_id')}><MenuItem value="">None</MenuItem>{collections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>
            <Autocomplete freeSolo options={directories} value={form.folder} onInputChange={(_, v) => setForm((p: any) => ({ ...p, folder: v }))} renderInput={(p) => <TextField {...p} label="Folder" />} />
            <Autocomplete multiple freeSolo options={allTags} value={form.tags} onChange={(_, v) => setForm((p: any) => ({ ...p, tags: v }))} renderValue={(sel, getTagProps) => sel.map((o, i) => <Chip {...getTagProps({ index: i })} key={String(o)} size="small" label={String(o)} />)} renderInput={(p) => <TextField {...p} label="Tags" />} />
            <TextField label="Licensing note" value={form.licensing_note} onChange={set('licensing_note')} multiline rows={2} />
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ p: 2.5 }}>
            <Typography variant="subtitle2">Properties</Typography>
            {prop('File', asset.name)}
            {prop('Type', `${asset.file_type?.toUpperCase() ?? '—'}${asset.mime_type ? ` (${asset.mime_type})` : ''}`)}
            {prop('Dimensions', asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—')}
            {prop('Size', asset.file_size ? fData(asset.file_size) : '—')}
            {prop('Folder', asset.folder || asset.directory || '—')}
            {prop('Collection', asset.collection_name || (asset.collection_id ? `#${asset.collection_id}` : '—'))}
            {prop('Source', `${asset.source_type ?? '—'} · ${asset.owner_system ?? '—'}`)}
            {prop('Alt text', asset.alt_text)}
            {prop('Caption', asset.caption)}
            {prop('Credit', asset.credit)}
            {prop('Licensing', asset.licensing_note)}
            {prop('SHA-256', asset.sha256 || asset.checksum_sha256 ? `${(asset.sha256 || asset.checksum_sha256)!.slice(0, 16)}…` : '—')}
            {prop('Created', asset.created_at ? fDateTime(asset.created_at) : '—')}
            {prop('Updated', asset.updated_at ? fDateTime(asset.updated_at) : '—')}
            {prop('URL', <Box component="a" href={omAssetDirectUrl(asset)} target="_blank" rel="noopener" sx={{ color: 'primary.main' }}>{omAssetDirectUrl(asset).replace(window.location.origin, '')}</Box>)}
          </Stack>
        )}
      </Scrollbar>

      <Divider />
      <Box sx={{ p: 2, gap: 1, display: 'flex', flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <Button variant="outlined" color="inherit" onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="contained" loading={busy} onClick={save} sx={{ flexGrow: 1 }}>Save changes</Button>
          </>
        ) : (
          <>
            <Button size="small" variant="soft" component="a" href={omAssetDirectUrl(asset)} download startIcon={<Iconify icon="eva:cloud-download-fill" />}>Download</Button>
            <Button size="small" variant="soft" startIcon={<Iconify icon="eva:link-2-fill" />} onClick={copyUrl}>Copy URL</Button>
            {isImageAsset(asset) && <Button size="small" variant="soft" startIcon={<Iconify icon="solar:restart-bold" />} onClick={onTransform}>Transform</Button>}
            {isImageAsset(asset) && <Button size="small" variant="soft" startIcon={<Iconify icon="mingcute:dot-grid-fill" />} onClick={onSplit}>Split</Button>}
            <Button size="small" variant="soft" startIcon={<Iconify icon="solar:copy-bold" />} onClick={onCopyTo}>Copy to…</Button>
            <Button size="small" variant="soft" startIcon={<Iconify icon="solar:export-bold" />} onClick={onWorkshop}>Workshop</Button>
            <Button size="small" variant="soft" color="warning" startIcon={<Iconify icon="solar:archive-down-minimlistic-bold" />} onClick={onArchive}>Archive</Button>
            <Button size="small" variant="soft" color="error" startIcon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={onPurge}>Delete</Button>
          </>
        )}
      </Box>
    </Drawer>
  );
}
