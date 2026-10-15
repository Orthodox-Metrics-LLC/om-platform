import { useState } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { fCurrency } from 'src/utils/format-number';

import { Iconify } from 'src/components/iconify';

import { useCheckoutContext } from './context';
import { CheckoutSummary } from './checkout-summary';

// ----------------------------------------------------------------------

export function CheckoutPayment() {
  const { onChangeStep, state: checkoutState } = useCheckoutContext();

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const planKeys = [...new Set(checkoutState.items.map((item) => item.planKey).filter(Boolean))];
  const isCartEmpty = !checkoutState.items.length;

  const onPay = async () => {
    try {
      setError('');
      setSubmitting(true);

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans: planKeys }),
      });
      const data = await response.json();

      if (!response.ok || !data?.url) {
        throw new Error(data?.error || 'Checkout is unavailable right now.');
      }

      window.location.assign(data.url);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Checkout is unavailable right now.');
    }
  };

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 8 }}>
        <Card>
          <CardHeader title="Payment" />

          <Stack spacing={2.5} sx={{ p: 3 }}>
            {checkoutState.items.map((item) => (
              <Box key={item.id} sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
                  {item.name}
                </Typography>
                <Typography variant="subtitle2">
                  {fCurrency(item.price)}
                  {item.size === 'Monthly' ? '/mo' : ''}
                </Typography>
              </Box>
            ))}

            {!isCartEmpty && <Divider sx={{ borderStyle: 'dashed' }} />}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Iconify icon="solar:shield-check-bold" width={28} sx={{ color: 'primary.main' }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                You will be redirected to Stripe to complete your purchase securely. Monthly hosting
                is billed as a subscription; onboarding is a one-time fee charged today.
              </Typography>
            </Box>

            {!!error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Card>

        <Button
          size="small"
          color="inherit"
          onClick={() => onChangeStep('back')}
          startIcon={<Iconify icon="eva:arrow-ios-back-fill" />}
        >
          Back
        </Button>
      </Grid>

      <Grid size={{ xs: 12, md: 4 }}>
        <CheckoutSummary checkoutState={checkoutState} onEdit={() => onChangeStep('go', 0)} />

        <Button
          fullWidth
          size="large"
          variant="contained"
          loading={submitting}
          disabled={isCartEmpty}
          onClick={onPay}
        >
          Pay with Stripe
        </Button>
      </Grid>
    </Grid>
  );
}
