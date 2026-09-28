import { varAlpha } from 'minimal-shared/utils';
import { useBoolean } from 'minimal-shared/hooks';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Tooltip from '@mui/material/Tooltip';
import ListItem from '@mui/material/ListItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import ListItemText from '@mui/material/ListItemText';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemButton from '@mui/material/ListItemButton';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { useOmAuth, omApiFetch, omRoleLabel, omDisplayName } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

type LinkedProfile = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  role: string;
  avatar_url: string | null;
  church_id: number | null;
  church_name: string | null;
};

const nameOf = (p: LinkedProfile) => omDisplayName({ ...p, username: null });

/**
 * super_admin only: the row of pinned accounts under the drawer avatar. Clicking
 * one switches the session via `/api/admin/impersonate`; the "+" pins another
 * account via `/api/user/profile/linked-profiles`.
 */
export function AccountLinkedProfiles({ onSwitched }: { onSwitched?: () => void }) {
  const { user, impersonation, switchToUser, returnToSelf } = useOmAuth();
  const addDialog = useBoolean();

  const [profiles, setProfiles] = useState<LinkedProfile[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const isSuperAdmin = user?.role === 'super_admin' || impersonation.impersonating;

  const load = useCallback(async () => {
    if (!isSuperAdmin) return;
    const res = await omApiFetch('/api/user/profile/linked-profiles');
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) setProfiles(json.profiles ?? []);
  }, [isSuperAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isSuperAdmin) return null;

  const handleSwitch = async (profile: LinkedProfile) => {
    if (profile.id === user?.id) return;
    setBusyId(profile.id);
    try {
      // Switching from an impersonated account to another: return first so the
      // server's originalAdmin record stays the real admin.
      if (impersonation.impersonating) await returnToSelf();
      await switchToUser(profile.id);
      toast.success(`Switched to ${nameOf(profile)}`);
      onSwitched?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch account');
    } finally {
      setBusyId(null);
    }
  };

  const handleReturn = async () => {
    setBusyId(-1);
    try {
      await returnToSelf();
      toast.success('Back on your own account');
      onSwitched?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not return');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (profile: LinkedProfile) => {
    const res = await omApiFetch(`/api/user/profile/linked-profiles/${profile.id}`, {
      method: 'DELETE',
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) setProfiles(json.profiles ?? []);
    else toast.error(json?.message || 'Could not remove profile');
  };

  return (
    <>
      <Box sx={{ px: 3, pt: 1, pb: impersonation.impersonating ? 1 : 3 }}>
        <Typography
          variant="caption"
          sx={{ mb: 1.5, display: 'block', textAlign: 'center', color: 'text.disabled' }}
        >
          Switch profile
        </Typography>

        <Box sx={{ gap: 1, flexWrap: 'wrap', display: 'flex', justifyContent: 'center' }}>
          {profiles.map((profile) => {
            const active = profile.id === user?.id;
            return (
              <Tooltip
                key={profile.id}
                title={
                  <Box sx={{ textAlign: 'center' }}>
                    <div>{active ? 'Current: ' : 'Switch to: '}{nameOf(profile)}</div>
                    <Box component="span" sx={{ typography: 'caption', opacity: 0.72 }}>
                      {omRoleLabel(profile.role)}
                      {profile.church_name ? ` · ${profile.church_name}` : ''}
                    </Box>
                  </Box>
                }
              >
                <Box sx={{ position: 'relative' }}>
                  <Avatar
                    alt={nameOf(profile)}
                    src={profile.avatar_url ?? undefined}
                    onClick={() => handleSwitch(profile)}
                    sx={(theme) => ({
                      cursor: active ? 'default' : 'pointer',
                      opacity: busyId === profile.id ? 0.5 : 1,
                      outline: active ? `solid 2px ${theme.vars.palette.primary.main}` : 'none',
                      outlineOffset: 2,
                    })}
                  >
                    {nameOf(profile).charAt(0).toUpperCase()}
                  </Avatar>
                  <IconButton
                    size="small"
                    aria-label={`Unpin ${nameOf(profile)}`}
                    onClick={() => handleRemove(profile)}
                    sx={(theme) => ({
                      p: 0,
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      position: 'absolute',
                      color: theme.vars.palette.common.white,
                      bgcolor: theme.vars.palette.grey[600],
                      '&:hover': { bgcolor: theme.vars.palette.error.main },
                    })}
                  >
                    <Iconify icon="mingcute:close-line" width={12} />
                  </IconButton>
                </Box>
              </Tooltip>
            );
          })}

          <Tooltip title="Add profile">
            <IconButton
              onClick={addDialog.onTrue}
              sx={[
                (theme) => ({
                  bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
                  border: `dashed 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.32)}`,
                }),
              ]}
            >
              <Iconify icon="mingcute:add-line" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {impersonation.impersonating && (
        <Box sx={{ px: 3, pb: 3 }}>
          <Button
            fullWidth
            size="small"
            color="warning"
            variant="soft"
            loading={busyId === -1}
            onClick={handleReturn}
            startIcon={<Iconify icon="eva:arrow-ios-back-fill" />}
          >
            Return to {impersonation.originalAdmin?.email ?? 'my account'}
          </Button>
        </Box>
      )}

      <AddProfileDialog
        open={addDialog.value}
        onClose={addDialog.onFalse}
        existingIds={profiles.map((p) => p.id)}
        onAdded={(list) => setProfiles(list)}
      />
    </>
  );
}

// ----------------------------------------------------------------------

function AddProfileDialog({
  open,
  onClose,
  existingIds,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  existingIds: number[];
  onAdded: (profiles: LinkedProfile[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LinkedProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await omApiFetch(
          `/api/user/profile/linked-profiles/search?q=${encodeURIComponent(q)}`
        );
        const json = await res.json().catch(() => null);
        setResults(res.ok && json?.success ? json.users ?? [] : []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, open]);

  const handleAdd = async (profile: LinkedProfile) => {
    setAdding(profile.id);
    try {
      const res = await omApiFetch('/api/user/profile/linked-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: profile.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Could not add profile');
      onAdded(json.profiles ?? []);
      toast.success(`${nameOf(profile)} added`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add profile');
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>Add a profile</DialogTitle>

      <DialogContent sx={{ pb: 1 }}>
        <TextField
          fullWidth
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ mb: 1 }}
        />

        <List disablePadding sx={{ minHeight: 120 }}>
          {results.map((profile) => {
            const already = existingIds.includes(profile.id);
            return (
              <ListItem key={profile.id} disablePadding>
                <ListItemButton
                  disabled={already || adding === profile.id}
                  onClick={() => handleAdd(profile)}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemAvatar>
                    <Avatar src={profile.avatar_url ?? undefined} alt={nameOf(profile)}>
                      {nameOf(profile).charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={nameOf(profile)}
                    secondary={`${omRoleLabel(profile.role)}${
                      profile.church_name ? ` · ${profile.church_name}` : ''
                    } · ${profile.email}`}
                    slotProps={{ secondary: { noWrap: true, sx: { typography: 'caption' } } }}
                  />
                  {already ? (
                    <Iconify icon="solar:check-circle-bold" sx={{ color: 'success.main' }} />
                  ) : (
                    <Iconify icon="mingcute:add-line" />
                  )}
                </ListItemButton>
              </ListItem>
            );
          })}

          {!results.length && (
            <Typography
              variant="body2"
              sx={{ py: 4, textAlign: 'center', color: 'text.disabled' }}
            >
              {searching
                ? 'Searching…'
                : query.trim().length < 2
                  ? 'Type at least 2 characters'
                  : 'No matching accounts'}
            </Typography>
          )}
        </List>
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
