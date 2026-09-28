import type { OmAssetScope } from './om-assets-api';

import { useState, useEffect } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { AssetChurchSelect } from './asset-church-select';
import { ASSET_SCOPES, useAssetManager } from './asset-manager-context';

// ----------------------------------------------------------------------

export function AssetDirectoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { filters, actions } = useAssetManager();
  const [scope, setScope] = useState<OmAssetScope>('public');
  const [churchId, setChurchId] = useState<number | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setScope((filters.scope || 'public') as OmAssetScope); setChurchId(filters.churchId); setPath(filters.directory ? `${filters.directory.replace(/\/$/, '')}/` : ''); }
  }, [open, filters]);

  const submit = async () => {
    setBusy(true);
    try { await actions.createDirectory(scope, path.trim(), scope === 'church' ? churchId : undefined); onClose(); } catch { /* toast */ } finally { setBusy(false); }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>New folder</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField select label="Scope" value={scope} onChange={(e) => setScope(e.target.value as OmAssetScope)}>{ASSET_SCOPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}</TextField>
        {scope === 'church' && <AssetChurchSelect value={churchId} onChange={setChurchId} />}
        <TextField autoFocus label="Folder path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="e.g. marketing/2026" helperText="Use / to nest folders" onKeyDown={(e) => e.key === 'Enter' && path.trim() && submit()} />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!path.trim() || (scope === 'church' && !churchId)} loading={busy} onClick={submit}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}
