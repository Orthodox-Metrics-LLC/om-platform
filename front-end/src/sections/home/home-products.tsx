import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { Iconify } from 'src/components/iconify';
import { varFade, MotionViewport } from 'src/components/animate';

import { SectionTitle } from './components/section-title';
import { FloatLine, FloatDotIcon } from './components/svg-elements';

// ----------------------------------------------------------------------

const renderLines = () => (
  <>
    <Stack
      spacing={8}
      sx={{
        top: 64,
        left: 80,
        zIndex: 2,
        bottom: 64,
        alignItems: 'center',
        position: 'absolute',
        transform: 'translateX(-50%)',
        '& span': { position: 'static', opacity: 0.12 },
      }}
    >
      <FloatDotIcon />
      <FloatDotIcon sx={{ opacity: 0.24, width: 14, height: 14 }} />
      <Box sx={{ flexGrow: 1 }} />
      <FloatDotIcon sx={{ opacity: 0.24, width: 14, height: 14 }} />
      <FloatDotIcon />
    </Stack>

    <FloatLine vertical sx={{ top: 0, left: 80 }} />
  </>
);

export function HomeProducts({ sx, ...other }: BoxProps) {
  const renderDescription = () => (
    <SectionTitle
      caption="Also from Orthodox Metrics"
      title="OM Cemetery Designer"
      description="Map the parish grounds section by section — every plot placed, its status current, and a record behind each interment, so families can be answered in seconds."
      sx={{ textAlign: { xs: 'center', md: 'left' } }}
    />
  );

  const renderImage = () => (
    <Stack
      component={m.div}
      variants={varFade('inDown', { distance: 24 })}
      sx={[
        (theme) => ({
          alignItems: 'flex-end',
          filter: `drop-shadow(0 24px 48px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)})`,
          ...theme.applyStyles('dark', {
            filter: `drop-shadow(0 24px 48px ${varAlpha(theme.vars.palette.common.blackChannel, 0.16)})`,
          }),
        }),
      ]}
    >
      <Box
        component="img"
        loading="lazy"
        alt="The OM Cemetery Designer plot map, with section labels, plot status and an interment record panel"
        src={`${CONFIG.assetsDir}/assets/images/home/products/om-cemetery-designer.webp`}
        sx={[
          (theme) => ({
            width: 720,
            maxWidth: 1,
            display: 'block',
            // The screenshot's own ratio — cropping it to 16/10 cut off the
            // sidebar and the record panel.
            aspectRatio: 1916 / 822,
            borderRadius: '16px 16px 0 16px',
            border: `solid 2px ${theme.vars.palette.common.white}`,
          }),
        ]}
      />

      <Box sx={{ p: 0.5, bgcolor: 'common.white', borderRadius: '0 0 8px 8px' }}>
        <Button
          component={RouterLink}
          variant="contained"
          href={paths.contact}
          endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
          sx={{
            color: 'grey.800',
            bgcolor: 'common.white',
            '&:hover': { bgcolor: 'common.white' },
          }}
        >
          Request Demo
        </Button>
      </Box>
    </Stack>
  );

  return (
    <Box
      component="section"
      sx={[
        { pt: 10, position: 'relative', pb: { xs: 10, md: 20 } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <MotionViewport>
        {renderLines()}

        <Container sx={{ position: 'relative' }}>
          <Grid container spacing={{ xs: 5, md: 8 }} sx={{ position: 'relative', zIndex: 9 }}>
            <Grid size={{ xs: 12, md: 6, lg: 5 }}>{renderDescription()}</Grid>
            <Grid size={{ xs: 12, md: 6, lg: 7 }}>{renderImage()}</Grid>
          </Grid>
        </Container>
      </MotionViewport>
    </Box>
  );
}
