import type { OmFriendUser } from './om-social-api';

import { usePopover } from 'minimal-shared/hooks';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Card from '@mui/material/Card';
import Avatar from '@mui/material/Avatar';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { CustomPopover } from 'src/components/custom-popover';
import { SearchNotFound } from 'src/components/search-not-found';

import { omApiFetch, omRoleLabel } from 'src/auth/context/om-auth';

import { omSocialApi } from './om-social-api';

// ----------------------------------------------------------------------

type Props = {
  userId: number;
  isSelf: boolean;
  searchFriends: string;
  onSearchFriends: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

export function ProfileFriends({ userId, isSelf, searchFriends, onSearchFriends }: Props) {
  const [friends, setFriends] = useState<OmFriendUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFriends(await omSocialApi.friends(userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load friends');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const dataFiltered = applyFilter({ inputData: friends, query: searchFriends });
  const notFound = !dataFiltered.length && !!searchFriends;

  return (
    <>
      <Box sx={{ my: 5, gap: 2, display: 'flex', justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' } }}>
        <Typography variant="h4">Friends</Typography>

        <TextField
          value={searchFriends}
          onChange={onSearchFriends}
          placeholder="Search friends..."
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: { xs: 1, sm: 260 } }}
        />
      </Box>

      {notFound ? (
        <SearchNotFound query={searchFriends} sx={{ py: 10 }} />
      ) : (
        <Box sx={{ gap: 3, display: 'grid', gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
          {dataFiltered.map((item) => (
            <FriendCard key={item.id} item={item} canRemove={isSelf} onRemoved={load} />
          ))}
        </Box>
      )}

      {!loading && !friends.length && !searchFriends && (
        <Typography variant="body2" sx={{ color: 'text.disabled', textAlign: 'center', py: 6 }}>
          {isSelf ? 'No friends yet — find people under Contacts › Discover.' : 'No friends to show.'}
        </Typography>
      )}
    </>
  );
}

// ----------------------------------------------------------------------

function FriendCard({ item, canRemove, onRemoved }: { item: OmFriendUser; canRemove: boolean; onRemoved: () => void }) {
  const menuActions = usePopover();

  const handleRemove = async () => {
    menuActions.onClose();
    try {
      const res = await omApiFetch(`/api/social/friends/${item.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) throw new Error(json?.message || 'Could not remove');
      toast.success(`${item.name} removed from friends`);
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove');
    }
  };

  return (
    <>
      <Card sx={{ py: 5, display: 'flex', position: 'relative', alignItems: 'center', flexDirection: 'column' }}>
        <Avatar alt={item.name} src={item.avatar_url ?? undefined} sx={{ width: 64, height: 64, mb: 3 }}>
          {item.name.charAt(0).toUpperCase()}
        </Avatar>

        <Link component={RouterLink} href={`${paths.dashboard.user.profile}?user=${item.id}`} variant="subtitle1" sx={{ color: 'text.primary' }}>
          {item.name}
        </Link>

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1, mt: 0.5 }}>
          {item.job_title || omRoleLabel(item.role)}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Label variant="soft" color={item.role === 'admin' || item.role === 'super_admin' ? 'info' : 'default'}>
            {omRoleLabel(item.role)}
          </Label>
          {item.church_name && (
            <Label variant="soft" color="default">
              {item.church_name}
            </Label>
          )}
        </Box>

        {canRemove && (
          <IconButton color={menuActions.open ? 'inherit' : 'default'} onClick={menuActions.onOpen} sx={{ top: 8, right: 8, position: 'absolute' }}>
            <Iconify icon="eva:more-vertical-fill" />
          </IconButton>
        )}
      </Card>

      <CustomPopover open={menuActions.open} anchorEl={menuActions.anchorEl} onClose={menuActions.onClose} slotProps={{ arrow: { placement: 'right-top' } }}>
        <MenuList>
          <MenuItem component={RouterLink} href={`${paths.dashboard.user.profile}?user=${item.id}`} onClick={menuActions.onClose}>
            <Iconify icon="solar:user-id-bold" />
            View profile
          </MenuItem>
          <MenuItem onClick={handleRemove} sx={{ color: 'error.main' }}>
            <Iconify icon="solar:trash-bin-trash-bold" />
            Remove friend
          </MenuItem>
        </MenuList>
      </CustomPopover>
    </>
  );
}

// ----------------------------------------------------------------------

function applyFilter({ inputData, query }: { inputData: OmFriendUser[]; query: string }) {
  if (!query) return inputData;
  const q = query.toLowerCase();
  return inputData.filter(
    (f) => f.name.toLowerCase().includes(q) || omRoleLabel(f.role).toLowerCase().includes(q) || (f.church_name ?? '').toLowerCase().includes(q)
  );
}
