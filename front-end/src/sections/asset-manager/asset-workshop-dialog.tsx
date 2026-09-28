import type { WorkshopDestination, WorkshopDestinationType } from './om-assets-api';

import { useState, useEffect } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { toast } from 'src/components/snackbar';

import { sendAssetsToWorkshop, fetchWorkshopDestinations } from './om-assets-api';

// ----------------------------------------------------------------------

/** Push assets to OM Workshop (inbox or a site workspace revision). */
export function AssetWorkshopDialog({ open, onClose, assetIds }: { open: boolean; onClose: () => void; assetIds: number[] }) {
  const [destinations, setDestinations] = useState<WorkshopDestination[]>([]);
  const [type, setType] = useState<WorkshopDestinationType>('inbox');
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchWorkshopDestinations().then(setDestinations).catch((e) => setError(e instanceof Error ? e.message : 'Workshop is unavailable'));
  }, [open]);

  const site = destinations.find((d) => d.siteId === siteId);

  const send = async () => {
    setBusy(true);
    try {
      const r = await sendAssetsToWorkshop({ assetIds, destinationType: type, ...(type === 'workspace' && { siteId, revisionId: site?.activeRevision?.id }) });
      if (r.error) throw new Error(r.error);
      toast.success(`${(r.imported?.length ?? r.transfers?.length ?? assetIds.length)} asset(s) sent to Workshop${r.failed?.length ? `, ${r.failed.length} failed` : ''}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send to Workshop');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>Send {assetIds.length} asset{assetIds.length === 1 ? '' : 's'} to Workshop</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="warning">{error}</Alert>}
        <TextField select label="Destination" value={type} onChange={(e) => setType(e.target.value as WorkshopDestinationType)}>
          <MenuItem value="inbox">Workshop inbox</MenuItem>
          <MenuItem value="workspace" disabled={!destinations.length}>Site workspace</MenuItem>
        </TextField>
        {type === 'workspace' && (
          <>
            <TextField select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {destinations.map((d) => <MenuItem key={d.siteId} value={d.siteId}>{d.displayName}{d.classification ? ` · ${d.classification}` : ''}</MenuItem>)}
            </TextField>
            {site?.activeRevision && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Active revision: {site.activeRevision.branchName || site.activeRevision.id} ({site.activeRevision.workspaceStatus || 'unknown'})
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" loading={busy} disabled={type === 'workspace' && !siteId} onClick={send}>Send</Button>
      </DialogActions>
    </Dialog>
  );
}
