import type { DialogProps } from '@mui/material/Dialog';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';

import { fData } from 'src/utils/format-number';

import { Upload } from 'src/components/upload';
import { Iconify } from 'src/components/iconify';

import { useOmFiles } from './om-files-context';

// ----------------------------------------------------------------------

type Props = DialogProps & {
  /** 'files' (default) uploads into the current folder; 'folder' creates a folder here. */
  mode?: 'files' | 'folder';
  onClose: () => void;
};

export function FileManagerCreateFolderDialog({ open, onClose, mode = 'files', ...other }: Props) {
  const { actions, info, breadcrumbs } = useOmFiles();
  const [files, setFiles] = useState<(File | string)[]>([]);
  const [folderName, setFolderName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setFolderName('');
    }
  }, [open]);

  const handleDrop = useCallback((accepted: File[]) => setFiles((prev) => [...prev, ...accepted]), []);

  const remaining = info ? info.quota_bytes - info.used_bytes : 0;
  const incoming = files.reduce((n, f) => n + (f instanceof File ? f.size : 0), 0);
  const overQuota = info ? incoming > remaining : false;
  const here = breadcrumbs.length ? breadcrumbs[breadcrumbs.length - 1].name : 'File manager';

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'folder') await actions.createFolder(folderName.trim());
      else await actions.upload(files.filter((f): f is File => f instanceof File));
      onClose();
    } catch {
      /* toast from context */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog fullWidth maxWidth="sm" open={open} aria-hidden={!open} onClose={onClose} {...other}>
      <DialogTitle sx={[(theme) => ({ p: theme.spacing(3, 3, 2, 3) })]}>
        {mode === 'folder' ? `New folder in ${here}` : `Upload to ${here}`}
      </DialogTitle>

      <IconButton aria-label="Close" onClick={onClose} sx={{ top: 8, right: 8, position: 'absolute' }}>
        <Iconify icon="mingcute:close-line" />
      </IconButton>

      <DialogContent dividers sx={{ pt: 1, pb: 0, border: 'none' }}>
        {mode === 'folder' ? (
          <TextField autoFocus fullWidth label="Folder name" value={folderName} onChange={(e) => setFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && folderName.trim() && submit()} sx={{ mb: 3 }} />
        ) : (
          <>
            <Upload multiple value={files} onDrop={handleDrop} onRemove={(f) => setFiles((p) => p.filter((x) => x !== f))} />
            {info && (
              <Box sx={{ mt: 2, typography: 'caption', color: overQuota ? 'error.main' : 'text.disabled' }}>
                {fData(info.used_bytes)} of {fData(info.quota_bytes)} used · {fData(Math.max(remaining, 0))} free
                {incoming > 0 && ` · selected ${fData(incoming)}`}
                {overQuota && ' — exceeds your church’s storage plan'}
              </Box>
            )}
          </>
        )}
        {busy && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>

      <DialogActions>
        {mode === 'folder' ? (
          <Button variant="contained" disabled={!folderName.trim()} loading={busy} onClick={submit}>
            Create
          </Button>
        ) : (
          <>
            <Button variant="contained" startIcon={<Iconify icon="eva:cloud-upload-fill" />} disabled={!files.length || overQuota} loading={busy} onClick={submit}>
              Upload
            </Button>
            {!!files.length && (
              <Button variant="outlined" color="inherit" onClick={() => setFiles([])}>
                Remove all
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
