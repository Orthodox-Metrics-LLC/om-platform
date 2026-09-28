import type { GridProps } from '@mui/material/Grid';
import type { OmPost, OmMedia, OmSocialProfile } from './om-social-api';

import { varAlpha } from 'minimal-shared/utils';
import { useRef, useState, useEffect, useCallback } from 'react';

import Fab from '@mui/material/Fab';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import InputBase from '@mui/material/InputBase';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { fDate } from 'src/utils/format-time';
import { fNumber } from 'src/utils/format-number';

import { Image } from 'src/components/image';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { omRoleLabel } from 'src/auth/context/om-auth';

import { omSocialApi } from './om-social-api';
import { ProfilePostItem } from './profile-post-item';

// ----------------------------------------------------------------------

type Props = GridProps & {
  info: OmSocialProfile;
  /** Whether the viewer may create posts on this profile (own profile only). */
  canPost: boolean;
  /** Whether the viewer may share posts (admins/super_admins and church users). */
  canShare: boolean;
};

const VISIBILITY = [
  { value: 'public', label: 'Public', icon: 'solar:users-group-rounded-bold' },
  { value: 'friends_only', label: 'Friends only', icon: 'solar:heart-bold' },
  { value: 'private', label: 'Only me', icon: 'solar:lock-password-outline' },
] as const;

