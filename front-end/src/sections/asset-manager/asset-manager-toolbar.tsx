import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import InputAdornment from '@mui/material/InputAdornment';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { Iconify } from 'src/components/iconify';

import { ASSET_SORT_OPTIONS } from './om-assets-api';
import { AssetChurchSelect } from './asset-church-select';
import { ASSET_SCOPES, useAssetManager, ASSET_CATEGORIES, ASSET_SOURCE_TYPES, ASSET_VISIBILITIES } from './asset-manager-context';

// ----------------------------------------------------------------------

type Props = {
  view: 'grid' | 'list';
  onChangeView: (v: 'grid' | 'list') => void;
  onUpload: () => void;
};

export function AssetManagerToolbar({ view, onChangeView, onUpload }: Props) {
  const { filters, setFilters, resetFilters, total, navLocation, collections } = useAssetManager();
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    const t = setTimeout(() => { if (searchInput.trim() !== filters.search) setFilters({ search: searchInput.trim() }); }, 350);
    return () => clearTimeout(t);
  }, [searchInput, filters.search, setFilters]);

  useEffect(() => { setSearchInput(filters.search); }, [filters.search]);

  const activeChips: { label: string; onDelete: () => void }[] = [];
  if (filters.scope) activeChips.push({ label: `Scope: ${ASSET_SCOPES.find((s) => s.value === filters.scope)?.label}`, onDelete: () => setFilters({ scope: '' }) });
  if (filters.churchId) activeChips.push({ label: `Church #${filters.churchId}`, onDelete: () => setFilters({ churchId: null }) });
  if (filters.category) activeChips.push({ label: `Category: ${filters.category}`, onDelete: () => setFilters({ category: '' }) });
  if (filters.visibility) activeChips.push({ label: `Visibility: ${filters.visibility}`, onDelete: () => setFilters({ visibility: '' }) });
  if (filters.sourceType) activeChips.push({ label: `Source: ${filters.sourceType}`, onDelete: () => setFilters({ sourceType: '' }) });
  if (filters.directory) activeChips.push({ label: `Folder: ${filters.directory}`, onDelete: () => setFilters({ directory: '' }) });
  if (filters.tag) activeChips.push({ label: `Tag: ${filters.tag}`, onDelete: () => setFilters({ tag: '' }) });
  if (filters.collectionId) activeChips.push({ label: `Collection: ${collections.find((c) => c.id === filters.collectionId)?.name ?? filters.collectionId}`, onDelete: () => setFilters({ collectionId: null }) });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search assets…"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} /></InputAdornment> } }}
          sx={{ minWidth: 240, flexGrow: 1, maxWidth: 420 }}
        />
        <TextField select size="small" label="Category" value={filters.category} onChange={(e) => setFilters({ category: e.target.value })} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {ASSET_CATEGORIES.map((c) => <MenuItem key={c.value} value={c.value} sx={{ textTransform: 'capitalize' }}>{c.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Visibility" value={filters.visibility} onChange={(e) => setFilters({ visibility: e.target.value as any })} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          {ASSET_VISIBILITIES.map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Source" value={filters.sourceType} onChange={(e) => setFilters({ sourceType: e.target.value as any })} sx={{ minWidth: 140 }}>
          <MenuItem value="">All</MenuItem>
          {ASSET_SOURCE_TYPES.map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}
        </TextField>
        {filters.scope === 'church' && (
          <Box sx={{ minWidth: 220 }}><AssetChurchSelect size="small" allowNone value={filters.churchId} onChange={(id) => setFilters({ churchId: id })} /></Box>
        )}
        <TextField select size="small" label="Sort" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as any })} sx={{ minWidth: 150 }}>
          {ASSET_SORT_OPTIONS.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
        </TextField>
        <ToggleButtonGroup size="small" value={view} exclusive onChange={(_, v) => v && onChangeView(v)}>
          <ToggleButton value="list"><Iconify icon="solar:list-bold" /></ToggleButton>
          <ToggleButton value="grid"><Iconify icon="mingcute:dot-grid-fill" /></ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<Iconify icon="eva:cloud-upload-fill" />} onClick={onUpload}>Upload</Button>
      </Box>

      {(activeChips.length > 0 || navLocation === 'all') && (
        <Box sx={{ gap: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}><strong>{total}</strong> results</Typography>
          {activeChips.map((c) => <Chip key={c.label} size="small" label={c.label} onDelete={c.onDelete} />)}
          {activeChips.length > 0 && <Button size="small" color="error" startIcon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={resetFilters}>Clear</Button>}
        </Box>
      )}
    </Box>
  );
}
