import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { churchBannerApi } from 'src/layouts/components/use-parish-appearance';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { FileSourceButton } from 'src/components/file-source-button/file-source-button';

import { omSocialApi } from 'src/sections/user/om-social-api';

// ----------------------------------------------------------------------

type Banner = { id: number; url: string };

/**
 * Parish profile-banner library (up to 12). Priest, deacon, and church admin
 * publish images here; every member of the church picks one on their profile.
 */
export function AccountProfileBanners({ churchId = null }: { churchId?: number | null }) {
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [max, setMax] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await churchBannerApi.list(churchId);
      setBanners(data.banners);
      setCanWrite(data.can_write);
      setMax(data.max || 12);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load profile banners');
    }
  }, [churchId]);

  useEffect(() => {
    load();
  }, [load]);

  const publish = async (fileUrl: string) => {
    const data = await churchBannerApi.add(fileUrl, churchId);
    setBanners(data.banners);
    toast.success('Profile banner added');
  };

  const handleLocalFile = async (file: File) => {
    setUploading(true);
    try {
      const [uploaded] = await omSocialApi.upload([file], 'cover');
      await publish(uploaded.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAsset = async (url: string) => {
    setUploading(true);
    try {
      await publish(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add that image');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: number) => {
    setRemovingId(id);
    try {
      const data = await churchBannerApi.remove(id, churchId);
      setBanners(data.banners);
      toast.success('Profile banner removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove banner');
    } finally {
      setRemovingId(null);
    }
  };

  const count = banners?.length ?? 0;
  const full = count >= max;

  return (
    <Card sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h6">Profile banners</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            Up to {max} images. Anyone in this parish can click the banner on their profile and choose one of these.
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: 'text.disabled', whiteSpace: 'nowrap' }}>
          {count} of {max}
        </Typography>
      </Box>

      {error && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}

      {!banners && !error && <LinearProgress />}

      {banners && (
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
          }}
        >
          {banners.map((banner, index) => (
            <Box key={banner.id} sx={{ position: 'relative' }}>
              <Box
                component="img"
                alt={`Parish profile banner ${index + 1}`}
                src={banner.url}
                sx={{ width: 1, aspectRatio: '16 / 5', objectFit: 'cover', borderRadius: 1, display: 'block', bgcolor: 'background.neutral' }}
              />
              {canWrite && (
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`Remove profile banner ${index + 1}`}
                  disabled={removingId === banner.id}
                  onClick={() => remove(banner.id)}
                  sx={{ position: 'absolute', top: 6, right: 6, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                >
                  <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                </IconButton>
              )}
            </Box>
          ))}
        </Box>
      )}

      {banners && count === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No profile banners yet. Wide images, about 16:5, look best across the top of a profile.
        </Typography>
      )}

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
        {!canWrite && (
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            Only church administrators, priests, and deacons can add these.
          </Typography>
        )}
        {canWrite && !full && (
          <FileSourceButton
            label={count ? 'Add banner' : 'Upload banner'}
            loading={uploading}
            assetScope="church"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onLocalFile={handleLocalFile}
            onAssetPicked={(asset) => {
              if (asset.url) handleAsset(asset.url);
            }}
          />
        )}
        {canWrite && full && (
          <Button disabled variant="outlined" color="inherit">
            {max} banners published
          </Button>
        )}
      </Box>
    </Card>
  );
}
