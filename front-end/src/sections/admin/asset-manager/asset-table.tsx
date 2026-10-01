import type { OmAsset } from './om-assets-api';
import type { AssetMenuAction } from './asset-card';

import { usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import Checkbox from '@mui/material/Checkbox';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import TableContainer from '@mui/material/TableContainer';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomPopover } from 'src/components/custom-popover';

import { AssetThumb, SCOPE_COLOR } from './asset-card';
import { isImageAsset } from './asset-manager-context';

// ----------------------------------------------------------------------

type Props = {
  assets: OmAsset[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (on: boolean) => void;
  onOpen: (a: OmAsset) => void;
  onAction: (a: OmAsset, action: AssetMenuAction) => void;
};

export function AssetTable({ assets, selected, onToggle, onToggleAll, onOpen, onAction }: Props) {
  const all = assets.length > 0 && assets.every((a) => selected.has(a.id));
  const some = assets.some((a) => selected.has(a.id));

  return (
    <TableContainer>
      <Scrollbar>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox"><Checkbox checked={all} indeterminate={!all && some} onChange={(e) => onToggleAll(e.target.checked)} /></TableCell>
              <TableCell>Asset</TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Folder</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {assets.map((a) => <Row key={a.id} asset={a} selected={selected.has(a.id)} onToggle={() => onToggle(a.id)} onOpen={() => onOpen(a)} onAction={(act) => onAction(a, act)} />)}
          </TableBody>
        </Table>
      </Scrollbar>
    </TableContainer>
  );
}

function Row({ asset, selected, onToggle, onOpen, onAction }: { asset: OmAsset; selected: boolean; onToggle: () => void; onOpen: () => void; onAction: (a: AssetMenuAction) => void }) {
  const menu = usePopover();
  const image = isImageAsset(asset);
  const item = (label: string, action: AssetMenuAction, icon: string, color?: string) => (
    <MenuItem key={action} onClick={() => { menu.onClose(); onAction(action); }} sx={color ? { color } : undefined}><Iconify icon={icon as any} />{label}</MenuItem>
  );
  return (
    <>
      <TableRow hover selected={selected} sx={{ cursor: 'pointer' }} onClick={onOpen}>
        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected} onChange={onToggle} /></TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 44, flexShrink: 0 }}><AssetThumb asset={asset} ratio="1/1" sx={{ borderRadius: 1 }} /></Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap sx={{ maxWidth: 320 }}>{asset.title || asset.name}</Typography>
              <Typography variant="caption" noWrap sx={{ color: 'text.disabled', display: 'block', maxWidth: 320 }}>{asset.name}</Typography>
            </Box>
          </Box>
        </TableCell>
        <TableCell><Label variant="soft" color={SCOPE_COLOR[asset.scope] || 'default'} sx={{ textTransform: 'capitalize' }}>{asset.scope}{asset.church_id ? ` #${asset.church_id}` : ''}</Label></TableCell>
        <TableCell sx={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{asset.category.replace(/_/g, ' ')}</TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{asset.folder || asset.directory || '—'}</TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>{asset.file_type?.toUpperCase() || '—'}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}</TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{asset.file_size ? fData(asset.file_size) : '—'}</TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>{asset.updated_at ? fDateTime(asset.updated_at) : '—'}</TableCell>
        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
          <IconButton size="small" onClick={menu.onOpen}><Iconify icon="eva:more-vertical-fill" /></IconButton>
        </TableCell>
      </TableRow>
      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose}>
        <MenuList>
          {item('Details', 'open', 'solar:eye-bold')}
          {item('Edit metadata', 'edit', 'solar:pen-bold')}
          {item('Copy URL', 'copy-url', 'eva:link-2-fill')}
          {item('Download', 'download', 'eva:cloud-download-fill')}
          {image && item('Transform', 'transform', 'solar:restart-bold')}
          {image && item('Split into tiles', 'split', 'mingcute:dot-grid-fill')}
          {item('Copy to another scope', 'copy-to', 'solar:copy-bold')}
          {item('Send to Workshop', 'workshop', 'solar:export-bold')}
          {item('Archive', 'archive', 'solar:trash-bin-trash-bold', 'error.main')}
        </MenuList>
      </CustomPopover>
    </>
  );
}
