import type { OmAssetScope } from './om-assets-api';

import { useState } from 'react';
import { useBoolean, usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import Autocomplete from '@mui/material/Autocomplete';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomPopover } from 'src/components/custom-popover';

import { AssetChurchSelect } from './asset-church-select';
import { AssetWorkshopDialog } from './asset-workshop-dialog';
import { ASSET_SCOPES, useAssetManager } from './asset-manager-context';

// ----------------------------------------------------------------------

/** Floating bar shown when assets are selected: archive, move, tags, scope, collections, workshop. */
export function AssetBulkActions() {
  const { selected, clearSelection, actions, directories, tags, collections, filters } = useAssetManager();
  const ids = [...selected];
  const confirmArchive = useBoolean();
  const moveDialog = useBoolean();
  const tagsDialog = useBoolean();
  const scopeDialog = useBoolean();
  const workshopDialog = useBoolean();
  const collectionMenu = usePopover();

  const [dir, setDir] = useState('');
  const [tagList, setTagList] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<'add' | 'remove' | 'set'>('add');
  const [scope, setScope] = useState<OmAssetScope>('public');
  const [churchId, setChurchId] = useState<number | null>(null);

  if (!ids.length) return null;

  return (
    <>
      <Box sx={(theme) => ({ p: 1.5, mb: 2, gap: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', borderRadius: 1.5, bgcolor: 'primary.lighter', color: 'primary.darker', boxShadow: theme.vars.customShadows.z8 })}>
        <Typography variant="subtitle2" sx={{ mr: 1 }}>{ids.length} selected</Typography>
        <Button size="small" variant="soft" startIcon={<Iconify icon="solar:add-folder-bold" />} onClick={moveDialog.onTrue}>Move to folder</Button>
        <Button size="small" variant="soft" startIcon={<Iconify icon="solar:tag-horizontal-bold-duotone" />} onClick={tagsDialog.onTrue}>Tags</Button>
        <Button size="small" variant="soft" startIcon={<Iconify icon="solar:global-bold-duotone" />} onClick={scopeDialog.onTrue}>Change scope</Button>
        <Button size="small" variant="soft" startIcon={<Iconify icon="solar:suitcase-tag-bold" />} onClick={collectionMenu.onOpen}>Collection</Button>
        <Button size="small" variant="soft" startIcon={<Iconify icon="solar:export-bold" />} onClick={workshopDialog.onTrue}>Send to Workshop</Button>
        <Button size="small" variant="soft" color="warning" startIcon={<Iconify icon="solar:archive-down-minimlistic-bold" />} onClick={confirmArchive.onTrue}>Archive</Button>
        <Button size="small" variant="soft" color="error" startIcon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={() => actions.purge(ids).catch(() => {})}>Delete</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" color="inherit" onClick={clearSelection}>Clear</Button>
      </Box>

      <CustomPopover open={collectionMenu.open} anchorEl={collectionMenu.anchorEl} onClose={collectionMenu.onClose}>
        <MenuList>
          {collections.map((c) => (
            <MenuItem key={c.id} onClick={() => { collectionMenu.onClose(); actions.collections.assign(c.id, ids).catch(() => {}); }}>
              <Iconify icon="mingcute:add-line" />Add to “{c.name}”
            </MenuItem>
          ))}
          {filters.collectionId && (
            <MenuItem onClick={() => { collectionMenu.onClose(); actions.collections.unassign(filters.collectionId!, ids).then(clearSelection).catch(() => {}); }} sx={{ color: 'error.main' }}>
              <Iconify icon="mingcute:close-line" />Remove from this collection
            </MenuItem>
          )}
          {!collections.length && <MenuItem disabled>No collections yet</MenuItem>}
        </MenuList>
      </CustomPopover>

      <ConfirmDialog open={confirmArchive.value} onClose={confirmArchive.onFalse} title="Archive assets" content={<>Archive <strong>{ids.length}</strong> assets? They are hidden from the library but kept on disk.</>} action={<Button variant="contained" color="warning" onClick={() => { confirmArchive.onFalse(); actions.archive(ids).catch(() => {}); }}>Archive</Button>} />

      <Dialog fullWidth maxWidth="xs" open={moveDialog.value} onClose={moveDialog.onFalse}>
        <DialogTitle>Move {ids.length} assets</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Autocomplete freeSolo options={directories} value={dir} onInputChange={(_, v) => setDir(v)} renderInput={(p) => <TextField {...p} label="Folder" placeholder="e.g. marketing/2026" />} />
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={moveDialog.onFalse}>Cancel</Button>
          <Button variant="contained" disabled={!dir.trim()} onClick={() => { moveDialog.onFalse(); actions.moveToDirectory(ids, dir.trim()).then(clearSelection).catch(() => {}); }}>Move</Button>
        </DialogActions>
      </Dialog>

      <Dialog fullWidth maxWidth="xs" open={tagsDialog.value} onClose={tagsDialog.onFalse}>
        <DialogTitle>Tags for {ids.length} assets</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField select label="Mode" value={tagMode} onChange={(e) => setTagMode(e.target.value as any)}>
            <MenuItem value="add">Add tags</MenuItem><MenuItem value="remove">Remove tags</MenuItem><MenuItem value="set">Replace all tags</MenuItem>
          </TextField>
          <Autocomplete multiple freeSolo options={tags} value={tagList} onChange={(_, v) => setTagList(v as string[])} renderValue={(sel, getTagProps) => sel.map((o, i) => <Chip {...getTagProps({ index: i })} key={o} size="small" label={o} />)} renderInput={(p) => <TextField {...p} label="Tags" placeholder="Type and press Enter" />} />
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={tagsDialog.onFalse}>Cancel</Button>
          <Button variant="contained" disabled={!tagList.length && tagMode !== 'set'} onClick={() => { tagsDialog.onFalse(); actions.applyTags(ids, tagList, tagMode).catch(() => {}); }}>Apply</Button>
        </DialogActions>
      </Dialog>

      <Dialog fullWidth maxWidth="xs" open={scopeDialog.value} onClose={scopeDialog.onFalse}>
        <DialogTitle>Change scope of {ids.length} assets</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField select label="Scope" value={scope} onChange={(e) => setScope(e.target.value as OmAssetScope)}>{ASSET_SCOPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label} — {s.description}</MenuItem>)}</TextField>
          {scope === 'church' && <AssetChurchSelect value={churchId} onChange={setChurchId} />}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={scopeDialog.onFalse}>Cancel</Button>
          <Button variant="contained" disabled={scope === 'church' && !churchId} onClick={() => { scopeDialog.onFalse(); actions.changeScope(ids, scope, scope === 'church' ? churchId : null).then(clearSelection).catch(() => {}); }}>Apply</Button>
        </DialogActions>
      </Dialog>

      <AssetWorkshopDialog open={workshopDialog.value} onClose={workshopDialog.onFalse} assetIds={ids} />
    </>
  );
}
