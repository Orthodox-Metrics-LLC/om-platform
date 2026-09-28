import type { OmNotification } from './use-om-notifications';

import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import SvgIcon from '@mui/material/SvgIcon';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';

import { fToNow } from 'src/utils/format-time';
import { fData } from 'src/utils/format-number';

import { Iconify } from 'src/components/iconify';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { notificationIcons } from './icons';

// ----------------------------------------------------------------------

export type NotificationItemProps = {
  notification: OmNotification;
  onOpen: (n: OmNotification) => void;
  onDismiss: (n: OmNotification) => void;
  onFriendRespond: (requestId: number, action: 'accept' | 'decline') => Promise<void>;
};

const readerContent = (data: string) => (
  <Box
    dangerouslySetInnerHTML={{ __html: data }}
    sx={{
      '& p': { m: 0, typography: 'body2' },
      '& a': { color: 'inherit', textDecoration: 'none' },
      '& strong': { typography: 'subtitle2' },
    }}
  />
);

const renderIcon = (type: string) =>
  ({
    order: notificationIcons.order,
    chat: notificationIcons.chat,
    mail: notificationIcons.mail,
    delivery: notificationIcons.delivery,
    payment: notificationIcons.order,
    project: notificationIcons.mail,
    file: notificationIcons.mail,
  })[type];

export function NotificationItem({ notification, onOpen, onDismiss, onFriendRespond }: NotificationItemProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const d = notification.data || {};

  const renderAvatar = () => (
    <ListItemAvatar>
      {notification.avatarUrl ? (
        <Avatar src={notification.avatarUrl} sx={{ bgcolor: 'background.neutral' }} />
      ) : (
        <Box
          sx={{
            width: 40,
            height: 40,
            display: 'flex',
            borderRadius: '50%',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.neutral',
          }}
        >
          <SvgIcon sx={{ width: 24, height: 24 }}>{renderIcon(notification.type)}</SvgIcon>
        </Box>
      )}
    </ListItemAvatar>
  );

  const renderText = () => (
    <ListItemText
      disableTypography
      primary={readerContent(notification.title)}
      secondary={
        <>
          {fToNow(notification.createdAt)}
          <Box component="span" sx={{ width: 2, height: 2, borderRadius: '50%', bgcolor: 'currentColor' }} />
          {notification.category}
        </>
      }
      slotProps={{
        primary: { sx: { mb: 0.5 } },
        secondary: { sx: { gap: 0.5, display: 'flex', alignItems: 'center', typography: 'caption', color: 'text.disabled' } },
      }}
    />
  );

  const renderUnReadBadge = () =>
    notification.isUnRead && (
      <Box sx={{ top: 26, width: 8, height: 8, right: 44, borderRadius: '50%', bgcolor: 'info.main', position: 'absolute' }} />
    );

  // Pending incoming friend request: real accept/decline on the friendship row.
  const isPendingFriendRequest =
    notification.typeName === 'friend_request' && d.action_type === 'friend_request_received' && d.request_id;

  const renderFriendAction = () => (
    <Box sx={{ gap: 1, mt: 1.5, display: 'flex' }}>
      <Button
        size="small"
        variant="contained"
        loading={busy === 'accept'}
        onClick={async (e) => {
          e.stopPropagation();
          setBusy('accept');
          try { await onFriendRespond(Number(d.request_id), 'accept'); } finally { setBusy(null); }
        }}
      >
        Accept
      </Button>
      <Button
        size="small"
        variant="outlined"
        loading={busy === 'decline'}
        onClick={async (e) => {
          e.stopPropagation();
          setBusy('decline');
          try { await onFriendRespond(Number(d.request_id), 'decline'); } finally { setBusy(null); }
        }}
      >
        Decline
      </Button>
    </Box>
  );

  const renderProjectAction = () =>
    (d.excerpt || notification.actionUrl) && (
      <>
        {d.excerpt && (
          <Box sx={{ p: 1.5, my: 1.5, borderRadius: 1.5, color: 'text.secondary', bgcolor: 'background.neutral', typography: 'body2' }}>
            {d.excerpt}
          </Box>
        )}
        {notification.actionUrl && (
          <Button size="small" variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={(e) => { e.stopPropagation(); onOpen(notification); }}>
            {notification.typeName === 'post_comment' || notification.typeName === 'mention' ? 'Reply' : 'Open'}
          </Button>
        )}
      </>
    );

  const renderFileAction = () =>
    d.file_name && (
      <Box sx={(theme) => ({ p: theme.spacing(1.5, 1.5, 1.5, 1), gap: 1, mt: 1.5, display: 'flex', borderRadius: 1.5, bgcolor: 'background.neutral' })}>
        <FileThumbnail file={d.file_name} />
        <ListItemText
          primary={d.file_name}
          secondary={d.file_size ? fData(Number(d.file_size)) : d.folder_name || ''}
          slotProps={{
            primary: { noWrap: true, sx: (theme) => ({ color: 'text.secondary', fontSize: theme.typography.pxToRem(13) }) },
            secondary: { sx: { mt: 0.25, typography: 'caption', color: 'text.disabled' } },
          }}
        />
        {d.download_url && (
          <Button size="small" variant="outlined" sx={{ flexShrink: 0 }} component="a" href={d.download_url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
            Download
          </Button>
        )}
      </Box>
    );

  return (
    <ListItemButton
      disableRipple
      onClick={() => onOpen(notification)}
      sx={[(theme) => ({ p: 2.5, pr: 5, alignItems: 'flex-start', borderBottom: `dashed 1px ${theme.vars.palette.divider}`, position: 'relative' })]}
    >
      {renderUnReadBadge()}
      {renderAvatar()}

      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        {renderText()}
        {isPendingFriendRequest && renderFriendAction()}
        {notification.type === 'project' && renderProjectAction()}
        {notification.type === 'file' && renderFileAction()}
      </Box>

      <IconButton
        size="small"
        aria-label="Dismiss notification"
        onClick={(e) => { e.stopPropagation(); onDismiss(notification); }}
        sx={{ position: 'absolute', top: 16, right: 8, color: 'text.disabled' }}
      >
        <Iconify icon="mingcute:close-line" width={16} />
      </IconButton>
    </ListItemButton>
  );
}
