import type { DrawerProps } from '@mui/material/Drawer';
import type { OmFileItem } from './om-files-api';

import { useState, useEffect } from 'react';
import { useBoolean } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Autocomplete from '@mui/material/Autocomplete';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { useOmFiles } from './om-files-context';
import { isFolder, omFilesApi } from './om-files-api';
import { FileManagerShareDialog } from './file-manager-share-dialog';
import { FileManagerInvitedItem } from './file-manager-invited-item';

// ----------------------------------------------------------------------

type Props = DrawerProps & {
  item: OmFileItem;
  onClose: () => void;
  onDelete: () => void;
};

export function FileManagerFileDetails({ item, open, onClose, onDelete, ...other }: Props) {
  const { churchId, canWrite, actions, refresh } = useOmFiles();
  const shareDialog = useBoolean();
  const showTags = useBoolean(true);
  const showProperties = useBoolean(true);
  const [tags, setTags] = useState<string[]>(item.tags ?? []);
  const [name, setName] = useState(item.name);

  useEffect(() => {
    setTags(item.tags ?? []);
    setName(item.name);
  }, [item]);

  const folder = isFolder(item);
  const hasShared = !!item.shared?.length;

  const saveTags = async (next: string[]) => {
    setTags(next);
    try {
      await omFilesApi.update(churchId, item.id, { tags: next });
      refresh();
    } catch {
      /* ignore */
    }
  };

  const saveName = async () => {
    if (name.trim() && name.trim() !== item.name) await actions.rename(item, name.trim()).catch(() => setName(item.name));
  };

  const renderHead = () => (
    <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center' }}>
      <Typography variant="h6" sx={{ flexGrow: 1 }}>
        Info
      </Typography>
      <Checkbox
        color="warning"
        icon={<Iconify icon="eva:star-outline" />}
        checkedIcon={<Iconify icon="eva:star-fill" />}
        checked={item.isFavorited}
        onChange={() => actions.toggleFavorite(item)}
        slotProps={{ input: { id: `favorite-details-${item.id}-checkbox`, 'aria-label': `Favorite ${item.name}` } }}
      />
    </Box>
  );

  const properties: { label: string; value: React.ReactNode }[] = [
    { label: 'Size', value: fData(item.size) },
    { label: 'Modified', value: fDateTime(item.modifiedAt) },
    { label: 'Type', value: folder ? 'folder' : item.type },
    ...(folder ? [{ label: 'Files', value: `${item.totalFiles ?? 0}` }] : [{ label: 'Category', value: item.category }]),
    { label: 'Created', value: fDateTime(item.createdAt) },
  ];

  const renderProperties = () => (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', typography: 'subtitle2', justifyContent: 'space-between' }}>
        Properties
        <IconButton size="small" onClick={showProperties.onToggle}>
          <Iconify icon={showProperties.value ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'} />
        </IconButton>
      </Box>
      {showProperties.value &&
        properties.map((p) => (
          <Box key={p.label} sx={{ gap: 2, display: 'flex', typography: 'caption' }}>
            <Box component="span" sx={{ width: 80, color: 'text.secondary' }}>{p.label}</Box>
            {p.value}
          </Box>
        ))}
    </Stack>
  );

  const renderTags = () => (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', typography: 'subtitle2', justifyContent: 'space-between' }}>
        Tags
        <IconButton size="small" onClick={showTags.onToggle}>
          <Iconify icon={showTags.value ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'} />
        </IconButton>
      </Box>
      {showTags.value && (
        <Autocomplete
          multiple
          freeSolo
          disabled={!canWrite}
          options={[]}
          value={tags}
          onChange={(_, v) => saveTags(v as string[])}
          renderValue={(selected, getTagProps) =>
            selected.map((option, index) => <Chip {...getTagProps({ index })} size="small" variant="soft" label={option} key={option} />)
          }
          renderInput={(params) => <TextField {...params} placeholder={canWrite ? '#Add a tag' : ''} />}
        />
      )}
    </Stack>
  );

  const renderShared = () => (
    <>
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">Shared with</Typography>
        {canWrite && (
          <IconButton size="small" color="primary" onClick={shareDialog.onTrue} sx={(theme) => ({ width: 24, height: 24, bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: theme.vars.palette.primary.dark } })}>
            <Iconify icon="mingcute:add-line" />
          </IconButton>
        )}
      </Box>
      {hasShared ? (
        <Box component="ul" sx={{ pl: 2.5, pr: 1 }}>
          {item.shared!.map((person) => <FileManagerInvitedItem key={person.id} person={person} />)}
        </Box>
      ) : (
        <Typography variant="caption" sx={{ px: 2.5, color: 'text.disabled' }}>Only you and your parish administrators.</Typography>
      )}
    </>
  );

  return (
    <>
      <Drawer open={open} onClose={onClose} anchor="right" slotProps={{ backdrop: { invisible: true }, paper: { sx: { width: 320 } } }} {...other}>
        {renderHead()}
        <Scrollbar>
          <Stack spacing={2.5} sx={{ p: 2.5, justifyContent: 'center', bgcolor: 'background.neutral' }}>
            {!folder && item.category === 'image' ? (
              <Box component="img" alt={item.name} src={omFilesApi.downloadUrl(item, true)} sx={{ width: 1, aspectRatio: '4/3', objectFit: 'cover', borderRadius: 1.5 }} />
            ) : (
              <FileThumbnail file={folder ? 'folder' : item.name} sx={{ width: 64, height: 64, alignSelf: 'flex-start' }} />
            )}
            {canWrite && !(folder && item.systemKey) ? (
              <TextField fullWidth size="small" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} slotProps={{ input: { sx: { typography: 'subtitle1' } } }} />
            ) : (
              <Typography variant="subtitle1" sx={{ wordBreak: 'break-all' }}>{item.name}</Typography>
            )}
            <Divider sx={{ borderStyle: 'dashed' }} />
            {renderTags()}
            {renderProperties()}
          </Stack>
          {renderShared()}
        </Scrollbar>

        <Box sx={{ p: 2.5, display: 'flex', gap: 1 }}>
          {!folder && (
            <Button fullWidth variant="soft" color="primary" component="a" href={item.url} startIcon={<Iconify icon="eva:cloud-download-fill" />}>
              Download
            </Button>
          )}
          {canWrite && !(folder && item.systemKey) && (
            <Button fullWidth variant="soft" color="error" size="large" startIcon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={onDelete}>
              Delete
            </Button>
          )}
        </Box>
      </Drawer>

      <FileManagerShareDialog open={shareDialog.value} item={item} onClose={shareDialog.onFalse} onCopyLink={() => actions.copyLink(item)} />
    </>
  );
}
