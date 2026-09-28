import type { ButtonProps } from '@mui/material/Button';

import { useState, useCallback } from 'react';

import Button from '@mui/material/Button';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { toast } from 'src/components/snackbar';

import { useOmAuth } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

type Props = ButtonProps & {
  onClose?: () => void;
};

/**
 * Ends the real OM session (`POST /api/auth/logout` clears the session cookie,
 * revokes the refresh token and drops the access token), then returns the user
 * to the sign-in page.
 */
export function SignOutButton({ onClose, sx, ...other }: Props) {
  const router = useRouter();
  const { signOut } = useOmAuth();
  const [busy, setBusy] = useState(false);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
      onClose?.();
      toast.success('You have been signed out');
      router.replace(paths.signIn);
    } catch (error) {
      console.error(error);
      toast.error('Unable to sign out');
    } finally {
      setBusy(false);
    }
  }, [onClose, router, signOut]);

  return (
    <Button fullWidth variant="soft" size="large" color="error" loading={busy} onClick={handleLogout} sx={sx} {...other}>
      Logout
    </Button>
  );
}
