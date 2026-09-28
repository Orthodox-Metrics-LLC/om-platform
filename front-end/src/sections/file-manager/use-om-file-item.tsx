import type { OmFileItem } from './om-files-api';

import { useState } from 'react';
import { useBoolean, usePopover } from 'minimal-shared/hooks';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomPopover } from 'src/components/custom-popover';

import { isFolder } from './om-files-api';
import { useOmFiles } from './om-files-context';
import { FileManagerShareDialog } from './file-manager-share-dialog';
import { FileManagerFileDetails } from './file-manager-file-details';

// ----------------------------------------------------------------------

/**
 * Shared behaviour for grid items and table rows: context menu, share dialog,
 * rename dialog, delete confirmation and the details drawer — all against OM.
 */
export function useOmFileItem(item: OmFileItem) {
  const { canWrite, actions, openFolder } = useOmFiles();
  const shareDialog = useBoolean();
  const confirmDialog = useBoolean();
  const detailsDrawer = useBoolean();
  const renameDialog = useBoolean();
  const menuActions = usePopover();
  const [name, setName] = useState(item.name);

  const folder = isFolder(item);
  const locked = folder && !!item.systemKey;

  const handleOpen = () => (folder ? openFolder(item.rawId) : detailsDrawer.onTrue());

  const renderMenuActions = () => (
    <CustomPopover open={menuActions.open} anchorEl={menuActions.anchorEl} onClose={menuActions.onClose} slotProps={{ arrow: { placement: 'right-top' } }}>
      <MenuList>
        {folder ? (
          <MenuItem onClick={() => { menuActions.onClose(); openFolder(item.rawId); }}>
            <Iconify icon="eva:arrow-ios-forward-fill" />
            Open
          </MenuItem>
        ) : (
          <MenuItem component="a" href={item.url} onClick={menuActions.onClose}>
            <Iconify icon="eva:cloud-download-fill" />
            Download
          </MenuItem>
        )}
        <MenuItem onClick={() => { menuActions.onClose(); actions.copyLink(item); }}>
          <Iconify icon="eva:link-2-fill" />
          Copy link
        </MenuItem>
        <MenuItem onClick={() => { menuActions.onClose(); shareDialog.onTrue(); }}>
          <Iconify icon="solar:share-bold" />
          Share
        </MenuItem>
        <MenuItem onClick={() => { menuActions.onClose(); detailsDrawer.onTrue(); }}>
          <Iconify icon="solar:eye-bold" />
          Details
        </MenuItem>
        {canWrite && !locked && (
          <>
            <MenuItem onClick={() => { menuActions.onClose(); setName(item.name); renameDialog.onTrue(); }}>
              <Iconify icon="solar:pen-bold" />
              Rename
            </MenuItem>
            <Divider sx={{ borderStyle: 'dashed' }} />
            <MenuItem onClick={() => { confirmDialog.onTrue(); menuActions.onClose(); }} sx={{ color: 'error.main' }}>
              <Iconify icon="solar:trash-bin-trash-bold" />
              Delete
            </MenuItem>
          </>
        )}
      </MenuList>
    </CustomPopover>
  );

  const renderDialogs = () => (
    <>
      <FileManagerShareDialog open={shareDialog.value} item={item} onClose={shareDialog.onFalse} onCopyLink={() => actions.copyLink(item)} />

      <ConfirmDialog
        open={confirmDialog.value}
        onClose={confirmDialog.onFalse}
        title="Delete"
        content={<>Delete <strong>{item.name}</strong>{folder ? ' and everything inside it' : ''}?</>}
        action={
          <Button variant="contained" color="error" onClick={() => { confirmDialog.onFalse(); actions.remove(item).catch(() => {}); }}>
            Delete
          </Button>
        }
      />

      <Dialog fullWidth maxWidth="xs" open={renameDialog.value} onClose={renameDialog.onFalse}>
        <DialogTitle>Rename {folder ? 'folder' : 'file'}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField autoFocus fullWidth label="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { renameDialog.onFalse(); actions.rename(item, name.trim()).catch(() => {}); } }} />
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={renameDialog.onFalse}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim()} onClick={() => { renameDialog.onFalse(); actions.rename(item, name.trim()).catch(() => {}); }}>Save</Button>
        </DialogActions>
      </Dialog>

      {detailsDrawer.value && (
        <FileManagerFileDetails
          item={item}
          open={detailsDrawer.value}
          onClose={detailsDrawer.onFalse}
          onDelete={() => { detailsDrawer.onFalse(); confirmDialog.onTrue(); }}
        />
      )}
    </>
  );

  return { folder, locked, menuActions, detailsDrawer, handleOpen, renderMenuActions, renderDialogs, toggleFavorite: () => actions.toggleFavorite(item).catch(() => {}) };
}
