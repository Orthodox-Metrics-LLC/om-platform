import type { OmFileItem } from './om-files-api';
import type { UseTableReturn } from 'src/components/table';

import { useRef } from 'react';
import { useBoolean } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';

import { Iconify } from 'src/components/iconify';

import { isFolder } from './om-files-api';
import { useOmFiles } from './om-files-context';
import { FileManagerPanel } from './file-manager-panel';
import { FileManagerFileItem } from './file-manager-file-item';
import { FileManagerFolderItem } from './file-manager-folder-item';
import { FileManagerActionSelected } from './file-manager-action-selected';
import { FileManagerCreateFolderDialog } from './file-manager-create-folder-dialog';

// ----------------------------------------------------------------------

type Props = {
  table: UseTableReturn;
  dataFiltered: OmFileItem[];
  onOpenConfirm: () => void;
};

export function FileManagerGridView({ table, dataFiltered, onOpenConfirm }: Props) {
  const { selected, onSelectRow: onSelectItem, onSelectAllRows: onSelectAllItems } = table;
  const { canWrite } = useOmFiles();

  const containerRef = useRef(null);
  const filesCollapse = useBoolean();
  const foldersCollapse = useBoolean();
  const newFilesDialog = useBoolean();
  const newFolderDialog = useBoolean();

  const folders = dataFiltered.filter(isFolder);
  const files = dataFiltered.filter((i) => !isFolder(i));

  const grid = { gap: 3, display: 'grid', gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' } } as const;

  return (
    <>
      <Box ref={containerRef}>
        {!!selected?.length && (
          <FileManagerActionSelected
            numSelected={selected.length}
            rowCount={dataFiltered.length}
            selected={selected}
            onSelectAllItems={(checked) => onSelectAllItems(checked, dataFiltered.map((row) => row.id))}
            action={
              canWrite ? (
                <Button size="small" color="error" variant="contained" startIcon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={onOpenConfirm} sx={{ mr: 1 }}>
                  Delete
                </Button>
              ) : null
            }
          />
        )}

        <FileManagerPanel title="Folders" subtitle={`${folders.length} folders`} onOpen={canWrite ? newFolderDialog.onTrue : undefined} collapse={foldersCollapse.value} onCollapse={foldersCollapse.onToggle} />
        <Collapse in={!foldersCollapse.value} unmountOnExit>
          <Box sx={grid}>
            {folders.map((folder) => (
              <FileManagerFolderItem key={folder.id} folder={folder} selected={selected.includes(folder.id)} onSelect={() => onSelectItem(folder.id)} />
            ))}
          </Box>
        </Collapse>

        <Box sx={{ mt: 4 }} />

        <FileManagerPanel title="Files" subtitle={`${files.length} files`} onOpen={canWrite ? newFilesDialog.onTrue : undefined} collapse={filesCollapse.value} onCollapse={filesCollapse.onToggle} />
        <Collapse in={!filesCollapse.value} unmountOnExit>
          <Box sx={grid}>
            {files.map((file) => (
              <FileManagerFileItem key={file.id} file={file as any} selected={selected.includes(file.id)} onSelect={() => onSelectItem(file.id)} />
            ))}
          </Box>
        </Collapse>
      </Box>

      <FileManagerCreateFolderDialog open={newFilesDialog.value} onClose={newFilesDialog.onFalse} />
      <FileManagerCreateFolderDialog open={newFolderDialog.value} onClose={newFolderDialog.onFalse} mode="folder" />
    </>
  );
}
