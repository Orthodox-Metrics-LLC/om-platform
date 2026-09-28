import type { AccountDrawerProps } from './components/account-drawer';

import { paths } from 'src/routes/paths';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

/**
 * Account drawer menu. Every entry resolves to a real, wired page:
 * Profile/Subscription/Security/Account settings are the Account tabs backed
 * by OM's `/api/user/*` endpoints.
 */
export const _account: AccountDrawerProps['data'] = [
  { label: 'Home', href: '/', icon: <Iconify icon="solar:home-angle-bold-duotone" /> },
  {
    label: 'Profile',
    href: paths.dashboard.user.account,
    icon: <Iconify icon="custom:profile-duotone" />,
  },
  {
    label: 'Subscription',
    href: `${paths.dashboard.user.account}/billing`,
    icon: <Iconify icon="custom:invoice-duotone" />,
  },
  {
    label: 'Security',
    href: `${paths.dashboard.user.account}/change-password`,
    icon: <Iconify icon="solar:shield-keyhole-bold-duotone" />,
  },
  {
    label: 'Account settings',
    href: `${paths.dashboard.user.account}/notifications`,
    icon: <Iconify icon="solar:settings-bold-duotone" />,
  },
];
