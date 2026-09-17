import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Container from '@mui/material/Container';

import { CONFIG } from 'src/global-config';

import { varScale, MotionViewport } from 'src/components/animate';

import { SectionTitle } from './components/section-title';
import { FloatLine, FloatDotIcon } from './components/svg-elements';

// ----------------------------------------------------------------------

/**
 * Languages Orthodox Metrics supports for record entry and display.
 * `code` is the ISO 639-1 language code and maps to
 * `public/assets/icons/languages/ic-<code>.svg`.
 */
const LANGUAGES = [
  { code: 'en', name: 'English', top: '8%', left: '50%' },
  { code: 'el', name: 'Greek', top: '35%', left: '92%' },
  { code: 'ru', name: 'Russian', top: '80%', left: '78%' },
  { code: 'ro', name: 'Romanian', top: '80%', left: '22%' },
  { code: 'ka', name: 'Georgian', top: '35%', left: '8%' },
];

type LanguageNodeProps = BoxProps & { label: string };

function LanguageNode({ label, children, sx, ...other }: LanguageNodeProps) {
  return (
    <Tooltip title={label} arrow>
      <Box
        sx={[
          (theme) => ({
            position: 'absolute',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            bgcolor: 'background.paper',
            boxShadow: theme.vars.customShadows.z8,
            transition: theme.transitions.create(['transform', 'box-shadow'], {
              duration: theme.transitions.duration.shorter,
            }),
            '&:hover': {
              transform: 'translate(-50%, -50%) scale(1.08)',
              boxShadow: theme.vars.customShadows.z16,
            },
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...other}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

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

export function HomeIntegrations({ sx, ...other }: BoxProps) {
  const renderDescription = () => (
    <SectionTitle
      caption="Languages & calendars"
      title="Robust multilingual framework"
      description={
        <>
          <Box component="span" sx={{ mb: 1, display: 'block' }}>
            Support for English, Greek, Russian, Romanian, and Georgian — with Old and New Calendar
            systems, jurisdiction-aware workflows, and OCA-compliant formats.
          </Box>

          <Box
            component="span"
            sx={{ fontStyle: 'italic', color: 'text.disabled', typography: 'caption' }}
          >
            * Supports Old and New Julian calendars.
            <br />* OCA-compliant record formats.
          </Box>
        </>
      }
      sx={{ textAlign: { xs: 'center', md: 'left' } }}
    />
  );

  /**
   * The supported languages orbit the Orthodox Metrics mark. Positions are
   * expressed as percentages of the square container so the whole cluster
   * scales with the viewport.
   */
  const renderImage = () => (
    <Box
      component={m.div}
      variants={{ ...varScale('in'), initial: { scale: 0.8, opacity: 0 } }}
      sx={{
        width: 1,
        maxWidth: 560,
        aspectRatio: '1/1',
        position: 'relative',
        mx: { xs: 'auto', md: 'unset' },
        ml: { md: 'auto' },
      }}
    >
      {/* Orbit guides */}
      {[100, 66].map((size) => (
        <Box
          key={size}
          sx={(theme) => ({
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: `${size}%`,
            height: `${size}%`,
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            border: `dashed 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
          })}
        />
      ))}

      {/* Orthodox Metrics mark at the centre */}
      <LanguageNode
        sx={{ top: '50%', left: '50%', width: 96, height: 96 }}
        label="Orthodox Metrics"
      >
        <Box
          component="img"
          alt="Orthodox Metrics"
          src={`${CONFIG.assetsDir}/logo/om-mark.png`}
          sx={{ width: 52, height: 52, objectFit: 'contain' }}
        />
      </LanguageNode>

      {LANGUAGES.map((language) => (
        <LanguageNode
          key={language.code}
          label={language.name}
          sx={{ top: language.top, left: language.left, width: 72, height: 72 }}
        >
          <Box
            component="img"
            alt={language.name}
            src={`${CONFIG.assetsDir}/assets/icons/languages/ic-${language.code}.svg`}
            sx={{ width: 34, height: 26, borderRadius: 0.75, objectFit: 'cover' }}
          />
        </LanguageNode>
      ))}
    </Box>
  );

  return (
    <Box
      component="section"
      sx={[{ pt: 10, position: 'relative' }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <MotionViewport>
        {renderLines()}

        <Container>
          <Grid container spacing={{ xs: 5, md: 8 }}>
            <Grid size={{ xs: 12, md: 6, lg: 5 }}>{renderDescription()}</Grid>

            <Grid sx={{ textAlign: { xs: 'center', md: 'right' } }} size={{ xs: 12, md: 6, lg: 7 }}>
              {renderImage()}
            </Grid>
          </Grid>
        </Container>
      </MotionViewport>
    </Box>
  );
}
