import type { DesignerState } from './use-designer';
import type { StudioMeta, CertificateType } from '../om-certificates-api';
import type { OmAsset } from 'src/sections/admin/asset-manager/om-assets-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import FormControlLabel from '@mui/material/FormControlLabel';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { omAssetFileUrl, fetchOmAssetsCursorPage } from 'src/sections/admin/asset-manager/om-assets-api';

// ----------------------------------------------------------------------

const ASSET_CATEGORIES = [{ value: 'template', label: 'Templates' }, { value: 'background', label: 'Backgrounds' }, { value: 'logo', label: 'Logos & marks' }, { value: 'icon', label: 'Icons' }, { value: 'header', label: 'Headers' }, { value: 'content', label: 'Artwork' }];

/** Left panel: Assets (Asset Manager artwork) · Fields (record bindings) · Add (text / shapes) · Layers. */
export function DesignerLeftPanel({ d, meta, certificateType, churchId, page }: { d: DesignerState; meta: StudioMeta | null; certificateType: CertificateType; churchId: number | null; page: { width: number; height: number } }) {
  const [tab, setTab] = useState<'assets' | 'fields' | 'add'>('assets');
  const [category, setCategory] = useState('template');
  const [assets, setAssets] = useState<OmAsset[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'assets') return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    Promise.all([
      fetchOmAssetsCursorPage({ scope: 'public', category, search: search || undefined, limit: 40 }, ctrl.signal).catch(() => ({ items: [] as OmAsset[] })),
      churchId ? fetchOmAssetsCursorPage({ scope: 'church', church_id: churchId, category, search: search || undefined, limit: 40 }, ctrl.signal).catch(() => ({ items: [] as OmAsset[] })) : Promise.resolve({ items: [] as OmAsset[] }),
    ]).then(([pub, ch]) => { const seen = new Set<number>(); setAssets([...(ch.items ?? []), ...(pub.items ?? [])].filter((a) => a.mime_type?.startsWith('image/') && !seen.has(a.id) && seen.add(a.id))); }).finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [tab, category, search, churchId]);

  const placeAsset = (a: OmAsset, asBackground: boolean) => {
    if (asBackground) {
      const bg = d.layout.layers.find((l) => l.type === 'background');
      if (bg) d.updateLayer(bg.id, { asset_id: a.id, asset_url: omAssetFileUrl(a.id), name: a.name, style: { ...bg.style, fit: 'contain' } });
      else d.addLayer('background', { asset_id: a.id, asset_url: omAssetFileUrl(a.id), name: a.name });
    } else {
      const ratio = a.width && a.height ? a.height / a.width : 0.75;
      const w = Math.min(240, page.width * 0.4);
      d.addLayer('image', { asset_id: a.id, asset_url: omAssetFileUrl(a.id), name: a.name, width: Math.round(w), height: Math.round(w * ratio) });
    }
  };

  const bindings = (meta?.bindings ?? []).filter((b) => b.group === certificateType || b.group === 'church');

  return (
    <Box sx={{ width: 300, flexShrink: 0, borderRight: (t) => `1px solid ${t.vars.palette.divider}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ px: 1, boxShadow: (t) => `inset 0 -2px 0 0 ${t.vars.palette.divider}` }}>
        <Tab value="assets" label="Assets" /><Tab value="fields" label="Fields" /><Tab value="add" label="Add" />
      </Tabs>
      <Scrollbar sx={{ flex: '1 1 0', minHeight: 0 }}>
        {tab === 'assets' && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
              {ASSET_CATEGORIES.map((c) => <Chip key={c.value} size="small" label={c.label} variant={category === c.value ? 'filled' : 'outlined'} color={category === c.value ? 'primary' : 'default'} onClick={() => setCategory(c.value)} />)}
            </Box>
            <TextField size="small" fullWidth placeholder="Search artwork…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 1.5 }} />
            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mb: 1 }}>Click to add as an image · use the ⤢ button to set as the page background. Upload new artwork in Asset Manager.</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
              {assets.map((a) => (
                <Box key={a.id} sx={{ position: 'relative', borderRadius: 1, overflow: 'hidden', border: (t) => `1px solid ${t.vars.palette.divider}`, '&:hover .bg': { opacity: 1 } }}>
                  <Box component="img" src={omAssetFileUrl(a.id)} alt={a.name} loading="lazy" onClick={() => placeAsset(a, false)} sx={{ width: 1, aspectRatio: '4 / 3', objectFit: 'contain', display: 'block', cursor: 'pointer', bgcolor: 'background.neutral' }} />
                  <Tooltip title="Set as page background"><IconButton className="bg" size="small" onClick={() => placeAsset(a, true)} sx={{ position: 'absolute', top: 4, right: 4, opacity: 0, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}><Iconify icon="solar:full-screen-square-outline" width={16} /></IconButton></Tooltip>
                  <Typography variant="caption" noWrap sx={{ display: 'block', px: 1, py: 0.5 }}>{a.name}</Typography>
                  {a.scope === 'church' && <Label variant="soft" color="info" sx={{ position: 'absolute', top: 4, left: 4 }}>Parish</Label>}
                </Box>
              ))}
              {!assets.length && !loading && <Typography variant="caption" sx={{ color: 'text.disabled', gridColumn: '1 / -1', py: 2 }}>No artwork in this category.</Typography>}
            </Box>
          </Box>
        )}

        {tab === 'fields' && (
          <Stack spacing={0.5} sx={{ p: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.disabled', mb: 1 }}>Record fields are filled from the sacrament record when a certificate is generated.</Typography>
            {bindings.map((b) => (
              <Button key={b.key} size="small" color="inherit" variant="outlined" onClick={() => d.addLayer('bound_field', { binding: { key: b.key, required: b.group !== 'church' }, name: b.label })} sx={{ justifyContent: 'space-between', textTransform: 'none' }}>
                <span>{b.label}</span><Label variant="soft" color={b.group === 'church' ? 'info' : 'primary'}>{b.group}</Label>
              </Button>
            ))}
          </Stack>
        )}

        {tab === 'add' && (
          <Stack spacing={1} sx={{ p: 2 }}>
            <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:file-text-bold" />} onClick={() => d.addLayer('text')}>Text</Button>
            <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:gallery-wide-bold" />} onClick={() => setTab('assets')}>Image (from Assets)</Button>
            <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:chart-square-outline" />} onClick={() => d.addLayer('shape')}>Rectangle / frame</Button>
            <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:full-screen-square-outline" />} onClick={() => d.addLayer('border', { x: d.layout.margins.left, y: d.layout.margins.top, width: page.width - d.layout.margins.left - d.layout.margins.right, height: page.height - d.layout.margins.top - d.layout.margins.bottom, style: { color: '#c9a227', border_width: 3 } })}>Page border</Button>
            {!d.layout.layers.some((l) => l.type === 'background') && <Button variant="outlined" color="inherit" onClick={() => d.addLayer('background')}>Background colour</Button>}
          </Stack>
        )}
      </Scrollbar>

      <Divider />
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'flex', alignItems: 'center' }}><Typography variant="subtitle2" sx={{ flexGrow: 1 }}>Layers</Typography><Typography variant="caption" sx={{ color: 'text.disabled' }}>{d.layout.layers.length}</Typography></Box>
      <Scrollbar sx={{ flex: '0 1 40%', minHeight: 120 }}>
        <Stack sx={{ px: 1, pb: 1 }}>
          {[...d.sorted].reverse().map((l) => (
            <Box key={l.id} onClick={() => d.setSelectedId(l.id)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderRadius: 0.75, cursor: 'pointer', bgcolor: l.id === d.selectedId ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
              <Iconify width={16} icon={l.type === 'background' ? 'solar:gallery-wide-bold' : l.type === 'image' ? 'solar:gallery-add-bold' : l.type === 'bound_field' ? 'solar:tag-horizontal-bold-duotone' : l.type === 'text' ? 'solar:file-text-bold' : 'solar:chart-square-outline'} sx={{ color: 'text.disabled', flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" noWrap>{l.name}</Typography>
                <Typography variant="caption" noWrap sx={{ color: 'text.disabled', display: 'block' }}>{l.type === 'bound_field' ? l.binding?.key : l.type.replace('_', ' ')}</Typography>
              </Box>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); d.updateLayer(l.id, { locked: !l.locked }); }}><Iconify width={14} icon="solar:lock-password-outline" sx={{ color: l.locked ? 'warning.main' : 'text.disabled' }} /></IconButton>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); d.updateLayer(l.id, { visible: !l.visible }); }}><Iconify width={14} icon={l.visible ? 'solar:eye-bold' : 'solar:eye-closed-bold'} /></IconButton>
            </Box>
          ))}
        </Stack>
      </Scrollbar>
    </Box>
  );
}

// ----------------------------------------------------------------------

/** Right panel: properties of the selected layer, or page settings. */
export function DesignerRightPanel({ d, meta, page }: { d: DesignerState; meta: StudioMeta | null; page: { width: number; height: number } }) {
  const l = d.selected;
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const field = (label: string, key: 'x' | 'y' | 'width' | 'height' | 'rotation') => (
    <TextField size="small" type="number" label={label} value={Math.round(l![key])} onChange={(e) => d.updateLayer(l!.id, { [key]: num(e.target.value) })} disabled={l!.locked && key !== 'rotation'} />
  );

  return (
    <Box sx={{ width: 300, flexShrink: 0, borderLeft: (t) => `1px solid ${t.vars.palette.divider}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Scrollbar sx={{ flex: '1 1 0' }}>
        {!l ? (
          <Stack spacing={2} sx={{ p: 2 }}>
            <Typography variant="subtitle2">Page</Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>{Math.round(page.width)} × {Math.round(page.height)} pt · {(page.width / 72).toFixed(2)}″ × {(page.height / 72).toFixed(2)}″</Typography>
            <FormControlLabel control={<Switch size="small" checked={d.layout.showGuides} onChange={(e) => d.commit((p) => ({ ...p, showGuides: e.target.checked }))} />} label="Show margin guides" />
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
              {(['top', 'right', 'bottom', 'left'] as const).map((k) => <TextField key={k} size="small" type="number" label={`Margin ${k}`} value={d.layout.margins[k]} onChange={(e) => d.commit((p) => ({ ...p, margins: { ...p.margins, [k]: num(e.target.value) } }))} />)}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>Select a layer on the canvas or in the Layers list to edit it. Arrow keys nudge (⇧ = 10 pt), Delete removes, ⌘/Ctrl+D duplicates, ⌘/Ctrl+Z undoes.</Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField size="small" label="Layer name" value={l.name} onChange={(e) => d.updateLayer(l.id, { name: e.target.value })} sx={{ flexGrow: 1 }} />
              <Tooltip title="Duplicate"><IconButton size="small" onClick={() => d.duplicateLayer(l.id)}><Iconify icon="solar:copy-bold" /></IconButton></Tooltip>
              {l.type !== 'background' && <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => d.removeLayer(l.id)}><Iconify icon="solar:trash-bin-trash-bold" /></IconButton></Tooltip>}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Send backward"><IconButton size="small" onClick={() => d.reorder(l.id, 'down')}><Iconify icon="eva:arrow-ios-downward-fill" /></IconButton></Tooltip>
              <Tooltip title="Bring forward"><IconButton size="small" onClick={() => d.reorder(l.id, 'up')}><Iconify icon="eva:arrow-ios-upward-fill" /></IconButton></Tooltip>
              <Box sx={{ flexGrow: 1 }} />
              <FormControlLabel control={<Switch size="small" checked={l.locked} onChange={(e) => d.updateLayer(l.id, { locked: e.target.checked })} />} label={<Typography variant="caption">Locked</Typography>} />
            </Box>

            <Divider sx={{ borderStyle: 'dashed' }} />
            <Typography variant="overline" sx={{ color: 'text.disabled' }}>Position & size (pt)</Typography>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>{field('X', 'x')}{field('Y', 'y')}{field('Width', 'width')}{field('Height', 'height')}</Box>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
              {field('Rotation °', 'rotation')}
              <Box><Typography variant="caption" sx={{ color: 'text.disabled' }}>Opacity {Math.round(l.opacity * 100)}%</Typography><Slider size="small" min={0} max={1} step={0.05} value={l.opacity} onChange={(_, v) => d.updateLayer(l.id, { opacity: v as number }, false)} onChangeCommitted={() => d.commit((p) => p)} /></Box>
            </Box>

            {(l.type === 'text' || l.type === 'bound_field') && (
              <>
                <Divider sx={{ borderStyle: 'dashed' }} />
                <Typography variant="overline" sx={{ color: 'text.disabled' }}>{l.type === 'text' ? 'Text' : 'Record field'}</Typography>
                {l.type === 'text' ? (
                  <TextField size="small" multiline minRows={2} label="Text" value={l.style?.text ?? ''} onChange={(e) => d.updateStyle(l.id, { text: e.target.value })} />
                ) : (
                  <>
                    <TextField select size="small" label="Field" value={l.binding?.key ?? ''} onChange={(e) => d.updateLayer(l.id, { binding: { ...(l.binding || {}), key: e.target.value }, name: meta?.bindings.find((b) => b.key === e.target.value)?.label || l.name })}>
                      {(meta?.bindings ?? []).map((b) => <MenuItem key={b.key} value={b.key}>{b.label} <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.disabled' }}>{b.key}</Typography></MenuItem>)}
                    </TextField>
                    <TextField size="small" label="Fallback when empty" value={l.binding?.fallback ?? ''} onChange={(e) => d.updateLayer(l.id, { binding: { key: l.binding?.key || '', ...(l.binding || {}), fallback: e.target.value } })} />
                  </>
                )}
                <TextField select size="small" label="Font" value={l.style?.font_family ?? 'Times-Roman'} onChange={(e) => d.updateStyle(l.id, { font_family: e.target.value })}>
                  {(meta?.fonts ?? []).map((f) => <MenuItem key={f.value} value={f.value} sx={{ fontFamily: f.css, fontWeight: f.weight, fontStyle: f.style }}>{f.value}</MenuItem>)}
                </TextField>
                <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
                  <TextField size="small" type="number" label="Size (pt)" value={l.style?.font_size ?? 14} onChange={(e) => d.updateStyle(l.id, { font_size: num(e.target.value) })} />
                  <TextField size="small" type="number" label="Line height" value={l.style?.line_height ?? 1.2} slotProps={{ htmlInput: { step: 0.1 } }} onChange={(e) => d.updateStyle(l.id, { line_height: num(e.target.value) })} />
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField size="small" type="color" label="Colour" value={l.style?.color ?? '#1a2744'} onChange={(e) => d.updateStyle(l.id, { color: e.target.value })} sx={{ width: 96 }} />
                  <ToggleButtonGroup exclusive size="small" value={l.style?.alignment ?? 'left'} onChange={(_, v) => v && d.updateStyle(l.id, { alignment: v })}>
                    <ToggleButton value="left"><Iconify icon="ic:round-format-align-left" /></ToggleButton><ToggleButton value="center"><Iconify icon="ic:round-format-align-center" /></ToggleButton><ToggleButton value="right"><Iconify icon="ic:round-format-align-right" /></ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <TextField select size="small" label="Case" value={l.style?.text_transform ?? 'none'} onChange={(e) => d.updateStyle(l.id, { text_transform: e.target.value as any })}>
                  <MenuItem value="none">As entered</MenuItem><MenuItem value="uppercase">UPPERCASE</MenuItem><MenuItem value="capitalize">Capitalize Words</MenuItem><MenuItem value="lowercase">lowercase</MenuItem>
                </TextField>
                <FormControlLabel control={<Switch size="small" checked={!!l.style?.allow_wrap} onChange={(e) => d.updateStyle(l.id, { allow_wrap: e.target.checked })} />} label={<Typography variant="caption">Wrap onto multiple lines</Typography>} />
              </>
            )}

            {(l.type === 'shape' || l.type === 'border') && (
              <>
                <Divider sx={{ borderStyle: 'dashed' }} />
                <Typography variant="overline" sx={{ color: 'text.disabled' }}>Frame</Typography>
                <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
                  <TextField size="small" type="color" label="Colour" value={l.style?.color ?? '#c9a227'} onChange={(e) => d.updateStyle(l.id, { color: e.target.value })} />
                  <TextField size="small" type="number" label="Line width" value={l.style?.border_width ?? 2} onChange={(e) => d.updateStyle(l.id, { border_width: num(e.target.value) })} />
                </Box>
              </>
            )}

            {(l.type === 'image' || l.type === 'background') && (
              <>
                <Divider sx={{ borderStyle: 'dashed' }} />
                <Typography variant="overline" sx={{ color: 'text.disabled' }}>{l.type === 'background' ? 'Page background' : 'Image'}</Typography>
                {l.asset_id ? <Box component="img" src={l.asset_url || `/api/assets/${l.asset_id}/file`} alt={l.name} sx={{ width: 1, borderRadius: 1, border: (t) => `1px solid ${t.vars.palette.divider}` }} /> : <Typography variant="caption" sx={{ color: 'text.disabled' }}>No artwork — pick one from the Assets tab.</Typography>}
                {l.type === 'background' && <TextField size="small" type="color" label="Fill colour (behind artwork)" value={l.style?.fill ?? '#f7f3eb'} onChange={(e) => d.updateStyle(l.id, { fill: e.target.value })} />}
                {l.type === 'image' && <TextField select size="small" label="Fit" value={l.style?.fit ?? 'contain'} onChange={(e) => d.updateStyle(l.id, { fit: e.target.value as any })}><MenuItem value="contain">Contain</MenuItem><MenuItem value="stretch">Stretch to box</MenuItem></TextField>}
                {l.asset_id && <Button size="small" color="inherit" onClick={() => d.updateLayer(l.id, { asset_id: null, asset_url: null })}>Remove artwork</Button>}
              </>
            )}
          </Stack>
        )}
      </Scrollbar>
    </Box>
  );
}
