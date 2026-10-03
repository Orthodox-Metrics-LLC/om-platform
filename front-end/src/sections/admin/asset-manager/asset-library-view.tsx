import type { Slide } from 'yet-another-react-lightbox';
import type { OmAsset } from './om-assets-api';
import type { AssetMenuAction } from './asset-card';

import { varAlpha } from 'minimal-shared/utils';
import { useBoolean } from 'minimal-shared/hooks';
import { useMemo, useState, useCallback } from 'react';
import { useLightboxState } from 'yet-another-react-lightbox';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { fData } from 'src/utils/format-number';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Lightbox } from 'src/components/lightbox';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { AssetCard } from './asset-card';
import { AssetTable } from './asset-table';
import { omAssetDirectUrl } from './om-assets-api';
import { AssetCopyDialog } from './asset-copy-dialog';
import { AssetBulkActions } from './asset-bulk-actions';
import { AssetUploadDialog } from './asset-upload-dialog';
import { AssetDetailsDrawer } from './asset-details-drawer';
import { AssetManagerSidebar } from './asset-manager-sidebar';
import { AssetManagerToolbar } from './asset-manager-toolbar';
import { AssetWorkshopDialog } from './asset-workshop-dialog';
import { AssetZipImportDialog } from './asset-zip-import-dialog';
import { AssetSplitDialog, AssetTransformDialog } from './asset-transform-dialog';
import { isImageAsset, isVideoAsset, useAssetManager, AssetManagerProvider } from './asset-manager-context';

// ----------------------------------------------------------------------

/** Media assets section: full Assets Library on /api/assets in Minimal UI. */
export function AssetLibraryView() {
  return (
    <AssetManagerProvider>
      <AssetLibraryContent />
    </AssetManagerProvider>
  );
}

