import type { Theme, SxProps } from '@mui/material/styles';
import type { OmFileItem } from './om-files-api';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import TableRow, { tableRowClasses } from '@mui/material/TableRow';
import TableCell, { tableCellClasses } from '@mui/material/TableCell';

import { fData } from 'src/utils/format-number';
import { fDate, fTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { isFolder } from './om-files-api';
import { useOmFileItem } from './use-om-file-item';
import { FileItemAvatar, FileItemActions } from './file-manager-file-item-slots';

// ----------------------------------------------------------------------

type Props = {
  row: OmFileItem;
  selected: boolean;
  onSelectRow: () => void;
};

export function FileManagerTableRow({ row, selected, onSelectRow }: Props) {
  const theme = useTheme();
  const { menuActions, detailsDrawer, handleOpen, renderMenuActions, renderDialogs, toggleFavorite } = useOmFileItem(row);
  const folder = isFolder(row);

  const defaultStyles: SxProps<Theme> = {
    borderTop: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
    borderBottom: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
    '&:first-of-type': { borderTopLeftRadius: 16, borderBottomLeftRadius: 16, borderLeft: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}` },
    '&:last-of-type': { borderTopRightRadius: 16, borderBottomRightRadius: 16, borderRight: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}` },
  };

  return (
    <>
      <TableRow
        selected={selected}
        sx={{
          borderRadius: 2,
          [`&.${tableRowClasses.selected}, &:hover`]: {
            backgroundColor: 'background.paper',
            boxShadow: theme.vars.customShadows.z20,
            transition: theme.transitions.create(['background-color', 'box-shadow'], { duration: theme.transitions.duration.shortest }),
            '&:hover': { backgroundColor: 'background.paper', boxShadow: theme.vars.customShadows.z20 },
          },
          [`& .${tableCellClasses.root}`]: { ...defaultStyles },
        }}
      >
        <TableCell padding="checkbox">
          <Checkbox checked={selected} onClick={onSelectRow} slotProps={{ input: { id: `${row.id}-checkbox`, 'aria-label': `${row.id} checkbox` } }} />
        </TableCell>

        <TableCell onClick={handleOpen} sx={{ cursor: 'pointer' }}>
          <Box sx={{ gap: 2, display: 'flex', alignItems: 'center' }}>
            <FileThumbnail file={folder ? 'folder' : row.name} />
            <Typography noWrap variant="inherit" sx={{ maxWidth: 360, ...(detailsDrawer.value && { fontWeight: 'fontWeightBold' }) }}>
              {row.name}
            </Typography>
            {folder && row.systemKey && <Label variant="soft" color="info">System</Label>}
          </Box>
        </TableCell>

        <TableCell onClick={handleOpen} sx={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
          {fData(row.size)}
        </TableCell>

        <TableCell onClick={handleOpen} sx={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
          {folder ? `folder · ${row.totalFiles ?? 0} files` : row.type}
        </TableCell>

        <TableCell onClick={handleOpen} sx={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <ListItemText
            primary={fDate(row.modifiedAt)}
            secondary={fTime(row.modifiedAt)}
            slotProps={{ primary: { noWrap: true, sx: { typography: 'body2' } }, secondary: { sx: { mt: 0.5, typography: 'caption' } } }}
          />
        </TableCell>

        <TableCell align="right" onClick={handleOpen}>
          <FileItemAvatar sharedUsers={row.shared} />
        </TableCell>

        <TableCell align="right" sx={{ px: 1 }}>
          <FileItemActions id={row.id} checked={row.isFavorited} onChange={toggleFavorite} openMenu={menuActions.open} onOpenMenu={menuActions.onOpen} />
        </TableCell>
      </TableRow>

      {renderMenuActions()}
      {renderDialogs()}
    </>
  );
}
