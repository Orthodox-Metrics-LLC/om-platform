import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import { useTheme } from '@mui/material/styles';

import { CONFIG } from 'src/global-config';

import { MotionViewport } from 'src/components/animate';
import {
  Carousel,
  useCarousel,
  CarouselDotButtons,
  CarouselArrowBasicButtons,
} from 'src/components/carousel';

import { HomeFAQs } from 'src/sections/home/home-faqs';
import { SectionTitle } from 'src/sections/home/components/section-title';
import { PublicPageBuilderOverride } from 'src/sections/latest-news/public-page-builder-override';

// ----------------------------------------------------------------------

/**
 * The plans render as designed cards (one image per plan, in light and dark
 * variants) inside a carousel rather than the template's plan-card grid.
 */
function PricingCarousel() {
  const theme = useTheme();
  const variant = theme.palette.mode === 'dark' ? 'dark' : 'light';

  const carousel = useCarousel({ loop: true, slidesToShow: 1 });

  return (
    <Box component="section" sx={{ py: 10, position: 'relative' }}>
      <MotionViewport>
        <Container>
          <SectionTitle
            caption="plans"
            title="Flexible plans designed to"
            txtGradient="scale"
            description="From small rural parishes to cathedral archives — one-time digitization for your historic books, plus affordable monthly hosting for a living sacramental registry."
            sx={{ mb: 8, textAlign: 'center' }}
          />

          <Box sx={{ position: 'relative', maxWidth: 1080, mx: 'auto' }}>
            <Carousel carousel={carousel}>
              {PLAN_CARDS.map((card) => (
                <Box
                  key={card.key}
                  component="img"
                  alt={card.alt}
                  src={`${CONFIG.assetsDir}/assets/images/pricing/${card.key}-${variant}.png`}
                  sx={{ width: 1, display: 'block', borderRadius: 2 }}
                />
              ))}
            </Carousel>

            <Box
              sx={{
                mt: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <CarouselDotButtons
                variant="rounded"
                scrollSnaps={carousel.dots.scrollSnaps}
                selectedIndex={carousel.dots.selectedIndex}
                onClickDot={carousel.dots.onClickDot}
              />

              <CarouselArrowBasicButtons {...carousel.arrows} options={carousel.options} />
            </Box>
          </Box>
        </Container>
      </MotionViewport>
    </Box>
  );
}

export function PricingView() {
  return (
    <PublicPageBuilderOverride
      pageType="pricing"
      fallback={
        <Container maxWidth={false} disableGutters>
          <PricingCarousel />

          <HomeFAQs />
        </Container>
      }
    />
  );
}

// ----------------------------------------------------------------------

const PLAN_CARDS = [
  { key: 'parish', alt: 'Parish Essentials plan with monthly price and onboarding fee options' },
  { key: 'diocese', alt: 'Diocesan Standard plan with monthly price and onboarding fee options' },
  { key: 'cath-pro', alt: 'Cathedral Pro plan with monthly price and onboarding fee options' },
];
