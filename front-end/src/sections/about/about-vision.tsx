import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { useRef, useState } from 'react';
import { varAlpha } from 'minimal-shared/utils';

import Fab from '@mui/material/Fab';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { CONFIG } from 'src/global-config';

import { Iconify } from 'src/components/iconify';
import { varFade, MotionViewport } from 'src/components/animate';

// ----------------------------------------------------------------------

const VIDEO_SRC = `${CONFIG.assetsDir}/assets/video/om-metrics-intro.mp4`;
const POSTER_SRC = `${CONFIG.assetsDir}/assets/video/om-metrics-intro-poster.webp`;

export function AboutVision({ sx, ...other }: BoxProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * `play()` must be called synchronously inside the click handler — deferring it
   * leaves the user-gesture context and the browser's autoplay policy blocks a
   * video that has audio.
   */
  const handlePlay = () => {
    videoRef.current?.play();
    setIsPlaying(true);
  };

  /**
   * The film is several megabytes, so `preload="none"` means no video bytes are
   * fetched until the visitor asks for it — only the poster frame loads.
   */
  const renderVideo = () => (
    <Box
      ref={videoRef}
      component="video"
      playsInline
      preload="none"
      poster={POSTER_SRC}
      controls={isPlaying}
      onPlay={() => setIsPlaying(true)}
      sx={{
        width: 1,
        display: 'block',
        objectFit: 'cover',
        bgcolor: 'common.black',
        aspectRatio: { xs: '4/3', sm: '16/9' },
      }}
    >
      <source src={VIDEO_SRC} type="video/mp4" />
      Your browser does not support embedded video.
    </Box>
  );

  const renderPlayOverlay = () => (
    <>
      <Box
        aria-hidden
        sx={(theme) => ({
          inset: 0,
          position: 'absolute',
          bgcolor: varAlpha(theme.vars.palette.grey['900Channel'], 0.32),
        })}
      />

      <Fab
        aria-label="Play the Orthodox Metrics intro film"
        onClick={handlePlay}
        sx={{ position: 'absolute', zIndex: 9 }}
      >
        <Iconify icon="solar:play-broken" width={24} />
      </Fab>
    </>
  );

  return (
    <Box
      component="section"
      sx={[
        {
          pb: 10,
          position: 'relative',
          bgcolor: 'background.neutral',
          '&::before': {
            top: 0,
            left: 0,
            width: 1,
            content: "''",
            position: 'absolute',
            height: { xs: 80, md: 120 },
            bgcolor: 'background.default',
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Container component={MotionViewport}>
        <Box
          sx={{
            mb: 10,
            borderRadius: 2,
            display: 'flex',
            overflow: 'hidden',
            position: 'relative',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {renderVideo()}
          {!isPlaying && renderPlayOverlay()}
        </Box>

        <Typography
          component={m.h6}
          variants={varFade('inUp')}
          variant="h3"
          sx={{ textAlign: 'center', maxWidth: 800, mx: 'auto' }}
        >
          Our vision is that every parish register — however old, however fragile — stays legible,
          searchable, and in the hands of the community that wrote it.
        </Typography>
      </Container>
    </Box>
  );
}
