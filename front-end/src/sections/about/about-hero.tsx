import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { CONFIG } from 'src/global-config';

import { varFade, AnimateText, MotionContainer, animateTextClasses } from 'src/components/animate';

// ----------------------------------------------------------------------

export function AboutHero({ sx, ...other }: BoxProps) {
  /**
   * The banner artwork sits on the right; the copy sits over a dark panel on the
   * left. The panel is drawn in CSS rather than baked into the image so the
   * heading stays real text.
   */
  const renderArtwork = () => (
    <Box
      aria-hidden
      sx={{
        // Spans the full section so the scrim can fade it out on the left —
        // a narrower box would leave a hard vertical seam.
        inset: 0,
        position: 'absolute',
        backgroundSize: 'cover',
        backgroundPosition: 'center right',
        backgroundRepeat: 'no-repeat',
        backgroundImage: `url(${CONFIG.assetsDir}/assets/images/about/who-we-are.webp)`,
      }}
    />
  );

  const renderScrim = () => (
    <Box
      aria-hidden
      sx={(theme) => ({
        inset: 0,
        position: 'absolute',
        background: `linear-gradient(to right, ${theme.vars.palette.grey[900]} 0%, ${theme.vars.palette.grey[900]} 26%, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.72)} 44%, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.1)} 62%, transparent 78%)`,
        [theme.breakpoints.down('md')]: {
          background: varAlpha(theme.vars.palette.grey['900Channel'], 0.76),
        },
      })}
    />
  );

  const renderCross = () => (
    <Box
      aria-hidden
      component="img"
      alt=""
      src={`${CONFIG.assetsDir}/assets/images/about/cross-watermark.webp`}
      sx={{
        left: 24,
        top: '50%',
        width: 220,
        opacity: 0.6,
        position: 'absolute',
        mixBlendMode: 'lighten',
        transform: 'translateY(-50%)',
        display: { xs: 'none', lg: 'block' },
      }}
    />
  );

  return (
    <Box
      component="section"
      sx={[
        (theme) => ({
          overflow: 'hidden',
          position: 'relative',
          bgcolor: theme.vars.palette.grey[900],
          height: { md: 560 },
          py: { xs: 10, md: 0 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {renderArtwork()}
      {renderScrim()}
      {renderCross()}

      <Container
        component={MotionContainer}
        sx={{
          height: 1,
          display: 'flex',
          position: 'relative',
          alignItems: 'center',
        }}
      >
        <Box sx={{ textAlign: { xs: 'center', md: 'unset' }, maxWidth: { md: 520 } }}>
          <Box
            component={m.div}
            variants={varFade('inRight', { distance: 24 })}
            sx={{ mb: 3, display: 'flex', justifyContent: { xs: 'center', md: 'flex-start' } }}
          >
            {/* Light-on-dark lockup. Composed here rather than using <Logo>,
                which renders its dark wordmark and would vanish on this panel. */}
            <Box sx={{ gap: 1.5, display: 'flex', alignItems: 'center' }}>
              <Box
                component="img"
                alt=""
                aria-hidden
                src={`${CONFIG.assetsDir}/logo/om-mark.png`}
                sx={{ width: 34, height: 34, objectFit: 'contain' }}
              />
              <Typography
                component="span"
                variant="h5"
                sx={{ color: 'common.white', fontWeight: 'fontWeightBold' }}
              >
                Orthodox{' '}
                <Box component="span" sx={{ fontWeight: 'fontWeightLight', opacity: 0.9 }}>
                  Metrics
                </Box>
              </Typography>
            </Box>
          </Box>

          <AnimateText
            component="h1"
            variant="h1"
            textContent={['Who', 'we are?']}
            variants={varFade('inRight', { distance: 24 })}
            sx={{
              color: 'common.white',
              [`& .${animateTextClasses.line}[data-index="0"]`]: {
                [`& .${animateTextClasses.word}[data-index="0"]`]: { color: 'primary.main' },
              },
            }}
          />

          <m.div variants={varFade('inUp', { distance: 24 })}>
            <Typography
              variant="h6"
              sx={{ mt: 3, color: 'common.white', fontWeight: 'fontWeightMedium' }}
            >
              Preserving our faith through technology.
              <br /> Let&apos;s work together to serve the Church.
            </Typography>
          </m.div>
        </Box>
      </Container>
    </Box>
  );
}
