import type { OmAsset, OmAssetScope, OmAssetVisibility } from './om-assets-api';

import { useState, useEffect } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Switch from '@mui/material/Switch';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';

import { AssetChurchSelect } from './asset-church-select';
import { ASSET_SCOPES, useAssetManager, ASSET_VISIBILITIES } from './asset-manager-context';

// ----------------------------------------------------------------------

/** Copy (or promote) an asset into another scope / church / collection. */
export function AssetCopyDialog({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: OmAsset | null }) {
  const { actions, collections } = useAssetManager();
  const [scope, setScope] = useState<OmAssetScope>('public');
  const [visibility, setVisibility] = useState<OmAssetVisibility | ''>('');
  const [churchId, setChurchId] = useState<number | null>(null);
  const [collectionId, setCollectionId] = useState<number | ''>('');
  const [promote, setPromote] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setScope(asset?.scope === 'church' ? 'public' : 'church'); setVisibility(''); setChurchId(null); setCollectionId(''); setPromote(false); } }, [open, asset]);
  if (!asset) return null;

  const submit = async () => {
    setBusy(true);
    try {
      await actions.copy(asset.id, { target_scope: scope, ...(visibility && { visibility }), ...(scope === 'church' && churchId && { church_id: churchId }), ...(collectionId && { collection_id: Number(collectionId) }), promote });
      onClose();
    } catch { /* toast */ } finally { setBusy(false); }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>Copy “{asset.name}”</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField select label="Target scope" value={scope} onChange={(e) => setScope(e.target.value as OmAssetScope)}>{ASSET_SCOPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label} — {s.description}</MenuItem>)}</TextField>
        {scope === 'church' && <AssetChurchSelect value={churchId} onChange={setChurchId} />}
        <TextField select label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}><MenuItem value="">Default for scope</MenuItem>{ASSET_VISIBILITIES.map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}</TextField>
        <TextField select label="Collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value === '' ? '' : Number(e.target.value))}><MenuItem value="">None</MenuItem>{collections.filter((c) => c.scope === scope).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>
        <FormControlLabel control={<Switch checked={promote} onChange={(e) => setPromote(e.target.checked)} />} label="Promote (mark copy as the canonical promoted version)" />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" loading={busy} disabled={scope === 'church' && !churchId} onClick={submit}>Copy</Button>
      </DialogActions>
    </Dialog>
  );
}
