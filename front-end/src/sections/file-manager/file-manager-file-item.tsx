import type { OmFile } from './om-files-api';
import type { FileItemProps } from './file-manager-file-item-slots';

import { useBoolean } from 'minimal-shared/hooks';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { useOmFileItem } from './use-om-file-item';
import {
  FileItem,
  FileItemIcon,
  FileItemInfo,
  FileItemAvatar,
  FileItemActions,
  FileItemActionOverlay,
} from './file-manager-file-item-slots';

// ----------------------------------------------------------------------

type Props = FileItemProps & {
  selected?: boolean;
  file: OmFile;
  onSelect?: () => void;
};

export function FileManagerFileItem({ file, selected, onSelect, sx, ...other }: Props) {
  const checkbox = useBoolean();
  const { menuActions, handleOpen, renderMenuActions, renderDialogs, toggleFavorite } = useOmFileItem(file);

  return (
    <>
      <FileItem variant="outlined" selected={selected} sx={sx} {...other}>
        <FileItemActionOverlay onClick={handleOpen} />
        <FileItemIcon
          id={file.id}
          onMouseEnter={checkbox.onTrue}
          onMouseLeave={checkbox.onFalse}
          hovered={checkbox.value}
          checked={selected}
          onChange={onSelect}
          fileType={file.name}
        />
        <FileItemInfo type="file" title={file.name} values={[fData(file.size), fDateTime(file.modifiedAt)]} />
        <FileItemAvatar sharedUsers={file.shared} />
        <FileItemActions
          id={file.id}
          checked={file.isFavorited}
          onChange={toggleFavorite}
          openMenu={menuActions.open}
          onOpenMenu={menuActions.onOpen}
        />
      </FileItem>

      {renderMenuActions()}
      {renderDialogs()}
    </>
  );
}
