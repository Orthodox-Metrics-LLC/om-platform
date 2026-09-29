import type { LayerType, LayoutJson, CertificateLayer } from '../om-certificates-api';

import { useRef, useMemo, useState, useCallback } from 'react';

// ----------------------------------------------------------------------

const uid = () => `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const DEFAULT_TEXT_STYLE = { font_family: 'Times-Roman', font_size: 16, color: '#1a2744', alignment: 'center' as const, line_height: 1.2 };

/** Designer state: layout with undo/redo, selection, zoom, snapping. Coordinates are PDF points. */
export function useDesigner(initial: LayoutJson, page: { width: number; height: number }) {
  const [layout, setLayoutState] = useState<LayoutJson>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [snap, setSnap] = useState(true);
  const [dirty, setDirty] = useState(false);
  const history = useRef<{ past: LayoutJson[]; future: LayoutJson[] }>({ past: [], future: [] });

  const commit = useCallback((next: LayoutJson | ((prev: LayoutJson) => LayoutJson), record = true) => {
    setLayoutState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (record) { history.current.past = [...history.current.past.slice(-49), prev]; history.current.future = []; }
      return value;
    });
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev) return;
    setLayoutState((cur) => { history.current.future.push(cur); return prev; });
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    setLayoutState((cur) => { history.current.past.push(cur); return next; });
    setDirty(true);
  }, []);

  const sorted = useMemo(() => [...layout.layers].sort((a, b) => a.z_index - b.z_index), [layout.layers]);
  const selected = layout.layers.find((l) => l.id === selectedId) ?? null;

  const updateLayer = useCallback((id: string, patch: Partial<CertificateLayer> | ((l: CertificateLayer) => Partial<CertificateLayer>), record = true) =>
    commit((prev) => ({ ...prev, layers: prev.layers.map((l) => (l.id === id ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)) }), record), [commit]);
  const updateStyle = useCallback((id: string, style: Partial<NonNullable<CertificateLayer['style']>>) => updateLayer(id, (l) => ({ style: { ...l.style, ...style } })), [updateLayer]);

  const addLayer = useCallback((type: LayerType, extra: Partial<CertificateLayer> = {}) => {
    const z = Math.max(0, ...layout.layers.map((l) => l.z_index)) + 1;
    const base: CertificateLayer = {
      id: uid(), type, name: extra.name || type.replace('_', ' '),
      x: Math.round(page.width / 2 - 150), y: Math.round(page.height / 2 - 20), width: 300, height: 40,
      rotation: 0, opacity: 1, z_index: z, locked: false, visible: true, style: { ...DEFAULT_TEXT_STYLE },
    };
    if (type === 'text') base.style = { ...base.style, text: 'Text' };
    if (type === 'bound_field') { base.name = extra.binding?.key?.split('.').pop()?.replace(/_/g, ' ') || 'Field'; base.binding = extra.binding || { key: 'baptism.full_name', required: true }; }
    if (type === 'shape' || type === 'border') { base.width = 240; base.height = 160; base.style = { color: '#c9a227', border_width: 2 }; }
    if (type === 'image') { base.width = 200; base.height = 160; base.style = { fit: 'contain' }; }
    if (type === 'background') { base.x = 0; base.y = 0; base.width = page.width; base.height = page.height; base.z_index = 0; base.locked = true; base.style = { fill: '#f7f3eb' }; }
    const layer = { ...base, ...extra, style: { ...base.style, ...(extra.style || {}) } };
    commit((prev) => ({ ...prev, layers: type === 'background' ? [layer, ...prev.layers.filter((l) => l.type !== 'background').map((l) => ({ ...l, z_index: l.z_index || 1 }))] : [...prev.layers, layer] }));
    setSelectedId(layer.id);
    return layer;
  }, [commit, layout.layers, page]);

  const removeLayer = useCallback((id: string) => { commit((prev) => ({ ...prev, layers: prev.layers.filter((l) => l.id !== id) })); setSelectedId((cur) => (cur === id ? null : cur)); }, [commit]);
  const duplicateLayer = useCallback((id: string) => {
    const src = layout.layers.find((l) => l.id === id);
    if (!src) return;
    const copy = { ...src, id: uid(), name: `${src.name} copy`, x: src.x + 12, y: src.y + 12, z_index: Math.max(0, ...layout.layers.map((l) => l.z_index)) + 1, locked: false };
    commit((prev) => ({ ...prev, layers: [...prev.layers, copy] }));
    setSelectedId(copy.id);
  }, [commit, layout.layers]);
  const reorder = useCallback((id: string, dir: 'up' | 'down' | 'top' | 'bottom') => commit((prev) => {
    const s = [...prev.layers].sort((a, b) => a.z_index - b.z_index);
    const i = s.findIndex((l) => l.id === id); if (i < 0) return prev;
    const [item] = s.splice(i, 1);
    const j = dir === 'up' ? Math.min(s.length, i + 1) : dir === 'down' ? Math.max(0, i - 1) : dir === 'top' ? s.length : 0;
    s.splice(j, 0, item);
    return { ...prev, layers: s.map((l, k) => ({ ...l, z_index: k })) };
  }), [commit]);

  const setLayout = useCallback((next: LayoutJson) => { history.current = { past: [], future: [] }; setLayoutState(next); setDirty(false); }, []);
  const snapTo = useCallback((v: number) => (snap ? Math.round(v / 4) * 4 : Math.round(v)), [snap]);

  return { layout, sorted, selected, selectedId, setSelectedId, zoom, setZoom, snap, setSnap, snapTo, dirty, setDirty, commit, setLayout, updateLayer, updateStyle, addLayer, removeLayer, duplicateLayer, reorder, undo, redo, canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 };
}
export type DesignerState = ReturnType<typeof useDesigner>;
