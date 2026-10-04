import type { IDatePickerControl } from 'src/types/common';

import dayjs from 'dayjs';
import { varAlpha } from 'minimal-shared/utils';
import { useState, useEffect, useCallback } from 'react';
import { usePopover, useBoolean } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import ToggleButton from '@mui/material/ToggleButton';
import InputAdornment from '@mui/material/InputAdornment';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { fIsAfter, fDateRangeShortLabel } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { CustomPopover } from 'src/components/custom-popover';
import { FileThumbnail } from 'src/components/file-thumbnail';
import { CustomDateRangePicker } from 'src/components/custom-date-range-picker';

import { ASSET_SORT_OPTIONS } from './om-assets-api';
import { AssetChurchSelect } from './asset-church-select';
import { ASSET_TYPES, ASSET_SCOPES, useAssetManager, ASSET_TAG_VOCAB, ASSET_SOURCE_TYPES, ASSET_VISIBILITIES } from './asset-manager-context';

// ----------------------------------------------------------------------

const ASSET_FILE_TYPE_OPTIONS = ['image', 'video', 'pdf', 'word', 'excel', 'powerpoint', 'txt', 'zip', 'audio'];

/** Map the icon-grid category labels to the server `file_type` values stored in om_assets */
const TYPE_LABEL_TO_SERVER: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'tiff'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'ogg'],
  pdf: ['pdf'],
  word: ['doc', 'docx'],
  excel: ['xls', 'xlsx', 'csv'],
  powerpoint: ['ppt', 'pptx'],
  txt: ['txt', 'md', 'json', 'xml', 'yaml', 'yml'],
  zip: ['zip', 'rar', '7z', 'tar', 'gz'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
};

type Props = {
  view: 'grid' | 'list';
  onChangeView: (v: 'grid' | 'list') => void;
  onUpload: () => void;
  onZipImport: () => void;
};

