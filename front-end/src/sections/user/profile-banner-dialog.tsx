import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { churchBannerApi } from 'src/layouts/components/use-parish-appearance';

import { toast } from 'src/components/snackbar';

import { omSocialApi } from './om-social-api';

// ----------------------------------------------------------------------

type Banner = { id: number; url: string };

type Props = {
  open: boolean;
  churchId: number;
  currentUrl: string | null;
  onClose: () => void;
  onApplied: (bannerUrl: string | null) => void;
};

export function ProfileBannerDialog({ open, churchId, currentUrl, onClose, onApplied }: Props) {
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'clear' | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    churchBannerApi
      .list(churchId)
      .then((data) => {
        if (!active) return;
        setBanners(data.banners);
        setCanWrite(data.can_write);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Could not load parish banners');
      });
    return () => {
      active = false;
    };
  }, [open, churchId]);

  const apply = async (bannerId: number | null) => {
    setBusyId(bannerId === null ? 'clear' : bannerId);
    try {
      const result = await omSocialApi.setCover(bannerId);
      onApplied(result.banner_url);
      toast.success(bannerId === null ? 'Profile banner cleared' : 'Profile banner updated');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update banner');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog fullWidth maxWidth="sm" open={open} onClose={busyId ? undefined : onClose} aria-labelledby="profile-banner-title">
      <DialogTitle id="profile-banner-title">Choose a profile banner</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          Pick one of the banners your parish has published.
        </Typography>

        {error && (
          <Typography color="error" variant="body2">
            {error}
          </Typography>
        )}

        {!banners && !error && <LinearProgress />}

        {banners && banners.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Your parish has not published profile banners yet.
            {canWrite ? ' Add some under Account → Appearance.' : ' A priest, deacon, or church admin can add them under Account → Appearance.'}
          </Typography>
        )}

        {banners && banners.length > 0 && (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {banners.map((banner, index) => {
              const selected = banner.url === currentUrl;
              return (
                <Box
                  key={banner.id}
                  component="button"
                  type="button"
                  disabled={!!busyId}
                  aria-pressed={selected}
                  aria-label={`Use parish banner ${index + 1}`}
                  onClick={() => apply(banner.id)}
                  sx={{
                    p: 0,
                    border: '2px solid',
                    borderColor: selected ? 'primary.main' : 'transparent',
                    borderRadius: 1,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    bgcolor: 'background.neutral',
                    '&:focus-visible': { outline: '2px solid', outlineOffset: 2, outlineColor: 'primary.main' },
                    '&:disabled': { cursor: 'progress', opacity: 0.7 },
                  }}
                >
                  <Box
                    component="img"
                    alt=""
                    src={banner.url}
                    sx={{ width: 1, aspectRatio: '16 / 5', objectFit: 'cover', display: 'block' }}
                  />
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {currentUrl && (
          <Button color="inherit" disabled={!!busyId} onClick={() => apply(null)} sx={{ mr: 'auto' }}>
            Use default
          </Button>
        )}
        {canWrite && (
          <Button component={RouterLink} href={`${paths.dashboard.user.account}/appearance`} color="inherit" onClick={onClose}>
            Manage banners
          </Button>
        )}
        <Button variant="outlined" color="inherit" onClick={onClose} disabled={!!busyId}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
