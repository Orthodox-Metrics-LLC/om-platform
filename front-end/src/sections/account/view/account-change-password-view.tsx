import Stack from '@mui/material/Stack';

import { AccountSessions } from '../account-sessions';
import { AccountSmsLogin } from '../account-sms-login';
import { AccountChangePassword } from '../account-change-password';

// ----------------------------------------------------------------------

export function AccountChangePasswordView() {
  return (
    <Stack spacing={3}>
      <AccountSmsLogin />
      <AccountChangePassword />
      <AccountSessions />
    </Stack>
  );
}
