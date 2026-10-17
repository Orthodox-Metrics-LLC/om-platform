import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useSearchParams } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

export default function VerifyEmailPage() {
  const token = useSearchParams().get('token') || '';
  const [message, setMessage] = useState('Confirming your email…');
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) {
      setConfirmed(false);
      setMessage('This confirmation link is missing its token.');
      return undefined;
    }
    let live = true;
    omApiFetch('/api/user/profile/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!live) return;
        setConfirmed(Boolean(res.ok && data?.success));
        setMessage(data?.message || 'This confirmation link could not be used.');
      })
      .catch(() => {
        if (!live) return;
        setConfirmed(false);
        setMessage('This confirmation link could not be used.');
      });
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <Box sx={{ p: 5, maxWidth: 560, mx: 'auto', textAlign: 'center' }}>
      <Typography variant="h4">
        {confirmed ? 'Email confirmed' : confirmed === false ? 'Email not confirmed' : 'Confirming email'}
      </Typography>
      <Typography sx={{ mt: 2 }}>{message}</Typography>
      <Button component={RouterLink} href={paths.signIn} variant="contained" sx={{ mt: 3 }}>
        Sign in
      </Button>
    </Box>
  );
}
