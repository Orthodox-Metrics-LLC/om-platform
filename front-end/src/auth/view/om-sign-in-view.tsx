import { z } from 'zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useBoolean } from 'minimal-shared/hooks';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { Iconify } from 'src/components/iconify';
import { Form } from 'src/components/hook-form/form-provider';
import { RHFTextField } from 'src/components/hook-form/rhf-text-field';

import { useOmAuth } from '../context/om-auth';
import { FormHead } from '../components/form-head';

// ----------------------------------------------------------------------

const SignInSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'Email is required.' })
    .email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
});

export function OmSignInView() {
  const router = useRouter();
  const showPassword = useBoolean();
  const { signIn, user } = useOmAuth();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const methods = useForm({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: '', password: '' },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const onSubmit = handleSubmit(async (data) => {
    setErrorMessage(null);
    try {
      const signedIn = await signIn(data.email, data.password);
      // The backend tells us when a password change or onboarding step is owed.
      if (signedIn.must_change_password) {
        setErrorMessage(
          'This account must change its password before continuing. Please sign in at orthodoxmetrics.com to complete that step.'
        );
        return;
      }
      /**
       * Hand off to the dashboard, honouring ?returnTo= so a guarded deep link
       * returns the user where they were headed. AuthGuard sets that param.
       */
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      router.push(returnTo && returnTo.startsWith('/') ? returnTo : paths.dashboard.root);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Sign in failed.');
    }
  });

  if (user) {
    return <SignedInPanel />;
  }

  return (
    <>
      <FormHead
        title="Sign in to Orthodox Metrics"
        description="Use your Orthodox Metrics account. Parish accounts issued through onboarding sign in with organization credentials."
        sx={{ textAlign: { xs: 'center', md: 'left' } }}
      />

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {errorMessage}
        </Alert>
      )}

      <Form methods={methods} onSubmit={onSubmit}>
        <Stack spacing={3}>
          <RHFTextField
            name="email"
            label="Email address"
            placeholder="you@parish.org"
            autoComplete="username"
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <Box sx={{ gap: 1.5, display: 'flex', flexDirection: 'column' }}>
            <Link
              variant="body2"
              color="inherit"
              href="https://orthodoxmetrics.com/auth/forgot-password"
              sx={{ alignSelf: 'flex-end' }}
            >
              Forgot password?
            </Link>

            <RHFTextField
              name="password"
              label="Password"
              autoComplete="current-password"
              type={showPassword.value ? 'text' : 'password'}
              slotProps={{
                inputLabel: { shrink: true },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={showPassword.onToggle} edge="end">
                        <Iconify
                          icon={showPassword.value ? 'solar:eye-bold' : 'solar:eye-closed-bold'}
                        />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Box>

          <Button
            fullWidth
            size="large"
            type="submit"
            color="inherit"
            variant="contained"
            loading={isSubmitting}
            loadingIndicator="Signing in…"
          >
            Sign in
          </Button>
        </Stack>
      </Form>

      <EnrollmentPrompt />
    </>
  );
}

// ----------------------------------------------------------------------

/** Sits below the form for visitors who have no account yet. */
function EnrollmentPrompt() {
  return (
    <Box sx={{ mt: 6 }}>
      <Divider sx={{ mb: 4 }} />

      <Typography variant="h5" sx={{ mb: 1.5 }}>
        Not a member? Interested in Orthodox Metrics?
      </Typography>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        Orthodox Metrics is for parishes, cathedrals and diocesan offices that want their
        sacramental records preserved and searchable. Enrolling takes about five minutes: tell us
        where your parish is, who to speak to, and which registers you keep. We will review the
        request and a member of our team will be in touch within 48 hours to plan the digitization
        with you.
      </Typography>

      <Button
        component={RouterLink}
        href={paths.enroll}
        size="large"
        color="primary"
        variant="contained"
        endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
      >
        Enroll your parish
      </Button>
    </Box>
  );
}

// ----------------------------------------------------------------------

/**
 * Shown once authenticated. This app is the public site — it has no authenticated
 * surface of its own yet — so it confirms who signed in and hands off rather than
 * pretending to be a dashboard.
 */
function SignedInPanel() {
  const { user, signOut } = useOmAuth();

  const name =
    user?.display_name ||
    [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
    user?.email;

  return (
    <Stack spacing={3}>
      <FormHead
        title="You are signed in"
        description="Authenticated against the Orthodox Metrics backend."
        sx={{ textAlign: { xs: 'center', md: 'left' } }}
      />

      <Box
        sx={[
          (theme) => ({
            p: 3,
            borderRadius: 2,
            bgcolor: 'background.neutral',
            border: `solid 1px ${theme.vars.palette.divider}`,
          }),
        ]}
      >
        <Stack spacing={1.5}>
          <Row label="Name" value={name} />
          <Row label="Email" value={user?.email} />
          <Row label="Role" value={user?.role} strong />
          <Row label="Church ID" value={user?.church_id != null ? String(user.church_id) : '—'} />
        </Stack>
      </Box>

      <Button size="large" color="inherit" variant="outlined" onClick={signOut}>
        Sign out
      </Button>
    </Stack>
  );
}

function Row({ label, value, strong }: { label: string; value?: string | null; strong?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography
        variant={strong ? 'subtitle2' : 'body2'}
        sx={{ textAlign: 'right', color: strong ? 'primary.main' : 'text.primary' }}
      >
        {value || '—'}
      </Typography>
    </Box>
  );
}
