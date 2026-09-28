import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useAuthContext } from 'src/auth/hooks';
import { RoleBasedGuard } from 'src/auth/guard';

import { UserCreateEditForm } from '../user-create-edit-form';

// ----------------------------------------------------------------------

/** New accounts are created by super admins (admins may add church-role users). */
export function UserCreateView() {
  const { user } = useAuthContext();

  return (
    <RoleBasedGuard hasContent currentRole={user?.role} allowedRoles={['super_admin', 'admin']}>
      <DashboardContent>
        <CustomBreadcrumbs
          heading="Create a new user"
          backHref={paths.dashboard.user.list}
          links={[
            { name: 'Dashboard', href: paths.dashboard.root },
            { name: 'User', href: paths.dashboard.user.list },
            { name: 'Create' },
          ]}
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        <UserCreateEditForm />
      </DashboardContent>
    </RoleBasedGuard>
  );
}
