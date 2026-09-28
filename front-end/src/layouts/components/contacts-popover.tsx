import type { IconButtonProps } from '@mui/material/IconButton';

import { useState } from 'react';
import { m } from 'framer-motion';
import { usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Badge from '@mui/material/Badge';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fToNow } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomPopover } from 'src/components/custom-popover';
import { varTap, varHover, transitionTap } from 'src/components/animate';

import { useAuthContext } from 'src/auth/hooks';
import { omRoleLabel } from 'src/auth/context/om-auth';

import { contactName, useOmContacts } from './use-om-contacts';

// ----------------------------------------------------------------------

type TabValue = 'friends' | 'requests' | 'discover';

export type ContactsPopoverProps = IconButtonProps;

/**
 * Header Contacts: accepted friends, pending requests and a directory of users
 * who set their profile to Public — each with a one-click request action.
 */
export function ContactsPopover({ sx, ...other }: ContactsPopoverProps) {
  const { open, anchorEl, onClose, onOpen } = usePopover();
  const { authenticated } = useAuthContext();

  const [tab, setTab] = useState<TabValue>('friends');
  const [busy, setBusy] = useState<string | null>(null);

  const contacts = useOmContacts(authenticated);

  const received = contacts.requests.filter((r) => r.direction === 'received');
  const sent = contacts.requests.filter((r) => r.direction === 'sent');

  const act = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const renderEmpty = (text: string) => (
    <Typography variant="body2" sx={{ py: 6, textAlign: 'center', color: 'text.disabled' }}>
      {text}
    </Typography>
  );

  const renderFriends = () =>
    contacts.friends.length
      ? contacts.friends.map((f) => (
          <MenuItem key={f.friend_id} sx={{ p: 1 }} disableRipple>
            <Badge variant={f.is_online ? 'online' : 'offline'} badgeContent=" ">
              <Avatar alt={contactName(f)} src={f.profile_image_url ?? undefined}>
                {contactName(f).charAt(0)}
              </Avatar>
            </Badge>
            <ListItemText
              primary={contactName(f)}
              secondary={f.is_online ? 'Online' : f.last_seen ? fToNow(f.last_seen) : ''}
              slotProps={{ secondary: { sx: { typography: 'caption', color: 'text.disabled' } } }}
            />
            <Tooltip title="Remove contact">
              <IconButton
                size="small"
                disabled={busy === `rm-${f.friend_id}`}
                onClick={() =>
                  act(`rm-${f.friend_id}`, () => contacts.removeFriend(f.friend_id), 'Contact removed')
                }
              >
                <Iconify icon="mingcute:close-line" width={18} />
              </IconButton>
            </Tooltip>
          </MenuItem>
        ))
      : renderEmpty('No contacts yet — find people under Discover.');

  const renderRequests = () =>
    contacts.requests.length ? (
      <>
        {received.map((r) => (
          <MenuItem key={r.id} sx={{ p: 1 }} disableRipple>
            <Avatar alt={contactName(r)} src={r.profile_image_url ?? undefined}>
              {contactName(r).charAt(0)}
            </Avatar>
            <ListItemText
              primary={contactName(r)}
              secondary={`Wants to connect · ${fToNow(r.requested_at)}`}
              slotProps={{ secondary: { sx: { typography: 'caption', color: 'text.disabled' } } }}
            />
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button
                size="small"
                variant="contained"
                loading={busy === `acc-${r.id}`}
                onClick={() => act(`acc-${r.id}`, () => contacts.respond(r.id, 'accept'), 'Request accepted')}
              >
                Accept
              </Button>
              <Button
                size="small"
                color="inherit"
                variant="outlined"
                loading={busy === `dec-${r.id}`}
                onClick={() => act(`dec-${r.id}`, () => contacts.respond(r.id, 'decline'), 'Request declined')}
              >
                Decline
              </Button>
            </Box>
          </MenuItem>
        ))}
        {sent.map((r) => (
          <MenuItem key={r.id} sx={{ p: 1 }} disableRipple>
            <Avatar alt={contactName(r)} src={r.profile_image_url ?? undefined}>
              {contactName(r).charAt(0)}
            </Avatar>
            <ListItemText
              primary={contactName(r)}
              secondary={`Request sent · ${fToNow(r.requested_at)}`}
              slotProps={{ secondary: { sx: { typography: 'caption', color: 'text.disabled' } } }}
            />
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              loading={busy === `can-${r.id}`}
              onClick={() => act(`can-${r.id}`, () => contacts.respond(r.id, 'cancel'), 'Request cancelled')}
            >
              Cancel
            </Button>
          </MenuItem>
        ))}
      </>
    ) : (
      renderEmpty('No pending requests.')
    );

  const renderDiscover = () =>
    contacts.discover.length
      ? contacts.discover.map((u) => (
          <MenuItem key={u.id} sx={{ p: 1 }} disableRipple>
            <Badge variant={u.is_online ? 'online' : 'offline'} badgeContent=" ">
              <Avatar alt={u.display_name} src={u.avatar_url ?? undefined}>
                {u.display_name.charAt(0)}
              </Avatar>
            </Badge>
            <ListItemText
              primary={u.display_name}
              secondary={[omRoleLabel(u.role), u.church_name].filter(Boolean).join(' · ')}
              slotProps={{ secondary: { noWrap: true, sx: { typography: 'caption', color: 'text.disabled' } } }}
            />
            {u.is_friend ? (
              <Label color="success" variant="soft">
                Contact
              </Label>
            ) : u.has_pending_request ? (
              <Label color="warning" variant="soft">
                {u.friendship_direction === 'received' ? 'Awaiting you' : 'Pending'}
              </Label>
            ) : (
              <Tooltip title="Send request">
                <IconButton
                  size="small"
                  color="primary"
                  disabled={busy === `add-${u.id}`}
                  onClick={() => act(`add-${u.id}`, () => contacts.sendRequest(u.id), 'Request sent')}
                >
                  <Iconify icon="solar:user-plus-bold" width={20} />
                </IconButton>
              </Tooltip>
            )}
          </MenuItem>
        ))
      : renderEmpty('Nobody has a public profile yet.');

  const renderMenuList = () => (
    <CustomPopover open={open} anchorEl={anchorEl} onClose={onClose}>
      <Box sx={{ px: 1.5, pt: 1.5, display: 'flex', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Contacts <span>({contacts.friends.length})</span>
        </Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={contacts.refresh} disabled={contacts.loading}>
            <Iconify icon="solar:restart-bold" width={18} />
          </IconButton>
        </Tooltip>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v: TabValue) => setTab(v)}
        sx={{ px: 1.5, minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}
      >
        <Tab value="friends" label="Contacts" />
        <Tab
          value="requests"
          label="Requests"
          icon={
            received.length ? (
              <Label color="error" variant="filled" sx={{ ml: 0.5 }}>
                {received.length}
              </Label>
            ) : undefined
          }
          iconPosition="end"
        />
        <Tab value="discover" label="Discover" />
      </Tabs>

      <Scrollbar sx={{ height: 320, width: 360 }}>
        {contacts.error ? (
          renderEmpty(contacts.error)
        ) : (
          <MenuList>
            {tab === 'friends' && renderFriends()}
            {tab === 'requests' && renderRequests()}
            {tab === 'discover' && renderDiscover()}
          </MenuList>
        )}
      </Scrollbar>

      <Box sx={{ p: 1, borderTop: (theme) => `dashed 1px ${theme.vars.palette.divider}` }}>
        <Button
          fullWidth
          size="small"
          color="inherit"
          component={RouterLink}
          href={paths.dashboard.user.account}
          onClick={onClose}
        >
          Make my profile public
        </Button>
      </Box>
    </CustomPopover>
  );

  return (
    <>
      <IconButton
        component={m.button}
        whileTap={varTap(0.96)}
        whileHover={varHover(1.04)}
        transition={transitionTap()}
        aria-label="Contacts button"
        onClick={onOpen}
        sx={[
          (theme) => ({ ...(open && { bgcolor: theme.vars.palette.action.selected }) }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...other}
      >
        <Badge badgeContent={received.length} color="error">
          <Iconify icon="solar:users-group-rounded-bold-duotone" width={24} />
        </Badge>
      </IconButton>

      {renderMenuList()}
    </>
  );
}
