import * as z from 'zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useBoolean } from 'minimal-shared/hooks';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';

import { paths } from 'src/routes/paths';
import { useRouter, useSearchParams } from 'src/routes/hooks';

import { SentIcon } from 'src/assets/icons';

import { Iconify } from 'src/components/iconify';
import { Form, Field, schemaUtils } from 'src/components/hook-form';

import { FormHead } from '../../../components/form-head';
import { FormResendCode } from '../../../components/form-resend-code';
import { FormReturnLink } from '../../../components/form-return-link';

// ----------------------------------------------------------------------

export type UpdatePasswordSchemaType = z.infer<typeof UpdatePasswordSchema>;

export const UpdatePasswordSchema = z
  .object({
    code: z
      .string()
      .min(1, { error: 'Code is required!' })
      .min(6, { error: 'Code must be at least 6 characters!' }),
    email: schemaUtils.email(),
    password: z
      .string()
      .min(1, { error: 'Password is required!' })
      .min(8, { error: 'Password must be at least 8 characters!' }),
    confirmPassword: z.string().min(1, { error: 'Confirm password is required!' }),
  })
  .refine((val) => val.password === val.confirmPassword, {
    error: 'Passwords do not match!',
    path: ['confirmPassword'],
  });

// ----------------------------------------------------------------------

/**
 * Final step of the OM reset flow: `POST /api/auth/reset-password-with-code`
 * re-validates the code, sets the new password, consumes the code, and revokes
 * existing sessions. Email/code arrive via query params from the verify page
 * and stay editable so a refreshed or manually opened page still works.
 */
export function CenteredUpdatePasswordView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showPassword = useBoolean();

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const defaultValues: UpdatePasswordSchemaType = {
    code: searchParams.get('code') ?? '',
    email: searchParams.get('email') ?? '',
    password: '',
    confirmPassword: '',
  };

  const methods = useForm({
    resolver: zodResolver(UpdatePasswordSchema),
    defaultValues,
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
      const res = await fetch('/api/auth/reset-password-with-code', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email.trim(),
          code: data.code.trim(),
          password: data.password,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      router.push(paths.signIn);
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

  const renderForm = () => (
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

      <Field.Text
        name="password"
        label="Password"
        placeholder="8+ characters"
        type={showPassword.value ? 'text' : 'password'}
        slotProps={{
          inputLabel: { shrink: true },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={showPassword.onToggle} edge="end">
                  <Iconify icon={showPassword.value ? 'solar:eye-bold' : 'solar:eye-closed-bold'} />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />

      <Field.Text
        name="confirmPassword"
        label="Confirm new password"
        type={showPassword.value ? 'text' : 'password'}
        slotProps={{
          inputLabel: { shrink: true },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={showPassword.onToggle} edge="end">
                  <Iconify icon={showPassword.value ? 'solar:eye-bold' : 'solar:eye-closed-bold'} />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />

      <Button
        fullWidth
        size="large"
        type="submit"
        variant="contained"
        loading={isSubmitting}
        loadingIndicator="Update password..."
      >
        Update password
      </Button>
    </Box>
  );

  return (
    <>
      <FormHead
        icon={<SentIcon />}
        title="Set a new password"
        description={`Enter the verification code we emailed you \nand choose a new password for your account.`}
      />

      <Form methods={methods} onSubmit={onSubmit}>
        {renderForm()}
      </Form>

      <FormResendCode onResendCode={handleResend} disabled={resending} />

      <FormReturnLink href={paths.signIn} />
    </>
  );
}
