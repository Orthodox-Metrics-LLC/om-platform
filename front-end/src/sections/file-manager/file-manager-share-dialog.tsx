import type { DialogProps } from '@mui/material/Dialog';
import type { OmFileItem, OmSharedUser, OmShareTarget } from './om-files-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import DialogTitle from '@mui/material/DialogTitle';
import Autocomplete from '@mui/material/Autocomplete';
import ListItemText from '@mui/material/ListItemText';
import DialogActions from '@mui/material/DialogActions';

import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { omRoleLabel } from 'src/auth/context/om-auth';

import { omFilesApi } from './om-files-api';
import { useOmFiles } from './om-files-context';

// ----------------------------------------------------------------------

type Props = DialogProps & {
  item: OmFileItem;
  onClose: () => void;
  onCopyLink?: () => void;
};

/** Share a file/folder with parish members or the church's support admins (view / edit). */
export function FileManagerShareDialog({ item, open, onClose, onCopyLink, sx, ...other }: Props) {
  const { churchId, canWrite, actions } = useOmFiles();
  const [targets, setTargets] = useState<OmShareTarget[]>([]);
  const [rows, setRows] = useState<{ user_id: number; permission: 'view' | 'edit' }[]>([]);
  const [picked, setPicked] = useState<OmShareTarget | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    omFilesApi.shareTargets(churchId).then(setTargets).catch(() => setTargets([]));
    setRows(((item.shared as OmSharedUser[] | null) || []).map((s) => ({ user_id: Number(s.id), permission: s.permission || 'view' })));
  }, [open, item, churchId]);

  const byId = new Map(targets.map((t) => [Number(t.id), t]));
  const available = targets.filter((t) => !rows.some((r) => r.user_id === Number(t.id)));

  const save = async () => {
    setSaving(true);
    try {
      await actions.setShares(item, rows);
      onClose();
    } catch {
      /* toast shown by context */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose} sx={sx} {...other}>
      <DialogTitle>Share “{item.name}”</DialogTitle>

      <Box sx={{ px: 3 }}>
        {canWrite && (
          <Autocomplete
            options={available}
            value={picked}
            onChange={(_, v) => {
              if (v) setRows((p) => [...p, { user_id: Number(v.id), permission: 'view' }]);
              setPicked(null);
            }}
            getOptionLabel={(o) => `${o.name} (${o.email})`}
            renderOption={(props, o) => (
              <li {...props} key={o.id}>
                <Avatar src={o.avatarUrl || undefined} sx={{ width: 28, height: 28, mr: 1.5 }}>{o.name.charAt(0)}</Avatar>
                <ListItemText primary={o.name} secondary={`${omRoleLabel(o.role)} · ${o.email}`} slotProps={{ secondary: { sx: { typography: 'caption' } } }} />
              </li>
            )}
            renderInput={(params) => <TextField {...params} placeholder="Add a person…" />}
            sx={{ mb: 2 }}
          />
        )}
      </Box>

      <Scrollbar sx={{ maxHeight: 60 * 5, px: 3 }}>
        <Box component="ul">
          {rows.map((r) => {
            const t = byId.get(r.user_id) || ((item.shared as OmSharedUser[] | null) || []).find((s) => Number(s.id) === r.user_id);
            if (!t) return null;
            return (
              <Box component="li" key={r.user_id} sx={{ py: 1, gap: 1.5, display: 'flex', alignItems: 'center' }}>
                <Avatar src={t.avatarUrl || undefined}>{t.name.charAt(0)}</Avatar>
                <ListItemText primary={t.name} secondary={t.email} slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true, sx: { typography: 'caption' } } }} />
                <TextField
                  select
                  size="small"
                  value={r.permission}
                  disabled={!canWrite}
                  onChange={(e) => setRows((p) => p.map((x) => (x.user_id === r.user_id ? { ...x, permission: e.target.value as 'view' | 'edit' } : x)))}
                  sx={{ width: 104 }}
                >
                  <MenuItem value="view">Can view</MenuItem>
                  <MenuItem value="edit">Can edit</MenuItem>
                </TextField>
                {canWrite && (
                  <IconButton size="small" onClick={() => setRows((p) => p.filter((x) => x.user_id !== r.user_id))}>
                    <Iconify icon="mingcute:close-line" width={18} />
                  </IconButton>
                )}
              </Box>
            );
          })}
          {!rows.length && (
            <Typography variant="body2" sx={{ py: 3, textAlign: 'center', color: 'text.disabled' }}>
              Not shared with anyone yet.
            </Typography>
          )}
        </Box>
      </Scrollbar>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        {onCopyLink ? (
          <Button startIcon={<Iconify icon="eva:link-2-fill" />} onClick={onCopyLink}>
            Copy link
          </Button>
        ) : <span />}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" color="inherit" onClick={onClose}>
            Close
          </Button>
          {canWrite && (
            <Button variant="contained" loading={saving} onClick={save}>
              Save
            </Button>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
}
