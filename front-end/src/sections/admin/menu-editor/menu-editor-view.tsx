import type { NavItemNode, CatalogItem, MenuAudience, MenuTemplate, NavSectionNode } from './om-menus-api';

import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Tabs from '@mui/material/Tabs';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';
import { navFromTemplate } from 'src/layouts/nav-template';
import { NAV_ICONS } from 'src/layouts/nav-config-dashboard';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { NavSectionVertical } from 'src/components/nav-section';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { omMenusApi, AUDIENCE_LABELS } from './om-menus-api';

// ----------------------------------------------------------------------

const AUDIENCES: MenuAudience[] = ['admin', 'church', 'limited'];
const ICON_OPTIONS = Object.keys(NAV_ICONS);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const move = <T,>(arr: T[], i: number, dir: -1 | 1) => {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
};

export function MenuEditorView() {
  const [audience, setAudience] = useState<MenuAudience>('church');
  const [templates, setTemplates] = useState<MenuTemplate[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [template, setTemplate] = useState<MenuTemplate | null>(null);
  const [nav, setNav] = useState<NavSectionNode[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([omMenusApi.templates(), omMenusApi.catalog()]);
    setTemplates(t.templates);
    setCatalog(c.items);
    return t.templates;
  }, []);

  useEffect(() => {
    load().then((all) => {
      const active = all.find((x) => x.audience === 'church' && x.is_active) || all.find((x) => x.audience === 'church');
      setTemplate(active || null);
      setNav(clone(active?.nav || []));
      setLoading(false);
    }).catch((e) => { toast.error(e.message); setLoading(false); });
  }, [load]);

  const pick = (aud: MenuAudience, id?: number) => {
    const t = id != null
      ? templates.find((x) => x.id === id) || null
      : templates.find((x) => x.audience === aud && x.is_active) || templates.find((x) => x.audience === aud) || null;
    setAudience(aud);
    setTemplate(t);
    setNav(clone(t?.nav || []));
    setDirty(false);
  };

  const patch = (fn: (n: NavSectionNode[]) => void) => {
    const n = clone(nav);
    fn(n);
    setNav(n);
    setDirty(true);
  };

  // ---- tree mutation helpers -------------------------------------------------
  const forItem = (si: number, trail: number[], fn: (item: NavItemNode, sibs: NavItemNode[], idx: number) => void) =>
    patch((n) => {
      let sibs = n[si].items;
      for (let d = 0; d < trail.length - 1; d++) sibs = sibs[trail[d]].children ||= [];
      fn(sibs[trail[trail.length - 1]], sibs, trail[trail.length - 1]);
    });

  // ---- template actions --------------------------------------------------------
  const save = async (activate = false) => {
    try {
      if (!template) {
        const r = await omMenusApi.create(audience, `${AUDIENCE_LABELS[audience]} menu`, nav);
        if (activate) await omMenusApi.activate(r.id);
        toast.success('Template created');
      } else {
        await omMenusApi.update(template.id, { name: template.name, nav });
        if (activate && !template.is_active) await omMenusApi.activate(template.id);
        toast.success(activate ? 'Saved and activated' : 'Saved');
      }
      const all = await load();
      const cur = template ? all.find((x) => x.id === template.id) : all.filter((x) => x.audience === audience).pop();
      setTemplates(all);
      setTemplate(cur || null);
      setDirty(false);
    } catch (e: any) { toast.error(e.message); }
  };

  const activate = async () => {
    if (!template) return;
    try {
      if (dirty) await save(true);
      else { await omMenusApi.activate(template.id); toast.success('Template is now live for this role'); }
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async () => {
    if (!template) return;
    try {
      await omMenusApi.remove(template.id);
      toast.success('Template deleted');
      const all = await load();
      setTemplates(all);
      pick(audience);
    } catch (e: any) { toast.error(e.message); }
  };

  const newDraft = async () => {
    try {
      const r = await omMenusApi.create(audience, `${AUDIENCE_LABELS[audience]} — copy`, nav);
      const all = await load();
      setTemplates(all);
      pick(audience, r.id);
      toast.success('Draft created');
    } catch (e: any) { toast.error(e.message); }
  };

  const previewData = useMemo(() => navFromTemplate(nav), [nav]);
  const audienceTemplates = templates.filter((t) => t.audience === audience);
  const audienceCatalog = catalog.filter((c) => c.audiences.includes(audience));

  if (loading) return <Stack sx={{ py: 10, alignItems: 'center' }}><CircularProgress /></Stack>;

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading="Menu editor"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'Menu editor' }]}
        sx={{ mb: 3 }}
      />
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, maxWidth: 720 }}>
        Build the left-hand menu each role sees at login. Choose an audience, arrange sections and items
        (the master menu lists everything that audience may include), then <b>Save &amp; activate</b> to publish.
        Hidden items are still blocked by route permissions — this controls the menu, not access.
      </Typography>

      <Tabs value={audience} onChange={(_, v) => pick(v)} sx={{ mb: 3 }}>
        {AUDIENCES.map((a) => (
          <Tab key={a} value={a} label={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {AUDIENCE_LABELS[a]}
              {templates.some((t) => t.audience === a && t.is_active) && <Chip size="small" color="success" label="live" variant="outlined" />}
            </Stack>
          } />
        ))}
      </Tabs>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        {/* ---------------------------------------------------------- editor */}
        <Card sx={{ flex: 1, p: 2.5, minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Template</InputLabel>
              <Select
                label="Template"
                value={template?.id ?? ''}
                onChange={(e) => pick(audience, Number(e.target.value))}
              >
                {audienceTemplates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}{t.is_active ? ' — live' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small" label="Name" sx={{ flex: 1, minWidth: 160 }}
              value={template?.name ?? ''}
              onChange={(e) => setTemplate((t) => (t ? { ...t, name: e.target.value } : t))}
            />
            <Button size="small" variant="outlined" onClick={newDraft} startIcon={<Iconify icon="mingcute:add-line" />}>New draft</Button>
            {!!template && !template.is_active && (
              <Button size="small" color="error" variant="outlined" onClick={remove}>Delete</Button>
            )}
          </Stack>

          <Scrollbar sx={{ maxHeight: 640 }}>
            <Stack spacing={2}>
              {nav.map((section, si) => (
                <Card key={si} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center' }}>
                    <TextField
                      size="small" label="Section" value={section.subheader}
                      onChange={(e) => patch((n) => { n[si].subheader = e.target.value; })}
                      sx={{ flex: 1 }}
                    />
                    <IconButton size="small" disabled={si === 0} onClick={() => patch((n) => move(n, si, -1))}><Iconify icon="eva:arrow-ios-upward-fill" /></IconButton>
                    <IconButton size="small" disabled={si === nav.length - 1} onClick={() => patch((n) => move(n, si, 1))}><Iconify icon="eva:arrow-ios-downward-fill" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => patch((n) => { n.splice(si, 1); })}><Iconify icon="solar:trash-bin-trash-bold" /></IconButton>
                  </Stack>

                  <Stack spacing={0.5}>
                    {section.items.map((item, ii) => (
                      <ItemRow
                        key={ii}
                        item={item}
                        trail={[ii]}
                        onChange={(fn) => forItem(si, [ii], fn)}
                        onMove={(dir) => patch((n) => move(n[si].items, ii, dir))}
                        onRemove={() => patch((n) => { n[si].items.splice(ii, 1); })}
                        onAddChild={() => forItem(si, [ii], (it) => { (it.children ||= []).push({ title: 'New item', path: '/dashboard' }); })}
                        first={ii === 0}
                        last={ii === section.items.length - 1}
                        si={si}
                        forItem={forItem}
                      />
                    ))}
                  </Stack>

                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    <FormControl size="small" sx={{ minWidth: 240 }}>
                      <InputLabel>Add from master menu</InputLabel>
                      <Select
                        label="Add from master menu" value=""
                        onChange={(e) => {
                          const c = audienceCatalog.find((x) => x.item_key === e.target.value);
                          if (!c) return;
                          patch((n) => n[si].items.push({
                            title: c.title, path: c.path, icon: c.icon, caption: c.caption,
                            info: c.info_label ? { label: c.info_label, color: c.info_color || 'info', icon: c.info_icon || undefined } : null,
                            children: clone(c.children || null),
                          }));
                        }}
                      >
                        {audienceCatalog.map((c) => <MenuItem key={c.item_key} value={c.item_key}>{c.title} — {c.path}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <Button
                      size="small" variant="text"
                      onClick={() => patch((n) => n[si].items.push({ title: 'Custom item', path: '/dashboard', icon: 'menuItem' }))}
                    >
                      Custom item
                    </Button>
                  </Stack>
                </Card>
              ))}

              <Button
                variant="outlined" startIcon={<Iconify icon="mingcute:add-line" />}
                onClick={() => patch((n) => n.push({ subheader: 'New section', items: [] }))}
              >
                Add section
              </Button>
            </Stack>
          </Scrollbar>

          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
            <Button variant="outlined" disabled={!dirty} onClick={() => save(false)}>Save draft</Button>
            <Button
              variant="contained" disabled={!dirty && !!template?.is_active}
              onClick={activate}
            >
              {template?.is_active && !dirty ? 'Live' : 'Save & activate'}
            </Button>
          </Stack>
        </Card>

        {/* ---------------------------------------------------------- preview */}
        <Card sx={{ width: 300, flexShrink: 0, position: 'sticky', top: 88 }}>
          <Typography variant="overline" sx={{ px: 2, pt: 2, display: 'block', color: 'text.secondary' }}>
            Live preview — {AUDIENCE_LABELS[audience]}
          </Typography>
          <Box sx={{ p: 1.5, maxHeight: 680, overflow: 'auto' }}>
            {previewData?.length
              ? <NavSectionVertical data={previewData} sx={{ '--nav-item-gap': '4px' } as any} />
              : <Typography variant="body2" sx={{ color: 'text.disabled', p: 2 }}>Empty menu</Typography>}
          </Box>
        </Card>
      </Stack>
    </DashboardContent>
  );
}

// ----------------------------------------------------------------------

type ItemRowProps = {
  item: NavItemNode;
  trail: number[];
  si: number;
  depth?: number;
  first: boolean;
  last: boolean;
  onChange: (fn: (item: NavItemNode, sibs: NavItemNode[], idx: number) => void) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddChild: () => void;
  forItem: (si: number, trail: number[], fn: (item: NavItemNode, sibs: NavItemNode[], idx: number) => void) => void;
};

function ItemRow({ item, trail, si, depth = 0, first, last, onChange, onMove, onRemove, onAddChild, forItem }: ItemRowProps) {
  const [open, setOpen] = useState(depth === 0 && !!item.children?.length);
  return (
    <Box sx={{ ml: depth * 3 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', py: 0.5, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
        <IconButton size="small" onClick={() => setOpen(!open)}>
          <Iconify icon={open ? 'eva:arrow-ios-downward-fill' : 'eva:arrow-ios-forward-fill'} width={14} />
        </IconButton>
        <FormControl size="small" sx={{ width: 120 }}>
          <Select
            value={item.icon || ''} displayEmpty
            onChange={(e) => onChange((it) => { it.icon = e.target.value || null; })}
            renderValue={(v) => v ? <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>{NAV_ICONS[v as keyof typeof NAV_ICONS] || <Iconify icon={String(v) as any} width={16} />}<Typography variant="caption">{String(v)}</Typography></Stack> : <Typography variant="caption" color="text.disabled">icon</Typography>}
          >
            <MenuItem value=""><em>None</em></MenuItem>
            {ICON_OPTIONS.map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
            {item.icon && !ICON_OPTIONS.includes(item.icon) && <MenuItem value={item.icon}>{item.icon}</MenuItem>}
          </Select>
        </FormControl>
        <TextField size="small" value={item.title} onChange={(e) => onChange((it) => { it.title = e.target.value; })} sx={{ width: 160, '& input': { fontSize: 13 } }} />
        <TextField size="small" value={item.path} onChange={(e) => onChange((it) => { it.path = e.target.value; })} sx={{ flex: 1, '& input': { fontSize: 12, fontFamily: 'monospace' } }} />
        <Switch
          size="small" checked={!item.disabled}
          onChange={(e) => onChange((it) => { it.disabled = !e.target.checked; })}
        />
        <IconButton size="small" disabled={first} onClick={() => onMove(-1)}><Iconify icon="eva:arrow-ios-upward-fill" width={14} /></IconButton>
        <IconButton size="small" disabled={last} onClick={() => onMove(1)}><Iconify icon="eva:arrow-ios-downward-fill" width={14} /></IconButton>
        {depth === 0 && (
          <IconButton size="small" title="Add sub-item" onClick={onAddChild}><Iconify icon="mingcute:add-line" width={14} /></IconButton>
        )}
        <IconButton size="small" color="error" onClick={onRemove}><Iconify icon="solar:trash-bin-trash-bold" width={14} /></IconButton>
      </Stack>
      {open && (
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {(item.children || []).map((child, ci) => (
            <ItemRow
              key={ci}
              item={child}
              trail={[...trail, ci]}
              si={si}
              depth={depth + 1}
              first={ci === 0}
              last={ci === (item.children?.length || 0) - 1}
              onChange={(fn) => forItem(si, [...trail, ci], fn)}
              onMove={(dir) => forItem(si, trail, (it) => { if (it.children) move(it.children, ci, dir); })}
              onRemove={() => forItem(si, trail, (it) => { it.children?.splice(ci, 1); })}
              onAddChild={() => {}}
              forItem={forItem}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}
