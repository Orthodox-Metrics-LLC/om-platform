import type { CertificateType, CertificateTemplate } from './om-certificates-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fDateTime } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomPopover } from 'src/components/custom-popover';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useRecordsChurch } from '../use-records-church';
import { omCertificatesApi, CERTIFICATE_TYPES } from './om-certificates-api';

// ----------------------------------------------------------------------

/** Templates: Orthodox Metrics (shared) and this parish's own, with a live thumbnail of the layout. */
export function CertificateTemplatesView() {
  const { churchId, platform } = useRecordsChurch();
  const [type, setType] = useState<CertificateType | 'all'>('all');
  const [data, setData] = useState<{ templates: CertificateTemplate[]; canDesignGlobal: boolean; canDesignParish: boolean } | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; t: CertificateTemplate } | null>(null);
  const [confirm, setConfirm] = useState<{ t: CertificateTemplate; action: 'archive' | 'delete' } | null>(null);
  const suffix = platform && churchId ? `?church=${churchId}` : '';

  const load = useCallback(() => omCertificatesApi.templates({ churchId, type: type === 'all' ? null : type, includeArchived: true }).then(setData).catch((e) => toast.error(e.message)), [churchId, type]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } setMenu(null); setConfirm(null); };
  const canDesign = data ? data.canDesignGlobal || data.canDesignParish : false;
  const canEdit = (t: CertificateTemplate) => (t.scope === 'global' ? !!data?.canDesignGlobal : !!data?.canDesignParish);

  const groups: { key: string; title: string; caption: string; items: CertificateTemplate[] }[] = data ? [
    { key: 'church', title: 'Parish templates', caption: 'Stored in this church’s own database — editable by church admins and clergy.', items: data.templates.filter((t) => t.scope === 'church') },
    { key: 'global', title: 'Orthodox Metrics templates', caption: 'Shared with every parish. Copy one to your parish to customise it.', items: data.templates.filter((t) => t.scope === 'global') },
  ] : [];

  const card = (t: CertificateTemplate) => {
    const bgAsset = t.thumbnail_asset_id ?? t.layout_json?.layers?.find((l) => l.type === 'background' && l.asset_id)?.asset_id ?? null;
    const typeMeta = CERTIFICATE_TYPES.find((c) => c.value === t.certificate_type);
    return (
      <Card key={t.id} sx={{ display: 'flex', flexDirection: 'column', opacity: t.status === 'archived' ? 0.6 : 1 }}>
        <Box component={RouterLink} href={`${paths.portal.records.certificateDesigner(t.id)}${suffix}`} sx={{ position: 'relative', aspectRatio: t.orientation === 'landscape' ? '11 / 8.5' : '8.5 / 11', maxHeight: 260, bgcolor: 'background.neutral', display: 'block', overflow: 'hidden' }}>
          {bgAsset ? <Box component="img" src={`/api/assets/${bgAsset}/file`} alt={t.name} sx={{ width: 1, height: 1, objectFit: 'contain', display: 'block' }} /> : <Box sx={{ width: 1, height: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}><Iconify icon="solar:gallery-wide-bold" width={48} /></Box>}
          <Box sx={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 0.5 }}>
            <Label variant="filled" color={typeMeta?.color ?? 'default'} sx={{ textTransform: 'capitalize' }}>{t.certificate_type}</Label>
            {t.is_default && <Label variant="filled" color="success">Default</Label>}
          </Box>
          <Label variant="soft" color={t.status === 'active' ? 'success' : t.status === 'archived' ? 'default' : 'warning'} sx={{ position: 'absolute', top: 8, right: 8 }}>{t.status}</Label>
        </Box>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="subtitle2" noWrap>{t.name}</Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>v{t.version_number ?? 1} · {t.canvas_size.toUpperCase()} {t.orientation} · {fDateTime(t.updated_at)}</Typography>
          </Box>
          <IconButton size="small" onClick={(e) => setMenu({ el: e.currentTarget, t })}><Iconify icon="eva:more-vertical-fill" /></IconButton>
        </Box>
      </Card>
    );
  };

  return (
    <DashboardContent maxWidth="xl">
      <CustomBreadcrumbs heading="Certificate templates" links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Certificates', href: `${paths.portal.records.certificates}${suffix}` }, { name: 'Templates' }]}
        action={canDesign && <Button component={RouterLink} href={`${paths.portal.records.certificateDesigner('new')}${suffix}`} variant="contained" startIcon={<Iconify icon="mingcute:add-line" />}>New template</Button>} sx={{ mb: 3 }} />

      <Tabs value={type} onChange={(_, v) => setType(v)} sx={{ mb: 3 }}>
        <Tab value="all" label="All" />{CERTIFICATE_TYPES.map((c) => <Tab key={c.value} value={c.value} label={c.label} />)}
      </Tabs>

      {!data ? <LinearProgress /> : groups.map((g) => (
        <Box key={g.key} sx={{ mb: 5 }}>
          <Typography variant="h6">{g.title}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{g.caption}</Typography>
          {g.items.length ? (
            <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' } }}>{g.items.map(card)}</Box>
          ) : (
            <Card sx={{ p: 4, textAlign: 'center', color: 'text.disabled' }}>
              <Typography variant="body2">{g.key === 'church' ? 'No parish templates yet. Copy an Orthodox Metrics template below or create a new one.' : 'No templates.'}</Typography>
            </Card>
          )}
        </Box>
      ))}

      <CustomPopover open={!!menu} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        {menu && (
          <MenuList>
            <MenuItem component={RouterLink} href={`${paths.portal.records.certificateDesigner(menu.t.id)}${suffix}`}><Iconify icon={canEdit(menu.t) ? 'solar:pen-bold' : 'solar:eye-bold'} />{canEdit(menu.t) ? 'Open in designer' : 'View'}</MenuItem>
            <MenuItem component={RouterLink} href={`${paths.portal.records.certificates}?template=${menu.t.id}${platform && churchId ? `&church=${churchId}` : ''}`}><Iconify icon="solar:verified-check-bold" />Generate with this</MenuItem>
            {(data?.canDesignParish || data?.canDesignGlobal) && <MenuItem onClick={() => act(() => omCertificatesApi.duplicate(menu.t.id, { church_id: churchId, scope: menu.t.scope === 'global' && data?.canDesignGlobal && !churchId ? 'global' : 'church' }), 'Template copied')}><Iconify icon="solar:copy-bold" />{menu.t.scope === 'global' && !data?.canDesignGlobal ? 'Copy to parish' : 'Duplicate'}</MenuItem>}
            {canEdit(menu.t) && menu.t.status === 'active' && !menu.t.is_default && <MenuItem onClick={() => act(() => omCertificatesApi.setDefault(menu.t.id, churchId), 'Set as default')}><Iconify icon="eva:star-fill" />Make default</MenuItem>}
            {canEdit(menu.t) && menu.t.status !== 'archived' && <MenuItem onClick={() => setConfirm({ t: menu.t, action: 'archive' })} sx={{ color: 'warning.main' }}><Iconify icon="solar:archive-down-minimlistic-bold" />Archive</MenuItem>}
            {canEdit(menu.t) && menu.t.status !== 'active' && <MenuItem onClick={() => setConfirm({ t: menu.t, action: 'delete' })} sx={{ color: 'error.main' }}><Iconify icon="solar:trash-bin-trash-bold" />Delete</MenuItem>}
          </MenuList>
        )}
      </CustomPopover>

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.action === 'delete' ? 'Delete template' : 'Archive template'} content={<>{confirm?.action === 'delete' ? 'Permanently delete' : 'Archive'} <strong>{confirm?.t.name}</strong>?</>}
        action={<Button variant="contained" color={confirm?.action === 'delete' ? 'error' : 'warning'} onClick={() => confirm && act(() => (confirm.action === 'delete' ? omCertificatesApi.remove(confirm.t.id, churchId) : omCertificatesApi.archive(confirm.t.id, churchId)), confirm.action === 'delete' ? 'Deleted' : 'Archived')}>{confirm?.action === 'delete' ? 'Delete' : 'Archive'}</Button>} />
    </DashboardContent>
  );
}
