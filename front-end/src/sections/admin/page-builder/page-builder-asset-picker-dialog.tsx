import type { OmAsset } from 'src/sections/asset-manager/om-assets-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import CircularProgress from '@mui/material/CircularProgress';

import { AssetThumb } from 'src/sections/asset-manager/asset-card';
import { fetchOmAssetsPage } from 'src/sections/asset-manager/om-assets-api';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (asset: OmAsset) => void;
};

/**
 * Lightweight asset picker for the Page Builder (not the full Asset Manager
 * context — just enough to browse/search and pick one asset to attach as
 * page/item media). Scoped to 'public' + 'site' assets, since Page Builder
 * content is for the public-facing site.
 */
export function PageBuilderAssetPickerDialog({ open, onClose, onPick }: Props) {
  const [assets, setAssets] = useState<OmAsset[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const page = await fetchOmAssetsPage({ search: q || undefined, page_size: 60 });
      setAssets(page.assets.filter((a) => a.scope === 'public' || a.scope === 'site'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Pick from Asset Manager</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          size="small"
          placeholder="Search assets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(search); }}
          sx={{ mb: 2 }}
        />
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : assets.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 6 }}>
            No public/site assets found. Upload media under Management → Asset Manager first.
          </Typography>
        ) : (
          <Grid container spacing={1.5}>
            {assets.map((asset) => (
              <Grid key={asset.id} size={{ xs: 4, sm: 3, md: 2 }}>
                <Box
                  onClick={() => onPick(asset)}
                  sx={{
                    cursor: 'pointer',
                    borderRadius: 1.5,
                    p: 0.5,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <AssetThumb asset={asset} ratio="1/1" />
                  <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5 }}>
                    {asset.title || asset.name}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
