import { useState, useEffect } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import ListSubheader from '@mui/material/ListSubheader';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { ASSET_CATEGORIES } from './asset-manager-context';

// ----------------------------------------------------------------------

export function categoryLabel(value: string) {
  return value.replace(/_/g, ' ');
}

type Props = {
  open: boolean;
  title: string;
  hint?: string;
  /** When set, Apply stays disabled until a different category is chosen. */
  currentCategory?: string;
  suggestedCategory?: string | null;
  applyLabel?: string;
  /** Sit above the file preview lightbox. */
  elevate?: boolean;
  onClose: () => void;
  onApply: (category: string) => void;
};

export function AssetCategoryDialog({
  open,
  title,
  hint,
  currentCategory,
  suggestedCategory,
  applyLabel = 'Apply',
  elevate = false,
  onClose,
  onApply,
}: Props) {
  const [category, setCategory] = useState('');

  useEffect(() => {
    if (!open) return;
    setCategory(suggestedCategory || currentCategory || ASSET_CATEGORIES[0]?.value || '');
  }, [open, suggestedCategory, currentCategory]);

  const groups = [...new Set(ASSET_CATEGORIES.map((item) => item.group))];

  return (
    <Dialog
      fullWidth
      maxWidth="xs"
      open={open}
      onClose={onClose}
      sx={elevate ? { zIndex: 12000 } : undefined}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {hint && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{hint}</Typography>}
        <TextField
          select
          label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {groups.flatMap((group) => [
            <ListSubheader key={group}>{group}</ListSubheader>,
            ...ASSET_CATEGORIES.filter((item) => item.group === group).map((item) => (
              <MenuItem key={item.value} value={item.value} sx={{ textTransform: 'capitalize' }}>
                {item.label}
              </MenuItem>
            )),
          ])}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!category || category === currentCategory}
          onClick={() => onApply(category)}
        >
          {applyLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
