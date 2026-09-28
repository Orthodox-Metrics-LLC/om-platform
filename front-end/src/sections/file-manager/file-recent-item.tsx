import type { OmFile } from './om-files-api';
import type { FileItemProps } from './file-manager-file-item-slots';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { FileThumbnail } from 'src/components/file-thumbnail';

import { useOmFileItem } from './use-om-file-item';
import { FileItem, FileItemInfo, FileItemAvatar, FileItemActions, FileItemActionOverlay } from './file-manager-file-item-slots';

// ----------------------------------------------------------------------

type Props = FileItemProps & {
  file: OmFile;
};

export function FileRecentItem({ file, sx, ...other }: Props) {
  const { menuActions, handleOpen, renderMenuActions, renderDialogs, toggleFavorite } = useOmFileItem(file);

  return (
    <>
      <FileItem
        sx={[
          (theme) => ({
            gap: 2,
            display: 'flex',
            cursor: 'pointer',
            position: 'relative',
            alignItems: { xs: 'unset', sm: 'center' },
            flexDirection: { xs: 'column', sm: 'row' },
            transition: theme.transitions.create(['background-color', 'box-shadow']),
            '&:hover': { bgcolor: 'background.paper', boxShadow: theme.vars.customShadows.z20 },
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...other}
      >
        <FileItemActionOverlay onClick={handleOpen} />
        <FileThumbnail file={file.name} />
        <FileItemInfo type="recent-file" title={file.name} values={[fData(file.size), fDateTime(file.modifiedAt)]} />
        <FileItemAvatar sharedUsers={file.shared} />
        <FileItemActions
          id={file.id}
          checked={file.isFavorited}
          onChange={toggleFavorite}
          openMenu={menuActions.open}
          onOpenMenu={menuActions.onOpen}
          sx={{ position: { xs: 'absolute', sm: 'unset' } }}
        />
      </FileItem>

      {renderMenuActions()}
      {renderDialogs()}
    </>
  );
}
