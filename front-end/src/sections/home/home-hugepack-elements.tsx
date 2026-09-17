import type { MotionValue } from 'framer-motion';
import type { BoxProps } from '@mui/material/Box';

import { useRef, useState } from 'react';
import { useClientRect } from 'minimal-shared/hooks';
import { m, useSpring, useScroll, useTransform, useMotionValueEvent } from 'framer-motion';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { styled, useTheme } from '@mui/material/styles';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { Iconify } from 'src/components/iconify';
import { varFade, MotionViewport } from 'src/components/animate';

import { SectionTitle, SectionCaption } from './components/section-title';
import { FloatLine, FloatTriangleLeftIcon } from './components/svg-elements';

// ----------------------------------------------------------------------

const renderLines = () => (
  <>
    <FloatTriangleLeftIcon sx={{ top: 80, left: 80, opacity: 0.4 }} />
    <FloatLine vertical sx={{ top: 0, left: 80 }} />
  </>
);

export function HomeHugePackElements({ sx, ...other }: BoxProps) {
  return (
    <Box
      component="section"
      sx={[
        () => ({
          pt: 10,
          position: 'relative',
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <MotionViewport>
        {renderLines()}

        <Container sx={{ textAlign: { xs: 'center', md: 'left' } }}>
          <Grid container rowSpacing={{ xs: 3, md: 0 }} columnSpacing={{ xs: 0, md: 8 }}>
            <Grid size={{ xs: 12, md: 6, lg: 7 }}>
              <SectionCaption title="Metrical record lifecycle" />
              <SectionTitle title="Large bundle of records" sx={{ mt: 3 }} />
            </Grid>

            <Grid size={{ xs: 12, md: 6, lg: 5 }}>
              <m.div variants={varFade('inUp', { distance: 24 })}>
                <Typography
                  sx={{ color: 'text.disabled', fontSize: { md: 20 }, lineHeight: { md: 36 / 20 } }}
                >
                  <Box component="span" sx={{ color: 'text.primary' }}>
                    Orthodox Metrics handles the complete sacramental lifecycle
                  </Box>
                  <br />— from digitizing century-old handwritten ledgers to generating official
                  certificates on demand.
                </Typography>
              </m.div>
            </Grid>
          </Grid>

          <m.div variants={varFade('inUp', { distance: 24 })}>
            <Button
              component={RouterLink}
              size="large"
              color="inherit"
              variant="outlined"
              href={paths.contact}
              endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
              sx={{ mt: 5, mx: 'auto' }}
            >
              Talk to us about your registers
            </Button>
          </m.div>
        </Container>
      </MotionViewport>
      <ScrollableContent />
    </Box>
  );
}

// ----------------------------------------------------------------------

function ScrollableContent() {
  const theme = useTheme();
  const isRtl = theme.direction === 'rtl';

  const containerRef = useRef<HTMLDivElement>(null);
  const containerRect = useClientRect(containerRef);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRect = useClientRect(scrollRef);

  const [startScroll, setStartScroll] = useState(false);

  const { scrollYProgress } = useScroll({ target: containerRef });

  const physics = { damping: 16, mass: 0.16, stiffness: 50 };

  const scrollRange = (-scrollRect.scrollWidth + containerRect.width) * (isRtl ? -1 : 1);

  const x1 = useSpring(useTransform(scrollYProgress, [0, 1], [0, scrollRange]), physics);
  const x2 = useSpring(useTransform(scrollYProgress, [0, 1], [scrollRange, 0]), physics);

  const background: MotionValue<string> = useTransform(
    scrollYProgress,
    [0, 0.25, 0.5, 0.75, 1],
    [
      theme.vars.palette.background.default,
      theme.vars.palette.background.neutral,
      theme.vars.palette.background.neutral,
      theme.vars.palette.background.neutral,
      theme.vars.palette.background.default,
    ]
  );

  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    if (latest !== 0 && latest !== 1) {
      setStartScroll(true);
    } else {
      setStartScroll(false);
    }
  });

  return (
    <ScrollRoot ref={containerRef} sx={{ height: scrollRect.scrollWidth, minHeight: '100vh' }}>
      <ScrollContainer style={{ background }} data-scrolling={startScroll}>
        <ScrollContent ref={scrollRef} layout transition={{ ease: 'linear', duration: 0.25 }}>
          <ScrollItem style={{ x: x1 }} sx={{ height: { xs: 130, md: 180 } }}>
            {repeatTiles(TOP_ROW, 4).map((tile, index) => (
              <StripTile key={`${tile.src}-${index}`} tile={tile} />
            ))}
          </ScrollItem>

          <ScrollItem style={{ x: x2 }} sx={{ height: { xs: 320, md: 480 } }}>
            {repeatTiles(BOTTOM_ROW, 2).map((tile, index) => (
              <StripTile key={`${tile.src}-${index}`} tile={tile} />
            ))}
          </ScrollItem>
        </ScrollContent>
      </ScrollContainer>
    </ScrollRoot>
  );
}

// ----------------------------------------------------------------------

const ScrollRoot = styled(m.div)(({ theme }) => ({
  zIndex: 9,
  position: 'relative',
  paddingTop: theme.spacing(5),
  [theme.breakpoints.up('md')]: {
    paddingTop: theme.spacing(15),
  },
}));

const ScrollContainer = styled(m.div)(({ theme }) => ({
  top: 0,
  height: '100vh',
  display: 'flex',
  position: 'sticky',
  overflow: 'hidden',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  transition: theme.transitions.create(['background-color']),
  '&[data-scrolling="true"]': { justifyContent: 'center' },
}));

const ScrollContent = styled(m.div)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(3),
  [theme.breakpoints.up('md')]: {
    gap: theme.spacing(5),
  },
}));

