import type { Theme, SxProps } from '@mui/material/styles';

import { Iconify, type IconifyProps } from 'src/components/iconify';

type IconProps = { sx?: SxProps<Theme>; color?: string; className?: string; fontSize?: unknown };

function parishIcon(icon: IconifyProps['icon']) {
  return function ParishIcon({ sx, className }: IconProps) {
    return <Iconify className={className} icon={icon} width={22} sx={sx} />;
  };
}

export const ArrowBackIcon = parishIcon('eva:arrow-ios-back-fill');
export const ArrowDownwardIcon = parishIcon('eva:arrow-downward-fill');
export const ArrowForwardIcon = parishIcon('eva:arrow-forward-fill');
export const ArrowUpwardIcon = parishIcon('eva:arrow-upward-fill');
export const BoltOutlinedIcon = parishIcon('custom:flash-outline');
export const BrushOutlinedIcon = parishIcon('solar:palette-bold');
export const CheckCircleOutlineIcon = parishIcon('eva:checkmark-circle-2-outline');
export const CheckIcon = parishIcon('eva:checkmark-fill');
export const ContentCopyOutlinedIcon = parishIcon('solar:copy-bold');
export const DeleteSweepIcon = parishIcon('solar:trash-bin-trash-bold');
export const DescriptionIcon = parishIcon('solar:file-text-bold');
export const DocumentScannerIcon = parishIcon('solar:gallery-wide-bold');
export const EventOutlinedIcon = parishIcon('solar:calendar-date-bold');
export const FilterListOutlinedIcon = parishIcon('solar:list-bold');
export const ImageIcon = parishIcon('solar:gallery-wide-bold');
export const PaletteOutlinedIcon = parishIcon('solar:palette-bold-duotone');
export const PeopleOutlinedIcon = parishIcon('solar:users-group-rounded-bold');
export const RestartAltIcon = parishIcon('solar:restart-bold');
export const SaveOutlinedIcon = parishIcon('solar:inbox-in-bold');
export const SearchOutlinedIcon = parishIcon('eva:search-fill');
export const ShareOutlinedIcon = parishIcon('solar:share-bold');
export const StorageOutlinedIcon = parishIcon('solar:box-minimalistic-bold');
export const TranslateIcon = parishIcon('solar:global-bold-duotone');
export const TuneIcon = parishIcon('solar:settings-bold');
export const WarningAmberIcon = parishIcon('solar:danger-triangle-bold');
