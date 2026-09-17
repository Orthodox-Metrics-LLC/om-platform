import { useEffect } from 'react';

import Stack from '@mui/material/Stack';

import { usePathname } from 'src/routes/hooks';

import { BackToTopButton } from 'src/components/animate/back-to-top-button';
import { ScrollProgress, useScrollProgress } from 'src/components/animate/scroll-progress';

import { HomeHero } from '../home-hero';
import { HomeFAQs } from '../home-faqs';
import { HomeMinimal } from '../home-minimal';
import { HomePricing } from '../home-pricing';
import { HomeProducts } from '../home-products';
import { sectionIdForPath } from '../landing-sections';
import { HomeForDesigner } from '../home-for-designer';
import { HomeTestimonials } from '../home-testimonials';
import { HomeIntegrations } from '../home-integrations';
import { HomeAdvertisement } from '../home-advertisement';
import { HomeHugePackElements } from '../home-hugepack-elements';
import { HomeHighlightFeatures } from '../home-highlight-features';

// ----------------------------------------------------------------------

export function HomeView() {
  const pageProgress = useScrollProgress();

  useScrollToLandingSection();

  return (
    <>
      <ScrollProgress
        variant="linear"
        progress={pageProgress.scrollYProgress}
        sx={[(theme) => ({ position: 'fixed', zIndex: theme.zIndex.appBar + 1 })]}
      />

      <BackToTopButton />

      {/* Section ids match OM's landing anchors so /product, /records, /ocr,
          /capabilities and /analytics can deep-link into this page. */}
      <HomeHero id="product" />

      <Stack sx={{ position: 'relative', bgcolor: 'background.default' }}>
        <HomeMinimal />

        <HomeHugePackElements id="record-capabilities" />

        <HomeForDesigner id="paper-to-digital" />

        <HomeHighlightFeatures id="history-insight" />

        <HomeIntegrations />

        <HomePricing id="pricing" />

        <HomeTestimonials />

        <HomeFAQs id="faq" />

        <HomeProducts />

        <HomeAdvertisement id="final-cta" />
      </Stack>
    </>
  );
}

// ----------------------------------------------------------------------

/**
 * Scrolls to the section this path deep-links to. Runs after mount so the
 * sections exist, and skips `/` and `/product` (which land at the top anyway).
 */
function useScrollToLandingSection() {
  const pathname = usePathname();

  useEffect(() => {
    const sectionId = sectionIdForPath(pathname);
    if (sectionId === 'product') return undefined;

    // Two frames: one for the section tree, one for layout to settle.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const section = document.getElementById(sectionId);
        if (!section) return;

        /**
         * `scrollIntoView` would put the section flush with the viewport top,
         * where the fixed header covers its heading. Offset by the header's own
         * height instead of hard-coding a number.
         */
        const headerHeight =
          parseInt(
            getComputedStyle(document.documentElement).getPropertyValue(
              '--layout-header-desktop-height'
            ),
            10
          ) || 72;

        window.scrollTo({
          top: section.getBoundingClientRect().top + window.scrollY - headerHeight,
        });
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [pathname]);
}
