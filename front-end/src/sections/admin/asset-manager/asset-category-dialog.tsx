import type { OmAssetClassification } from './om-assets-api';

import { useState, useEffect } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import Autocomplete from '@mui/material/Autocomplete';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { ASSET_TYPES, ASSET_TAG_VOCAB } from './asset-manager-context';

// ----------------------------------------------------------------------

export function categoryLabel(value: string) {
  return value.replace(/_/g, ' ');
}

export function classificationLabel(value: { category?: string | null; primary_tag?: string | null; secondary_tag?: string | null }) {
  return [value.category, value.primary_tag, value.secondary_tag].filter(Boolean).map((part) => categoryLabel(String(part))).join(' · ');
}

type Props = {
  open: boolean;
  title: string;
  hint?: string;
  current?: OmAssetClassification | null;
  suggested?: OmAssetClassification | null;
  applyLabel?: string;
  /** Sit above the file preview lightbox. */
  elevate?: boolean;
  onClose: () => void;
  onApply: (classification: OmAssetClassification) => void;
};

export function AssetCategoryDialog({
  open,
  title,
  hint,
  current,
  suggested,
  applyLabel = 'Apply',
  elevate = false,
  onClose,
  onApply,
}: Props) {
  const [category, setCategory] = useState('image');
  const [primaryTag, setPrimaryTag] = useState('');
  const [secondaryTag, setSecondaryTag] = useState('');

  useEffect(() => {
    if (!open) return;
    const source = suggested?.category ? suggested : current;
    setCategory(source?.category || 'image');
    setPrimaryTag(source?.primary_tag || '');
    setSecondaryTag(source?.secondary_tag || '');
  }, [open, suggested, current]);

  const unchanged = category === (current?.category || '')
    && primaryTag === (current?.primary_tag || '')
    && secondaryTag === (current?.secondary_tag || '');

  const tagField = (label: string, value: string, onChange: (next: string) => void) => (
    <Autocomplete
      freeSolo
      options={ASSET_TAG_VOCAB}
      value={value}
      onInputChange={(_, next) => onChange(next)}
      renderInput={(params) => <TextField {...params} label={label} placeholder="Optional" />}
    />
  );

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose} sx={elevate ? { zIndex: 12000 } : undefined}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {hint && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{hint}</Typography>}
        <TextField select label="Type" value={category} onChange={(event) => setCategory(event.target.value)}>
          {ASSET_TYPES.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
        </TextField>
        {tagField('Primary tag', primaryTag, setPrimaryTag)}
        {tagField('Secondary tag', secondaryTag, setSecondaryTag)}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!category || (!!current && unchanged)}
          onClick={() => onApply({ category, primary_tag: primaryTag.trim() || null, secondary_tag: secondaryTag.trim() || null })}
        >
          {applyLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
