import { useState, useEffect } from 'react';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { SplashScreen } from 'src/components/loading-screen';

import { useAuthContext } from '../hooks';

// ----------------------------------------------------------------------

type RoleRouteGuardProps = {
  allowedRoles: string[];
  children: React.ReactNode;
};

/**
 * Route-level role check. Unlike `RoleBasedGuard` (which renders inline
 * "Permission denied" copy in place), this redirects to the real 403 page —
 * for wrapping entire route subtrees (Page Builder, Menu Editor, Asset
 * Manager, Invoices, …) that an unauthorized user should not be able to load
 * at all, not just see a blocked message inside.
 *
 * Mirrors `AuthGuard`'s loading/redirect pattern; assumes it runs inside an
 * `AuthGuard` already (so `user` is present once `loading` is false).
 */
export function RoleRouteGuard({ allowedRoles, children }: RoleRouteGuardProps) {
  const router = useRouter();
  const { loading, user } = useAuthContext();

  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (loading) return;

    if (!user?.role || !allowedRoles.includes(user.role)) {
      router.replace(paths.page403);
      return;
    }

    setIsChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.role]);

  if (isChecking) {
    return <SplashScreen />;
  }

  return <>{children}</>;
}
