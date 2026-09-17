import type { BoxProps } from '@mui/material/Box';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { Iconify } from 'src/components/iconify';
import { LAND_PATH, STATE_BORDERS_PATH } from 'src/components/us-map/paths';

// ----------------------------------------------------------------------

export function ContactMap({ sx, ...other }: BoxProps) {
  const renderMap = () => (
    <Box
      aria-hidden
      component="svg"
      viewBox="0 0 1000 779"
      sx={{ width: 1, height: 1, display: 'block' }}
    >
      <Box
        component="path"
        d={LAND_PATH}
        sx={(theme) => ({
          fill: theme.vars.palette.grey[300],
          ...theme.applyStyles('dark', { fill: theme.vars.palette.grey[700] }),
        })}
      />
      <Box
        component="path"
        d={STATE_BORDERS_PATH}
        strokeWidth={1.2}
        sx={(theme) => ({
          fill: 'none',
          stroke: theme.vars.palette.background.default,
        })}
      />
    </Box>
  );

  const renderPins = () =>
    REGIONS.map((region) => (
      <Tooltip key={region.name} title={region.name} arrow>
        <Box
          sx={{
            top: region.top,
            left: region.left,
            position: 'absolute',
            lineHeight: 0,
            // Anchor the pin's point on the coordinate, not its centre.
            transform: 'translate(-50%, -100%)',
            transition: (theme) => theme.transitions.create(['transform']),
            '&:hover': { transform: 'translate(-50%, -100%) scale(1.2)' },
          }}
        >
          <Iconify width={22} icon="custom:location-fill" sx={{ color: 'primary.main' }} />
        </Box>
      </Tooltip>
    ));

  const renderNote = () => (
    <Box
      sx={(theme) => ({
        top: 16,
        right: 16,
        p: 1.5,
        maxWidth: 232,
        borderRadius: 1.5,
        position: 'absolute',
        bgcolor: varAlpha(theme.vars.palette.background.paperChannel, 0.9),
        boxShadow: theme.vars.customShadows.z8,
      })}
    >
      <Box sx={{ gap: 1, display: 'flex' }}>
        <Iconify
          width={20}
          icon="solar:global-bold-duotone"
          sx={{ flexShrink: 0, color: 'primary.main' }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          <Box component="span" sx={{ fontWeight: 'fontWeightSemiBold', color: 'text.primary' }}>
            Orthodox Metrics
          </Box>{' '}
          serves Orthodox churches and organizations across North America — and worldwide,
          remotely.
        </Typography>
      </Box>
    </Box>
  );

  const renderLegend = () => (
    <Box
      sx={{
        left: 16,
        right: 16,
        bottom: 16,
        gap: 2,
        display: 'flex',
        position: 'absolute',
        alignItems: 'flex-end',
        pointerEvents: 'none',
        justifyContent: 'space-between',
      }}
    >
      <Box sx={{ gap: 1, display: 'flex', alignItems: 'center' }}>
        <Iconify width={20} icon="custom:location-fill" sx={{ color: 'primary.main' }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Regions we serve
          <br />
          (across North America)
        </Typography>
      </Box>

      <Typography
        variant="caption"
        sx={{ fontStyle: 'italic', textAlign: 'right', color: 'text.disabled' }}
      >
        Different locations.
        <br />A stronger Church together.
      </Typography>
    </Box>
  );

  return (
    <Box
      sx={[
        (theme) => ({
          p: 2,
          display: 'flex',
          alignItems: 'center',
          minHeight: { xs: 320, md: 560 },
          borderRadius: 2,
          position: 'relative',
          bgcolor: theme.vars.palette.background.neutral,
          border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Box sx={{ position: 'relative', width: 1 }}>
        {renderMap()}
        {renderPins()}
      </Box>

      {renderNote()}
      {renderLegend()}
    </Box>
  );
}

// ----------------------------------------------------------------------

/**
 * Representative metropolitan areas Orthodox Metrics serves. These are regions,
 * not parish addresses — no parish location is disclosed here.
 *
 * `left`/`top` are the coordinates projected through the same Albers Equal Area
 * Conic projection used to generate the paths below, expressed as percentages of
 * the viewBox, so pins stay aligned at any size.
 */
const REGIONS = [
  { name: 'Anchorage, AK', left: '33.1%', top: '15.12%' },
  { name: 'Seattle, WA', left: '44.9%', top: '42.96%' },
  { name: 'Los Angeles, CA', left: '44.32%', top: '63.9%' },
  { name: 'Dallas, TX', left: '64.72%', top: '69.02%' },
  { name: 'Chicago, IL', left: '72.73%', top: '54.83%' },
  { name: 'Toronto, ON', left: '79.43%', top: '51.0%' },
  { name: 'Boston, MA', left: '86.67%', top: '50.93%' },
  { name: 'Miami, FL', left: '82.24%', top: '77.75%' },
] as const;

