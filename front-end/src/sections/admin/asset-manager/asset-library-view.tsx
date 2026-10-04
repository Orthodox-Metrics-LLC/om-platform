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
import { AssetCategorySuggestions } from './asset-category-suggestions';
import { AssetSplitDialog, AssetTransformDialog } from './asset-transform-dialog';
import { classificationLabel, AssetCategoryDialog } from './asset-category-dialog';
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
  const [lightboxEpoch, setLightboxEpoch] = useState(0);
  const [purgedIds, setPurgedIds] = useState<Set<number>>(new Set());
  const [previewCategoryAsset, setPreviewCategoryAsset] = useState<OmAsset | null>(null);

  const visible: OmAsset[] =
    am.navLocation === 'duplicates' ? am.duplicateGroups.flatMap((g) => g.assets)
    : am.navLocation === 'similar' ? am.similarGroups.flatMap((g) => g.assets)
    : am.assets;

  // Images/videos preview inline (large view + a filmstrip of neighboring
  // assets on the right) instead of popping the metadata drawer. Other file
  // types (documents, etc.) still open the drawer — a lightbox doesn't make
  // sense for those. purgedIds hides assets deleted from inside the preview
  // right away, without waiting on the full list to refetch from the server.
  const previewableAssets = useMemo(
    () => visible.filter((a) => (isImageAsset(a) || isVideoAsset(a)) && !purgedIds.has(a.id)),
    [visible, purgedIds]
  );
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

  // Delete the slide currently being viewed, right away — remove it from the
  // preview immediately (optimistic, via purgedIds) rather than waiting on
  // the grid's own reload, then land on whatever slide is now at that index
  // (i.e. what used to be "next"), or close if nothing is left to show.
  const deleteFromPreview = useCallback(
    (asset: OmAsset, viewedIndex: number) => {
      setPurgedIds((prev) => new Set(prev).add(asset.id));
      const newLength = previewableAssets.length - 1;
      setLightboxIndex(newLength <= 0 ? -1 : Math.min(viewedIndex, newLength - 1));
      setLightboxEpoch((e) => e + 1);
      am.actions.purge([asset.id]).catch(() => {
        // purge failed — bring it back into view instead of losing it silently
        setPurgedIds((prev) => { const next = new Set(prev); next.delete(asset.id); return next; });
      });
    },
    [am.actions, previewableAssets.length]
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
          <Card><AssetTable assets={visible} selected={am.selected} onToggle={(id) => am.toggleSelect(id)} onToggleAll={(on) => am.selectMany(visible.map((a) => a.id), on)} onOpen={(a) => open(a)} onAction={onAction} currentSort={am.filters.sort} onSort={(sort) => am.setFilters({ sort })} /></Card>
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
          <AssetCategorySuggestions
            suggestions={am.categorySuggestions}
            onMove={(groups) => { am.actions.changeCategories(groups).catch(() => {}); }}
          />
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
        key={`${lightboxIndex}-${lightboxEpoch}`}
        open={lightboxIndex >= 0}
        close={() => setLightboxIndex(-1)}
        slides={lightboxSlides}
        index={Math.max(lightboxIndex, 0)}
        disableTotal={false}
        thumbnails={{ position: 'end' }}
        toolbarExtraButtons={[
          <ChangeCategoryFromPreviewButton
            key="category-from-preview"
            assets={previewableAssets}
            suggestions={am.categorySuggestions}
            onOpen={setPreviewCategoryAsset}
            onMove={(asset, classification) => {
              const leavingFilter = Boolean(am.filters.category) && am.filters.category !== classification.category;
              am.actions.changeCategory([asset.id], classification).then(() => {
                if (leavingFilter) setLightboxIndex(-1);
              }).catch(() => {});
            }}
          />,
          <DeleteFromPreviewButton
            key="delete-from-preview"
            assets={previewableAssets}
            onDelete={deleteFromPreview}
          />,
        ]}
      />
      <AssetCategoryDialog
        elevate
        open={!!previewCategoryAsset}
        onClose={() => setPreviewCategoryAsset(null)}
        title="Change type"
        current={previewCategoryAsset ? { category: previewCategoryAsset.category, primary_tag: previewCategoryAsset.primary_tag, secondary_tag: previewCategoryAsset.secondary_tag } : null}
        suggested={(() => {
          const hit = am.categorySuggestions.find((item) => item.id === previewCategoryAsset?.id);
          return hit ? { category: hit.suggested_category, primary_tag: hit.suggested_primary_tag, secondary_tag: hit.suggested_secondary_tag } : null;
        })()}
        hint={previewCategoryAsset ? previewCategoryHint(previewCategoryAsset, am.categorySuggestions) : undefined}
        applyLabel="Apply"
        onApply={(classification) => {
          const asset = previewCategoryAsset;
          setPreviewCategoryAsset(null);
          if (!asset) return;
          const leavingFilter = Boolean(am.filters.category) && am.filters.category !== classification.category;
          am.actions.changeCategory([asset.id], classification).then(() => {
            if (leavingFilter) setLightboxIndex(-1);
          }).catch(() => {});
        }}
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

function previewCategoryHint(asset: OmAsset, suggestions: { id: number; suggested_category: string; suggested_primary_tag?: string | null; suggested_secondary_tag?: string | null }[]) {
  const hit = suggestions.find((item) => item.id === asset.id);
  const current = classificationLabel(asset);
  if (!hit) return `Currently ${current}.`;
  const suggested = classificationLabel({ category: hit.suggested_category, primary_tag: hit.suggested_primary_tag, secondary_tag: hit.suggested_secondary_tag });
  return `Currently ${current}. The file name looks like ${suggested}.`;
}

function ChangeCategoryFromPreviewButton({
  assets,
  suggestions,
  onOpen,
  onMove,
}: {
  assets: OmAsset[];
  suggestions: { id: number; suggested_category: string; suggested_primary_tag?: string | null; suggested_secondary_tag?: string | null }[];
  onOpen: (asset: OmAsset) => void;
  onMove: (asset: OmAsset, classification: { category: string; primary_tag?: string | null; secondary_tag?: string | null }) => void;
}) {
  const { currentIndex } = useLightboxState();
  const asset = assets[currentIndex];
  const hit = suggestions.find((item) => item.id === asset?.id);
  const suggested = hit ? { category: hit.suggested_category, primary_tag: hit.suggested_primary_tag, secondary_tag: hit.suggested_secondary_tag } : null;

  if (!asset) return null;

  return (
    <>
      {suggested && (
        <Tooltip title={`File name looks like ${classificationLabel(suggested)}`}>
          <Button
            size="small"
            variant="contained"
            color="warning"
            onClick={() => onMove(asset, suggested)}
            sx={{ mx: 0.5, textTransform: 'capitalize' }}
          >
            File as {classificationLabel(suggested)}
          </Button>
        </Tooltip>
      )}
      <Tooltip title={`Change type (currently ${classificationLabel(asset)})`}>
        <IconButton className="yarl__button" onClick={() => onOpen(asset)} sx={{ color: 'common.white' }}>
          <Iconify icon="solar:palette-bold" width={22} />
        </IconButton>
      </Tooltip>
    </>
  );
}

/**
 * Lightbox toolbar button: deletes the slide currently being viewed right
 * away, without leaving the preview. useLightboxState reads the live slide
 * index from the lightbox's own context, so no manual index-tracking state
 * is needed here — the parent (deleteFromPreview) handles removing the
 * slide from view and landing on the next one.
 */
function DeleteFromPreviewButton({
  assets,
  onDelete,
}: {
  assets: OmAsset[];
  onDelete: (asset: OmAsset, viewedIndex: number) => void;
}) {
  const { currentIndex } = useLightboxState();
  const asset = assets[currentIndex];

  if (!asset) return null;

  return (
    <Tooltip title="Delete this">
      <IconButton
        className="yarl__button"
        onClick={() => onDelete(asset, currentIndex)}
        sx={{ color: 'common.white' }}
      >
        <Iconify icon="solar:trash-bin-trash-bold" width={22} />
      </IconButton>
    </Tooltip>
  );
}
