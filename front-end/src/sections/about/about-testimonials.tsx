import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Masonry from '@mui/lab/Masonry';
import Rating from '@mui/material/Rating';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { Iconify } from 'src/components/iconify';
import { varFade, MotionViewport } from 'src/components/animate';

// ----------------------------------------------------------------------

export function AboutTestimonials({ sx, ...other }: BoxProps) {
  const renderLink = () => (
    <Button
      component={RouterLink}
      href={paths.contact}
      color="primary"
      endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
    >
      Talk to us
    </Button>
  );

  const renderDescription = () => (
    <Box sx={{ maxWidth: { md: 360 }, textAlign: { xs: 'center', md: 'unset' } }}>
      <m.div variants={varFade('inUp')}>
        <Typography variant="overline" sx={{ color: 'common.white', opacity: 0.48 }}>
          Testimonials
        </Typography>
      </m.div>

      <m.div variants={varFade('inUp')}>
        <Typography variant="h2" sx={{ my: 3, color: 'common.white' }}>
          What parishes <br />
          tell us
        </Typography>
      </m.div>

      <m.div variants={varFade('inUp')}>
        <Typography sx={{ color: 'common.white' }}>
          Orthodox Metrics is shaped by the clergy and parish staff who use it. The features that
          matter most — dual calendars, multilingual entry, certificate generation — exist because
          parishes asked for them.
        </Typography>
      </m.div>

      <Box
        component={m.div}
        variants={varFade('inUp')}
        sx={{ mt: 3, justifyContent: 'center', display: { xs: 'flex', md: 'none' } }}
      >
        {renderLink()}
      </Box>
    </Box>
  );

  const renderContent = () => (
    <Box
      sx={[
        (theme) => ({
          ...theme.mixins.hideScrollY,
          py: { md: 10 },
          height: { md: 1 },
          overflowY: { xs: 'unset', md: 'auto' },
        }),
      ]}
    >
      <Masonry spacing={3} columns={{ xs: 1, md: 2 }} sx={{ ml: 0 }}>
        {TESTIMONIALS.map((testimonial) => (
          <m.div key={testimonial.name} variants={varFade('inUp')}>
            <TestimonialItem testimonial={testimonial} />
          </m.div>
        ))}
      </Masonry>
    </Box>
  );

  return (
    <Box
      component="section"
      sx={[
        (theme) => ({
          ...theme.mixins.bgGradient({
            images: [
              `linear-gradient(0deg, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.9)}, ${varAlpha(theme.vars.palette.grey['900Channel'], 0.9)})`,
              `url(${CONFIG.assetsDir}/assets/images/contact/om-hero-church.webp)`,
            ],
          }),
          overflow: 'hidden',
          height: { md: 840 },
          py: { xs: 10, md: 0 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Container component={MotionViewport} sx={{ position: 'relative', height: 1 }}>
        <Grid
          container
          spacing={3}
          sx={{
            height: 1,
            alignItems: 'center',
            justifyContent: { xs: 'center', md: 'space-between' },
          }}
        >
          <Grid size={{ xs: 10, md: 4 }}>{renderDescription()}</Grid>

          <Grid size={{ xs: 12, md: 7, lg: 6 }} sx={{ height: 1, alignItems: 'center' }}>
            {renderContent()}
          </Grid>
        </Grid>

        <Box
          component={m.div}
          variants={varFade('inUp')}
          sx={{ bottom: 60, position: 'absolute', display: { xs: 'none', md: 'flex' } }}
        >
          {renderLink()}
        </Box>
      </Container>
    </Box>
  );
}

// ----------------------------------------------------------------------

type TestimonialItemProps = BoxProps & {
  testimonial: {
    name: string;
    role: string;
    content: string;
    ratingNumber: number;
  };
};

function TestimonialItem({ testimonial, sx, ...other }: TestimonialItemProps) {
  return (
    <Box
      sx={[
        (theme) => ({
          ...theme.mixins.bgBlur({ color: varAlpha(theme.vars.palette.common.whiteChannel, 0.08) }),
          p: 3,
          gap: 3,
          display: 'flex',
          borderRadius: 2,
          color: 'common.white',
          flexDirection: 'column',
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Iconify icon="mingcute:quote-left-fill" width={40} sx={{ opacity: 0.48 }} />

      <Typography variant="body2">{testimonial.content}</Typography>

      <Rating value={testimonial.ratingNumber} readOnly size="small" />

      <Box sx={{ gap: 2, display: 'flex' }}>
        <Avatar alt={testimonial.name} sx={{ bgcolor: 'primary.main' }}>
          {testimonial.name.charAt(0)}
        </Avatar>

        <ListItemText
          primary={testimonial.name}
          secondary={testimonial.role}
          slotProps={{
            secondary: {
              sx: {
                mt: 0.5,
                opacity: 0.64,
                color: 'inherit',
                typography: 'caption',
              },
            },
          }}
        />
      </Box>
    </Box>
  );
}

// ----------------------------------------------------------------------

const TESTIMONIALS = [
  {
    name: 'Fr. Michael D.',
    role: 'Parish Priest',
    ratingNumber: 5,
    content:
      'Orthodox Metrics transformed how we manage our 90-year archive. Records that took hours to find are now searchable in seconds.',
  },
  {
    name: 'Nicholas K.',
    role: 'Parish Secretary',
    ratingNumber: 5,
    content:
      'The certificate generation alone saves me an entire day each month. Everything is accurate and beautifully formatted.',
  },
  {
    name: 'Dn. Peter S.',
    role: 'Deacon',
    ratingNumber: 5,
    content:
      'Finally, a system that understands Orthodox parish needs — dual calendars, multilingual support, the whole thing.',
  },
  {
    name: 'Andrei R.',
    role: 'Diocesan Administrator',
    ratingNumber: 5,
    content:
      'Rolling up data across twelve parishes used to be a nightmare. Now I have a single dashboard for everything.',
  },
  {
    name: 'Fr. George T.',
    role: 'Cathedral Dean',
    ratingNumber: 5,
    content:
      'We digitized over 4,000 pages of historical registers. The OCR quality exceeded our expectations.',
  },
  {
    name: 'Stefan M.',
    role: 'Office Manager',
    ratingNumber: 5,
    content:
      'The multilingual support is incredible. We serve a mixed Greek and English congregation and everything works seamlessly.',
  },
];
