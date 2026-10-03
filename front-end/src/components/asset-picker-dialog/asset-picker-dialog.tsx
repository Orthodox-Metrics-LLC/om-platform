import type { OmAsset, AssetSortField } from 'src/sections/admin/asset-manager/om-assets-api';

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
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';

import { Iconify } from 'src/components/iconify';

import { AssetThumb } from 'src/sections/admin/asset-manager/asset-card';
import { fetchOmAssetsPage, ASSET_SORT_OPTIONS } from 'src/sections/admin/asset-manager/om-assets-api';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (asset: OmAsset) => void;
  /** Initial scope filter, e.g. 'church' when opened from a church-scoped upload. */
  defaultScope?: '' | 'public' | 'church' | 'site' | 'internal';
};

const SCOPE_OPTIONS: { value: '' | 'public' | 'church' | 'site' | 'internal'; label: string }[] = [
  { value: '', label: 'All assets' },
  { value: 'public', label: 'Public assets' },
  { value: 'site', label: 'Site assets' },
  { value: 'church', label: 'Church assets' },
  { value: 'internal', label: 'Internal assets' },
];

/**
 * Shared "browse church storage" dialog — any upload surface in the app can
 * let a user pick an already-uploaded asset instead of their local computer.
 * Browses the full Asset Manager catalog, defaults to newest-first, and
 * supports smart search (video / image / document synonyms plus
 * year/date-range filters).
 */
export function AssetPickerDialog({ open, onClose, onPick, defaultScope = '' }: Props) {
  const [assets, setAssets] = useState<OmAsset[]>([]);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'' | 'public' | 'church' | 'site' | 'internal'>(defaultScope);
  const [sort, setSort] = useState<AssetSortField>('created_desc');
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (
      q: string,
      nextPage = 1,
      nextScope: '' | 'public' | 'church' | 'site' | 'internal' = scope,
      nextSort: AssetSortField = sort,
    ) => {
      setLoading(true);
      try {
        const page = await fetchOmAssetsPage({
          scope: nextScope || undefined,
          search: q || undefined,
          sort: nextSort,
          page: nextPage,
          page_size: 48,
          smart_search: true,
        });
        setAssets(page.assets);
        setTotal(page.total);
        setPageNumber(page.page);
        setPageCount(Math.max(1, Math.ceil(page.total / page.page_size)));
      } finally {
        setLoading(false);
      }
    },
    [scope, sort],
  );

  // Initial load when the dialog opens.
  useEffect(() => {
    if (open) load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced reload on search/scope/sort changes.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => load(search, 1), 350);
    return () => clearTimeout(t);
  }, [open, search, scope, sort, load]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Pick from Asset Manager</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1.5, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            size="small"
            value={scope}
            sx={{ minWidth: 150 }}
            onChange={(event) => {
              const next = event.target.value as typeof scope;
              setScope(next);
              load(search, 1, next, sort);
            }}
          >
            {SCOPE_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>

          <Select
            size="small"
            value={sort}
            sx={{ minWidth: 160 }}
            onChange={(event) => {
              const next = event.target.value as AssetSortField;
              setSort(next);
              load(search, 1, scope, next);
            }}
          >
            {ASSET_SORT_OPTIONS.map((opt) => (
              <MenuItem key={opt.id} value={opt.id}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>

          <TextField
            fullWidth
            size="small"
            placeholder="Search assets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load(search, 1);
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
                  </InputAdornment>
                ),
              },
            }}
          />

          <Button variant="outlined" onClick={() => load(search, 1)}>
            Search
          </Button>
        </Box>

        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
          {loading ? 'Loading…' : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`}
          {' · Try '}
          <Box component="span" sx={{ color: 'text.primary' }}>
            video
          </Box>
          ,{' '}
          <Box component="span" sx={{ color: 'text.primary' }}>
            pictures from 2025
          </Box>
          , or{' '}
          <Box component="span" sx={{ color: 'text.primary' }}>
            docs
          </Box>
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : assets.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 6 }}>
            No assets found. Upload media under Management → Asset Manager first.
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
            page={pageNumber}
            count={pageCount}
            color="primary"
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
