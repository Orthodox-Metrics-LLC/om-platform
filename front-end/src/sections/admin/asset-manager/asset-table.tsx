import type { AssetMenuAction } from './asset-card';
import type { OmAsset, AssetSortField } from './om-assets-api';

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
import TableSortLabel from '@mui/material/TableSortLabel';
import TableContainer from '@mui/material/TableContainer';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomPopover } from 'src/components/custom-popover';

import { AssetThumb, SCOPE_COLOR } from './asset-card';
import { isImageAsset, isVideoAsset } from './asset-manager-context';

// ----------------------------------------------------------------------

/**
 * Column definitions. `sortAsc` / `sortDesc` map to AssetSortField server
 * sort keys. Columns without sort keys render a plain header cell.
 */
const COLUMNS: { id: string; label: string; sortAsc?: AssetSortField; sortDesc?: AssetSortField; align?: 'left' | 'right'; width?: number }[] = [
  { id: 'name', label: 'Asset', sortAsc: 'name', sortDesc: 'name_desc' },
  { id: 'scope', label: 'Scope', sortAsc: 'scope', sortDesc: 'scope_desc', width: 110 },
  { id: 'category', label: 'Type', sortAsc: 'category', sortDesc: 'category_desc', width: 180 },
  { id: 'folder', label: 'Folder', width: 140 },
  { id: 'type', label: 'Type', width: 120 },
  { id: 'size', label: 'Size', sortAsc: 'size', sortDesc: 'size_desc', align: 'right', width: 100 },
  { id: 'updated', label: 'Updated', sortAsc: 'updated', sortDesc: 'updated_desc', width: 160 },
];

type Props = {
  assets: OmAsset[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (on: boolean) => void;
  onOpen: (a: OmAsset) => void;
  onAction: (a: OmAsset, action: AssetMenuAction) => void;
  /** Current active server sort key — drives highlight + direction indicator */
  currentSort?: AssetSortField;
  /** Callback when a column header is clicked: receives the new AssetSortField to set */
  onSort?: (sort: AssetSortField) => void;
};

function sortDirection(colId: string, currentSort?: AssetSortField): 'asc' | 'desc' | undefined {
  const col = COLUMNS.find((c) => c.id === colId);
  if (!col?.sortAsc) return undefined;
  if (currentSort === col.sortAsc) return 'asc';
  if (currentSort === col.sortDesc) return 'desc';
  return undefined;
}

export function AssetTable({ assets, selected, onToggle, onToggleAll, onOpen, onAction, currentSort, onSort }: Props) {
  const all = assets.length > 0 && assets.every((a) => selected.has(a.id));
  const some = assets.some((a) => selected.has(a.id));

  const handleSort = (colId: string) => {
    if (!onSort) return;
    const col = COLUMNS.find((c) => c.id === colId);
    if (!col?.sortAsc || !col?.sortDesc) return;
    const dir = sortDirection(colId, currentSort);
    // Toggle: if asc → desc, if desc → asc, if unset → asc
    onSort(dir === 'asc' ? col.sortDesc : col.sortAsc);
  };

  return (
    <TableContainer>
      <Scrollbar>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox"><Checkbox checked={all} indeterminate={!all && some} onChange={(e) => onToggleAll(e.target.checked)} /></TableCell>
              {COLUMNS.map((col) => {
                const dir = sortDirection(col.id, currentSort);
                const sortable = !!col.sortAsc && !!onSort;
                return (
                  <TableCell key={col.id} align={col.align} sx={col.width ? { width: col.width } : undefined}>
                    {sortable ? (
                      <TableSortLabel active={!!dir} direction={dir || 'asc'} onClick={() => handleSort(col.id)}>
                        {col.label}
                      </TableSortLabel>
                    ) : col.label}
                  </TableCell>
                );
              })}
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
  const previewable = image || isVideoAsset(asset);
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
        <TableCell sx={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{[asset.category, asset.primary_tag, asset.secondary_tag].filter(Boolean).join(' · ').replace(/_/g, ' ')}</TableCell>
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
          {item(previewable ? 'Preview' : 'Details', 'open', 'solar:eye-bold')}
          {item('Edit metadata', 'edit', 'solar:pen-bold')}
          {item('Copy URL', 'copy-url', 'eva:link-2-fill')}
          {item('Download', 'download', 'eva:cloud-download-fill')}
          {image && item('Transform', 'transform', 'solar:restart-bold')}
          {image && item('Split into tiles', 'split', 'mingcute:dot-grid-fill')}
          {item('Copy to another scope', 'copy-to', 'solar:copy-bold')}
          {item('Send to Workshop', 'workshop', 'solar:export-bold')}
          {item('Archive', 'archive', 'solar:archive-down-minimlistic-bold', 'warning.main')}
          {item('Delete permanently', 'purge', 'solar:trash-bin-trash-bold', 'error.main')}
        </MenuList>
      </CustomPopover>
    </>
  );
}
