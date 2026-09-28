import type { CardProps } from '@mui/material/Card';
import type { OmFollowUser } from './om-social-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { useAuthContext } from 'src/auth/hooks';
import { omRoleLabel } from 'src/auth/context/om-auth';

import { omSocialApi } from './om-social-api';

// ----------------------------------------------------------------------

type Props = {
  userId: number;
  mode: 'followers' | 'following';
};

export function ProfileFollowers({ userId, mode }: Props) {
  const { user } = useAuthContext();
  const [people, setPeople] = useState<OmFollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPeople(mode === 'followers' ? await omSocialApi.followers(userId) : await omSocialApi.following(userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [userId, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (p: OmFollowUser) => {
    setBusy(p.id);
    try {
      if (p.viewer_follows) await omSocialApi.unfollow(p.id);
      else await omSocialApi.follow(p.id);
      setPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, viewer_follows: !p.viewer_follows } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Typography variant="h4" sx={{ my: 5 }}>
        {mode === 'followers' ? 'Followers' : 'Following'}
      </Typography>

      <Box
        sx={{
          gap: 3,
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        }}
      >
        {people.map((p) => (
          <CardItem
            key={p.id}
            person={p}
            isSelf={Number(user?.id) === p.id}
            busy={busy === p.id}
            onToggle={() => toggle(p)}
          />
        ))}
      </Box>

      {!loading && !people.length && (
        <Typography variant="body2" sx={{ color: 'text.disabled', textAlign: 'center', py: 6 }}>
          {mode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
        </Typography>
      )}
    </>
  );
}

// ----------------------------------------------------------------------

type CardItemProps = CardProps & {
  person: OmFollowUser;
  isSelf: boolean;
  busy: boolean;
  onToggle: () => void;
};

function CardItem({ person, isSelf, busy, onToggle, sx, ...other }: CardItemProps) {
  return (
    <Card
      sx={[(theme) => ({ display: 'flex', alignItems: 'center', p: theme.spacing(3, 2, 3, 3) }), ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <Avatar
        component={RouterLink}
        href={`${paths.dashboard.user.profile}?user=${person.id}`}
        alt={person.name}
        src={person.avatar_url ?? undefined}
        sx={{ width: 48, height: 48, mr: 2, textDecoration: 'none' }}
      >
        {person.name.charAt(0).toUpperCase()}
      </Avatar>

      <ListItemText
        primary={person.name}
        secondary={
          <>
            <Iconify icon="solar:user-id-bold" width={16} sx={{ flexShrink: 0, mr: 0.5 }} />
            {[omRoleLabel(person.role), person.church_name].filter(Boolean).join(' · ')}
          </>
        }
        slotProps={{
          primary: { noWrap: true },
          secondary: {
            noWrap: true,
            sx: { mt: 0.5, display: 'flex', alignItems: 'center', typography: 'caption', color: 'text.disabled' },
          },
        }}
      />

      {!isSelf && (
        <Button
          size="small"
          loading={busy}
          variant={person.viewer_follows ? 'text' : 'outlined'}
          color={person.viewer_follows ? 'success' : 'inherit'}
          startIcon={person.viewer_follows ? <Iconify width={18} icon="eva:checkmark-fill" sx={{ mr: -0.75 }} /> : null}
          onClick={onToggle}
          sx={{ flexShrink: 0, ml: 1.5 }}
        >
          {person.viewer_follows ? 'Following' : 'Follow'}
        </Button>
      )}
    </Card>
  );
}
