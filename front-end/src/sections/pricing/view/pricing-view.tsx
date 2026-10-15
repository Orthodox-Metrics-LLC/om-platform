import type { ICheckoutItem } from 'src/types/checkout';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import { useColorScheme } from '@mui/material/styles';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';

import { MotionViewport } from 'src/components/animate';
import {
  Carousel,
  useCarousel,
  CarouselDotButtons,
  CarouselArrowBasicButtons,
} from 'src/components/carousel';

import { HomeFAQs } from 'src/sections/home/home-faqs';
import { useCheckoutContext } from 'src/sections/checkout/context';
import { SectionTitle } from 'src/sections/home/components/section-title';

// ----------------------------------------------------------------------

type PlanCard = {
  key: string;
  alt: string;
  name: string;
  planKey: string;
  /** Cart line items created when the card's Add to Cart area is clicked. */
  items: { name: string; cadence: string; price: number }[];
};

const PLAN_CARDS: PlanCard[] = [
  {
    key: 'parish',
    name: 'Parish Essentials',
    planKey: 'parish_essentials',
    alt: 'Parish Essentials plan with monthly price and onboarding fee options',
    items: [
      { name: 'Parish Essentials — Hosting & Analytics', cadence: 'Monthly', price: 8.99 },
      { name: 'Parish Essentials — Onboarding', cadence: 'One-time', price: 1250 },
    ],
  },
  {
    key: 'diocese',
    name: 'Diocesan Standard',
    planKey: 'diocesan_standard',
    alt: 'Diocesan Standard plan with monthly price and onboarding fee options',
    items: [
      { name: 'Diocesan Standard — Hosting & Analytics', cadence: 'Monthly', price: 13.99 },
      { name: 'Diocesan Standard — Onboarding', cadence: 'One-time', price: 3200 },
    ],
  },
  {
    key: 'cath-pro',
    name: 'Cathedral Pro',
    planKey: 'cathedral_pro',
    alt: 'Cathedral Pro plan with monthly price',
    items: [
      { name: 'Cathedral Pro — Hosting & Analytics', cadence: 'Monthly', price: 24.99 },
    ],
  },
];

// The Add to Cart button is baked into each card image; these rects overlay it.
// Positions differ between the light and dark artwork, so they are per-variant.
const CTA_RECT: Record<string, Record<'light' | 'dark', object>> = {
  parish: {
    light: { left: '42%', top: '57%', width: '16%', height: '12%' },
    dark: { left: '1%', top: '70%', width: '18%', height: '28%' },
  },
  diocese: {
    light: { left: '40%', top: '57%', width: '16%', height: '14%' },
    dark: { left: '1%', top: '70%', width: '18%', height: '28%' },
  },
  'cath-pro': {
    light: { left: '43%', top: '81%', width: '15%', height: '15%' },
    dark: { left: '1%', top: '70%', width: '18%', height: '28%' },
  },
};

// ----------------------------------------------------------------------

/**
 * The plans render as designed cards (one image per plan, in light and dark
 * variants) inside a carousel rather than the template's plan-card grid.
 */
function PricingCarousel() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const variant = colorScheme === 'dark' ? 'dark' : 'light';
  const { onAddToCart } = useCheckoutContext();

  const carousel = useCarousel({ loop: true, slidesToShow: 1 });

  const onAddPlan = (card: PlanCard) => {
    const coverUrl = `${CONFIG.assetsDir}/assets/images/pricing/${card.key}-${variant}.png`;
    card.items.forEach((item) =>
      onAddToCart({
        id: `${card.planKey}:${item.name}`,
        name: item.name,
        size: item.cadence,
        price: item.price,
        planKey: card.planKey,
        coverUrl,
        colors: [],
        quantity: 1,
        available: 1,
      } satisfies ICheckoutItem)
    );
    router.push(paths.product.checkout);
  };

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
                <Box key={card.key} sx={{ position: 'relative' }}>
                  <Box
                    component="img"
                    alt={card.alt}
                    src={`${CONFIG.assetsDir}/assets/images/pricing/${card.key}-${variant}.png`}
                    sx={{ width: 1, display: 'block', borderRadius: 2 }}
                  />
                  <Box
                    component="button"
                    type="button"
                    aria-label={`Add ${card.name} to cart`}
                    onClick={() => onAddPlan(card)}
                    sx={{
                      p: 0,
                      border: 0,
                      borderRadius: 1,
                      position: 'absolute',
                      cursor: 'pointer',
                      bgcolor: 'transparent',
                      ...CTA_RECT[card.key][variant],
                      '&:focus-visible': {
                        outline: '2px solid',
                        outlineColor: 'primary.main',
                      },
                    }}
                  />
                </Box>
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
    <Container maxWidth={false} disableGutters>
      <PricingCarousel />

      <HomeFAQs />
    </Container>
  );
}
