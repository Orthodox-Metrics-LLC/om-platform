import type { OmAssetCollection } from './om-assets-api';

import { useState } from 'react';
import { useBoolean, usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Collapse from '@mui/material/Collapse';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomPopover } from 'src/components/custom-popover';

import { AssetDirectoryDialog } from './asset-directory-dialog';
import { AssetCollectionDialog } from './asset-collection-dialog';
import { ASSET_SCOPES, useAssetManager } from './asset-manager-context';

// ----------------------------------------------------------------------

/** Left rail: scopes with counts, folders (directories), collections, tags, duplicate/similar shortcuts. */
export function AssetManagerSidebar() {
  const { filters, setFilters, navLocation, setNavLocation, scopeCounts, folderCounts, directories, tags, collections, duplicateGroups, similarGroups, selected, actions } = useAssetManager();
  const showFolders = useBoolean(true);
  const showCollections = useBoolean(true);
  const showTags = useBoolean(false);
  const collectionDialog = useBoolean();
  const dirDialog = useBoolean();
  const [editing, setEditing] = useState<OmAssetCollection | null>(null);

  const totalAll = Object.values(scopeCounts).reduce((n, v) => n + (v || 0), 0);

  const section = (title: string, open: boolean, onToggle: () => void, onAdd?: () => void) => (
    <Box sx={{ px: 2, pt: 2, pb: 0.5, display: 'flex', alignItems: 'center' }}>
      <Typography variant="overline" sx={{ color: 'text.disabled', flexGrow: 1 }}>{title}</Typography>
      {onAdd && (
        <IconButton size="small" onClick={onAdd}><Iconify icon="mingcute:add-line" width={16} /></IconButton>
      )}
      <IconButton size="small" onClick={onToggle}><Iconify icon={open ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'} width={16} /></IconButton>
    </Box>
  );

  const navItem = (label: string, active: boolean, onClick: () => void, count?: number, icon = 'solar:file-bold-duotone', depth = 0) => (
    <ListItemButton key={`${depth}-${label}`} selected={active} onClick={onClick} sx={{ borderRadius: 1, mx: 1, my: 0.25, py: 0.75, pl: 1.5 + depth * 2 }}>
      <Iconify icon={icon as any} width={20} sx={{ mr: 1.5, color: active ? 'primary.main' : 'text.secondary' }} />
      <ListItemText primary={label} slotProps={{ primary: { noWrap: true, sx: { typography: 'body2' } } }} />
      {count !== undefined && <Label variant="soft" color={active ? 'primary' : 'default'}>{count}</Label>}
    </ListItemButton>
  );

  return (
    <>
      <Scrollbar sx={{ height: 1 }}>
        <Box sx={{ pt: 1 }}>
          {navItem('All assets', navLocation === 'all' && !filters.scope, () => { setNavLocation('all'); setFilters({ scope: '', directory: '' }); }, totalAll, 'solar:gallery-wide-bold')}
          {ASSET_SCOPES.map((s) =>
            navItem(s.label, navLocation === 'all' && filters.scope === s.value, () => { setNavLocation('all'); setFilters({ scope: s.value, directory: '' }); }, scopeCounts[s.value] ?? 0,
              s.value === 'public' ? 'solar:global-bold-duotone' : s.value === 'church' ? 'custom:cross-bold' : s.value === 'site' ? 'solar:monitor-bold' : 'solar:lock-password-outline')
          )}
          <Divider sx={{ my: 1, borderStyle: 'dashed' }} />
          {navItem('Duplicates', navLocation === 'duplicates', () => setNavLocation('duplicates'), duplicateGroups.length, 'solar:copy-bold')}
          {navItem('Similar groups', navLocation === 'similar', () => setNavLocation('similar'), similarGroups.length, 'solar:gallery-circle-outline')}
        </Box>

        {section('Folders', showFolders.value, showFolders.onToggle, dirDialog.onTrue)}
        <Collapse in={showFolders.value}>
          {!directories.length && <Typography variant="caption" sx={{ px: 2.5, color: 'text.disabled' }}>No folders{filters.scope ? ' in this scope' : ''}.</Typography>}
          {directories.map((d) =>
            navItem(d.split('/').filter(Boolean).pop() || d, navLocation === 'all' && filters.directory === d, () => { setNavLocation('all'); setFilters({ directory: filters.directory === d ? '' : d }); }, folderCounts[d], 'solar:add-folder-bold', Math.max(0, d.split('/').filter(Boolean).length - 1))
          )}
        </Collapse>

        {section('Collections', showCollections.value, showCollections.onToggle, () => { setEditing(null); collectionDialog.onTrue(); })}
        <Collapse in={showCollections.value}>
          {!collections.length && <Typography variant="caption" sx={{ px: 2.5, color: 'text.disabled' }}>No collections yet.</Typography>}
          {collections.map((c) => (
            <CollectionRow
              key={c.id}
              collection={c}
              active={navLocation === 'collection' && filters.collectionId === c.id}
              onOpen={() => { setNavLocation('collection'); setFilters({ collectionId: c.id, scope: '', directory: '' }); }}
              onEdit={() => { setEditing(c); collectionDialog.onTrue(); }}
              onDelete={() => actions.collections.remove(c.id).then(() => { if (filters.collectionId === c.id) setNavLocation('all'); }).catch(() => {})}
              onAddSelected={selected.size ? () => actions.collections.assign(c.id, [...selected]).catch(() => {}) : undefined}
            />
          ))}
        </Collapse>

        {section('Tags', showTags.value, showTags.onToggle)}
        <Collapse in={showTags.value}>
          <Box sx={{ px: 2, pb: 2, gap: 0.5, display: 'flex', flexWrap: 'wrap' }}>
            {tags.map((t) => (
              <Chip key={t} size="small" label={t} variant={filters.tag === t ? 'filled' : 'outlined'} color={filters.tag === t ? 'primary' : 'default'} onClick={() => setFilters({ tag: filters.tag === t ? '' : t })} />
            ))}
            {!tags.length && <Typography variant="caption" sx={{ color: 'text.disabled' }}>No tags yet.</Typography>}
          </Box>
        </Collapse>
      </Scrollbar>

      <AssetCollectionDialog open={collectionDialog.value} onClose={collectionDialog.onFalse} collection={editing} />
      <AssetDirectoryDialog open={dirDialog.value} onClose={dirDialog.onFalse} />
    </>
  );
}

// ----------------------------------------------------------------------

function CollectionRow({ collection, active, onOpen, onEdit, onDelete, onAddSelected }: { collection: OmAssetCollection; active: boolean; onOpen: () => void; onEdit: () => void; onDelete: () => void; onAddSelected?: () => void }) {
  const menu = usePopover();
  const confirm = useBoolean();
  return (
    <>
      <ListItemButton selected={active} onClick={onOpen} sx={{ borderRadius: 1, mx: 1, my: 0.25, py: 0.75, pr: 0.5 }}>
        <Iconify icon="solar:suitcase-tag-bold" width={20} sx={{ mr: 1.5, color: active ? 'primary.main' : 'text.secondary' }} />
        <ListItemText primary={collection.name} secondary={collection.scope} slotProps={{ primary: { noWrap: true, sx: { typography: 'body2' } }, secondary: { sx: { typography: 'caption' } } }} />
        {collection.asset_count !== undefined && <Label variant="soft">{collection.asset_count}</Label>}
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); menu.onOpen(e); }}><Iconify icon="eva:more-vertical-fill" width={16} /></IconButton>
      </ListItemButton>

      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose}>
        <MenuList>
          {onAddSelected && (
            <MenuItem onClick={() => { menu.onClose(); onAddSelected(); }}><Iconify icon="mingcute:add-line" />Add selected here</MenuItem>
          )}
          <MenuItem onClick={() => { menu.onClose(); onEdit(); }}><Iconify icon="solar:pen-bold" />Edit</MenuItem>
          <MenuItem onClick={() => { menu.onClose(); confirm.onTrue(); }} sx={{ color: 'error.main' }}><Iconify icon="solar:trash-bin-trash-bold" />Delete</MenuItem>
        </MenuList>
      </CustomPopover>

      <ConfirmDialog open={confirm.value} onClose={confirm.onFalse} title="Delete collection" content={<>Delete <strong>{collection.name}</strong>? Assets stay in the library.</>} action={<Button variant="contained" color="error" onClick={() => { confirm.onFalse(); onDelete(); }}>Delete</Button>} />
    </>
  );
}
