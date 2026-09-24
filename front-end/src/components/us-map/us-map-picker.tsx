import type { BoxProps } from '@mui/material/Box';

import { varAlpha } from 'minimal-shared/utils';
import { useRef, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

import { Iconify } from 'src/components/iconify';

import { STATE_REGIONS } from './state-regions';
import { LAND_PATH, STATE_BORDERS_PATH } from './paths';

// ----------------------------------------------------------------------

type ViewBox = { x: number; y: number; w: number; h: number };

/**
 * Crops the shared 1000x779 world artwork to the continental US, with some
 * padding for context, and matched to the map frame's 4:3 aspect ratio so
 * the initial view fills the frame without letterboxing.
 */
const BASE_VIEWBOX: ViewBox = { x: 369, y: 259, w: 562, h: 422 };

const MIN_SCALE = 1; // BASE_VIEWBOX, fully zoomed out
const MAX_SCALE = 6;
const ZOOM_STEP = 1.4;

/** How far the pointer may drift and still count as a click, in screen px. */
const DRAG_THRESHOLD = 5;

type Props = BoxProps & {
  onSelectState: (code: string, name: string) => void;
};

/**
 * Pannable, zoomable picker for the 49 continental-US states (Alaska and
 * Hawaii are not in `STATE_REGIONS` — see that file for why). Shown before a
 * state is chosen, as an alternative to the dropdown in `enroll-view.tsx`.
 *
 * Implemented by animating the SVG `viewBox` directly rather than a CSS
 * transform, so stroke widths stay crisp at every zoom level and hit-testing
 * on the state paths needs no coordinate translation.
 */
export function UsMapPicker({ onSelectState, sx, ...other }: Props) {
  const [viewBox, setViewBox] = useState<ViewBox>(BASE_VIEWBOX);
  const [hovered, setHovered] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startClientX: number;
    startClientY: number;
    startViewBox: ViewBox;
  } | null>(null);

  /** Mirrors `viewBox` for the native wheel listener below, which must read the
   *  latest value without being torn down and reattached on every zoom/pan. */
  const viewBoxRef = useRef(viewBox);
  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  const clampViewBox = useCallback((next: ViewBox): ViewBox => {
    const w = clamp(next.w, BASE_VIEWBOX.w / MAX_SCALE, BASE_VIEWBOX.w / MIN_SCALE);
    const h = w * (BASE_VIEWBOX.h / BASE_VIEWBOX.w);
    // Allow panning a little past the cropped edge so states right at the
    // border of the crop are not stuck unreachable, but not into the void.
    const overpan = BASE_VIEWBOX.w * 0.6;
    const x = clamp(next.x, BASE_VIEWBOX.x - overpan, BASE_VIEWBOX.x + BASE_VIEWBOX.w + overpan - w);
    const y = clamp(next.y, BASE_VIEWBOX.y - overpan, BASE_VIEWBOX.y + BASE_VIEWBOX.h + overpan - h);
    return { x, y, w, h };
     
  }, []);

  const zoomBy = useCallback(
    (factor: number, pivot?: { x: number; y: number }) => {
      setViewBox((prev) => {
        const w = prev.w / factor;
        const h = prev.h / factor;
        const px = pivot ?? { x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 };
        const ratioX = (px.x - prev.x) / prev.w;
        const ratioY = (px.y - prev.y) / prev.h;
        return clampViewBox({
          x: px.x - ratioX * w,
          y: px.y - ratioY * h,
          w,
          h,
        });
      });
    },
    [clampViewBox]
  );

  /**
   * React attaches its synthetic `onWheel` as a passive listener, so
   * `preventDefault()` inside it is silently ignored and the page scrolls
   * underneath the map while it zooms. A native listener with
   * `{ passive: false }` is the only way to actually stop that.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;

    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const current = viewBoxRef.current;
      const pivot = {
        x: current.x + ((event.clientX - rect.left) / rect.width) * current.w,
        y: current.y + ((event.clientY - rect.top) / rect.height) * current.h,
      };
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, pivot);
    };

    svg.addEventListener('wheel', onWheelNative, { passive: false });
    return () => svg.removeEventListener('wheel', onWheelNative);
  }, [zoomBy]);

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewBox: viewBox,
    };
     
  }, [viewBox]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag?.active) return;

      const dxClient = event.clientX - drag.startClientX;
      const dyClient = event.clientY - drag.startClientY;
      if (Math.hypot(dxClient, dyClient) > DRAG_THRESHOLD) drag.moved = true;
      if (!drag.moved) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const dx = (dxClient / rect.width) * drag.startViewBox.w;
      const dy = (dyClient / rect.height) * drag.startViewBox.h;

      setViewBox(
        clampViewBox({
          ...drag.startViewBox,
          x: drag.startViewBox.x - dx,
          y: drag.startViewBox.y - dy,
        })
      );
    },
    [clampViewBox]
  );

  const endDrag = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    (event.currentTarget as SVGSVGElement).releasePointerCapture(event.pointerId);
    if (dragRef.current) dragRef.current.active = false;
  }, []);

  /** Swallows the click that follows a drag gesture, so panning never also selects a state. */
  const handleClickCapture = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current?.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (dragRef.current) dragRef.current.moved = false;
  }, []);

  const scale = BASE_VIEWBOX.w / viewBox.w;

  return (
    <Box sx={[{ position: 'relative' }, ...(Array.isArray(sx) ? sx : [sx])]} {...other}>
      <Box
        component="svg"
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        role="group"
        aria-label="Select your state from the map"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={handleClickCapture}
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
                tabIndex={0}
                role="button"
                aria-label={`Select ${region.name}`}
                onMouseEnter={() => setHovered(region.code)}
                onMouseLeave={() => setHovered((c) => (c === region.code ? null : c))}
                onClick={() => onSelectState(region.code, region.name)}
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
        <ZoomButton icon="mingcute:add-line" label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} />
        <ZoomButton icon="mingcute:minimize-line" label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} />
        <ZoomButton
          icon="solar:restart-bold"
          label="Reset view"
          onClick={() => setViewBox(BASE_VIEWBOX)}
        />
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max));
}
