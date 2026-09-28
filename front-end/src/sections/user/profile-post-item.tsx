import type { OmPost, OmComment } from './om-social-api';

import { varAlpha } from 'minimal-shared/utils';
import { useBoolean, usePopover } from 'minimal-shared/hooks';
import { useRef, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import InputBase from '@mui/material/InputBase';
import IconButton from '@mui/material/IconButton';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';
import FormControlLabel from '@mui/material/FormControlLabel';
import AvatarGroup, { avatarGroupClasses } from '@mui/material/AvatarGroup';

import { fDateTime } from 'src/utils/format-time';
import { fShortenNumber } from 'src/utils/format-number';

import { Label } from 'src/components/label';
import { Image } from 'src/components/image';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomPopover } from 'src/components/custom-popover';

import { useAuthContext } from 'src/auth/hooks';
import { omRoleLabel } from 'src/auth/context/om-auth';

import { omSocialApi } from './om-social-api';

// ----------------------------------------------------------------------

type Props = {
  post: OmPost;
  canShare: boolean;
  onShare: (post: OmPost) => void;
  onDeleted: (id: number) => void;
};

export function ProfilePostItem({ post, canShare, onShare, onDeleted }: Props) {
  const { user } = useAuthContext();
  const menu = usePopover();
  const confirmDelete = useBoolean();

  const commentRef = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState('');
  const [liked, setLiked] = useState(post.viewer_liked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [likers, setLikers] = useState<{ id: number; name: string; avatar_url: string | null }[]>([]);
  const [comments, setComments] = useState<OmComment[] | null>(null);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [sending, setSending] = useState(false);

  const isOwner = Number(user?.id) === post.author.id;
  const canDelete = isOwner || user?.role === 'super_admin' || user?.role === 'admin';

  useEffect(() => {
    if (post.like_count > 0) omSocialApi.likes(post.id).then(setLikers).catch(() => {});
  }, [post.id, post.like_count]);

  const loadComments = useCallback(async () => {
    try {
      const list = await omSocialApi.comments(post.id);
      setComments(list);
      setCommentCount(list.length);
    } catch {
      setComments([]);
    }
  }, [post.id]);

  useEffect(() => {
    if (post.comment_count > 0) loadComments();
  }, [post.comment_count, loadComments]);

  const handleLike = async () => {
    try {
      const r = await omSocialApi.toggleLike(post.id);
      setLiked(r.liked);
      setLikeCount(r.like_count);
      setLikers(await omSocialApi.likes(post.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not react');
    }
  };

  const handleComment = async () => {
    const text = message.trim();
    if (!text) return;
    setSending(true);
    try {
      const c = await omSocialApi.addComment(post.id, text);
      setComments((prev) => [...(prev ?? []), c]);
      setCommentCount((n) => n + 1);
      setMessage('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not comment');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    try {
      await omSocialApi.deletePost(post.id);
      toast.success('Post deleted');
      onDeleted(post.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  const renderMedia = (media: OmPost['media']) =>
    media.length ? (
      <Box
        sx={{
          p: 1,
          gap: 1,
          display: 'grid',
          gridTemplateColumns: media.length > 1 ? 'repeat(2, 1fr)' : '1fr',
        }}
      >
        {media.map((m) =>
          m.kind === 'video' ? (
            <Box
              key={m.url}
              component="video"
              controls
              preload="metadata"
              src={m.url}
              sx={{ width: 1, borderRadius: 1.5, bgcolor: 'common.black', maxHeight: 480 }}
            />
          ) : (
            <Image key={m.url} alt="Post media" src={m.url} ratio="16/9" sx={{ borderRadius: 1.5 }} />
          )
        )}
      </Box>
    ) : null;

  const renderHead = () => (
    <CardHeader
      disableTypography
      avatar={
        <Avatar src={post.author.avatar_url ?? undefined} alt={post.author.name}>
          {post.author.name.charAt(0).toUpperCase()}
        </Avatar>
      }
      title={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2">{post.author.name}</Typography>
          <Label variant="soft" color={post.author.role === 'super_admin' || post.author.role === 'admin' ? 'info' : 'default'}>
            {omRoleLabel(post.author.role)}
          </Label>
          {post.visibility !== 'public' && (
            <Iconify
              icon={post.visibility === 'private' ? 'solar:lock-password-outline' : 'solar:users-group-rounded-bold'}
              width={16}
              sx={{ color: 'text.disabled' }}
            />
          )}
        </Box>
      }
      subheader={
        <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.5, display: 'block' }}>
          {fDateTime(post.created_at)}
        </Typography>
      }
      action={
        canDelete ? (
          <IconButton onClick={menu.onOpen}>
            <Iconify icon="eva:more-vertical-fill" />
          </IconButton>
        ) : null
      }
    />
  );

  const renderShared = () =>
    post.shared_from && (
      <Paper variant="outlined" sx={{ mx: 3, mb: 2, p: 2, borderRadius: 1.5, bgcolor: 'background.neutral' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Avatar src={post.shared_from.author.avatar_url ?? undefined} sx={{ width: 28, height: 28 }}>
            {post.shared_from.author.name.charAt(0)}
          </Avatar>
          <Typography variant="subtitle2">{post.shared_from.author.name}</Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {fDateTime(post.shared_from.created_at)}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {post.shared_from.message}
        </Typography>
        {renderMedia(post.shared_from.media)}
      </Paper>
    );

  const renderCommentList = () =>
    !!comments?.length && (
      <Stack spacing={1.5} sx={{ px: 3, pb: 2 }}>
        {comments.map((comment) => (
          <Box key={comment.id} sx={{ gap: 2, display: 'flex' }}>
            <Avatar alt={comment.author.name} src={comment.author.avatar_url ?? undefined}>
              {comment.author.name.charAt(0)}
            </Avatar>
            <Paper sx={{ p: 1.5, flexGrow: 1, bgcolor: 'background.neutral' }}>
              <Box sx={{ mb: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ typography: 'subtitle2' }}>{comment.author.name}</Box>
                <Box sx={{ typography: 'caption', color: 'text.disabled' }}>{fDateTime(comment.created_at)}</Box>
              </Box>
              <Box sx={{ typography: 'body2', color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{comment.message}</Box>
            </Paper>
          </Box>
        ))}
      </Stack>
    );

  const renderInput = () => (
    <Box sx={{ gap: 2, display: 'flex', alignItems: 'center', p: (theme) => theme.spacing(0, 3, 3, 3) }}>
      <Avatar src={(user as any)?.photoURL ?? undefined} alt={user?.displayName}>
        {user?.displayName?.charAt(0).toUpperCase()}
      </Avatar>
      <InputBase
        fullWidth
        value={message}
        inputRef={commentRef}
        placeholder="Write a comment…"
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleComment();
          }
        }}
        endAdornment={
          <InputAdornment position="end" sx={{ mr: 1 }}>
            <IconButton size="small" onClick={handleComment} disabled={sending || !message.trim()}>
              <Iconify icon="custom:send-fill" />
            </IconButton>
          </InputAdornment>
        }
        inputProps={{ id: `comment-${post.id}-input`, 'aria-label': `Comment ${post.id} input` }}
        sx={[
          (theme) => ({
            pl: 1.5,
            height: 40,
            borderRadius: 1,
            border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.32)}`,
          }),
        ]}
      />
    </Box>
  );

  const renderActions = () => (
    <Box sx={[(theme) => ({ display: 'flex', alignItems: 'center', p: theme.spacing(2, 3, 3, 3) })]}>
      <FormControlLabel
        control={
          <Checkbox
            checked={liked}
            onChange={handleLike}
            color="error"
            icon={<Iconify icon="solar:heart-bold" />}
            checkedIcon={<Iconify icon="solar:heart-bold" />}
            slotProps={{ input: { id: `favorite-${post.id}-checkbox`, 'aria-label': `Like post ${post.id}` } }}
          />
        }
        label={fShortenNumber(likeCount)}
        sx={{ mr: 1 }}
      />

      {!!likers.length && (
        <AvatarGroup sx={{ [`& .${avatarGroupClasses.avatar}`]: { width: 32, height: 32 } }}>
          {likers.map((person) => (
            <Avatar key={person.id} alt={person.name} src={person.avatar_url ?? undefined}>
              {person.name.charAt(0)}
            </Avatar>
          ))}
        </AvatarGroup>
      )}

      <Box sx={{ flexGrow: 1 }} />

      <IconButton
        onClick={() => {
          if (comments === null) loadComments();
          commentRef.current?.focus();
        }}
        aria-label="Comment"
      >
        <Iconify icon="solar:chat-round-dots-bold" />
        {commentCount > 0 && (
          <Typography variant="caption" sx={{ ml: 0.5 }}>
            {fShortenNumber(commentCount)}
          </Typography>
        )}
      </IconButton>

      {canShare && (
        <IconButton onClick={() => onShare(post)} aria-label="Share">
          <Iconify icon="solar:share-bold" />
        </IconButton>
      )}
    </Box>
  );

  return (
    <Card>
      {renderHead()}

      {!!post.message && (
        <Typography variant="body2" sx={[(theme) => ({ p: theme.spacing(3, 3, 2, 3), whiteSpace: 'pre-wrap' })]}>
          {post.message}
        </Typography>
      )}

      {renderShared()}
      {renderMedia(post.media)}
      {renderActions()}
      {renderCommentList()}
      {renderInput()}

      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose}>
        <MenuList>
          <MenuItem
            onClick={() => {
              menu.onClose();
              confirmDelete.onTrue();
            }}
            sx={{ color: 'error.main' }}
          >
            <Iconify icon="solar:trash-bin-trash-bold" />
            Delete post
          </MenuItem>
        </MenuList>
      </CustomPopover>

      <ConfirmDialog
        open={confirmDelete.value}
        onClose={confirmDelete.onFalse}
        title="Delete post"
        content="Delete this post and its comments?"
        action={
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              confirmDelete.onFalse();
              handleDelete();
            }}
          >
            Delete
          </Button>
        }
      />
    </Card>
  );
}
