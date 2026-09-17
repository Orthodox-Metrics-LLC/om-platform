import Box from '@mui/material/Box';
import Container from '@mui/material/Container';

import { HomeFAQs } from 'src/sections/home/home-faqs';
import { ContactForm } from 'src/sections/contact/contact-form';

// ----------------------------------------------------------------------

/**
 * Renders the home page's FAQ section rather than a second set of questions.
 *
 * The template's version drove this page from Minimal's `_faqs` mock, and paired
 * it with a category row whose icons were e-commerce concepts (delivery, payment,
 * refund, package) that do not apply to Orthodox Metrics, plus a stock hero
 * photograph. One source of questions means the two pages cannot disagree.
 *
 * The "still have questions" form is the real contact form rather than the
 * template's `FaqsForm`, which had no submit handler at all.
 */
export function FaqsView() {
  return (
    <>
      <HomeFAQs />

      <Container component="section" sx={{ pb: { xs: 10, md: 15 } }}>
        <Box sx={{ maxWidth: 640, mx: 'auto' }}>
          <ContactForm />
        </Box>
      </Container>
    </>
  );
}
