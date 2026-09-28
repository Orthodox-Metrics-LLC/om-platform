import { useState } from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

import { paths } from 'src/routes/paths';
import { useRouter, useSearchParams } from 'src/routes/hooks';

import { EmailInboxIcon } from 'src/assets/icons';

import { FormHead } from '../../../components/form-head';

// ----------------------------------------------------------------------

/**
 * Post-reset confirmation for OM's real forgot-password flow.
 *
 * `POST /api/auth/forgot-password` emails a temporary password (the backend
 * always reports success to avoid user enumeration) — there is no 6-digit
 * code to verify, so the template's code field is replaced with the OM
 * instructions: sign in with the temporary password, then the forced
 * change-password step takes over. "Resend" re-issues the request.
 */
export function CenteredVerifyView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    setResendError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }
      setResent(true);
    } catch (error) {
      setResendError(error instanceof Error ? error.message : 'Could not resend. Try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <>
      <FormHead
        icon={<EmailInboxIcon />}
        title="Please check your email!"
        description={
          email
            ? `We've emailed a temporary password to ${email}. \nSign in with it and you'll be prompted to set a new password.`
            : `We've emailed a temporary password. \nSign in with it and you'll be prompted to set a new password.`
        }
      />

      <Box sx={{ gap: 3, display: 'flex', flexDirection: 'column' }}>
        {resent && <Alert severity="success">A new temporary password was sent.</Alert>}
        {resendError && <Alert severity="error">{resendError}</Alert>}

        <Button
          fullWidth
          size="large"
          color="inherit"
          variant="contained"
          onClick={() => router.push(paths.signIn)}
        >
          Return to sign in
        </Button>
      </Box>

      {email ? (
        <Box sx={{ mt: 3, typography: 'body2', alignSelf: 'center', textAlign: 'center' }}>
          {"Didn't receive it? "}
          <Link
            variant="subtitle2"
            onClick={handleResend}
            sx={{
              cursor: 'pointer',
              ...(resending && { color: 'text.disabled', pointerEvents: 'none' }),
            }}
          >
            {resending ? 'Sending…' : 'Resend'}
          </Link>
        </Box>
      ) : null}
    </>
  );
}
