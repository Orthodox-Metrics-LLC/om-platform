import type { IconButtonProps } from '@mui/material/IconButton';
import type { OmNotification } from './use-om-notifications';

import { m } from 'framer-motion';
import { useState, useCallback } from 'react';
import { useBoolean } from 'minimal-shared/hooks';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Badge from '@mui/material/Badge';
import Drawer from '@mui/material/Drawer';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { varTap, varHover, transitionTap } from 'src/components/animate';

import { useAuthContext } from 'src/auth/hooks';

import { NotificationItem } from './notification-item';
import { useOmNotifications } from './use-om-notifications';

// ----------------------------------------------------------------------

export type NotificationsDrawerProps = IconButtonProps;

/** Live notifications from OM (friend requests, mentions/replies, files, chat, billing). */
export function NotificationsDrawer({ sx, ...other }: NotificationsDrawerProps) {
  const router = useRouter();
  const { authenticated } = useAuthContext();
  const { value: open, onFalse: onClose, onTrue: onOpen } = useBoolean();
  const [currentTab, setCurrentTab] = useState('all');

  const { items, markRead, markAllRead, dismiss, respondFriendRequest } = useOmNotifications(authenticated);

  const unread = items.filter((n) => n.isUnRead);
  const read = items.filter((n) => !n.isUnRead);
  const visible = currentTab === 'unread' ? unread : currentTab === 'read' ? read : items;

  const TABS = [
    { value: 'all', label: 'All', count: items.length },
    { value: 'unread', label: 'Unread', count: unread.length },
    { value: 'read', label: 'Read', count: read.length },
  ];

  const handleChangeTab = useCallback((event: React.SyntheticEvent, newValue: string) => {
    setCurrentTab(newValue);
  }, []);

  const handleOpen = useCallback(
    async (n: OmNotification) => {
      if (n.isUnRead) markRead(n.id);
      if (n.actionUrl && (n.actionUrl.startsWith('/dashboard') || n.actionUrl.startsWith('/portal'))) {
        onClose();
        router.push(n.actionUrl);
      } else if (n.typeName.startsWith('friend_')) {
        // Legacy prod URLs — friend activity lives in the header Contacts popover here.
        onClose();
        router.push(paths.dashboard.user.profile + '?tab=friends');
      }
    },
    [markRead, onClose, router]
  );

  const handleFriendRespond = useCallback(
    async (requestId: number, action: 'accept' | 'decline') => {
      try {
        await respondFriendRequest(requestId, action);
        toast.success(action === 'accept' ? 'Friend request accepted' : 'Friend request declined');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not respond');
      }
    },
    [respondFriendRequest]
  );

  const renderHead = () => (
    <Box sx={{ py: 2, pr: 1, pl: 2.5, minHeight: 68, display: 'flex', alignItems: 'center' }}>
      <Typography variant="h6" sx={{ flexGrow: 1 }}>
        Notifications
      </Typography>

      {!!unread.length && (
        <Tooltip title="Mark all as read">
          <IconButton color="primary" onClick={markAllRead}>
            <Iconify icon="eva:done-all-fill" />
          </IconButton>
        </Tooltip>
      )}

      <IconButton onClick={onClose} sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
        <Iconify icon="mingcute:close-line" />
      </IconButton>

      <Tooltip title="Notification settings">
        <IconButton
          onClick={() => {
            onClose();
            router.push(`${paths.dashboard.user.account}/notifications`);
          }}
        >
          <Iconify icon="solar:settings-bold-duotone" />
        </IconButton>
      </Tooltip>
    </Box>
  );

  const renderTabs = () => (
    <Tabs variant="fullWidth" value={currentTab} onChange={handleChangeTab} indicatorColor="custom">
      {TABS.map((tab) => (
        <Tab
          key={tab.value}
          iconPosition="end"
          value={tab.value}
          label={tab.label}
          icon={
            <Label
              variant={((tab.value === 'all' || tab.value === currentTab) && 'filled') || 'soft'}
              color={(tab.value === 'unread' && 'info') || 'default'}
            >
              {tab.count}
            </Label>
          }
        />
      ))}
    </Tabs>
  );

  const renderList = () => (
    <Scrollbar>
      <Box component="ul">
        {visible.map((notification) => (
          <Box component="li" key={notification.id} sx={{ display: 'flex' }}>
            <NotificationItem
              notification={notification}
              onOpen={handleOpen}
              onDismiss={(n) => dismiss(n.id)}
              onFriendRespond={handleFriendRespond}
            />
          </Box>
        ))}
        {!visible.length && (
          <Typography variant="body2" sx={{ py: 8, textAlign: 'center', color: 'text.disabled' }}>
            {currentTab === 'unread' ? "You're all caught up." : 'No notifications yet.'}
          </Typography>
        )}
      </Box>
    </Scrollbar>
  );

  return (
    <>
      <IconButton
        component={m.button}
        whileTap={varTap(0.96)}
        whileHover={varHover(1.04)}
        transition={transitionTap()}
        aria-label="Notifications button"
        onClick={onOpen}
        sx={sx}
        {...other}
      >
        <Badge badgeContent={unread.length} color="error">
          <Iconify width={24} icon="solar:bell-bing-bold-duotone" />
        </Badge>
      </IconButton>

      <Drawer
        open={open}
        onClose={onClose}
        anchor="right"
        slotProps={{ backdrop: { invisible: true }, paper: { sx: { width: 1, maxWidth: 420 } } }}
      >
        {renderHead()}
        {renderTabs()}
        {renderList()}

        <Box sx={{ p: 1 }}>
          <Button fullWidth size="large" onClick={markAllRead} disabled={!unread.length}>
            Mark all as read
          </Button>
        </Box>
      </Drawer>
    </>
  );
}