function AssetLibraryContent() {
  const am = useAssetManager();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [current, setCurrent] = useState<OmAsset | null>(null);
  const [editing, setEditing] = useState(false);
  const details = useBoolean();
  const uploadDialog = useBoolean();
  const zipImportDialog = useBoolean();
  const transformDialog = useBoolean();
  const splitDialog = useBoolean();
  const copyDialog = useBoolean();
  const workshopDialog = useBoolean();
  const confirmArchive = useBoolean();
  const confirmPurge = useBoolean();
  const confirmDupes = useBoolean();
  const [dropFiles, setDropFiles] = useState<File[]>([]);
  const [zipDropFile, setZipDropFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  const visible: OmAsset[] =
    am.navLocation === 'duplicates' ? am.duplicateGroups.flatMap((g) => g.assets)
    : am.navLocation === 'similar' ? am.similarGroups.flatMap((g) => g.assets)
    : am.assets;

  // Images/videos preview inline (large view + a filmstrip of neighboring
  // assets on the right) instead of popping the metadata drawer. Other file
  // types (documents, etc.) still open the drawer — a lightbox doesn't make
  // sense for those.
  const previewableAssets = useMemo(() => visible.filter((a) => isImageAsset(a) || isVideoAsset(a)), [visible]);
  const lightboxSlides: Slide[] = useMemo(
    () =>
      previewableAssets.map((a): Slide =>
        isVideoAsset(a)
          ? {
              type: 'video',
              sources: [{ src: omAssetDirectUrl(a), type: a.mime_type || a.file_type || 'video/mp4' }],
              title: a.title || a.name,
            }
          : { src: omAssetDirectUrl(a), title: a.title || a.name }
      ),
    [previewableAssets]
  );

  const open = useCallback(
    (a: OmAsset, edit = false) => {
      setCurrent(a);
      setEditing(edit);
      if (!edit) {
        const idx = previewableAssets.findIndex((x) => x.id === a.id);
        if (idx >= 0) {
          setLightboxIndex(idx);
          return;
        }
      }
      details.onTrue();
    },
    [details, previewableAssets]
  );

  const onAction = useCallback(
    (a: OmAsset, action: AssetMenuAction) => {
      setCurrent(a);
      switch (action) {
        case 'open': open(a); break;
        case 'edit': open(a, true); break;
        case 'copy-url': navigator.clipboard.writeText(omAssetDirectUrl(a)).then(() => toast.success('URL copied')).catch(() => toast.error('Could not copy')); break;
        case 'download': window.open(omAssetDirectUrl(a), '_blank'); break;
        case 'transform': transformDialog.onTrue(); break;
        case 'split': splitDialog.onTrue(); break;
        case 'copy-to': copyDialog.onTrue(); break;
        case 'workshop': workshopDialog.onTrue(); break;
        case 'archive': confirmArchive.onTrue(); break;
        case 'purge': confirmPurge.onTrue(); break;
        default:
      }
    },
    [open, transformDialog, splitDialog, copyDialog, workshopDialog, confirmArchive, confirmPurge]
  );

  const renderGroups = (groups: { key: string; title: string; subtitle?: string; assets: OmAsset[] }[]) =>
    groups.map((g) => (
      <Box key={g.key} sx={{ mb: 3 }}>
        <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2">{g.title}</Typography>
          {g.subtitle && <Typography variant="caption" sx={{ color: 'text.disabled' }}>{g.subtitle}</Typography>}
          <Label variant="soft">{g.assets.length}</Label>
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(6, 1fr)' } }}>
          {g.assets.map((a) => <AssetCard key={a.id} dense asset={a} selected={am.selected.has(a.id)} onSelect={() => am.toggleSelect(a.id)} onOpen={() => open(a)} onAction={(act) => onAction(a, act)} />)}
        </Box>
      </Box>
    ));

  const renderBody = () => {
    if (am.error) return <EmptyContent filled title={am.error} sx={{ py: 10 }} />;
    if (am.navLocation === 'duplicates') {
      return am.duplicateGroups.length ? (
        <>
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>{am.duplicateGroups.length} exact-duplicate groups (same SHA-256). Removing keeps one copy per group.</Typography>
            <Button variant="soft" color="error" startIcon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={confirmDupes.onTrue}>Remove duplicates</Button>
          </Box>
          {renderGroups(am.duplicateGroups.map((g) => ({ key: g.sha256, title: g.assets[0]?.name ?? g.sha256.slice(0, 12), subtitle: `${g.sha256.slice(0, 12)}… · ${g.assets[0]?.file_size ? fData(g.assets[0].file_size) : ''}`, assets: g.assets })))}
        </>
      ) : <EmptyContent filled title="No duplicates" description="Every asset has a unique checksum." sx={{ py: 10 }} />;
    }
    if (am.navLocation === 'similar') {
      return am.similarGroups.length
        ? renderGroups(am.similarGroups.map((g) => ({ key: g.key, title: `${g.category.replace(/_/g, ' ')} · ${g.width}×${g.height}`, assets: g.assets })))
        : <EmptyContent filled title="No similar groups" description="Assets are grouped when they share category and dimensions." sx={{ py: 10 }} />;
    }
    if (am.loading && !am.assets.length) return <LinearProgress />;
    if (!visible.length) return <EmptyContent filled title="No assets match" description="Adjust the filters or upload new assets." action={<Button variant="contained" onClick={uploadDialog.onTrue} startIcon={<Iconify icon="eva:cloud-upload-fill" />}>Upload</Button>} sx={{ py: 10 }} />;
    return (
      <>
        {view === 'grid' ? (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', xl: 'repeat(5, 1fr)' } }}>
            {visible.map((a) => <AssetCard key={a.id} asset={a} selected={am.selected.has(a.id)} onSelect={() => am.toggleSelect(a.id)} onOpen={() => open(a)} onAction={(act) => onAction(a, act)} />)}
          </Box>
        ) : (
          <Card><AssetTable assets={visible} selected={am.selected} onToggle={(id) => am.toggleSelect(id)} onToggleAll={(on) => am.selectMany(visible.map((a) => a.id), on)} onOpen={(a) => open(a)} onAction={onAction} /></Card>
        )}
        {am.hasMore && (
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Button variant="outlined" color="inherit" loading={am.loadingMore} onClick={am.loadMore}>Load more ({am.assets.length} of {am.total})</Button>
          </Box>
        )}
      </>
    );
  };

  return (
    <Box
      sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', position: 'relative' }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault(); setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
          setZipDropFile(files[0]); zipImportDialog.onTrue();
        } else {
          setDropFiles(files); uploadDialog.onTrue();
        }
      }}
    >
      <Card sx={{ width: 264, flexShrink: 0, display: { xs: 'none', md: 'block' }, height: 'calc(100vh - 260px)', position: 'sticky', top: 96 }}>
        <AssetManagerSidebar />
      </Card>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <AssetManagerToolbar view={view} onChangeView={setView} onUpload={() => { setDropFiles([]); uploadDialog.onTrue(); }} onZipImport={zipImportDialog.onTrue} />
        <Box sx={{ mt: 3 }}>
          <AssetBulkActions />
          {renderBody()}
        </Box>
      </Box>

      {dragOver && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            borderRadius: 2,
            border: '2px dashed',
            borderColor: 'primary.main',
            bgcolor: (theme) => varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Typography variant="h6" color="primary">Drop files to upload</Typography>
        </Box>
      )}

      <AssetDetailsDrawer asset={current} open={details.value} editing={editing} onClose={details.onFalse} onTransform={transformDialog.onTrue} onSplit={splitDialog.onTrue} onCopyTo={copyDialog.onTrue} onWorkshop={workshopDialog.onTrue} onArchive={confirmArchive.onTrue} onPurge={confirmPurge.onTrue} />
      <Lightbox
        open={lightboxIndex >= 0}
        close={() => setLightboxIndex(-1)}
        slides={lightboxSlides}
        index={Math.max(lightboxIndex, 0)}
        disableTotal={false}
        thumbnails={{ position: 'end' }}
        toolbarExtraButtons={[
          <MarkForDeleteButton
            key="mark-for-delete"
            assets={previewableAssets}
            selected={am.selected}
            onToggle={am.toggleSelect}
          />,
        ]}
      />
      <AssetUploadDialog open={uploadDialog.value} onClose={uploadDialog.onFalse} initialFiles={dropFiles} />
      <AssetZipImportDialog open={zipImportDialog.value} onClose={() => { setZipDropFile(null); zipImportDialog.onFalse(); }} initialFile={zipDropFile} />
      <AssetTransformDialog open={transformDialog.value} onClose={transformDialog.onFalse} asset={current} onDone={(a) => { if (a) { am.actions.replaceAsset(a); setCurrent(a); } am.reload(); }} />
      <AssetSplitDialog open={splitDialog.value} onClose={splitDialog.onFalse} asset={current} onDone={() => { details.onFalse(); am.reload(); am.reloadMeta(); }} />
      <AssetCopyDialog open={copyDialog.value} onClose={copyDialog.onFalse} asset={current} />
      <AssetWorkshopDialog open={workshopDialog.value} onClose={workshopDialog.onFalse} assetIds={current ? [current.id] : []} />
      <ConfirmDialog open={confirmArchive.value} onClose={confirmArchive.onFalse} title="Archive asset" content={<>Archive <strong>{current?.name}</strong>?</>} action={<Button variant="contained" color="warning" onClick={() => { confirmArchive.onFalse(); details.onFalse(); if (current) am.actions.archive([current.id]).catch(() => {}); }}>Archive</Button>} />
      <ConfirmDialog
        open={confirmPurge.value}
        onClose={confirmPurge.onFalse}
        title="Delete asset permanently"
        content={<>Permanently delete <strong>{current?.name}</strong>? The file and all metadata are removed immediately — <strong>this cannot be undone</strong>. If you just want to hide it, use Archive instead.</>}
        action={<Button variant="contained" color="error" onClick={() => { confirmPurge.onFalse(); details.onFalse(); if (current) am.actions.purge([current.id]).catch(() => {}); }}>Delete permanently</Button>}
      />
      <ConfirmDialog open={confirmDupes.value} onClose={confirmDupes.onFalse} title="Remove duplicates" content="Archive every duplicate copy, keeping the oldest asset of each group?" action={<Button variant="contained" color="error" onClick={() => { confirmDupes.onFalse(); am.actions.deleteDuplicates().catch(() => {}); }}>Remove</Button>} />
    </Box>
  );
}

// ----------------------------------------------------------------------

/**
 * Lightbox toolbar button: mark/unmark the slide currently being viewed for
 * deletion without leaving the preview. Reuses the same selection set as the
 * grid/list checkboxes (useLightboxState reads the live slide index from the
 * lightbox's own context, no manual index-tracking needed) — closing the
 * lightbox after marking several images leaves them selected, so the
 * existing bulk-actions bar's "Delete" button finishes the job in one step.
 */
function MarkForDeleteButton({
  assets,
  selected,
  onToggle,
}: {
  assets: OmAsset[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  const { currentIndex } = useLightboxState();
  const asset = assets[currentIndex];

  if (!asset) return null;

  const marked = selected.has(asset.id);

  return (
    <Tooltip title={marked ? 'Unmark for deletion' : 'Mark for deletion'}>
      <IconButton className="yarl__button" onClick={() => onToggle(asset.id)} sx={{ color: marked ? 'error.light' : 'inherit' }}>
        <Iconify icon="solar:trash-bin-trash-bold" width={22} />
      </IconButton>
    </Tooltip>
  );
}
