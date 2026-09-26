import type { BoxProps } from '@mui/material/Box';

import { useRef, useState } from 'react';
import { varAlpha } from 'minimal-shared/utils';
import { m, useSpring, useMotionValue, useReducedMotion } from 'framer-motion';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { Iconify } from 'src/components/iconify';
import { varFade, MotionContainer } from 'src/components/animate';

// ----------------------------------------------------------------------

const ARTWORK_RATIO = 924 / 876;

/** Pointer-parallax travel, in pixels. */
const PARALLAX = 14;

/**
 * The artwork is a crop of a larger composition, so every edge except the top is
 * a hard line. Softening them lets it sit on the page without visible seams.
 */
const HERO_EDGE_MASK = [
  'linear-gradient(to right, transparent, black 9%)',
  'linear-gradient(to left, transparent, black 6%)',
  'linear-gradient(to top, transparent, black 11%)',
].join(', ');

export function HomeHero({ sx, ...other }: BoxProps) {
  const reduceMotion = useReducedMotion();

  const sectionRef = useRef<HTMLDivElement>(null);
  const [showVideo, setShowVideo] = useState(false);

  const physics = { damping: 22, mass: 0.3, stiffness: 90 };
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const artworkX = useSpring(pointerX, physics);
  const artworkY = useSpring(pointerY, physics);

  /**
   * Nudges the artwork toward the pointer. Skipped entirely when the visitor has
   * asked for reduced motion.
   */
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || !sectionRef.current) return;

    const rect = sectionRef.current.getBoundingClientRect();
    const fromCenterX = (event.clientX - rect.left) / rect.width - 0.5;
    const fromCenterY = (event.clientY - rect.top) / rect.height - 0.5;

    pointerX.set(fromCenterX * PARALLAX * 2);
    pointerY.set(fromCenterY * PARALLAX);
  };

  const handlePointerLeave = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  const renderEyebrow = () => (
    <Box
      component={m.div}
      variants={varFade('inUp', { distance: 24 })}
      sx={{ gap: 2, display: 'flex', alignItems: 'center' }}
    >
      <Box sx={{ width: 40, height: 3, borderRadius: 1, bgcolor: 'primary.main' }} />
      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', letterSpacing: 1.4, fontWeight: 'fontWeightSemiBold' }}
      >
        Orthodox record stewardship
      </Typography>
    </Box>
  );

  const renderHeading = () => (
    <m.div variants={varFade('inUp', { distance: 24 })}>
      <Box
        component="h1"
        sx={[
          (theme) => ({
            m: 0,
            typography: 'h2',
            fontFamily: theme.typography.fontSecondaryFamily,
            [theme.breakpoints.up('lg')]: {
              fontSize: theme.typography.pxToRem(52),
              lineHeight: 1.18,
            },
          }),
        ]}
      >
        Preserve your parish history with
        {/* Own line, as in the artwork. */}
        <Box component="span" sx={{ display: 'block', color: 'primary.main' }}>
          Orthodox Metrics
        </Box>
      </Box>
    </m.div>
  );

  const renderText = () => (
    <m.div variants={varFade('inUp', { distance: 24 })}>
      <Typography sx={{ color: 'text.secondary', fontSize: { md: 18 }, maxWidth: 460 }}>
        OM helps Orthodox parishes digitize, search, preserve, and manage baptism, marriage, and
        funeral records in one place.
      </Typography>
    </m.div>
  );

  const renderButtons = () => (
    <Box
      component={m.div}
      variants={varFade('inUp', { distance: 24 })}
      sx={{
        gap: 2,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: { xs: 'center', md: 'flex-start' },
      }}
    >
      <Button
        component={RouterLink}
        href={paths.enroll}
        size="large"
        color="inherit"
        variant="contained"
        endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
        sx={{
          height: 52,
          px: 3,
          // Nudge the arrow along on hover.
          '& .MuiButton-endIcon': {
            transition: (theme) => theme.transitions.create(['transform']),
          },
          '&:hover .MuiButton-endIcon': { transform: 'translateX(4px)' },
        }}
      >
        Get Started
      </Button>

      <Button
        onClick={() => setShowVideo(true)}
        size="large"
        color="inherit"
        variant="outlined"
        startIcon={<Iconify width={24} icon="solar:play-circle-bold" />}
        sx={{ height: 52, px: 3, borderColor: 'currentColor' }}
      >
        Play Introduction Video
      </Button>
    </Box>
  );

  const renderFeatures = () => (
    <Box
      component={m.div}
      variants={varFade('inUp', { distance: 24 })}
      sx={{
        pt: 1,
        gap: { xs: 2.5, sm: 0 },
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        justifyContent: { xs: 'center', md: 'flex-start' },
      }}
    >
      {FEATURES.map((feature, index) => (
        <Box key={feature.label} sx={{ display: 'flex', alignItems: 'center' }}>
          {index > 0 && (
            <Divider
              flexItem
              orientation="vertical"
              sx={{ mx: { xs: 2.5, sm: 1.5 }, display: { xs: 'none', sm: 'block' } }}
            />
          )}

          <Box
            sx={{
              gap: 1,
              display: 'flex',
              alignItems: 'center',
              transition: (theme) => theme.transitions.create(['transform']),
              '&:hover': { transform: 'translateY(-3px)' },
              '&:hover .om-feature-icon': {
                color: 'primary.contrastText',
                bgcolor: 'primary.main',
              },
            }}
          >
            <Box
              className="om-feature-icon"
              sx={(theme) => ({
                width: 34,
                height: 34,
                flexShrink: 0,
                display: 'flex',
                borderRadius: 1.5,
                alignItems: 'center',
                color: 'primary.main',
                justifyContent: 'center',
                bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
                transition: theme.transitions.create(['background-color', 'color']),
              })}
            >
              <Iconify width={20} icon={feature.icon} />
            </Box>

            <Typography variant="body2" sx={{ fontWeight: 'fontWeightMedium', maxWidth: 132 }}>
              {feature.label}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );

  const renderArtwork = () => (
    <Box
      component={m.div}
      variants={varFade('inUp', { distance: 32 })}
      style={reduceMotion ? undefined : { x: artworkX, y: artworkY }}
      sx={{ position: 'relative' }}
    >
      {showVideo ? (
        <Box
          component="video"
          src={`${CONFIG.assetsDir}/assets/video/om-metrics-intro.mp4`}
          autoPlay
          controls
          playsInline
          onEnded={() => setShowVideo(false)}
          sx={{
            width: 1,
            display: 'block',
            aspectRatio: ARTWORK_RATIO,
            borderRadius: 1,
          }}
        />
      ) : (
        <Box
          component={m.img}
          alt="The Orthodox Metrics dashboard beside a 1912 Greek baptism register, a parish church, and a censer"
          src={`${CONFIG.assetsDir}/assets/images/home/hero-artwork.webp`}
          animate={reduceMotion ? undefined : { y: [0, -12, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          sx={{
            width: 1,
            display: 'block',
            aspectRatio: ARTWORK_RATIO,
            maskImage: HERO_EDGE_MASK,
            maskComposite: 'intersect',
            WebkitMaskImage: HERO_EDGE_MASK,
            WebkitMaskComposite: 'source-in',
          }}
        />
      )}
    </Box>
  );

  return (
    <Box
      ref={sectionRef}
      component="section"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      sx={[
        (theme) => ({
          overflow: 'hidden',
          position: 'relative',
          pt: { xs: 6, md: 4 },
          pb: { xs: 8, md: 6 },
          // Recreates the soft glow behind the artwork.
          ...theme.mixins.bgGradient({
            images: [
              `radial-gradient(70% 80% at 72% 40%, ${varAlpha(theme.vars.palette.primary.mainChannel, 0.06)}, transparent 70%)`,
            ],
          }),
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Container component={MotionContainer}>
        <Grid
          container
          spacing={{ xs: 5, md: 4 }}
          sx={{ alignItems: 'center', textAlign: { xs: 'center', md: 'left' } }}
        >
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack
              spacing={3}
              sx={{ alignItems: { xs: 'center', md: 'flex-start' } }}
            >
              {renderEyebrow()}
              {renderHeading()}
              {renderText()}
              {renderButtons()}
              {renderFeatures()}
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>{renderArtwork()}</Grid>
        </Grid>
      </Container>
    </Box>
  );
}

// ----------------------------------------------------------------------

const FEATURES = [
  { label: 'Digitize records', icon: 'solar:file-text-bold' },
  { label: 'Search sacramental history', icon: 'eva:search-fill' },
  { label: 'Preserve provenance', icon: 'solar:shield-check-bold' },
] as const;
