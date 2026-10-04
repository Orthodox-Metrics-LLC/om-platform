import type { OmAssetCollection } from './om-assets-api';

import { useState, useEffect } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { ASSET_SCOPES, useAssetManager, ASSET_CATEGORIES, ASSET_VISIBILITIES } from './asset-manager-context';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; collection: OmAssetCollection | null };

export function AssetCollectionDialog({ open, onClose, collection }: Props) {
  const { actions } = useAssetManager();
  const [form, setForm] = useState({ name: '', description: '', scope: 'public', visibility: 'public', category: '', folder: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: collection?.name ?? '', description: collection?.description ?? '', scope: collection?.scope ?? 'public', visibility: collection?.visibility ?? 'public', category: collection?.category ?? '', folder: collection?.folder ?? '' });
  }, [open, collection]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    try {
      const payload = { ...form, scope: form.scope as OmAssetCollection['scope'], visibility: form.visibility as OmAssetCollection['visibility'], category: form.category || null, folder: form.folder || null, description: form.description || null };
      if (collection) await actions.collections.update(collection.id, payload);
      else await actions.collections.create(payload);
      onClose();
    } catch { /* toast */ } finally { setBusy(false); }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>{collection ? 'Edit collection' : 'New collection'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField autoFocus label="Name" value={form.name} onChange={set('name')} />
        <TextField label="Description" value={form.description} onChange={set('description')} multiline rows={2} />
        <TextField select label="Scope" value={form.scope} onChange={set('scope')}>{ASSET_SCOPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}</TextField>
        <TextField select label="Visibility" value={form.visibility} onChange={set('visibility')}>{ASSET_VISIBILITIES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}</TextField>
        <TextField select label="Default type" value={form.category} onChange={set('category')}><MenuItem value="">None</MenuItem>{ASSET_CATEGORIES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}</TextField>
        <TextField label="Default folder" value={form.folder} onChange={set('folder')} placeholder="e.g. marketing/2026" />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!form.name.trim()} loading={busy} onClick={submit}>{collection ? 'Save' : 'Create'}</Button>
      </DialogActions>
    </Dialog>
  );
}