const ScrollItem = styled(m.div)(({ theme }) => ({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  width: 'max-content',
  gap: theme.spacing(2.5),
  [theme.breakpoints.up('md')]: {
    gap: theme.spacing(4),
  },
}));

// ----------------------------------------------------------------------

/** `ratio` is the asset's intrinsic width/height. */
type StripTileItem = { src: string; alt: string; ratio: number };

function StripTile({ tile }: { tile: StripTileItem }) {
  return (
    <Box
      component="img"
      loading="lazy"
      alt={tile.alt}
      src={`${CONFIG.assetsDir}/assets/images/home/records/${tile.src}`}
      sx={(theme) => ({
        height: 1,
        flexShrink: 0,
        borderRadius: 2,
        objectFit: 'contain',
        bgcolor: 'background.paper',
        boxShadow: theme.vars.customShadows.z8,
        /**
         * The declared ratio sizes the box from the row height before the image
         * bytes arrive. Without it, lazily-loaded images have no intrinsic width
         * when `useClientRect` measures the row, the measured scroll width
         * collapses, and the section becomes too short to scroll through.
         */
        aspectRatio: tile.ratio,
      })}
    />
  );
}

/**
 * The rows have to be wider than the viewport for the horizontal scroll to have
 * anywhere to travel, so the tiles are repeated — the same effect the original
 * `repeat-x` background produced.
 */
function repeatTiles(tiles: StripTileItem[], times: number): StripTileItem[] {
  return Array.from({ length: times }, () => tiles).flat();
}

// ----------------------------------------------------------------------

/** Shorter row: wide dashboard and summary views. */
const TOP_ROW: StripTileItem[] = [
  { src: 'records-overview.webp', ratio: 1.495, alt: 'Church records summary with yearly totals' },
  {
    src: 'parish-history.webp',
    ratio: 2.665,
    alt: 'Parish history dashboard showing record trends by year',
  },
  {
    src: 'register-cards-trio.webp',
    ratio: 2.04,
    alt: 'Three baptism register cards from a parish archive',
  },
  {
    src: 'notebook-entries.webp',
    ratio: 1.495,
    alt: 'Guide to reading entries in a parish notebook',
  },
];

/**
 * Taller row. Opens on the same baptism record (No. 15401) as it moves from the
 * handwritten page, to a transcription, to a structured record in the platform.
 */
const BOTTOM_ROW: StripTileItem[] = [
  {
    src: 'register-handwritten.webp',
    ratio: 0.8,
    alt: 'Handwritten baptism register card, parish record 15401',
  },
  {
    src: 'register-transcribed.webp',
    ratio: 0.8,
    alt: 'The same baptism record transcribed into print',
  },
  {
    src: 'register-digitized.webp',
    ratio: 0.8,
    alt: 'The same baptism record as a structured digital record',
  },
  {
    src: 'ocr-batch-progress.webp',
    ratio: 1.234,
    alt: 'OCR batch processing progress for a parish register',
  },
  {
    src: 'ocr-batch-complete.webp',
    ratio: 1.128,
    alt: 'Completed OCR batch ready for review',
  },
  {
    src: 'certificate-generator.webp',
    ratio: 1.776,
    alt: 'Certificate generator with a live baptism certificate preview',
  },
];
