import type { BoxProps } from '@mui/material/Box';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { CONFIG } from 'src/global-config';

import { Image } from 'src/components/image';
import { Iconify } from 'src/components/iconify';
import { Carousel, useCarousel, CarouselArrowFloatButtons } from 'src/components/carousel';

// ----------------------------------------------------------------------

type TeamMember = {
  name: string;
  role: string;
  photoUrl?: string;
};

const MEMBERS: TeamMember[] = [
  {
    name: 'Nectarios Parsells',
    role: 'CEO',
    photoUrl: `${CONFIG.assetsDir}/assets/images/about/team-nectarios-parsells.webp`,
  },
  { name: 'John W.', role: 'CFO' },
  { name: '', role: '' },
  { name: '', role: '' },
];

export function AboutTeam({ sx, ...other }: BoxProps) {
  const carousel = useCarousel({
    align: 'start',
    slideSpacing: '24px',
    slidesToShow: { xs: 1, sm: 2, md: 3, xl: 4 },
  });

  return (
    <Box
      component="section"
      sx={[{ py: { xs: 10, md: 15 }, bgcolor: 'background.neutral' }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <Container>
        <Typography variant="overline" sx={{ color: 'text.disabled', display: 'block', textAlign: 'center' }}>
          Integrity team
        </Typography>

        <Typography variant="h2" sx={{ my: 3, textAlign: 'center' }}>
          We create to simplify
        </Typography>

        <Typography
          sx={{
            mx: 'auto',
            mb: { xs: 5, md: 8 },
            maxWidth: 560,
            textAlign: 'center',
            color: 'text.secondary',
          }}
        >
          Our purpose is to be of service as you see fit. The goal is to create to free up church
          priest and administrators in a way that works for them.
        </Typography>

        <Box sx={{ position: 'relative' }}>
          <CarouselArrowFloatButtons
            {...carousel.arrows}
            options={carousel.options}
            slotProps={{
              prevBtn: { sx: { left: -16 } },
              nextBtn: { sx: { right: -16 } },
            }}
            sx={{ top: 'calc(50% + 28px)' }}
          />

          <Carousel carousel={carousel}>
            {MEMBERS.map((member, index) => (
              <TeamCard key={index} member={member} />
            ))}
          </Carousel>
        </Box>
      </Container>
    </Box>
  );
}

// ----------------------------------------------------------------------

function TeamCard({ member }: { member: TeamMember }) {
  return (
    <Box>
      <Box sx={{ mb: 2, textAlign: 'center', minHeight: 52 }}>
        <Typography variant="subtitle1">{member.name || <>&nbsp;</>}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {member.role || <>&nbsp;</>}
        </Typography>
      </Box>

      <Box
        sx={{
          borderRadius: 2,
          overflow: 'hidden',
          position: 'relative',
          bgcolor: 'background.paper',
          aspectRatio: '3/4',
          border: (theme) => `solid 1px ${theme.vars.palette.divider}`,
        }}
      >
        {member.photoUrl ? (
          <Image
            alt={member.name}
            src={member.photoUrl}
            ratio="3/4"
            sx={{ height: 1, width: 1 }}
          />
        ) : (
          <Box
            sx={{
              width: 1,
              height: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.disabled',
              bgcolor: 'background.neutral',
            }}
          >
            <Iconify icon="solar:user-rounded-bold" width="40%" />
          </Box>
        )}
      </Box>
    </Box>
  );
}
