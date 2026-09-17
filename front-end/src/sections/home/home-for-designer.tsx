import type { BoxProps } from '@mui/material/Box';

import { m, useInView } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';
import { useRef, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { Iconify } from 'src/components/iconify';
import { varFade, AnimateBorder, MotionViewport } from 'src/components/animate';

import { SectionTitle } from './components/section-title';

// ----------------------------------------------------------------------

const CLIPS = [
  { src: 'preserve-1', alt: 'Gloved hands opening a bound parish register' },
  { src: 'preserve-2', alt: 'A register being scanned beside a monitor' },
  { src: 'preserve-3', alt: 'A priest working through records on screen' },
  { src: 'preserve-4', alt: 'A clergyman turning the pages of a handwritten register' },
] as const;

export function HomeForDesigner({ sx, ...other }: BoxProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.35 });

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  /** Index of the clip currently playing; -1 once the sequence has finished. */
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  /** Guards against restarting the sequence if the section re-enters view. */
  const hasStarted = useRef(false);

  useEffect(() => {
    if (isInView && !hasStarted.current) {
      hasStarted.current = true;
      setActiveIndex(0);
    }
  }, [isInView]);

  // Play whichever clip just became active. Muted + playsInline so the browser
  // allows it without a user gesture.
  useEffect(() => {
    if (activeIndex < 0) return;
    videoRefs.current[activeIndex]?.play().catch(() => {
      // Autoplay refused — leave the poster frame in place rather than stalling
      // the whole sequence.
      setActiveIndex((current) => (current === activeIndex ? current + 1 : current));
    });
  }, [activeIndex]);

  /** Hand over to the next clip. Stops after the fourth — no looping. */
  const handleEnded = useCallback((index: number) => {
    setActiveIndex((current) => (current === index ? index + 1 : current));
  }, []);

  /**
   * Each clip is an inset card floating on the section's dark ground rather than
   * filling its quadrant. The first quadrant also carries the copy, so its clip
   * is pushed to the right to leave room for it.
   */
  const renderQuadrant = (clip: (typeof CLIPS)[number], index: number) => (
    <Box
      key={clip.src}
      sx={{
        display: 'flex',
        alignItems: 'center',
        px: { xs: 2, md: 4 },
        aspectRatio: { xs: 16 / 10, md: 2.6 },
        justifyContent: index === 0 ? { xs: 'center', md: 'flex-end' } : 'center',
      }}
    >
      <Box
        component="video"
        ref={(node: HTMLVideoElement | null) => {
          videoRefs.current[index] = node;
        }}
        muted
        playsInline
        preload="metadata"
        poster={`${CONFIG.assetsDir}/assets/video/preserve/${clip.src}-poster.webp`}
        onEnded={() => handleEnded(index)}
        aria-label={clip.alt}
        sx={{
          display: 'block',
          objectFit: 'cover',
          width: { xs: '92%', md: '48%' },
          aspectRatio: 16 / 9,
          // The clip that has not run yet sits back; the active one comes forward.
          opacity: activeIndex === index ? 1 : 0.5,
          transition: (theme) =>
            theme.transitions.create(['opacity'], { duration: theme.transitions.duration.complex }),
        }}
      >
        <source
          src={`${CONFIG.assetsDir}/assets/video/preserve/${clip.src}.mp4`}
          type="video/mp4"
        />
      </Box>
    </Box>
  );

  const renderCopy = () => (
    <Stack
      spacing={4}
      sx={[
        (theme) => ({
          px: 3,
          py: 10,
          zIndex: 2,
          position: 'relative',
          alignItems: 'center',
          [theme.breakpoints.up('md')]: {
            px: 8,
            py: 0,
            top: 0,
            left: 0,
            position: 'absolute',
            alignItems: 'flex-start',
            justifyContent: 'center',
            // Held back from the first quadrant's clip so the heading does not
            // run underneath it.
            width: 'min(calc(50% + 16px), 450px)',
            height: 'calc(50% + 16px)',
          },
        }),
      ]}
    >
      <SectionTitle
        caption="from paper to digital"
        title="Preserve the original"
        description="Parish registers are historical evidence, not disposable input. Orthodox Metrics keeps the source beside the structured record so digitization improves access without erasing provenance."
        sx={[
          () => ({
            zIndex: 1,
            textAlign: { xs: 'center', md: 'left' },
            alignItems: { xs: 'center', md: 'flex-start' },
          }),
        ]}
        slotProps={{
          caption: {
            sx: [
              (theme) => ({
                ...theme.mixins.textGradient(
                  `to right, ${theme.vars.palette.common.white}, ${varAlpha(theme.vars.palette.common.whiteChannel, 0.2)}`
                ),
              }),
            ],
          },
          title: {
            sx: [
              (theme) => ({
                ...theme.mixins.textGradient(
                  `135deg, ${theme.vars.palette.warning.main}, ${theme.vars.palette.primary.main}`
                ),
                // Sized to stay on one line in the room left beside the clip.
                [theme.breakpoints.up('md')]: { fontSize: theme.typography.pxToRem(34) },
              }),
            ],
          },
          description: { sx: { maxWidth: 320, color: 'common.white' } },
        }}
      />

      <Box
        component={m.div}
        variants={varFade('inLeft', { distance: 24 })}
        sx={{ alignSelf: { md: 'flex-end' } }}
      >
        {renderActionButton()}
      </Box>
    </Stack>
  );

  return (
    <Box
      ref={sectionRef}
      component="section"
      sx={[
        (theme) => ({
          overflow: 'hidden',
          position: 'relative',
          bgcolor: theme.vars.palette.grey[900],
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {/*
        Four clips in a 2x2 grid, playing one after another. The grid sits in
        normal flow and each cell carries the footage's own 16:9 ratio, so the
        section is sized by the video rather than the video being cropped to fit
        the section.
      */}
      <Box
        sx={{
          display: 'grid',
          position: 'relative',
          gridTemplateColumns: 'repeat(2, 1fr)',
        }}
      >
        {CLIPS.map(renderQuadrant)}
      </Box>

      <MotionViewport>
        {renderCopy()}
        {renderTopBorder()}
        {renderBottomBorder()}
      </MotionViewport>
    </Box>
  );
}

// ----------------------------------------------------------------------

const renderActionButton = () => (
  <AnimateBorder
    sx={{ borderRadius: 1.25 }}
    duration={12}
    slotProps={{
      outlineColor: (theme) =>
        `linear-gradient(135deg, ${varAlpha(theme.vars.palette.primary.mainChannel, 0.04)}, ${varAlpha(theme.vars.palette.warning.mainChannel, 0.04)})`,
      primaryBorder: {
        size: 50,
        width: '1.5px',
        sx: (theme) => ({
          color: theme.vars.palette.primary.main,
        }),
      },
      secondaryBorder: {
        sx: (theme) => ({
          color: theme.vars.palette.warning.main,
        }),
      },
    }}
  >
    <Button
      component={RouterLink}
      size="large"
      color="primary"
      variant="text"
      href={paths.enroll}
      endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
      sx={{ px: 2, borderRadius: 'inherit' }}
    >
      Start Digitizing
    </Button>
  </AnimateBorder>
);

const renderTopBorder = () => (
  <AnimateBorder
    duration={32}
    slotProps={{
      outlineColor: (theme) => varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
      primaryBorder: {
        size: 300,
        width: '0 3px 3px 0',
        sx: (theme) => ({
          color: varAlpha(theme.vars.palette.primary.lightChannel, 0.8),
        }),
      },
      secondaryBorder: {
        sx: (theme) => ({
          color: varAlpha(theme.vars.palette.primary.lightChannel, 0.8),
        }),
      },
    }}
    sx={[
      () => ({
        top: 0,
        left: 0,
        zIndex: 1,
        width: 'calc(50% + 16px)',
        height: 'calc(50% + 16px)',
        position: 'absolute',
        borderRadius: '0 0 24px 0',
        display: { xs: 'none', md: 'block' },
      }),
    ]}
  />
);

const renderBottomBorder = () => (
  <AnimateBorder
    duration={32}
    slotProps={{
      outlineColor: (theme) => varAlpha(theme.vars.palette.common.whiteChannel, 0.08),
      primaryBorder: {
        size: 300,
        width: '3px 0 0 3px',
        sx: (theme) => ({
          color: varAlpha(theme.vars.palette.common.whiteChannel, 0.8),
        }),
      },
      secondaryBorder: {
        sx: (theme) => ({
          color: varAlpha(theme.vars.palette.common.whiteChannel, 0.8),
        }),
      },
    }}
    sx={[
      () => ({
        right: 0,
        bottom: 0,
        zIndex: 1,
        position: 'absolute',
        width: 'calc(50% + 16px)',
        height: 'calc(50% + 16px)',
        borderRadius: '24px 0 0 0',
        display: { xs: 'none', md: 'block' },
      }),
    ]}
  />
);
