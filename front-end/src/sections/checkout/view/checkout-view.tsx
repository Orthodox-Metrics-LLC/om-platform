import { useEffect } from 'react';

import Grid from '@mui/material/Grid';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { PublicPageBuilderOverride } from 'src/sections/latest-news/public-page-builder-override';

import { CheckoutCart } from '../checkout-cart';
import { useCheckoutContext } from '../context';
import { CheckoutSteps } from '../checkout-steps';
import { CheckoutPayment } from '../checkout-payment';
import { CheckoutOrderComplete } from '../checkout-order-complete';

// ----------------------------------------------------------------------

export function CheckoutView() {
  const { steps, activeStep, completed, onResetCart } = useCheckoutContext();

  // Stripe returns to the "complete" step — clear the cart so a refresh of the
  // checkout page does not reshow the purchased items.
  useEffect(() => {
    if (completed) onResetCart();
  }, [completed, onResetCart]);

  return (
    <PublicPageBuilderOverride
      pageType="checkout"
      fallback={
    <Container sx={{ mb: 10 }}>
      <Typography variant="h4" sx={{ my: { xs: 3, md: 5 } }}>
        Checkout
      </Typography>

      <Grid container sx={{ justifyContent: completed ? 'center' : 'flex-start' }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <CheckoutSteps steps={steps} activeStep={activeStep ?? 0} />
        </Grid>
      </Grid>

      <>
        {activeStep === 0 && <CheckoutCart />}

        {activeStep === 1 && <CheckoutPayment />}

        {completed && (
          <CheckoutOrderComplete open onResetCart={onResetCart} />
        )}
      </>
    </Container>
      }
    />
  );
}
