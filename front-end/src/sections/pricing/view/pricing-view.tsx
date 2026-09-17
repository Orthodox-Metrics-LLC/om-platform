import Container from '@mui/material/Container';

import { HomeFAQs } from 'src/sections/home/home-faqs';
import { HomePricing } from 'src/sections/home/home-pricing';

// ----------------------------------------------------------------------

/**
 * Renders the same pricing section as the home page rather than keeping a second
 * set of plans.
 *
 * The template's own pricing page shipped Minimal's `_pricingPlans` mock
 * (basic / starter / premium at $0 / $4.99 / $9.99, with features like
 * "3 prototypes" and "Up to 5 team members") plus a monthly/yearly toggle that
 * changed nothing. That contradicted the real plans on the home page, so a
 * visitor comparing the two pages saw two different prices. Reusing one source
 * means they cannot drift again.
 */
export function PricingView() {
  return (
    <Container maxWidth={false} disableGutters>
      <HomePricing />

      <HomeFAQs />
    </Container>
  );
}
