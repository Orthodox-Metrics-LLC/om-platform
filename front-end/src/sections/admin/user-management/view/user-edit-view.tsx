import type { OmAdminUser } from '../om-users-api';

import { useState, useEffect, useCallback } from 'react';

import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useAuthContext } from 'src/auth/hooks';
import { RoleBasedGuard } from 'src/auth/guard';

import { omUsersApi, userFullName } from '../om-users-api';
import { UserCreateEditForm } from '../user-create-edit-form';

// ----------------------------------------------------------------------

type Props = {
  id: string;
};

export function UserEditView({ id }: Props) {
  const { user: actor } = useAuthContext();

  const [currentUser, setCurrentUser] = useState<OmAdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCurrentUser(await omUsersApi.get(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load user');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <RoleBasedGuard hasContent currentRole={actor?.role} allowedRoles={['super_admin', 'admin']}>
      <DashboardContent>
        <CustomBreadcrumbs
          heading="Edit"
          backHref={paths.dashboard.user.list}
          links={[
            { name: 'Dashboard', href: paths.dashboard.root },
            { name: 'User', href: paths.dashboard.user.list },
            { name: currentUser ? userFullName(currentUser) : '…' },
          ]}
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        {error ? (
          <Card sx={{ p: 3 }}>
            <Typography color="error">{error}</Typography>
          </Card>
        ) : currentUser ? (
          <UserCreateEditForm key={currentUser.id} currentUser={currentUser} onSaved={load} />
        ) : (
          <LinearProgress />
        )}
      </DashboardContent>
    </RoleBasedGuard>
  );
}
