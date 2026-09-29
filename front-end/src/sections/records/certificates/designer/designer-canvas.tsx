import type { DesignerState } from './use-designer';
import type { StudioMeta, CertificateLayer } from '../om-certificates-api';

import { useRef, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';

// ----------------------------------------------------------------------

type Props = { d: DesignerState; page: { width: number; height: number }; meta: StudioMeta | null; sampleValues: Record<string, string>; showGrid: boolean };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = typeof HANDLES[number];

/** Text exactly as the PDF renderer lays it out: top-aligned, first baseline at y + font size, ellipsis when single-line. */
export function layerText(layer: CertificateLayer, sample: Record<string, string>) {
  if (layer.type === 'text') return layer.style?.text ?? '';
  if (layer.type === 'bound_field') {
    const v = sample[layer.binding?.key || ''] ?? layer.binding?.fallback ?? `[${layer.binding?.key?.split('.').pop() || 'field'}]`;
    return v;
  }
  return '';
}
const transform = (t: string, mode?: string) => (mode === 'uppercase' ? t.toUpperCase() : mode === 'lowercase' ? t.toLowerCase() : mode === 'capitalize' ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t);

/**
 * WYSIWYG page. Everything is positioned in PDF points and scaled with CSS transform, so what is on
 * screen is what pdf-lib draws (fonts limited to the approved standard 14 set).
 */
export function DesignerCanvas({ d, page, meta, sampleValues, showGrid }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fontCss = (family?: string) => meta?.fonts.find((f) => f.value === family) ?? { css: 'Times New Roman, Times, serif', weight: 'normal', style: 'normal' };

  // Drag / resize in page coordinates (divide by zoom)
  const startDrag = useCallback((e: React.MouseEvent, layer: CertificateLayer, handle: Handle | 'move') => {
    if (layer.locked) return;
    e.preventDefault(); e.stopPropagation();
    d.setSelectedId(layer.id);
    const start = { x: e.clientX, y: e.clientY, lx: layer.x, ly: layer.y, lw: layer.width, lh: layer.height };
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - start.x) / d.zoom; const dy = (ev.clientY - start.y) / d.zoom;
      let { lx: x, ly: y, lw: w, lh: h } = start;
      if (handle === 'move') { x += dx; y += dy; }
      else {
        if (handle.includes('e')) w = Math.max(8, start.lw + dx);
        if (handle.includes('s')) h = Math.max(8, start.lh + dy);
        if (handle.includes('w')) { w = Math.max(8, start.lw - dx); x = start.lx + (start.lw - w); }
        if (handle.includes('n')) { h = Math.max(8, start.lh - dy); y = start.ly + (start.lh - h); }
      }
      d.updateLayer(layer.id, { x: d.snapTo(x), y: d.snapTo(y), width: d.snapTo(w), height: d.snapTo(h) }, false);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); d.commit((prev) => prev); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }, [d]);

  // keyboard nudge / delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!d.selected || d.selected.locked) return;
      const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const step = e.shiftKey ? 10 : 1;
      const l = d.selected;
      if (e.key === 'ArrowLeft') d.updateLayer(l.id, { x: l.x - step });
      else if (e.key === 'ArrowRight') d.updateLayer(l.id, { x: l.x + step });
      else if (e.key === 'ArrowUp') d.updateLayer(l.id, { y: l.y - step });
      else if (e.key === 'ArrowDown') d.updateLayer(l.id, { y: l.y + step });
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (l.type !== 'background') d.removeLayer(l.id); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { if (e.shiftKey) d.redo(); else d.undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); d.duplicateLayer(l.id); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d]);

  return (
    <Box ref={wrapRef} onMouseDown={() => d.setSelectedId(null)} sx={{ flexGrow: 1, overflow: 'auto', bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.900' : 'grey.200'), display: 'flex', alignItems: 'flex-start', justifyContent: 'center', p: 4 }}>
      <Box sx={{ width: page.width * d.zoom, height: page.height * d.zoom, flexShrink: 0, position: 'relative', boxShadow: (t) => t.customShadows.z24 }}>
        <Box sx={{ width: page.width, height: page.height, transform: `scale(${d.zoom})`, transformOrigin: 'top left', position: 'relative', overflow: 'hidden', bgcolor: '#fff', backgroundImage: showGrid ? 'linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)' : 'none', backgroundSize: showGrid ? '36px 36px' : undefined }}>
          {d.layout.showGuides && (
            <Box sx={{ position: 'absolute', top: d.layout.margins.top, left: d.layout.margins.left, right: d.layout.margins.right, bottom: d.layout.margins.bottom, border: '1px dashed rgba(201,162,39,0.6)', pointerEvents: 'none', zIndex: 1000 }} />
          )}
          {d.sorted.filter((l) => l.visible).map((layer) => {
            const isSel = layer.id === d.selectedId;
            const isText = layer.type === 'text' || layer.type === 'bound_field';
            const f = fontCss(layer.style?.font_family);
            const fontSize = layer.style?.font_size || 14;
            const allowWrap = layer.style?.allow_wrap || layer.height > fontSize * 2;
            const img = layer.asset_url || (layer.asset_id ? `/api/assets/${layer.asset_id}/file` : null);
            const fit = layer.type === 'background' ? 'contain' : layer.style?.fit || 'contain';
            return (
              <Box
                key={layer.id}
                onMouseDown={(e) => { e.stopPropagation(); if (layer.locked) { d.setSelectedId(layer.id); return; } startDrag(e, layer, 'move'); }}
                sx={{
                  position: 'absolute', left: layer.x, top: layer.y, width: layer.width, height: layer.height, opacity: layer.opacity,
                  transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined, zIndex: layer.z_index + 1,
                  cursor: layer.locked ? 'default' : 'move', boxSizing: 'border-box',
                  outline: isSel ? '2px solid #00A76F' : '1px solid transparent', outlineOffset: 0,
                  '&:hover': { outline: isSel ? '2px solid #00A76F' : '1px dashed rgba(0,167,111,0.6)' },
                  bgcolor: layer.type === 'background' && !img ? layer.style?.fill || '#f7f3eb' : 'transparent',
                  border: layer.type === 'shape' || layer.type === 'border' ? `${layer.style?.border_width || 2}px solid ${layer.style?.color || '#c9a227'}` : undefined,
                  overflow: 'hidden',
                }}
              >
                {img && (layer.type === 'background' || layer.type === 'image') && (
                  <Box component="img" src={img} alt={layer.name} draggable={false} sx={{ width: 1, height: 1, objectFit: fit === 'stretch' ? 'fill' : fit, display: 'block', pointerEvents: 'none', userSelect: 'none' }} />
                )}
                {layer.type === 'image' && !img && (
                  <Box sx={{ width: 1, height: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.04)', color: 'text.disabled', typography: 'caption', border: '1px dashed rgba(0,0,0,0.2)' }}>Choose an image</Box>
                )}
                {isText && (
                  <Box
                    component="span"
                    sx={{
                      display: 'block', width: 1, fontFamily: f.css, fontWeight: f.weight, fontStyle: f.style, fontSize, lineHeight: `${(layer.style?.line_height || 1.2) * fontSize}px`,
                      color: layer.style?.color || '#1a2744', textAlign: layer.style?.alignment || 'left', whiteSpace: allowWrap ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      // pdf-lib draws the first baseline at y + fontSize; CSS line box centres glyphs — offset to match.
                      pt: `${Math.max(0, fontSize - (layer.style?.line_height || 1.2) * fontSize * 0.78)}px`, userSelect: 'none', pointerEvents: 'none',
                    }}
                  >
                    {transform(layerText(layer, sampleValues), layer.style?.text_transform)}
                  </Box>
                )}
                {isSel && !layer.locked && HANDLES.map((h) => (
                  <Box key={h} onMouseDown={(e) => startDrag(e, layer, h)} sx={{ position: 'absolute', width: 8, height: 8, bgcolor: '#fff', border: '1.5px solid #00A76F', borderRadius: 0.25, zIndex: 2,
                    cursor: `${h}-resize`,
                    top: h.includes('n') ? -4 : h.includes('s') ? 'calc(100% - 4px)' : 'calc(50% - 4px)',
                    left: h.includes('w') ? -4 : h.includes('e') ? 'calc(100% - 4px)' : 'calc(50% - 4px)' }} />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
