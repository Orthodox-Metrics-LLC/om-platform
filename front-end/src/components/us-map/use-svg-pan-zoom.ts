import { useRef, useState, useEffect, useCallback } from 'react';

// ----------------------------------------------------------------------

export type ViewBox = { x: number; y: number; w: number; h: number };

export type TapInfo = { clientX: number; clientY: number; target: EventTarget | null };

type UseSvgPanZoomOptions = {
  /** Smallest zoom, expressed as a multiple of `baseViewBox` (1 = cannot zoom out past it). */
  minScale?: number;
  maxScale?: number;
  zoomStep?: number;
  /** How far the pointer may drift and still count as a tap, in screen px. */
  dragThreshold?: number;
  /** How far panning may go past `baseViewBox`'s edges, as a ratio of its width. */
  overpanRatio?: number;
  /** Fired on pointerup when the gesture was a tap rather than a drag. */
  onTap?: (info: TapInfo) => void;
};

/**
 * Pan/zoom for an SVG whose `viewBox` is animated directly (not a CSS
 * transform), so strokes stay crisp at every zoom level. Shared by
 * `UsMapPicker` (whole-country state picker) and `EnrollParishMap` (per-state
 * parish pins) — the two differ only in their base frame and zoom limits.
 *
 * Tap detection deliberately does NOT use the browser's `click` event.
 * `setPointerCapture` (needed so a fast drag keeps panning even if the
 * pointer leaves the SVG) retargets the resulting synthetic `click` to the
 * capturing element in most browsers, so a click on a child path never
 * reaches that path's own `onClick`. Instead, `onTap` reports the actual
 * element under the pointer at `pointerdown` time, captured before capture
 * changes any targeting.
 */
export function useSvgPanZoom(baseViewBox: ViewBox, options: UseSvgPanZoomOptions = {}) {
  const {
    minScale = 1,
    maxScale = 6,
    zoomStep = 1.4,
    dragThreshold = 5,
    overpanRatio = 0.6,
    onTap,
  } = options;

  const [viewBox, setViewBox] = useState<ViewBox>(baseViewBox);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startClientX: number;
    startClientY: number;
    startViewBox: ViewBox;
    downTarget: EventTarget | null;
  } | null>(null);

  /** Mirrors `viewBox` for the native wheel listener, which must read the
   *  latest value without being torn down and reattached on every zoom/pan. */
  const viewBoxRef = useRef(viewBox);
  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  // Reset to the new frame whenever the caller passes a different base (e.g.
  // a different state's fitted bounding box) rather than keeping a stale zoom.
  useEffect(() => {
    setViewBox(baseViewBox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseViewBox.x, baseViewBox.y, baseViewBox.w, baseViewBox.h]);

  const clampViewBox = useCallback(
    (next: ViewBox): ViewBox => {
      const w = clamp(next.w, baseViewBox.w / maxScale, baseViewBox.w / minScale);
      const h = w * (baseViewBox.h / baseViewBox.w);
      // Allow panning a little past the base frame so content right at its
      // edge is not stuck unreachable, but not into unbounded empty space.
      const overpan = baseViewBox.w * overpanRatio;
      const x = clamp(next.x, baseViewBox.x - overpan, baseViewBox.x + baseViewBox.w + overpan - w);
      const y = clamp(next.y, baseViewBox.y - overpan, baseViewBox.y + baseViewBox.h + overpan - h);
      return { x, y, w, h };
    },
    [baseViewBox, minScale, maxScale, overpanRatio]
  );

  const zoomBy = useCallback(
    (factor: number, pivot?: { x: number; y: number }) => {
      setViewBox((prev) => {
        const w = prev.w / factor;
        const h = prev.h / factor;
        const px = pivot ?? { x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 };
        const ratioX = (px.x - prev.x) / prev.w;
        const ratioY = (px.y - prev.y) / prev.h;
        return clampViewBox({ x: px.x - ratioX * w, y: px.y - ratioY * h, w, h });
      });
    },
    [clampViewBox]
  );

  const resetView = useCallback(() => setViewBox(baseViewBox), [baseViewBox]);

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
      zoomBy(event.deltaY < 0 ? zoomStep : 1 / zoomStep, pivot);
    };

    svg.addEventListener('wheel', onWheelNative, { passive: false });
    return () => svg.removeEventListener('wheel', onWheelNative);
  }, [zoomBy, zoomStep]);

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    // Captured before setPointerCapture changes any event targeting.
    const downTarget = event.target;
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewBox: viewBoxRef.current,
      downTarget,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag?.active) return;

      const dxClient = event.clientX - drag.startClientX;
      const dyClient = event.clientY - drag.startClientY;
      if (Math.hypot(dxClient, dyClient) > dragThreshold) drag.moved = true;
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
    [clampViewBox, dragThreshold]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      (event.currentTarget as SVGSVGElement).releasePointerCapture(event.pointerId);
      const drag = dragRef.current;
      if (drag?.active && !drag.moved) {
        onTap?.({ clientX: event.clientX, clientY: event.clientY, target: drag.downTarget });
      }
      if (drag) drag.active = false;
    },
    [onTap]
  );

  const onPointerLeave = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag) drag.active = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const scale = baseViewBox.w / viewBox.w;

  return {
    svgRef,
    viewBox,
    scale,
    resetView,
    zoomIn: () => zoomBy(zoomStep),
    zoomOut: () => zoomBy(1 / zoomStep),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerLeave },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max));
}
