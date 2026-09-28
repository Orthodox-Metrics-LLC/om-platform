import * as z from 'zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

import { paths } from 'src/routes/paths';
import { useRouter, useSearchParams } from 'src/routes/hooks';

import { EmailInboxIcon } from 'src/assets/icons';

import { Form, Field, schemaUtils } from 'src/components/hook-form';

import { FormHead } from '../../../components/form-head';
import { FormResendCode } from '../../../components/form-resend-code';
import { FormReturnLink } from '../../../components/form-return-link';

// ----------------------------------------------------------------------

export type VerifySchemaType = z.infer<typeof VerifySchema>;

export const VerifySchema = z.object({
  email: schemaUtils.email(),
  code: z
    .string()
    .min(1, { error: 'Code is required!' })
    .min(6, { error: 'Code must be at least 6 characters!' }),
});

// ----------------------------------------------------------------------

/**
 * Verifies the 6-digit code emailed by `POST /api/auth/forgot-password-code`.
 * On success the user is sent to the update-password page carrying email+code
 * so the final reset step can consume the code.
 */
export function CenteredVerifyView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email') ?? '';

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const methods = useForm<VerifySchemaType>({
    resolver: zodResolver(VerifySchema),
    defaultValues: { email: emailParam, code: '' },
  });

  const {
    watch,
    setError,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const currentEmail = watch('email');

  const onSubmit = handleSubmit(async (data) => {
    try {
      const res = await fetch('/api/auth/verify-password-reset-code', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email.trim(), code: data.code.trim() }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      router.push(
        `${paths.authDemo.centered.updatePassword}?email=${encodeURIComponent(
          data.email.trim()
        )}&code=${encodeURIComponent(data.code.trim())}`
      );
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Something went wrong. Try again.',
      });
    }
  });

  const handleResend = async () => {
    const email = currentEmail?.trim();
    if (!email) {
      setError('email', { message: 'Enter your email address to resend the code.' });
      return;
    }
    setResending(true);
    setResent(false);
    try {
      const res = await fetch('/api/auth/forgot-password-code', {
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
      setError('root', {
        message: error instanceof Error ? error.message : 'Could not resend. Try again.',
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <>
      <FormHead
        icon={<EmailInboxIcon />}
        title="Please check your email!"
        description={`We've emailed a 6-digit verification code. \nEnter the code below to verify your email address.`}
      />

      <Form methods={methods} onSubmit={onSubmit}>
        <Box sx={{ gap: 3, display: 'flex', flexDirection: 'column' }}>
          {methods.formState.errors.root?.message && (
            <Alert severity="error">{methods.formState.errors.root.message}</Alert>
          )}
          {resent && <Alert severity="success">A new verification code was sent.</Alert>}

          <Field.Text
            name="email"
            label="Email address"
            placeholder="example@gmail.com"
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <Field.Code name="code" />

          <Button
            fullWidth
            size="large"
            type="submit"
            variant="contained"
            loading={isSubmitting}
            loadingIndicator="Verify..."
          >
            Verify
          </Button>
        </Box>
      </Form>

      <FormResendCode onResendCode={handleResend} disabled={resending} />

      <FormReturnLink href={paths.signIn} />
    </>
  );
}
