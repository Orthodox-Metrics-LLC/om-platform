import type { DashboardContentProps } from 'src/layouts/dashboard';

import { removeLastSlash } from 'minimal-shared/utils';

import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import { paths } from 'src/routes/paths';
import { usePathname } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useAuthContext } from 'src/auth/hooks';
import { isPlatformRole } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/** Parish clergy and church admins configure their own parish. Platform admins too. */
export const PARISH_ACCOUNT_ROLES = [
  'super_admin',
  'admin',
  'church_admin',
  'manager',
  'priest',
] as const;

const ACCOUNT_NAV_ITEMS = [
  {
    label: 'General',
    icon: <Iconify width={24} icon="solar:user-id-bold" />,
    href: paths.dashboard.user.account,
  },
  {
    label: 'Billing',
    icon: <Iconify width={24} icon="solar:bill-list-bold" />,
    href: `${paths.dashboard.user.account}/billing`,
  },
  {
    label: 'Notifications',
    icon: <Iconify width={24} icon="solar:bell-bing-bold" />,
    href: `${paths.dashboard.user.account}/notifications`,
  },
  {
    label: 'Social links',
    icon: <Iconify width={24} icon="solar:share-bold" />,
    href: `${paths.dashboard.user.account}/socials`,
  },
  {
    label: 'Security',
    icon: <Iconify width={24} icon="ic:round-vpn-key" />,
    href: `${paths.dashboard.user.account}/change-password`,
  },
  {
    label: 'Appearance',
    icon: <Iconify width={24} icon="solar:gallery-wide-bold" />,
    href: `${paths.dashboard.user.account}/appearance`,
  },
];

const PARISH_NAV_ITEMS = [
  {
    label: 'Parish',
    icon: <Iconify width={24} icon="solar:users-group-rounded-bold" />,
    href: paths.dashboard.accountParish.root,
  },
  {
    label: 'Database mapping',
    icon: <Iconify width={24} icon="solar:box-minimalistic-bold" />,
    href: paths.dashboard.accountParish.databaseMapping,
  },
  {
    label: 'Record headers',
    icon: <Iconify width={24} icon="solar:file-text-bold" />,
    href: paths.dashboard.accountParish.recordSettings,
  },
  {
    label: 'Search',
    icon: <Iconify width={24} icon="eva:search-fill" />,
    href: paths.dashboard.accountParish.searchConfiguration,
  },
];

const OCR_NAV_ITEM = {
  label: 'OCR',
  icon: <Iconify width={24} icon="solar:settings-bold" />,
  href: paths.dashboard.accountParish.ocrPreferences,
};

function activeTabHref(pathname: string, items: Array<{ href: string }>) {
  const current = removeLastSlash(pathname);
  return (
    items
      .filter((tab) => current === tab.href || current.startsWith(`${tab.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? false
  );
}

// ----------------------------------------------------------------------

export function AccountLayout({ children, ...other }: DashboardContentProps) {
  const pathname = usePathname();
  const { user } = useAuthContext();

  const canManageParish =
    !!user?.role && (PARISH_ACCOUNT_ROLES as readonly string[]).includes(user.role);
  const navItems = [
    ...ACCOUNT_NAV_ITEMS,
    ...(canManageParish ? PARISH_NAV_ITEMS : []),
    ...(isPlatformRole(user?.role) ? [OCR_NAV_ITEM] : []),
  ];

  return (
    <DashboardContent {...other}>
      <CustomBreadcrumbs
        heading="Account"
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'User', href: paths.dashboard.user.root },
          { name: 'Account' },
        ]}
        sx={{ mb: 3 }}
      />

      <Tabs
        value={activeTabHref(pathname, navItems)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: { xs: 3, md: 5 } }}
      >
        {navItems.map((tab) => (
          <Tab
            component={RouterLink}
            key={tab.href}
            label={tab.label}
            icon={tab.icon}
            value={tab.href}
            href={tab.href}
          />
        ))}
      </Tabs>

      {children}
    </DashboardContent>
  );
}
