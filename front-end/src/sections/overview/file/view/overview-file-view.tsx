import type { OmFilesOverview } from 'src/sections/file-manager/om-files-api';

import { useBoolean } from 'minimal-shared/hooks';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';

import { fToNow } from 'src/utils/format-time';
import { fData } from 'src/utils/format-number';

import { CONFIG } from 'src/global-config';
import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';
import { UploadBox } from 'src/components/upload';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';

import { FileWidget } from 'src/sections/file-manager/file-widget';
import { omFilesApi } from 'src/sections/file-manager/om-files-api';
import { FileRecentItem } from 'src/sections/file-manager/file-recent-item';
import { FileManagerPanel } from 'src/sections/file-manager/file-manager-panel';
import { FileDataActivity } from 'src/sections/file-manager/file-data-activity';
import { FileStorageOverview } from 'src/sections/file-manager/file-storage-overview';
import { useOmFiles, OmFilesProvider } from 'src/sections/file-manager/om-files-context';
import { FileManagerFolderItem } from 'src/sections/file-manager/file-manager-folder-item';
import { FileManagerCreateFolderDialog } from 'src/sections/file-manager/file-manager-create-folder-dialog';

// ----------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROOT_ICON: Record<string, string> = {
  records: `${CONFIG.assetsDir}/assets/icons/files/ic-document.svg`,
  media: `${CONFIG.assetsDir}/assets/icons/files/ic-video.svg`,
  documents: `${CONFIG.assetsDir}/assets/icons/files/ic-folder.svg`,
};

/** Overview → File: a church's storage at a glance (or an admin looking at one church via ?church=). */
export function OverviewFileView({ churchId = null }: { churchId?: number | null }) {
  return (
    <OmFilesProvider churchId={churchId}>
      <OverviewFileContent />
    </OmFilesProvider>
  );
}