export function AssetManagerToolbar({ view, onChangeView, onUpload, onZipImport }: Props) {
  const { filters, setFilters, resetFilters, total, navLocation, collections } = useAssetManager();
  const [searchInput, setSearchInput] = useState(filters.search);
  const dateRange = useBoolean();
  const typePopover = usePopover();

  const startDate: IDatePickerControl = filters.dateFrom ? dayjs(filters.dateFrom) : null;
  const endDate: IDatePickerControl = filters.dateTo ? dayjs(filters.dateTo) : null;
  const dateError = fIsAfter(startDate, endDate);

  useEffect(() => {
    const t = setTimeout(() => { if (searchInput.trim() !== filters.search) setFilters({ search: searchInput.trim() }); }, 350);
    return () => clearTimeout(t);
  }, [searchInput, filters.search, setFilters]);

  useEffect(() => { setSearchInput(filters.search); }, [filters.search]);

  const handleStartDate = useCallback(
    (d: IDatePickerControl) => setFilters({ dateFrom: d ? d.format('YYYY-MM-DD') : '' }),
    [setFilters]
  );
  const handleEndDate = useCallback(
    (d: IDatePickerControl) => setFilters({ dateTo: d ? d.format('YYYY-MM-DD') : '' }),
    [setFilters]
  );

  // Resolve which category label is currently active (for highlighting in the popover)
  const activeTypeCategory = ASSET_FILE_TYPE_OPTIONS.find(
    (cat) => filters.fileType && TYPE_LABEL_TO_SERVER[cat]?.join(',') === filters.fileType
  ) || '';
  const typeDisplayLabel = activeTypeCategory
    ? activeTypeCategory.charAt(0).toUpperCase() + activeTypeCategory.slice(1)
    : '';

  const handleTypeSelect = useCallback(
    (cat: string) => {
      const exts = TYPE_LABEL_TO_SERVER[cat];
      if (!exts) return;
      const csv = exts.join(',');
      // Toggle: clicking the same category clears the filter
      setFilters({ fileType: filters.fileType === csv ? '' : csv });
    },
    [setFilters, filters.fileType]
  );

  const activeChips: { label: string; onDelete: () => void }[] = [];
  if (filters.scope) activeChips.push({ label: `Scope: ${ASSET_SCOPES.find((s) => s.value === filters.scope)?.label}`, onDelete: () => setFilters({ scope: '' }) });
  if (filters.churchId) activeChips.push({ label: `Church #${filters.churchId}`, onDelete: () => setFilters({ churchId: null }) });
  if (filters.category) activeChips.push({ label: `Type: ${filters.category}`, onDelete: () => setFilters({ category: '' }) });
  if (filters.primaryTag) activeChips.push({ label: `Primary: ${filters.primaryTag.replace(/_/g, ' ')}`, onDelete: () => setFilters({ primaryTag: '' }) });
  if (filters.visibility) activeChips.push({ label: `Visibility: ${filters.visibility}`, onDelete: () => setFilters({ visibility: '' }) });
  if (filters.sourceType) activeChips.push({ label: `Source: ${filters.sourceType}`, onDelete: () => setFilters({ sourceType: '' }) });
  if (filters.directory) activeChips.push({ label: `Folder: ${filters.directory}`, onDelete: () => setFilters({ directory: '' }) });
  if (filters.tag) activeChips.push({ label: `Tag: ${filters.tag}`, onDelete: () => setFilters({ tag: '' }) });
  if (filters.collectionId) activeChips.push({ label: `Collection: ${collections.find((c) => c.id === filters.collectionId)?.name ?? filters.collectionId}`, onDelete: () => setFilters({ collectionId: null }) });
  if (filters.fileType) activeChips.push({ label: `File: ${typeDisplayLabel || filters.fileType}`, onDelete: () => setFilters({ fileType: '' }) });
  if (filters.dateFrom && filters.dateTo) activeChips.push({ label: `Date: ${fDateRangeShortLabel(startDate, endDate)}`, onDelete: () => setFilters({ dateFrom: '', dateTo: '' }) });

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
        <TextField select size="small" label="Type" value={filters.category} onChange={(e) => setFilters({ category: e.target.value })} sx={{ minWidth: 140 }}>
          <MenuItem value="">All</MenuItem>
          {ASSET_TYPES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Primary tag" value={filters.primaryTag} onChange={(e) => setFilters({ primaryTag: e.target.value })} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {ASSET_TAG_VOCAB.map((tag) => <MenuItem key={tag} value={tag} sx={{ textTransform: 'capitalize' }}>{tag.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <Button
          color="inherit"
          onClick={typePopover.onOpen}
          endIcon={<Iconify icon={typePopover.open ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'} sx={{ ml: -0.5 }} />}
        >
          {typeDisplayLabel || 'File type'}
          {activeTypeCategory && <Label color="info" sx={{ ml: 1 }}>1</Label>}
        </Button>
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
        <Button
          size="small"
          color="inherit"
          onClick={dateRange.onTrue}
          endIcon={<Iconify icon="eva:arrow-ios-downward-fill" sx={{ ml: -0.5 }} />}
        >
          {startDate && endDate ? fDateRangeShortLabel(startDate, endDate) : 'Select date'}
        </Button>
        <TextField select size="small" label="Sort" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as any })} sx={{ minWidth: 150 }}>
          {ASSET_SORT_OPTIONS.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
        </TextField>
        <ToggleButtonGroup size="small" value={view} exclusive onChange={(_, v) => v && onChangeView(v)}>
          <ToggleButton value="list"><Iconify icon="solar:list-bold" /></ToggleButton>
          <ToggleButton value="grid"><Iconify icon="mingcute:dot-grid-fill" /></ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" startIcon={<Iconify icon="solar:archive-down-minimlistic-bold" />} onClick={onZipImport}>Import ZIP</Button>
        <Button variant="contained" startIcon={<Iconify icon="eva:cloud-upload-fill" />} onClick={onUpload}>Upload</Button>
      </Box>

      {(activeChips.length > 0 || navLocation === 'all') && (
        <Box sx={{ gap: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}><strong>{total}</strong> results</Typography>
          {activeChips.map((c) => <Chip key={c.label} size="small" label={c.label} onDelete={c.onDelete} />)}
          {activeChips.length > 0 && <Button size="small" color="error" startIcon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={resetFilters}>Clear</Button>}
        </Box>
      )}

      <CustomDateRangePicker
        variant="calendar"
        startDate={startDate}
        endDate={endDate}
        onChangeStartDate={handleStartDate}
        onChangeEndDate={handleEndDate}
        open={dateRange.value}
        onClose={dateRange.onFalse}
        selected={!!startDate && !!endDate}
        error={dateError}
      />

      <CustomPopover open={typePopover.open} anchorEl={typePopover.anchorEl} onClose={typePopover.onClose} slotProps={{ paper: { sx: { p: 2.5 } } }}>
        <Box sx={{ gap: 1, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' } }}>
          {ASSET_FILE_TYPE_OPTIONS.map((type) => {
            const selected = activeTypeCategory === type;
            return (
              <ButtonBase
                key={type}
                onClick={() => { handleTypeSelect(type); typePopover.onClose(); }}
                sx={[(theme) => ({
                  p: 1,
                  gap: 1,
                  borderRadius: 1,
                  typography: 'caption',
                  textTransform: 'capitalize',
                  justifyContent: 'flex-start',
                  border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.08)}`,
                  ...(selected && { bgcolor: 'action.selected', fontWeight: 'fontWeightSemiBold' }),
                })]}
              >
                <FileThumbnail file={type} sx={{ width: 24, height: 24 }} />
                {type}
              </ButtonBase>
            );
          })}
        </Box>
        <Box sx={{ mt: 2.5, gap: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button variant="outlined" color="inherit" onClick={() => { setFilters({ fileType: '' }); typePopover.onClose(); }}>Clear</Button>
        </Box>
      </CustomPopover>
    </Box>
  );
}