export function ProfileHome({ info, canPost, canShare, sx, ...other }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [posts, setPosts] = useState<OmPost[]>([]);
  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState('');
  const [visibility, setVisibility] = useState<OmPost['visibility']>('public');
  const [attachments, setAttachments] = useState<OmMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [shareOf, setShareOf] = useState<OmPost | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPosts(await omSocialApi.posts(info.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load posts');
    } finally {
      setLoading(false);
    }
  }, [info.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await omSocialApi.upload(files, 'post');
      setAttachments((prev) => [...prev, ...uploaded.map((f) => ({ url: f.url, kind: f.kind }))]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handlePost = async () => {
    if (!message.trim() && !attachments.length && !shareOf) return;
    setPosting(true);
    try {
      const post = await omSocialApi.createPost({
        message: message.trim(),
        media: attachments,
        visibility,
        ...(shareOf && { shared_from: shareOf.id }),
      });
      setPosts((prev) => [post, ...prev]);
      setMessage('');
      setAttachments([]);
      setShareOf(null);
      toast.success(shareOf ? 'Post shared' : 'Posted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post');
    } finally {
      setPosting(false);
    }
  };

  const handleShare = (post: OmPost) => {
    setShareOf(post);
    document.getElementById('post-input')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderFollows = () => (
    <Card sx={{ py: 3, textAlign: 'center', typography: 'h4' }}>
      <Stack divider={<Divider orientation="vertical" flexItem sx={{ borderStyle: 'dashed' }} />} sx={{ flexDirection: 'row' }}>
        <Stack sx={{ width: 1 }}>
          {fNumber(info.followers_count)}
          <Box component="span" sx={{ color: 'text.secondary', typography: 'body2' }}>
            Followers
          </Box>
        </Stack>
        <Stack sx={{ width: 1 }}>
          {fNumber(info.following_count)}
          <Box component="span" sx={{ color: 'text.secondary', typography: 'body2' }}>
            Following
          </Box>
        </Stack>
        <Stack sx={{ width: 1 }}>
          {fNumber(info.posts_count)}
          <Box component="span" sx={{ color: 'text.secondary', typography: 'body2' }}>
            Posts
          </Box>
        </Stack>
      </Stack>
    </Card>
  );

  const row = (icon: string, content: React.ReactNode) => (
    <Box sx={{ gap: 2, display: 'flex', lineHeight: '24px', alignItems: 'flex-start' }}>
      <Iconify width={24} icon={icon as any} sx={{ flexShrink: 0 }} />
      <span>{content}</span>
    </Box>
  );

  const renderAbout = () => (
    <Card>
      <CardHeader title="About" />
      <Box sx={{ p: 3, gap: 2, display: 'flex', typography: 'body2', flexDirection: 'column' }}>
        {info.bio && <div>{info.bio}</div>}
        {info.location && row('mingcute:location-fill', <>Lives in <strong>{info.location}</strong></>)}
        {(info.is_self || info.is_friend) && row('solar:letter-bold', info.email)}
        {row(
          'solar:user-id-bold',
          <>
            {info.job_title ? <>{info.job_title} · </> : null}
            <strong>{omRoleLabel(info.role)}</strong>
          </>
        )}
        {info.church_name &&
          row(
            'custom:cross-bold',
            <>
              Member of <strong>{info.church_name}</strong>
            </>
          )}
        {info.church_affiliation && row('solar:flag-bold', info.church_affiliation)}
        {info.website &&
          row(
            'eva:link-2-fill',
            <Link href={info.website} target="_blank" rel="noopener" color="inherit">
              {info.website.replace(/^https?:\/\//, '')}
            </Link>
          )}
        {row('solar:calendar-date-bold', <>Member since {fDate(info.member_since)}</>)}
      </Box>
    </Card>
  );

  const renderPostInput = () => (
    <Card sx={{ p: 3 }}>
      {shareOf && (
        <Box
          sx={{
            p: 1.5,
            mb: 2,
            gap: 1.5,
            display: 'flex',
            borderRadius: 1,
            alignItems: 'center',
            bgcolor: 'background.neutral',
          }}
        >
          <Iconify icon="solar:share-bold" />
          <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
            Sharing <strong>{shareOf.author.name}</strong>: {shareOf.message || 'media post'}
          </Typography>
          <IconButton size="small" onClick={() => setShareOf(null)}>
            <Iconify icon="mingcute:close-line" width={18} />
          </IconButton>
        </Box>
      )}

      <InputBase
        multiline
        fullWidth
        rows={4}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={shareOf ? 'Add a comment to your share…' : 'Share what you are thinking here...'}
        inputProps={{ id: 'post-input' }}
        sx={[
          (theme) => ({
            p: 2,
            mb: 2,
            borderRadius: 1,
            border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
          }),
        ]}
      />

      {!!attachments.length && (
        <Box sx={{ mb: 2, gap: 1, display: 'flex', flexWrap: 'wrap' }}>
          {attachments.map((m) => (
            <Box key={m.url} sx={{ position: 'relative', width: 96, height: 96 }}>
              {m.kind === 'video' ? (
                <Box component="video" src={m.url} muted sx={{ width: 1, height: 1, borderRadius: 1, objectFit: 'cover', bgcolor: 'common.black' }} />
              ) : (
                <Image src={m.url} alt="" ratio="1/1" sx={{ borderRadius: 1 }} />
              )}
              <IconButton
                size="small"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.url !== m.url))}
                sx={{ top: 2, right: 2, position: 'absolute', bgcolor: 'rgba(0,0,0,0.5)', color: 'common.white', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
              >
                <Iconify icon="mingcute:close-line" width={14} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ gap: 1, display: 'flex', alignItems: 'center' }}>
          <Fab size="small" color="inherit" variant="softExtended" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Iconify icon="solar:gallery-wide-bold" width={24} sx={{ color: 'success.main' }} />
            {uploading ? 'Uploading…' : 'Image/Video'}
          </Fab>

          <TextField
            select
            size="small"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as OmPost['visibility'])}
            slotProps={{ select: { renderValue: (v) => VISIBILITY.find((o) => o.value === v)?.label } }}
            sx={{ minWidth: 140 }}
          >
            {VISIBILITY.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                <Iconify icon={o.icon} width={18} sx={{ mr: 1 }} />
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Button variant="contained" onClick={handlePost} loading={posting} disabled={!message.trim() && !attachments.length && !shareOf}>
          {shareOf ? 'Share' : 'Post'}
        </Button>
      </Box>

      <input ref={fileRef} type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} onChange={handleFiles} />
    </Card>
  );

  return (
    <Grid container spacing={3} sx={sx} {...other}>
      <Grid size={{ xs: 12, md: 4 }} sx={{ gap: 3, display: 'flex', flexDirection: 'column' }}>
        {renderFollows()}
        {renderAbout()}
      </Grid>

      <Grid size={{ xs: 12, md: 8 }} sx={{ gap: 3, display: 'flex', flexDirection: 'column' }}>
        {canPost && renderPostInput()}

        {posts.map((post) => (
          <ProfilePostItem
            key={post.id}
            post={post}
            canShare={canShare && canPost}
            onShare={handleShare}
            onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
          />
        ))}

        {!loading && !posts.length && (
          <Card sx={{ p: 5, textAlign: 'center', color: 'text.disabled', typography: 'body2' }}>
            {canPost ? 'Nothing posted yet — share your first update above.' : 'No posts to show.'}
          </Card>
        )}
      </Grid>
    </Grid>
  );
}
