import type { OmAsset } from 'src/sections/admin/asset-manager/om-assets-api';
import type { Page, PageItem, PageType, LayoutType, PageVersion } from './om-pages-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Grid from '@mui/material/Grid';
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
import FormControlLabel from '@mui/material/FormControlLabel';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Image } from 'src/components/image';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { PageBuilderPublicItem } from 'src/sections/latest-news/page-builder-public-item';

import { templateFor } from './page-builder-templates';
import { omPagesApi, PAGE_TYPES } from './om-pages-api';
import { PageBuilderAssetPickerDialog } from './page-builder-asset-picker-dialog';
import {
  BUILDER_COMPONENTS,
  componentDefinition,
  PageBuilderEffectsEditor,
  PageBuilderComponentConfig,
} from './page-builder-components';

// ----------------------------------------------------------------------

type TabKey = 'setup' | 'items' | 'media' | 'effects' | 'preview' | 'versions';

type Props = { id?: number };

export function PageBuilderEditView({ id }: Props) {
  const router = useRouter();
  const isNew = !id;

  const [tab, setTab] = useState<TabKey>('setup');
  const [page, setPage] = useState<Partial<Page>>({
    title: '',
    page_type: 'latest_news',
    summary: '',
    status: 'draft',
    timezone: 'America/New_York',
    publish_mode: 'manual',
    rotation_enabled: false,
    rotation_interval_seconds: 8,
    display_priority: 0,
    show_on_homepage: false,
    show_in_parish_portal: false,
    items: [],
    media: [],
  });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTargetItemId, setPickerTargetItemId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [{ campaign }, { versions: v }] = await Promise.all([
        omPagesApi.get(id),
        omPagesApi.listVersions(id),
      ]);
      setPage(campaign);
      setVersions(v);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load page');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const applyTemplate = (pageType: PageType) => {
    const t = templateFor(pageType);
    setPage((p) => ({
      ...p,
      page_type: pageType,
      title: t?.title || p.title,
      summary: t?.summary || p.summary,
      items: t && !p.id
        ? [{ ...t.item, id: -1, campaign_id: 0, sort_order: 0, status: 'active', active: true, media: [] } as any]
        : p.items,
    }));
  };

  const saveSetup = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const { campaign } = await omPagesApi.create(page);
        toast.success('Page created');
        router.replace(paths.dashboard.pageBuilder.edit(campaign.id));
      } else {
        const { campaign } = await omPagesApi.update(id!, page);
        setPage(campaign);
        toast.success('Saved');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addItem = async (layoutType: LayoutType = 'card') => {
    if (!id) { toast.error('Save the page first'); return; }
    const definition = componentDefinition(layoutType);
    try {
      const { item } = await omPagesApi.addItem(id, {
        title: definition?.label || 'New item',
        layout_type: layoutType,
        component_config: definition?.defaults || {},
        effects_config: { animation: 'none', trigger: 'in_view', duration: 0.5, opacity: 1, scale: 1 },
      });
      setPage((p) => ({ ...p, items: [...(p.items || []), item] }));
    } catch (e: any) { toast.error(e.message); }
  };

  const moveItem = async (index: number, direction: -1 | 1) => {
    const items = [...(page.items || [])];
    const target = index + direction;
    if (target < 0 || target >= items.length || !id) return;
    [items[index], items[target]] = [items[target], items[index]];
    setPage((current) => ({ ...current, items }));
    try { await omPagesApi.reorderItems(id, items.map((item) => item.id)); }
    catch (e: any) { toast.error(e.message); await load(); }
  };

  const updateItem = async (item: PageItem, patch: Partial<PageItem>) => {
    const next = { ...item, ...patch };
    setPage((p) => ({ ...p, items: (p.items || []).map((i) => (i.id === item.id ? next : i)) }));
    if (item.id < 0) return; // unsaved template item; persisted on first save
    try {
      await omPagesApi.updateItem(item.id, patch);
    } catch (e: any) { toast.error(e.message); }
  };

  const removeItem = async (item: PageItem) => {
    setPage((p) => ({ ...p, items: (p.items || []).filter((i) => i.id !== item.id) }));
    if (item.id < 0) return;
    try { await omPagesApi.deleteItem(item.id); } catch (e: any) { toast.error(e.message); }
  };

  const openPicker = (itemId: number | null) => {
    if (!id) { toast.error('Save the page first'); return; }
    setPickerTargetItemId(itemId);
    setPickerOpen(true);
  };

  const handlePick = async (asset: OmAsset) => {
    setPickerOpen(false);
    if (!id) return;
    try {
      const fileUrl = asset.url || asset.public_url || `/api/assets/${asset.id}/file`;
      const { media } = await omPagesApi.attachAssetMedia({
        campaign_id: id,
        om_asset_id: asset.id,
        file_url: fileUrl,
        file_type: asset.file_type === 'video' ? 'video' : asset.file_type === 'document' ? 'document' : 'image',
        item_id: pickerTargetItemId,
        alt_text: asset.alt_text || undefined,
      });
      setPage((p) => {
        if (pickerTargetItemId) {
          return {
            ...p,
            items: (p.items || []).map((i) => (i.id === pickerTargetItemId ? { ...i, media: [...(i.media || []), media] } : i)),
          };
        }
        return { ...p, media: [...(p.media || []), media] };
      });
      toast.success('Media attached');
    } catch (e: any) { toast.error(e.message || 'Failed to attach media'); }
  };

  const patchMedia = async (mediaId: number, patch: Partial<Page['media'][number]>) => {
    try {
      const { media } = await omPagesApi.updateMedia(mediaId, patch);
      setPage((current) => ({
        ...current,
        media: (current.media || []).map((entry) => (entry.id === mediaId ? media : entry)),
        items: (current.items || []).map((item) => ({
          ...item,
          media: (item.media || []).map((entry) => (entry.id === mediaId ? media : entry)),
        })),
      }));
    } catch (e: any) { toast.error(e.message); }
  };

  const removeMedia = async (mediaId: number, itemId: number | null) => {
    try {
      await omPagesApi.deleteMedia(mediaId);
      setPage((p) => (itemId
        ? { ...p, items: (p.items || []).map((i) => (i.id === itemId ? { ...i, media: (i.media || []).filter((m) => m.id !== mediaId) } : i)) }
        : { ...p, media: (p.media || []).filter((m) => m.id !== mediaId) }));
    } catch (e: any) { toast.error(e.message); }
  };

  const saveDraft = async () => {
    if (!id) { toast.error('Save the setup tab first'); return; }
    setSaving(true);
    try {
      const { version } = await omPagesApi.saveVersion(id);
      setVersions((v) => [version, ...v]);
      toast.success('Draft saved');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const publish = async (versionId: number) => {
    if (!id) return;
    setSaving(true);
    try {
      const { campaign } = await omPagesApi.publishVersion(id, versionId);
      setPage(campaign);
      const { versions: v } = await omPagesApi.listVersions(id);
      setVersions(v);
      toast.success('Published');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const publishNow = async () => {
    if (!id) { toast.error('Save the setup tab first'); return; }
    setSaving(true);
    try {
      const { version } = await omPagesApi.saveVersion(id, 'Published from editor');
      await publish(version.id);
    } finally { setSaving(false); }
  };

  if (loading) {
    return <Stack sx={{ py: 10, alignItems: 'center' }}><CircularProgress /></Stack>;
  }

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading={isNew ? 'New page' : page.title || 'Edit page'}
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'Page Builder', href: paths.dashboard.pageBuilder.root },
          { name: isNew ? 'New' : page.title || '' },
        ]}
        action={
          <Stack direction="row" spacing={1}>
            {!isNew && (
              <Button
                variant="text"
                startIcon={<Iconify icon="solar:eye-bold" />}
                href="/latest-news"
                target="_blank"
                component="a"
              >
                View live page
              </Button>
            )}
            <Button variant="outlined" loading={saving} onClick={saveDraft} disabled={isNew}>
              Save draft
            </Button>
            <Button variant="contained" loading={saving} onClick={isNew ? saveSetup : publishNow}>
              {isNew ? 'Create page' : 'Publish now'}
            </Button>
          </Stack>
        }
        sx={{ mb: 3 }}
      />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab value="setup" label="Setup" />
        <Tab value="items" label={`Items${page.items?.length ? ` (${page.items.length})` : ''}`} disabled={isNew} />
        <Tab value="media" label="Media" disabled={isNew} />
        <Tab value="effects" label="Effects" disabled={isNew} />
        <Tab value="preview" label="Preview" disabled={isNew} />
        <Tab value="versions" label={`Versions${versions.length ? ` (${versions.length})` : ''}`} disabled={isNew} />
      </Tabs>

      {tab === 'setup' && (
        <Card sx={{ p: 3 }}>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>Page type</InputLabel>
                <Select
                  label="Page type"
                  value={page.page_type}
                  onChange={(e) => applyTemplate(e.target.value as PageType)}
                >
                  {PAGE_TYPES.map((pt) => <MenuItem key={pt.value} value={pt.value}>{pt.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth label="Display priority" type="number"
                value={page.display_priority ?? 0}
                onChange={(e) => setPage((p) => ({ ...p, display_priority: Number(e.target.value) }))}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth label="Title"
                value={page.title || ''}
                onChange={(e) => setPage((p) => ({ ...p, title: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth label="Summary" multiline rows={2}
                value={page.summary || ''}
                onChange={(e) => setPage((p) => ({ ...p, summary: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth label="Visible from" type="datetime-local"
                slotProps={{ inputLabel: { shrink: true } }}
                value={page.visibility_start_at ? page.visibility_start_at.slice(0, 16) : ''}
                onChange={(e) => setPage((p) => ({ ...p, visibility_start_at: e.target.value || null }))}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth label="Visible until" type="datetime-local"
                slotProps={{ inputLabel: { shrink: true } }}
                value={page.visibility_end_at ? page.visibility_end_at.slice(0, 16) : ''}
                onChange={(e) => setPage((p) => ({ ...p, visibility_end_at: e.target.value || null }))}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControlLabel
                control={<Switch checked={!!page.rotation_enabled} onChange={(e) => setPage((p) => ({ ...p, rotation_enabled: e.target.checked }))} />}
                label="Rotate items"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControlLabel
                control={<Switch checked={!!page.show_on_homepage} onChange={(e) => setPage((p) => ({ ...p, show_on_homepage: e.target.checked }))} />}
                label="Show on homepage"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControlLabel
                control={<Switch checked={!!page.show_in_parish_portal} onChange={(e) => setPage((p) => ({ ...p, show_in_parish_portal: e.target.checked }))} />}
                label="Show in Parish Portal"
              />
            </Grid>
          </Grid>
          <Divider sx={{ my: 3 }} />
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button variant="contained" loading={saving} onClick={saveSetup}>
              {isNew ? 'Create page' : 'Save setup'}
            </Button>
          </Stack>
        </Card>
      )}

      {tab === 'items' && (
        <Stack spacing={2}>
          <Card sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Component library</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              Add Minimal UI content, interaction and presentation components. Every component is saved in the page version and rendered on the public site.
            </Typography>
            <Grid container spacing={1.5}>
              {BUILDER_COMPONENTS.map((component) => (
                <Grid key={component.type} size={{ xs: 6, sm: 4, md: 3 }}>
                  <Card
                    variant="outlined"
                    onClick={() => addItem(component.type)}
                    sx={{ p: 1.5, height: 1, cursor: 'pointer', '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                      <Iconify icon={component.icon as any} width={20} sx={{ color: 'primary.main' }} />
                      <Typography variant="subtitle2">{component.label}</Typography>
                    </Stack>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{component.description}</Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Card>

          {(page.items || []).map((item, index) => (
            <Card key={item.id} sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
                <Label variant="soft">{componentDefinition(item.layout_type)?.label || item.layout_type}</Label>
                <Box sx={{ flex: 1 }} />
                <FormControlLabel control={<Switch size="small" checked={item.active} onChange={(event) => updateItem(item, { active: event.target.checked, status: event.target.checked ? 'active' : 'disabled' })} />} label="Visible" />
                <IconButton size="small" disabled={index === 0} onClick={() => moveItem(index, -1)}><Iconify icon="eva:arrow-ios-upward-fill" /></IconButton>
                <IconButton size="small" disabled={index === (page.items || []).length - 1} onClick={() => moveItem(index, 1)}><Iconify icon="eva:arrow-ios-downward-fill" /></IconButton>
              </Stack>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField fullWidth label="Title" value={item.title} onChange={(e) => updateItem(item, { title: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField fullWidth label="Subtitle" value={item.subtitle || ''} onChange={(e) => updateItem(item, { subtitle: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField fullWidth multiline rows={3} label="Body" value={item.body || ''} onChange={(e) => updateItem(item, { body: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <FormControl fullWidth>
                    <InputLabel>Layout</InputLabel>
                    <Select label="Layout" value={item.layout_type} onChange={(e) => updateItem(item, { layout_type: e.target.value as LayoutType })}>
                      {BUILDER_COMPONENTS.map((component) => <MenuItem key={component.type} value={component.type}>{component.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField fullWidth label="CTA label" value={item.cta_label || ''} onChange={(e) => updateItem(item, { cta_label: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField fullWidth label="CTA URL" value={item.cta_url || ''} onChange={(e) => updateItem(item, { cta_url: e.target.value })} />
                </Grid>
              </Grid>

              <Box sx={{ mt: 2, p: 2, borderRadius: 1.5, bgcolor: 'background.neutral' }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                  {componentDefinition(item.layout_type)?.label || item.layout_type} settings
                </Typography>
                <PageBuilderComponentConfig
                  item={item}
                  onChange={(component_config) => updateItem(item, { component_config })}
                />
              </Box>

              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
                {(item.media || []).map((m) => (
                  <Box key={m.id} sx={{ position: 'relative', width: 72, height: 72 }}>
                    {m.file_type === 'image' ? (
                      <Image src={m.file_url} sx={{ borderRadius: 1, width: 1, height: 1 }} />
                    ) : (
                      <Box sx={{ width: 1, height: 1, borderRadius: 1, bgcolor: 'background.neutral', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Iconify icon="solar:file-text-bold" />
                      </Box>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => removeMedia(m.id, item.id)}
                      sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper', boxShadow: 1 }}
                    >
                      <Iconify icon="solar:close-circle-bold" width={16} />
                    </IconButton>
                  </Box>
                ))}
                <Button size="small" variant="outlined" startIcon={<Iconify icon="solar:gallery-add-bold" />} onClick={() => openPicker(item.id)}>
                  Add media
                </Button>
              </Stack>

              <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1.5 }}>
                <Button size="small" color="error" onClick={() => removeItem(item)}>Remove item</Button>
              </Stack>
            </Card>
          ))}
          <Button variant="outlined" startIcon={<Iconify icon="mingcute:add-line" />} onClick={() => addItem('card')}>
            Add item
          </Button>
        </Stack>
      )}

      {tab === 'media' && (
        <Stack spacing={2}>
          <Card sx={{ p: 2.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6">Asset Manager media</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Browse the real public/site asset library. Attached media stays linked to its Asset Manager record.
                </Typography>
              </Box>
              <Button variant="outlined" href={paths.dashboard.assetManager} target="_blank" component="a">Open Asset Manager</Button>
              <Button variant="contained" startIcon={<Iconify icon="solar:gallery-add-bold" />} onClick={() => openPicker(null)}>Attach media</Button>
            </Stack>
          </Card>
          <Grid container spacing={2}>
            {(page.media || []).map((media) => (
              <Grid key={media.id} size={{ xs: 12, md: 6 }}>
                <Card variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" spacing={2}>
                    <Box sx={{ width: 128, height: 96, flexShrink: 0 }}>
                      {media.file_type === 'image' ? <Image src={media.file_url} sx={{ borderRadius: 1, width: 1, height: 1 }} /> : <Box sx={{ width: 1, height: 1, borderRadius: 1, bgcolor: 'background.neutral', display: 'grid', placeItems: 'center' }}><Iconify icon="solar:file-text-bold" width={30} /></Box>}
                    </Box>
                    <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                      <TextField size="small" label="Alt text" defaultValue={media.alt_text || ''} onBlur={(event) => patchMedia(media.id, { alt_text: event.target.value })} />
                      <TextField size="small" label="Caption" defaultValue={media.caption || ''} onBlur={(event) => patchMedia(media.id, { caption: event.target.value })} />
                      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <FormControlLabel control={<Switch size="small" checked={media.is_primary} onChange={(event) => patchMedia(media.id, { is_primary: event.target.checked })} />} label="Primary" />
                        <IconButton color="error" size="small" onClick={() => removeMedia(media.id, null)}><Iconify icon="solar:trash-bin-trash-bold" /></IconButton>
                      </Stack>
                    </Stack>
                  </Stack>
                </Card>
              </Grid>
            ))}
          </Grid>
          {!page.media?.length && <Card sx={{ p: 6, textAlign: 'center' }}><Typography color="text.secondary">No page-level media attached yet.</Typography></Card>}
        </Stack>
      )}

      {tab === 'effects' && (
        <Stack spacing={2}>
          <Card sx={{ p: 2.5 }}>
            <Typography variant="h6">Effects</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Configure Minimal-style motion, in-view triggers, transforms, sticky positioning and scroll progress per item.
            </Typography>
          </Card>
          {(page.items || []).map((item) => (
            <Card key={item.id} sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
                <Iconify icon={(componentDefinition(item.layout_type)?.icon || 'solar:widget-5-bold-duotone') as any} width={22} sx={{ color: 'primary.main' }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1">{item.title}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{componentDefinition(item.layout_type)?.label || item.layout_type}</Typography>
                </Box>
              </Stack>
              <PageBuilderEffectsEditor
                effects={item.effects_config || {}}
                onChange={(effects_config) => updateItem(item, { effects_config })}
              />
            </Card>
          ))}
          {!page.items?.length && (
            <Card sx={{ p: 5, textAlign: 'center' }}><Typography color="text.secondary">Add an item before configuring effects.</Typography></Card>
          )}
        </Stack>
      )}

      {tab === 'preview' && (
        <Card sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.default' }}>
          <Box sx={{ mb: 4, textAlign: 'center' }}>
            <Label color="warning" variant="soft" sx={{ mb: 1.5 }}>Draft preview</Label>
            <Typography variant="h2">{page.title}</Typography>
            {page.summary && <Typography sx={{ mt: 1, color: 'text.secondary' }}>{page.summary}</Typography>}
          </Box>
          <Stack spacing={{ xs: 4, md: 6 }}>
            {(page.items || []).filter((item) => item.active && item.status !== 'disabled').map((item) => (
              <PageBuilderPublicItem key={item.id} item={item} />
            ))}
          </Stack>
        </Card>
      )}

      {tab === 'versions' && (
        <Card>
          {versions.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography color="text.secondary">No versions saved yet. Use &quot;Save draft&quot; to create one.</Typography>
            </Box>
          ) : (
            <Scrollbar>
              <Stack divider={<Divider />}>
                {versions.map((v) => (
                  <Stack key={v.id} direction="row" spacing={2} sx={{ alignItems: 'center', p: 2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {v.label || `Version #${v.id}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Saved {fDateTime(v.created_at)}
                        {v.published_at ? ` · Published ${fDateTime(v.published_at)}` : ''}
                      </Typography>
                    </Box>
                    <Label color={v.id === page.published_version_id ? 'success' : 'default'} variant="soft">
                      {v.id === page.published_version_id ? 'live' : v.status}
                    </Label>
                    {v.id !== page.published_version_id && (
                      <Button size="small" variant="outlined" onClick={() => publish(v.id)}>Publish this version</Button>
                    )}
                  </Stack>
                ))}
              </Stack>
            </Scrollbar>
          )}
        </Card>
      )}

      <PageBuilderAssetPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={handlePick} />
    </Box>
  );
}
