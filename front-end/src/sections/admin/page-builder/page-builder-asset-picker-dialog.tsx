import type { OmAsset } from 'src/sections/admin/asset-manager/om-assets-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Pagination from '@mui/material/Pagination';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import CircularProgress from '@mui/material/CircularProgress';

import { AssetThumb } from 'src/sections/admin/asset-manager/asset-card';
import { fetchOmAssetsPage } from 'src/sections/admin/asset-manager/om-assets-api';

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
  const [scope, setScope] = useState<'public' | 'site'>('public');
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: string, nextPage = 1, nextScope: 'public' | 'site' = scope) => {
    setLoading(true);
    try {
      const page = await fetchOmAssetsPage({ scope: nextScope, search: q || undefined, page: nextPage, page_size: 48 });
      setAssets(page.assets);
      setPageNumber(page.page);
      setPageCount(Math.max(1, Math.ceil(page.total / page.page_size)));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    if (open) load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Pick from Asset Manager</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <Select
            size="small" value={scope} sx={{ minWidth: 140 }}
            onChange={(event) => {
              const next = event.target.value as 'public' | 'site';
              setScope(next);
              load(search, 1, next);
            }}
          >
            <MenuItem value="public">Public assets</MenuItem>
            <MenuItem value="site">Site assets</MenuItem>
          </Select>
          <TextField
            fullWidth size="small" placeholder="Search assets…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(search, 1); }}
          />
          <Button variant="outlined" onClick={() => load(search, 1)}>Search</Button>
        </Box>
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
        {!loading && pageCount > 1 && (
          <Pagination
            page={pageNumber} count={pageCount} color="primary"
            onChange={(_, nextPage) => load(search, nextPage)}
            sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
