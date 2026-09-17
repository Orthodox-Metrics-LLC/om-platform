import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { CONFIG } from 'src/global-config';

import { Iconify } from 'src/components/iconify';
import { varFade, AnimateText, MotionContainer, animateTextClasses } from 'src/components/animate';

// ----------------------------------------------------------------------

export function ContactHero({ sx, ...other }: BoxProps) {
  /**
   * The banner artwork is split into two plates — the parish interior on the
   * left and the Orthodox Metrics dashboard on the right — each fading into the
   * dark backdrop so the copy in the middle stays legible. Both plates are
   * decorative and drop away on small screens.
   */
  const renderPlate = (side: 'left' | 'right') => (
    <Box
      aria-hidden
      sx={(theme) => ({
        top: 0,
        bottom: 0,
        width: '48%',
        position: 'absolute',
        display: { xs: 'none', md: 'block' },
        ...(side === 'left'
          ? {
              left: 0,
              backgroundPosition: 'left center',
              backgroundImage: `url(${CONFIG.assetsDir}/assets/images/contact/om-hero-church.webp)`,
              maskImage: 'linear-gradient(to right, black 60%, transparent 100%)',
            }
          : {
              right: 0,
              backgroundPosition: 'right center',
              backgroundImage: `url(${CONFIG.assetsDir}/assets/images/contact/om-hero-dashboard.webp)`,
              maskImage: 'linear-gradient(to left, black 70%, transparent 100%)',
            }),
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        ...theme.applyStyles('dark', { opacity: 0.86 }),
      })}
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
          py: { xs: 8, md: 10 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {renderPlate('left')}
      {renderPlate('right')}

      {/* Keeps the copy readable where it overlaps the artwork. */}
      <Box
        aria-hidden
        sx={(theme) => ({
          inset: 0,
          position: 'absolute',
          background: `linear-gradient(to right, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.2)} 0%, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.78)} 28%, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.78)} 66%, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.2)} 100%)`,
          display: { xs: 'none', md: 'block' },
        })}
      />

      <Container component={MotionContainer} sx={{ position: 'relative' }}>
        <Box sx={{ textAlign: { xs: 'center', md: 'unset' } }}>
          <AnimateText
            component="h1"
            variant="h2"
            textContent={['Where to find', 'Orthodox Metrics']}
            variants={varFade('inUp', { distance: 24 })}
            sx={{
              color: 'common.white',
              [`& .${animateTextClasses.line}[data-index="0"]`]: { color: 'primary.main' },
            }}
          />

          <Box
            component="ul"
            sx={{
              mt: 5,
              display: 'grid',
              color: 'common.white',
              rowGap: 4,
              columnGap: { xs: 3, md: 4 },
              gridTemplateColumns: {
                xs: 'repeat(1, 1fr)',
                sm: 'repeat(2, 1fr)',
                md: 'repeat(4, 1fr)',
              },
              maxWidth: { md: 960 },
            }}
          >
            {ENQUIRIES.map((enquiry) => (
              <Box component="li" key={enquiry.title} sx={{ listStyle: 'none' }}>
                <m.div variants={varFade('inUp', { distance: 24 })}>
                  <Box
                    sx={{
                      mb: 1,
                      gap: 1,
                      display: 'flex',
                      alignItems: 'center',
                      // Reserve two lines so descriptions stay on a shared baseline
                      // when a title wraps.
                      minHeight: { md: 56 },
                      justifyContent: { xs: 'center', md: 'flex-start' },
                    }}
                  >
                    <Iconify width={24} icon={enquiry.icon} sx={{ color: 'common.white' }} />
                    <Typography variant="h6">{enquiry.title}</Typography>
                  </Box>
                </m.div>

                <m.div variants={varFade('inUp', { distance: 24 })}>
                  <Typography variant="body2" sx={{ opacity: 0.72 }}>
                    {enquiry.description}
                  </Typography>
                </m.div>
              </Box>
            ))}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}

// ----------------------------------------------------------------------

const ENQUIRIES = [
  {
    title: 'Support',
    description: 'Get help with your account or technical questions.',
    icon: 'solar:headphones-round-bold',
  },
  {
    title: 'Sales',
    description: 'Learn more about OM and request a demo.',
    icon: 'solar:chart-square-outline',
  },
  {
    title: 'Church Onboarding',
    description: "We'll help you get your parish set up for success.",
    icon: 'solar:home-2-outline',
  },
  {
    title: 'Records Digitization',
    description: 'Preserve and organize your parish records.',
    icon: 'solar:file-text-bold',
  },
] as const;
