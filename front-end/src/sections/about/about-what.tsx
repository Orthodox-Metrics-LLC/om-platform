import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { Image } from 'src/components/image';
import { Iconify } from 'src/components/iconify';
import { varFade, MotionViewport } from 'src/components/animate';

// ----------------------------------------------------------------------

export function AboutWhat({ sx, ...other }: BoxProps) {
  return (
    <Box
      component="section"
      sx={[{ overflow: 'hidden' }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <Container
        component={MotionViewport}
        sx={{ py: { xs: 10, md: 15 }, textAlign: { xs: 'center', md: 'unset' } }}
      >
        <Grid container columnSpacing={{ md: 3 }} sx={{ alignItems: 'flex-start' }}>
          <Grid
            container
            size={{ xs: 12, md: 6, lg: 7 }}
            sx={{ pr: { md: 7 }, alignItems: 'center', display: { xs: 'none', md: 'flex' } }}
          >
            <Grid size={6}>
              <m.div variants={varFade('inUp')}>
                <Image
                  alt="The Orthodox Metrics dashboard"
                  src={`${CONFIG.assetsDir}/assets/images/contact/om-hero-dashboard.webp`}
                  ratio="1/1"
                  sx={(theme) => ({
                    borderRadius: 3,
                    boxShadow: `-40px 40px 80px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
                    ...theme.applyStyles('dark', {
                      boxShadow: `-40px 40px 80px ${varAlpha(theme.vars.palette.common.blackChannel, 0.24)}`,
                    }),
                  })}
                />
              </m.div>
            </Grid>

            <Grid size={6}>
              <m.div variants={varFade('inUp')}>
                <Image
                  alt="A parish interior"
                  src={`${CONFIG.assetsDir}/assets/images/contact/om-hero-church.webp`}
                  ratio="3/4"
                  sx={(theme) => ({
                    borderRadius: 3,
                    boxShadow: `-40px 40px 80px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
                    ...theme.applyStyles('dark', {
                      boxShadow: `-40px 40px 80px ${varAlpha(theme.vars.palette.common.blackChannel, 0.24)}`,
                    }),
                  })}
                />
              </m.div>
            </Grid>
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 5 }}>
            <Typography component={m.h2} variants={varFade('inRight')} variant="h2" sx={{ mb: 3 }}>
              What is Orthodox Metrics?
            </Typography>

            <Typography
              component={m.p}
              variants={varFade('inRight')}
              sx={[
                (theme) => ({
                  color: 'text.secondary',
                  ...theme.applyStyles('dark', {
                    color: 'common.white',
                  }),
                }),
              ]}
            >
              Orthodox Metrics is a records platform built specifically for Orthodox parishes. It
              keeps baptism, chrismation, marriage, and funeral registers in one place — digitizing
              the handwritten books a parish already has, then making them searchable without
              discarding the original page. Parishes keep their own data; dioceses get a view across
              the ones they oversee.
            </Typography>

            <Box
              sx={{
                my: 5,
                gap: 3,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {PRINCIPLES.map((principle) => (
                <m.div key={principle.title} variants={varFade('inRight')}>
                  <Box sx={{ gap: 2, display: 'flex', textAlign: 'left' }}>
                    <Iconify
                      width={24}
                      icon="eva:checkmark-fill"
                      sx={{ flexShrink: 0, mt: 0.25, color: 'primary.main' }}
                    />
                    <Box>
                      <Typography variant="subtitle1">{principle.title}</Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {principle.description}
                      </Typography>
                    </Box>
                  </Box>
                </m.div>
              ))}
            </Box>

            <Button
              component={RouterLink}
              href={paths.ocr}
              variant="outlined"
              color="inherit"
              size="large"
              endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
            >
              See how it works
            </Button>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

// ----------------------------------------------------------------------

const PRINCIPLES = [
  {
    title: 'The original page is never discarded',
    description:
      'Every structured record stays linked to the scan it came from, so provenance survives digitization.',
  },
  {
    title: 'Built around Orthodox practice',
    description:
      'Canonical field sets, jurisdiction-aware workflows, and both the Julian and Revised Julian calendars.',
  },
  {
    title: 'The parish owns its records',
    description:
      'Each parish gets an isolated database with encrypted backups and role-scoped access.',
  },
];
