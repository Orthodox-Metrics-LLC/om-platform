import type { OmFolder } from './om-files-api';
import type { FileItemProps } from './file-manager-file-item-slots';

import { useBoolean } from 'minimal-shared/hooks';

import { fData } from 'src/utils/format-number';

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
  onSelect?: () => void;
  folder: OmFolder;
};

export function FileManagerFolderItem({ sx, folder, selected, onSelect, ...other }: Props) {
  const checkbox = useBoolean();
  const { menuActions, handleOpen, renderMenuActions, renderDialogs, toggleFavorite } = useOmFileItem(folder);

  return (
    <>
      <FileItem variant="outlined" selected={selected} sx={sx} {...other}>
        <FileItemActionOverlay onClick={handleOpen} onDoubleClick={handleOpen} />
        <FileItemIcon
          id={folder.id}
          onMouseEnter={checkbox.onTrue}
          onMouseLeave={checkbox.onFalse}
          hovered={checkbox.value}
          checked={selected}
          onChange={onSelect}
        />
        <FileItemInfo
          type="folder"
          title={folder.systemKey ? `${folder.name}` : folder.name}
          values={[fData(folder.size), `${folder.totalFiles ?? 0} files`]}
        />
        <FileItemAvatar sharedUsers={folder.shared} />
        <FileItemActions
          id={folder.id}
          checked={folder.isFavorited}
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
