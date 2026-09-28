import type { OmAsset, ImageTransformPayload } from './om-assets-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import ToggleButton from '@mui/material/ToggleButton';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { splitOmAsset, omAssetFileUrl, transformOmAssetImage } from './om-assets-api';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; asset: OmAsset | null; onDone: (asset?: OmAsset) => void };

/** Rotate / resize / crop an image asset server-side (`POST /api/assets/:id/transform`). */
export function AssetTransformDialog({ open, onClose, asset, onDone }: Props) {
  const [rotate, setRotate] = useState(0);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [crop, setCrop] = useState({ on: false, left: '0', top: '0', width: '', height: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && asset) { setRotate(0); setWidth(''); setHeight(''); setCrop({ on: false, left: '0', top: '0', width: String(asset.width ?? ''), height: String(asset.height ?? '') }); }
  }, [open, asset]);

  if (!asset) return null;

  const apply = async () => {
    const payload: ImageTransformPayload = {};
    if (rotate) payload.rotate = rotate;
    if (width) payload.width = Number(width);
    if (height) payload.height = Number(height);
    if (crop.on) payload.crop = { left: Number(crop.left) || 0, top: Number(crop.top) || 0, width: Number(crop.width), height: Number(crop.height) };
    if (!Object.keys(payload).length) {
      toast.info('Nothing to apply');
      return;
    }
    setBusy(true);
    try {
      const updated = await transformOmAssetImage(asset.id, payload);
      toast.success('Image transformed');
      onDone(updated);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transform failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog fullWidth maxWidth="sm" open={open} onClose={onClose}>
      <DialogTitle>Transform “{asset.name}”</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box component="img" alt={asset.name} src={`${omAssetFileUrl(asset.id)}?v=${asset.updated_at ?? ''}`} sx={{ width: 1, maxHeight: 280, objectFit: 'contain', borderRadius: 1.5, bgcolor: 'background.neutral', transform: `rotate(${rotate}deg)`, transition: 'transform .2s' }} />
        <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>{asset.width}×{asset.height} · {asset.file_type?.toUpperCase()}</Typography>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Rotate</Typography>
          <ToggleButtonGroup exclusive size="small" value={rotate} onChange={(_, v) => v !== null && setRotate(v)}>
            {[0, 90, 180, 270].map((d) => <ToggleButton key={d} value={d}>{d}°</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Resize (leave one empty to keep aspect)</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField size="small" type="number" label="Width" value={width} onChange={(e) => setWidth(e.target.value)} />
            <TextField size="small" type="number" label="Height" value={height} onChange={(e) => setHeight(e.target.value)} />
          </Box>
        </Box>

        <Box>
          <FormControlLabel control={<Switch checked={crop.on} onChange={(e) => setCrop((c) => ({ ...c, on: e.target.checked }))} />} label={<Typography variant="subtitle2">Crop</Typography>} />
          {crop.on && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mt: 1 }}>
              {(['left', 'top', 'width', 'height'] as const).map((k) => (
                <TextField key={k} size="small" type="number" label={k[0].toUpperCase() + k.slice(1)} value={crop[k]} onChange={(e) => setCrop((c) => ({ ...c, [k]: e.target.value }))} />
              ))}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" loading={busy} startIcon={<Iconify icon="solar:restart-bold" />} onClick={apply}>Apply</Button>
      </DialogActions>
    </Dialog>
  );
}

// ----------------------------------------------------------------------

/** Split an image into a rows × cols grid of new assets (`POST /api/assets/:id/split`). */
export function AssetSplitDialog({ open, onClose, asset, onDone }: Props) {
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [deleteSource, setDeleteSource] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setRows(2); setCols(2); setDeleteSource(false); } }, [open]);
  if (!asset) return null;

  const run = async () => {
    setBusy(true);
    try {
      const r = await splitOmAsset(asset.id, { rows, cols, delete_source: deleteSource });
      toast.success(`Created ${r.assets.length} tiles${r.deleted_source ? ' and archived the source' : ''}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Split failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>Split “{asset.name}” into tiles</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ position: 'relative' }}>
          <Box component="img" alt={asset.name} src={omAssetFileUrl(asset.id)} sx={{ width: 1, maxHeight: 220, objectFit: 'contain', borderRadius: 1.5, bgcolor: 'background.neutral' }} />
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, pointerEvents: 'none' }}>
            {Array.from({ length: rows * cols }).map((_, i) => <Box key={i} sx={{ border: '1px dashed', borderColor: 'primary.main', opacity: 0.7 }} />)}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField size="small" type="number" label="Rows" value={rows} onChange={(e) => setRows(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
          <TextField size="small" type="number" label="Columns" value={cols} onChange={(e) => setCols(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
        </Box>
        <FormControlLabel control={<Switch checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} />} label="Archive the original after splitting" />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" loading={busy} onClick={run}>Create {rows * cols} tiles</Button>
      </DialogActions>
    </Dialog>
  );
}
