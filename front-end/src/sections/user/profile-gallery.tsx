import type { OmGalleryItem } from './om-social-api';

import { usePopover } from 'minimal-shared/hooks';
import { useRef, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';

import { fDate } from 'src/utils/format-time';

import { Image } from 'src/components/image';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { CustomPopover } from 'src/components/custom-popover';
import { Lightbox, useLightbox } from 'src/components/lightbox';

import { omSocialApi } from './om-social-api';

// ----------------------------------------------------------------------

type Props = {
  userId: number;
  isSelf: boolean;
};

export function ProfileGallery({ userId, isSelf }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [gallery, setGallery] = useState<OmGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGallery(await omSocialApi.gallery(userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load gallery');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const slides = gallery.map((g) => ({ src: g.url }));
  const lightbox = useLightbox(slides);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      await omSocialApi.upload(files, 'gallery');
      toast.success(`${files.length} image${files.length === 1 ? '' : 's'} added`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Box sx={{ my: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h4">Gallery</Typography>
        {isSelf && (
          <>
            <Button variant="contained" loading={uploading} onClick={() => fileRef.current?.click()} startIcon={<Iconify icon="solar:camera-add-bold" />}>
              Add photos
            </Button>
            <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleFiles} />
          </>
        )}
      </Box>

      <Box sx={{ gap: 3, display: 'grid', gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
        {gallery.map((image) => (
          <GalleryCard key={image.id} image={image} canDelete={isSelf} onOpen={() => lightbox.onOpen(image.url)} onDeleted={load} />
        ))}
      </Box>

      {!loading && !gallery.length && (
        <Typography variant="body2" sx={{ color: 'text.disabled', textAlign: 'center', py: 6 }}>
          {isSelf ? 'Your gallery is empty — add photos above.' : 'No photos yet.'}
        </Typography>
      )}

      <Lightbox index={lightbox.selected} slides={slides} open={lightbox.open} close={lightbox.onClose} />
    </>
  );
}

// ----------------------------------------------------------------------

function GalleryCard({ image, canDelete, onOpen, onDeleted }: { image: OmGalleryItem; canDelete: boolean; onOpen: () => void; onDeleted: () => void }) {
  const menu = usePopover();

  const handleDelete = async () => {
    menu.onClose();
    try {
      await omSocialApi.deleteGalleryItem(image.id);
      toast.success('Photo removed');
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove');
    }
  };

  return (
    <>
      <Card sx={{ cursor: 'pointer', color: 'common.white' }}>
        {canDelete && (
          <IconButton color="inherit" onClick={menu.onOpen} sx={{ top: 8, right: 8, zIndex: 9, position: 'absolute' }}>
            <Iconify icon="eva:more-vertical-fill" />
          </IconButton>
        )}

        <ListItemText
          sx={{ p: 3, left: 0, width: 1, bottom: 0, zIndex: 9, position: 'absolute' }}
          primary={image.caption || 'Photo'}
          secondary={fDate(image.created_at)}
          slotProps={{
            primary: { noWrap: true, sx: { typography: 'subtitle1' } },
            secondary: { sx: { mt: 0.5, opacity: 0.48, color: 'inherit' } },
          }}
        />

        <Image
          alt={image.caption || 'Gallery'}
          ratio="1/1"
          src={image.url}
          onClick={onOpen}
          slotProps={{
            overlay: {
              sx: (theme) => ({ backgroundImage: `linear-gradient(to bottom, transparent 0%, ${theme.vars.palette.common.black} 75%)` }),
            },
          }}
        />
      </Card>

      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose}>
        <MenuList>
          <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
            <Iconify icon="solar:trash-bin-trash-bold" />
            Remove photo
          </MenuItem>
        </MenuList>
      </CustomPopover>
    </>
  );
}