function OverviewFileContent() {
  const { churchId, info, actions, canWrite, openFolder, refresh } = useOmFiles();
  const uploadDialog = useBoolean();
  const folderDialog = useBoolean();

  const [year, setYear] = useState(new Date().getFullYear());
  const [ov, setOv] = useState<OmFilesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOv(await omFilesApi.overview(churchId, year));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load storage overview');
    }
  }, [churchId, year]);

  useEffect(() => {
    load();
  }, [load, info?.used_bytes]);

  const handleDrop = useCallback(
    async (accepted: File[]) => {
      // Quick drop lands in the Documents root
      const docs = info?.roots.find((r) => r.systemKey === 'documents');
      if (!docs) return;
      openFolder(docs.rawId);
      await actions.upload(accepted).catch(() => {});
      openFolder(null);
      await Promise.all([refresh(), load()]);
    },
    [actions, info, openFolder, refresh, load]
  );

  if (error) return <DashboardContent><EmptyContent filled title={error} sx={{ py: 10 }} /></DashboardContent>;
  if (!ov || !info) return <DashboardContent><LinearProgress /></DashboardContent>;

  const usedPct = ov.quota_bytes ? Math.round((ov.used_bytes / ov.quota_bytes) * 100) : 0;
  const seriesFor = (names: string[]) => ov.activity.series.filter((s) => names.includes(s.name)).reduce((acc, s) => acc.map((v, i) => v + s.data[i]), Array(12).fill(0));

  const renderStorageOverview = () => (
    <FileStorageOverview
      total={ov.quota_bytes}
      used={ov.used_bytes}
      chart={{ series: usedPct }}
      data={[
        { name: 'Images', usedStorage: ov.categories.images.bytes, filesCount: ov.categories.images.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-img.svg`} /> },
        { name: 'Media', usedStorage: ov.categories.media.bytes, filesCount: ov.categories.media.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-video.svg`} /> },
        { name: 'Documents', usedStorage: ov.categories.documents.bytes, filesCount: ov.categories.documents.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-document.svg`} /> },
        { name: 'Other', usedStorage: ov.categories.other.bytes, filesCount: ov.categories.other.count, icon: <Box component="img" src={`${CONFIG.assetsDir}/assets/icons/files/ic-file.svg`} /> },
      ]}
    />
  );

  return (
    <>
      <DashboardContent maxWidth="xl">
        <Box sx={{ mb: 3 }}>
          <Typography variant="h4">Files</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {ov.church.name}{ov.church.jurisdiction ? ` · ${ov.church.jurisdiction}` : ''} · {fData(ov.used_bytes)} of {fData(ov.quota_bytes)} used
          </Typography>
        </Box>

        <Grid container spacing={3}>
          <Grid sx={{ display: { xs: 'block', sm: 'none' } }} size={12}>{renderStorageOverview()}</Grid>

          {ov.roots.map((root) => {
            const folder = info.roots.find((r) => r.systemKey === root.key);
            return (
              <Grid key={root.key} size={{ xs: 12, sm: 6, md: 4 }}>
                <Box onClick={() => folder && (window.location.href = `${paths.portal.fileManager}?folder=${folder.rawId}${churchId ? `&church=${churchId}` : ''}`)} sx={{ cursor: 'pointer' }}>
                  <FileWidget title={`${root.name} · ${root.count} files`} value={root.bytes} total={ov.quota_bytes} icon={<Box component="img" alt={root.name} src={ROOT_ICON[root.key]} sx={{ width: 48, height: 48 }} />} />
                </Box>
              </Grid>
            );
          })}

          <Grid size={{ xs: 12, md: 6, lg: 8 }}>
            <FileDataActivity
              title="Data activity"
              subheader={`Uploads in ${year}`}
              chart={{
                series: [
                  { name: `${year}`, categories: MONTHS, data: [
                    { name: 'Images', data: seriesFor(['image']) },
                    { name: 'Media', data: seriesFor(['video', 'audio']) },
                    { name: 'Documents', data: seriesFor(['document']) },
                    { name: 'Other', data: seriesFor(['other']) },
                  ] },
                  ...ov.activity.years.filter((y) => y !== year).map((y) => ({ name: `${y}`, categories: MONTHS, data: [] as { name: string; data: number[] }[] })),
                ],
              }}
              onSelectSeries={(name: string) => setYear(Number(name))}
            />

            <Box sx={{ mt: 5 }}>
              <FileManagerPanel title="Folders" link={paths.portal.fileManager} onOpen={canWrite ? folderDialog.onTrue : undefined} />
              <Scrollbar sx={{ mb: 3, minHeight: 186 }}>
                <Box sx={{ gap: 3, display: 'flex' }}>
                  {info.roots.map((folder) => (
                    <FileManagerFolderItem key={folder.id} folder={folder} sx={{ width: 240, flexShrink: 0 }} />
                  ))}
                </Box>
              </Scrollbar>

              <FileManagerPanel title="Recent files" link={paths.portal.fileManager} onOpen={canWrite ? uploadDialog.onTrue : undefined} />
              <Box sx={{ gap: 2, display: 'flex', flexDirection: 'column' }}>
                {ov.recent_files.slice(0, 5).map((file) => <FileRecentItem key={file.id} file={file} />)}
                {!ov.recent_files.length && <EmptyContent title="No files yet" sx={{ py: 6 }} />}
              </Box>
            </Box>
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 4 }}>
            {canWrite && (
              <UploadBox
                onDrop={handleDrop}
                placeholder={
                  <Box sx={{ gap: 0.5, display: 'flex', alignItems: 'center', color: 'text.disabled', flexDirection: 'column' }}>
                    <Iconify icon="eva:cloud-upload-fill" width={40} />
                    <Typography variant="body2">Upload to Documents</Typography>
                  </Box>
                }
                sx={{ py: 2.5, width: 'auto', height: 'auto', borderRadius: 1.5 }}
              />
            )}

            <Box sx={{ display: { xs: 'none', sm: 'block' }, mt: canWrite ? 3 : 0 }}>{renderStorageOverview()}</Box>

            <Box sx={{ mt: 3, p: 3, borderRadius: 2, bgcolor: 'background.neutral' }}>
              <Typography variant="subtitle2" sx={{ mb: 2 }}>Recent activity</Typography>
              <Stack spacing={2}>
                {ov.recent_activity.slice(0, 8).map((a) => (
                  <Box key={a.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                    <Avatar src={a.user?.avatar_url ?? undefined} sx={{ width: 32, height: 32 }}>{a.user?.name?.charAt(0)}</Avatar>
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography variant="body2" noWrap>
                        <strong>{a.user?.name ?? 'Someone'}</strong> {ACTION_LABEL[a.action] ?? a.action} <em>{a.item_name}</em>
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>{fToNow(a.created_at)}{a.size_delta ? ` · ${fData(Math.abs(a.size_delta))}` : ''}</Typography>
                    </Box>
                  </Box>
                ))}
                {!ov.recent_activity.length && <Typography variant="caption" sx={{ color: 'text.disabled' }}>No activity yet.</Typography>}
              </Stack>
            </Box>
          </Grid>
        </Grid>
      </DashboardContent>

      <FileManagerCreateFolderDialog open={uploadDialog.value} onClose={uploadDialog.onFalse} />
      <FileManagerCreateFolderDialog open={folderDialog.value} onClose={folderDialog.onFalse} mode="folder" />
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  upload: 'uploaded', create: 'created folder', rename: 'renamed', move: 'moved', delete: 'deleted',
  share: 'shared', unshare: 'unshared', download: 'downloaded', favorite: 'starred',
};
