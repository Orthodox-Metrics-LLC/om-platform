import type { OmAsset } from './om-assets-api';

import { usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Checkbox from '@mui/material/Checkbox';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { fData } from 'src/utils/format-number';

import { Label } from 'src/components/label';
import { Image } from 'src/components/image';
import { Iconify } from 'src/components/iconify';
import { CustomPopover } from 'src/components/custom-popover';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { omAssetFileUrl, omAssetDirectUrl } from './om-assets-api';
import { isImageAsset, isVideoAsset } from './asset-manager-context';

// ----------------------------------------------------------------------

export type AssetMenuAction = 'open' | 'edit' | 'copy-url' | 'download' | 'transform' | 'split' | 'copy-to' | 'workshop' | 'archive';

type Props = {
  asset: OmAsset;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onAction: (action: AssetMenuAction) => void;
  dense?: boolean;
};

export const SCOPE_COLOR: Record<string, 'info' | 'success' | 'warning' | 'default'> = { public: 'success', church: 'info', site: 'warning', internal: 'default' };

export function AssetThumb({ asset, ratio = '4/3', sx }: { asset: OmAsset; ratio?: string; sx?: any }) {
  if (isImageAsset(asset)) return <Image alt={asset.alt_text || asset.name} src={omAssetFileUrl(asset.id)} ratio={ratio as any} sx={{ borderRadius: 1.5, ...sx }} />;
  if (isVideoAsset(asset)) return <Box component="video" src={omAssetFileUrl(asset.id)} muted preload="metadata" sx={{ width: 1, aspectRatio: ratio.replace('/', ' / '), objectFit: 'cover', borderRadius: 1.5, bgcolor: 'common.black', ...sx }} />;
  return (
    <Box sx={{ width: 1, aspectRatio: ratio.replace('/', ' / '), display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.neutral', borderRadius: 1.5, ...sx }}>
      <FileThumbnail file={asset.name} sx={{ width: 48, height: 48 }} />
    </Box>
  );
}

export function AssetCard({ asset, selected, onSelect, onOpen, onAction, dense }: Props) {
  const menu = usePopover();
  const image = isImageAsset(asset);

  const item = (label: string, action: AssetMenuAction, icon: string, color?: string) => (
    <MenuItem key={action} onClick={() => { menu.onClose(); onAction(action); }} sx={color ? { color } : undefined}>
      <Iconify icon={icon as any} />{label}
    </MenuItem>
  );

  return (
    <>
      <Paper
        variant="outlined"
        onDoubleClick={onOpen}
        sx={[
          (theme) => ({
            p: dense ? 1 : 1.5,
            position: 'relative',
            cursor: 'pointer',
            borderRadius: 2,
            transition: theme.transitions.create(['box-shadow', 'border-color']),
            ...(selected && { borderColor: 'primary.main', boxShadow: `0 0 0 1px ${theme.vars.palette.primary.main}` }),
            '&:hover': { boxShadow: theme.vars.customShadows.z8, '& .asset-check, & .asset-menu': { opacity: 1 } },
          }),
        ]}
        onClick={(e) => { if ((e.target as HTMLElement).closest('button, input')) return; onOpen(); }}
      >
        <Checkbox
          className="asset-check"
          size="small"
          checked={selected}
          onClick={(e) => { e.stopPropagation(); onSelect(e); }}
          sx={{ position: 'absolute', top: 6, left: 6, zIndex: 2, opacity: selected ? 1 : 0, bgcolor: 'background.paper', borderRadius: 1, p: 0.25 }}
        />
        <IconButton className="asset-menu" size="small" onClick={(e) => { e.stopPropagation(); menu.onOpen(e); }} sx={{ position: 'absolute', top: 6, right: 6, zIndex: 2, opacity: 0, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}>
          <Iconify icon="eva:more-vertical-fill" width={18} />
        </IconButton>

        <AssetThumb asset={asset} />

        <Box sx={{ mt: 1.25, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap title={asset.name}>{asset.title || asset.name}</Typography>
          <Box sx={{ mt: 0.5, gap: 0.5, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <Label variant="soft" color={SCOPE_COLOR[asset.scope] || 'default'} sx={{ textTransform: 'capitalize' }}>{asset.scope}{asset.church_id ? ` #${asset.church_id}` : ''}</Label>
            <Label variant="outlined" sx={{ textTransform: 'capitalize' }}>{asset.category.replace(/_/g, ' ')}</Label>
            {asset.status === 'archived' && <Label variant="soft" color="error">Archived</Label>}
          </Box>
          {!dense && (
            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 0.5 }} noWrap>
              {[asset.file_type?.toUpperCase(), asset.width && asset.height ? `${asset.width}×${asset.height}` : null, asset.file_size ? fData(asset.file_size) : null].filter(Boolean).join(' · ')}
            </Typography>
          )}
        </Box>
      </Paper>

      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose} slotProps={{ arrow: { placement: 'right-top' } }}>
        <MenuList>
          {item('Details', 'open', 'solar:eye-bold')}
          {item('Edit metadata', 'edit', 'solar:pen-bold')}
          {item('Copy URL', 'copy-url', 'eva:link-2-fill')}
          <MenuItem component="a" href={omAssetDirectUrl(asset)} download onClick={menu.onClose}><Iconify icon="eva:cloud-download-fill" />Download</MenuItem>
          {image && item('Transform (rotate / resize / crop)', 'transform', 'solar:restart-bold')}
          {image && item('Split into tiles', 'split', 'mingcute:dot-grid-fill')}
          {item('Copy to another scope', 'copy-to', 'solar:copy-bold')}
          {item('Send to Workshop', 'workshop', 'solar:export-bold')}
          {item('Archive', 'archive', 'solar:trash-bin-trash-bold', 'error.main')}
        </MenuList>
      </CustomPopover>
    </>
  );
}
