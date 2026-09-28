import Stack from '@mui/material/Stack';

import { AccountSessions } from '../account-sessions';
import { AccountChangePassword } from '../account-change-password';

// ----------------------------------------------------------------------

export function AccountChangePasswordView() {
  return (
    <Stack spacing={3}>
      <AccountChangePassword />
      <AccountSessions />
    </Stack>
  );
}
