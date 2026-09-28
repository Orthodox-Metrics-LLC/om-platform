import type { OmAdminOverview } from 'src/sections/file-manager/om-files-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Avatar from '@mui/material/Avatar';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fToNow } from 'src/utils/format-time';
import { fData } from 'src/utils/format-number';

import { CONFIG } from 'src/global-config';

import { EmptyContent } from 'src/components/empty-content';

import { FileWidget } from 'src/sections/file-manager/file-widget';
import { omFilesApi } from 'src/sections/file-manager/om-files-api';
import { FileDataActivity } from 'src/sections/file-manager/file-data-activity';
import { FileStorageOverview } from 'src/sections/file-manager/file-storage-overview';

// ----------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROOT_ICON: Record<string, string> = {
  records: `${CONFIG.assetsDir}/assets/icons/files/ic-document.svg`,
  media: `${CONFIG.assetsDir}/assets/icons/files/ic-video.svg`,
  documents: `${CONFIG.assetsDir}/assets/icons/files/ic-folder.svg`,
};
const ACTION_LABEL: Record<string, string> = { upload: 'uploaded', create: 'created folder', rename: 'renamed', move: 'moved', delete: 'deleted', share: 'shared', unshare: 'unshared', download: 'downloaded', favorite: 'starred' };

/** Cross-tenant storage overview for super_admin/admin, filterable by jurisdiction / affiliation. */
export function AdminFilesOverviewView() {
  const [jurisdiction, setJurisdiction] = useState('');
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [ov, setOv] = useState<OmAdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([omFilesApi.adminOverview(jurisdiction || undefined, year), omFilesApi.adminChurches(undefined)]);
      setOv(o);
      setJurisdictions(c.jurisdictions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load overview');
    }
  }, [jurisdiction, year]);

  useEffect(() => { load(); }, [load]);

  if (error) return <EmptyContent filled title={error} sx={{ py: 10 }} />;
  if (!ov) return <LinearProgress />;

  const { totals } = ov;
  const usedPct = totals.quota_bytes ? Math.round((totals.used_bytes / totals.quota_bytes) * 100) : 0;
  const seriesFor = (names: string[]) => ov.activity.series.filter((s) => names.includes(s.name)).reduce((acc, s) => acc.map((v, i) => v + s.data[i]), Array(12).fill(0));
  const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Box sx={{ gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select size="small" label="Jurisdiction / affiliation" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} sx={{ minWidth: 260 }}>
            <MenuItem value="">All jurisdictions</MenuItem>
            {jurisdictions.map((j) => <MenuItem key={j} value={j}>{j}</MenuItem>)}
          </TextField>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {ov.churches.length} church{ov.churches.length === 1 ? '' : 'es'} · {totals.file_count} files · {fData(totals.used_bytes)} of {fData(totals.quota_bytes)} allotted
          </Typography>
        </Box>
      </Grid>

      {totals.roots.map((root) => (
        <Grid key={root.key} size={{ xs: 12, sm: 6, md: 4 }}>
          <FileWidget title={`${root.name} · ${root.count} files`} value={root.bytes} total={totals.quota_bytes} icon={<Box component="img" alt={root.name} src={ROOT_ICON[root.key]} sx={{ width: 48, height: 48 }} />} />
        </Grid>
      ))}

      <Grid size={{ xs: 12, md: 8 }}>
        <FileDataActivity
          title="Data activity"
          subheader={`Uploads across ${jurisdiction || 'all jurisdictions'} in ${year}`}
          chart={{
            series: [
              { name: `${year}`, categories: MONTHS, data: [
                { name: 'Images', data: seriesFor(['image']) }, { name: 'Media', data: seriesFor(['video', 'audio']) },
                { name: 'Documents', data: seriesFor(['document']) }, { name: 'Other', data: seriesFor(['other']) },
              ] },
              ...years.filter((y) => y !== year).map((y) => ({ name: `${y}`, categories: MONTHS, data: [] as { name: string; data: number[] }[] })),
            ],
          }}
          onSelectSeries={(n) => setYear(Number(n))}
        />

        <Card sx={{ mt: 3 }}>
          <Box sx={{ p: 3, pb: 1 }}><Typography variant="h6">Churches</Typography></Box>
          <Stack divider={<Box sx={{ borderBottom: (t) => `1px dashed ${t.vars.palette.divider}` }} />}>
            {ov.churches.map((c) => {
              const pct = c.quota_bytes ? Math.round((c.used_bytes / c.quota_bytes) * 100) : 0;
              return (
                <Box key={c.id} component={RouterLink} href={`${paths.dashboard.general.file}?church=${c.id}`} sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 2, color: 'inherit', textDecoration: 'none', '&:hover': { bgcolor: 'action.hover' } }}>
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="subtitle2" noWrap>{c.name}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>{c.jurisdiction || 'No jurisdiction'} · {c.file_count} files{c.last_activity ? ` · active ${fToNow(c.last_activity)}` : ''}</Typography>
                  </Box>
                  <Box sx={{ width: 220 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', typography: 'caption', color: 'text.secondary' }}><span>{fData(c.used_bytes)}</span><span>{pct}% of {fData(c.quota_bytes)}</span></Box>
                    <LinearProgress variant="determinate" value={pct} color={pct > 90 ? 'error' : pct > 75 ? 'warning' : 'primary'} sx={{ height: 6, borderRadius: 1 }} />
                  </Box>
                </Box>
              );
            })}
            {!ov.churches.length && <EmptyContent title="No provisioned churches in this filter" sx={{ py: 6 }} />}
          </Stack>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, md: 4 }}>
        <FileStorageOverview
          total={totals.quota_bytes}
          used={totals.used_bytes}
          chart={{ series: usedPct }}
          data={[
            { name: 'Images', usedStorage: totals.categories.images.bytes, filesCount: totals.categories.images.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-img.svg`} /> },
            { name: 'Media', usedStorage: totals.categories.media.bytes, filesCount: totals.categories.media.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-video.svg`} /> },
            { name: 'Documents', usedStorage: totals.categories.documents.bytes, filesCount: totals.categories.documents.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-document.svg`} /> },
            { name: 'Other', usedStorage: totals.categories.other.bytes, filesCount: totals.categories.other.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-file.svg`} /> },
          ]}
        />

        <Card sx={{ mt: 3, p: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Recent activity across tenants</Typography>
          <Stack spacing={2}>
            {ov.recent_activity.slice(0, 12).map((a) => (
              <Box key={`${a.church?.id}-${a.id}`} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                <Avatar src={a.user?.avatar_url ?? undefined} sx={{ width: 32, height: 32 }}>{a.user?.name?.charAt(0)}</Avatar>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" noWrap><strong>{a.user?.name ?? 'Someone'}</strong> {ACTION_LABEL[a.action] ?? a.action} <em>{a.item_name}</em></Typography>
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>{a.church?.name} · {fToNow(a.created_at)}{a.size_delta ? ` · ${fData(Math.abs(a.size_delta))}` : ''}</Typography>
                </Box>
              </Box>
            ))}
            {!ov.recent_activity.length && <Typography variant="caption" sx={{ color: 'text.disabled' }}>No activity yet.</Typography>}
          </Stack>
        </Card>
      </Grid>
    </Grid>
  );
}
