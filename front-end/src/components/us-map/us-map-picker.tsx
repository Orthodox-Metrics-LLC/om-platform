import type { BoxProps } from '@mui/material/Box';

import { useState, useCallback } from 'react';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

import { Iconify } from 'src/components/iconify';

import { STATE_REGIONS } from './state-regions';
import { useSvgPanZoom } from './use-svg-pan-zoom';
import { LAND_PATH, STATE_BORDERS_PATH } from './paths';

// ----------------------------------------------------------------------

/**
 * Crops the shared 1000x779 world artwork to the continental US, with some
 * padding for context, and matched to the map frame's 4:3 aspect ratio so
 * the initial view fills the frame without letterboxing.
 */
const BASE_VIEWBOX = { x: 369, y: 259, w: 562, h: 422 };

type Props = BoxProps & {
  onSelectState: (code: string, name: string) => void;
};

/**
 * Pannable, zoomable picker for the 49 continental-US states (Alaska and
 * Hawaii are not in `STATE_REGIONS` — see that file for why). Shown before a
 * state is chosen, as an alternative to the dropdown in `enroll-view.tsx`.
 */
export function UsMapPicker({ onSelectState, sx, ...other }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const handleTap = useCallback(
    ({ target }: { target: EventTarget | null }) => {
      const code = (target as Element | null)?.getAttribute?.('data-code');
      const region = code ? STATE_REGIONS.find((r) => r.code === code) : undefined;
      if (region) onSelectState(region.code, region.name);
    },
    [onSelectState]
  );

  const { svgRef, viewBox, scale, resetView, zoomIn, zoomOut, handlers } = useSvgPanZoom(BASE_VIEWBOX, {
    minScale: 1,
    maxScale: 6,
    onTap: handleTap,
  });

  return (
    <Box sx={[{ position: 'relative' }, ...(Array.isArray(sx) ? sx : [sx])]} {...other}>
      <Box
        component="svg"
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        role="group"
        aria-label="Select your state from the map"
        {...handlers}
        sx={{ width: 1, height: 1, display: 'block', touchAction: 'none', cursor: 'grab' }}
      >
        <Box
          component="path"
          d={LAND_PATH}
          sx={(theme) => ({ fill: varAlpha(theme.vars.palette.grey['500Channel'], 0.16) })}
        />

        {STATE_REGIONS.map((region) => {
          const isHovered = region.code === hovered;
          return (
            <Tooltip key={region.code} title={region.name}>
              <Box
                component="path"
                d={region.d}
                data-code={region.code}
                tabIndex={0}
                role="button"
                aria-label={`Select ${region.name}`}
                onMouseEnter={() => setHovered(region.code)}
                onMouseLeave={() => setHovered((c) => (c === region.code ? null : c))}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectState(region.code, region.name);
                  }
                }}
                sx={(theme) => ({
                  cursor: 'pointer',
                  strokeWidth: 0.6 / scale,
                  stroke: theme.vars.palette.common.white,
                  fill: isHovered
                    ? theme.vars.palette.primary.main
                    : varAlpha(theme.vars.palette.primary.mainChannel, 0.32),
                  transition: theme.transitions.create(['fill']),
                })}
              />
            </Tooltip>
          );
        })}

        <Box
          component="path"
          d={STATE_BORDERS_PATH}
          sx={(theme) => ({
            fill: 'none',
            pointerEvents: 'none',
            strokeWidth: 0.6 / scale,
            stroke: varAlpha(theme.vars.palette.grey['500Channel'], 0.4),
          })}
        />
      </Box>

      <Box sx={{ top: 8, right: 8, gap: 0.5, display: 'flex', flexDirection: 'column', position: 'absolute' }}>
        <ZoomButton icon="mingcute:add-line" label="Zoom in" onClick={zoomIn} />
        <ZoomButton icon="mingcute:minimize-line" label="Zoom out" onClick={zoomOut} />
        <ZoomButton icon="solar:restart-bold" label="Reset view" onClick={resetView} />
      </Box>
    </Box>
  );
}

// ----------------------------------------------------------------------

function ZoomButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <Tooltip title={label} placement="left">
      <IconButton
        size="small"
        onClick={onClick}
        sx={(theme) => ({
          bgcolor: 'background.paper',
          boxShadow: theme.vars.customShadows.z8,
          '&:hover': { bgcolor: 'background.paper' },
        })}
      >
        <Iconify width={16} icon={icon as never} />
      </IconButton>
    </Tooltip>
  );
}
