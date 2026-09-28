import type { OmSocialProfile } from '../om-social-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';
import { usePathname, useSearchParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';
import { DashboardContent } from 'src/layouts/dashboard';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useAuthContext } from 'src/auth/hooks';
import { omRoleLabel } from 'src/auth/context/om-auth';

import { ProfileHome } from '../profile-home';
import { omSocialApi } from '../om-social-api';
import { ProfileCover } from '../profile-cover';
import { ProfileFriends } from '../profile-friends';
import { ProfileGallery } from '../profile-gallery';
import { ProfileFollowers } from '../profile-followers';

// ----------------------------------------------------------------------

const NAV_ITEMS = [
  { value: '', label: 'Profile', icon: <Iconify width={24} icon="solar:user-id-bold" /> },
  { value: 'followers', label: 'Followers', icon: <Iconify width={24} icon="solar:heart-bold" /> },
  { value: 'following', label: 'Following', icon: <Iconify width={24} icon="solar:user-plus-bold" /> },
  { value: 'friends', label: 'Friends', icon: <Iconify width={24} icon="solar:users-group-rounded-bold" /> },
  { value: 'gallery', label: 'Gallery', icon: <Iconify width={24} icon="solar:gallery-wide-bold" /> },
];

const TAB_PARAM = 'tab';
const USER_PARAM = 'user';
const DEFAULT_COVER = `${CONFIG.assetsDir}/assets/background/background-5.webp`;

// ----------------------------------------------------------------------

/**
 * `/dashboard/user/profile` shows the signed-in user's profile;
 * `?user=<id>` shows someone else's (read-only, with Follow when allowed).
 */
export function UserProfileView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user: sessionUser } = useAuthContext();

  const selectedTab = searchParams.get(TAB_PARAM) ?? '';
  const targetParam = searchParams.get(USER_PARAM);
  const targetId = targetParam ? Number(targetParam) : null;

  const [profile, setProfile] = useState<OmSocialProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [searchFriends, setSearchFriends] = useState('');

  const load = useCallback(async () => {
    try {
      setProfile(targetId ? await omSocialApi.profile(targetId) : await omSocialApi.me());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load profile');
    }
  }, [targetId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearchFriends = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchFriends(event.target.value);
  }, []);

  const createRedirectPath = (currentPath: string, tab: string) => {
    const params = new URLSearchParams();
    if (targetParam) params.set(USER_PARAM, targetParam);
    if (tab) params.set(TAB_PARAM, tab);
    const qs = params.toString();
    return qs ? `${currentPath}?${qs}` : currentPath;
  };

  const toggleFollow = async () => {
    if (!profile) return;
    setFollowBusy(true);
    try {
      if (profile.is_following) await omSocialApi.unfollow(profile.id);
      else await omSocialApi.follow(profile.id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update follow');
    } finally {
      setFollowBusy(false);
    }
  };

  // Sharing: admins/super_admins and church users may re-post to their own feed.
  const canShare = !!sessionUser;

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading={profile?.is_self ? 'My profile' : 'Profile'}
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'User', href: paths.dashboard.user.root },
          { name: profile?.name ?? '…' },
        ]}
        action={
          profile && !profile.is_self && profile.can_follow ? (
            <Button
              variant={profile.is_following ? 'outlined' : 'contained'}
              color={profile.is_following ? 'inherit' : 'primary'}
              loading={followBusy}
              onClick={toggleFollow}
              startIcon={<Iconify icon={profile.is_following ? 'eva:checkmark-fill' : 'solar:user-plus-bold'} />}
            >
              {profile.is_following ? 'Following' : 'Follow'}
            </Button>
          ) : profile?.is_self ? (
            <Button component={RouterLink} href={paths.dashboard.user.account} variant="outlined" color="inherit" startIcon={<Iconify icon="solar:pen-bold" />}>
              Edit profile
            </Button>
          ) : null
        }
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      {error && (
        <Card sx={{ p: 3 }}>
          <Typography color="error">{error}</Typography>
        </Card>
      )}

      {!error && !profile && <LinearProgress />}

      {profile && (
        <>
          <Card sx={{ height: 290 }}>
            <ProfileCover
              role={[omRoleLabel(profile.role), profile.church_name].filter(Boolean).join(' · ')}
              name={profile.name}
              avatarUrl={profile.avatar_url ?? ''}
              coverUrl={profile.banner_url || DEFAULT_COVER}
            />

            <Box
              sx={{
                width: 1,
                bottom: 0,
                zIndex: 9,
                px: { md: 3 },
                display: 'flex',
                position: 'absolute',
                bgcolor: 'background.paper',
                justifyContent: { xs: 'center', md: 'flex-end' },
              }}
            >
              <Tabs value={selectedTab} variant="scrollable" allowScrollButtonsMobile>
                {NAV_ITEMS.map((tab) => (
                  <Tab
                    component={RouterLink}
                    key={tab.value}
                    value={tab.value}
                    icon={tab.icon}
                    label={tab.label}
                    href={createRedirectPath(pathname, tab.value)}
                  />
                ))}
              </Tabs>
            </Box>
          </Card>

          {selectedTab === '' && (
            <ProfileHome key={profile.id} info={profile} canPost={profile.is_self} canShare={canShare} sx={{ mt: 3 }} />
          )}
          {selectedTab === 'followers' && <ProfileFollowers key={`fo-${profile.id}`} userId={profile.id} mode="followers" />}
          {selectedTab === 'following' && <ProfileFollowers key={`fi-${profile.id}`} userId={profile.id} mode="following" />}
          {selectedTab === 'friends' && (
            <ProfileFriends
              key={`fr-${profile.id}`}
              userId={profile.id}
              isSelf={profile.is_self}
              searchFriends={searchFriends}
              onSearchFriends={handleSearchFriends}
            />
          )}
          {selectedTab === 'gallery' && <ProfileGallery key={`ga-${profile.id}`} userId={profile.id} isSelf={profile.is_self} />}
        </>
      )}
    </DashboardContent>
  );
}
