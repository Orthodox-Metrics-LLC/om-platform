import type { OmAdminUser, OmChurchOption } from './om-users-api';

import { useState, useEffect } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';

import { omRoleLabel } from 'src/auth/context/om-auth';

import { churchLabel, userFullName, isPlatformRole } from './om-users-api';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  user: OmAdminUser | null;
  churches: OmChurchOption[];
  onClose: () => void;
  onConfirm: (churchId: number | null) => Promise<void>;
};

/**
 * Approval step. Church-role accounts must leave this dialog with a church_id —
 * the server rejects activation without one (CHURCH_REQUIRED).
 */
export function UserApproveDialog({ open, user, churches, onClose, onConfirm }: Props) {
  const [churchId, setChurchId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChurchId(user?.church_id ?? '');
  }, [user]);

  if (!user) return null;

  const needsChurch = !isPlatformRole(user.role);
  const isFirstApproval = user.account_status === 'pending';
  const disabled = busy || (needsChurch && churchId === '');

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(churchId === '' ? null : Number(churchId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>{isFirstApproval ? 'Approve account' : 'Re-activate account'}</DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        <Typography variant="body2">
          <strong>{userFullName(user)}</strong> · {omRoleLabel(user.role)} · {user.email}
        </Typography>

        {needsChurch ? (
          <TextField
            select
            fullWidth
            required
            label="Church"
            value={churchId}
            onChange={(e) => setChurchId(e.target.value === '' ? '' : Number(e.target.value))}
            helperText="Required — the user's records, media and chat are scoped to this parish."
          >
            {churches.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {churchLabel(c)} <span style={{ opacity: 0.6, marginLeft: 6 }}>#{c.id}</span>
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Alert severity="info">Platform accounts are not tied to a single church.</Alert>
        )}

        {isFirstApproval && (
          <Alert severity="success" variant="outlined">
            On approval the user is emailed a temporary password and asked to set a new one on
            first sign-in.
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" color="success" disabled={disabled} loading={busy} onClick={handleConfirm}>
          {isFirstApproval ? 'Approve' : 'Activate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
