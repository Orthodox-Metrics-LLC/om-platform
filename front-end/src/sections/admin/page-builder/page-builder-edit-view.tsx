import type { OmAsset } from 'src/sections/asset-manager/om-assets-api';
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

import { templateFor } from './page-builder-templates';
import { omPagesApi, PAGE_TYPES } from './om-pages-api';
import { PageBuilderAssetPickerDialog } from './page-builder-asset-picker-dialog';

// ----------------------------------------------------------------------

const LAYOUT_TYPES: LayoutType[] = ['hero', 'split', 'card', 'banner', 'quote', 'image_grid', 'video'];

type TabKey = 'setup' | 'items' | 'media' | 'versions';

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

  const addItem = async () => {
    if (!id) { toast.error('Save the page first'); return; }
    try {
      const { item } = await omPagesApi.addItem(id, { title: 'New item', layout_type: 'card' });
      setPage((p) => ({ ...p, items: [...(p.items || []), item] }));
    } catch (e: any) { toast.error(e.message); }
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
        <Tab value="items" label="Items" disabled={isNew} />
        <Tab value="media" label="Media" disabled={isNew} />
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
          {(page.items || []).map((item) => (
            <Card key={item.id} sx={{ p: 2.5 }}>
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
                      {LAYOUT_TYPES.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
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
          <Button variant="outlined" startIcon={<Iconify icon="mingcute:add-line" />} onClick={addItem}>
            Add item
          </Button>
        </Stack>
      )}

      {tab === 'media' && (
        <Card sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Page-level media</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {(page.media || []).map((m) => (
              <Box key={m.id} sx={{ position: 'relative', width: 96, height: 96 }}>
                {m.file_type === 'image' ? (
                  <Image src={m.file_url} sx={{ borderRadius: 1, width: 1, height: 1 }} />
                ) : (
                  <Box sx={{ width: 1, height: 1, borderRadius: 1, bgcolor: 'background.neutral', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Iconify icon="solar:file-text-bold" />
                  </Box>
                )}
                <IconButton
                  size="small"
                  onClick={() => removeMedia(m.id, null)}
                  sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper', boxShadow: 1 }}
                >
                  <Iconify icon="solar:close-circle-bold" width={16} />
                </IconButton>
              </Box>
            ))}
            <Button variant="outlined" startIcon={<Iconify icon="solar:gallery-add-bold" />} onClick={() => openPicker(null)}>
              Add from Asset Manager
            </Button>
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
