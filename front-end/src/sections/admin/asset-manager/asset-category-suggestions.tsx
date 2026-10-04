import type { OmAssetCategorySuggestion } from './om-assets-api';

import { useMemo, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';

import { Label } from 'src/components/label';

import { categoryLabel } from './asset-category-dialog';

// ----------------------------------------------------------------------

type Props = {
  suggestions: OmAssetCategorySuggestion[];
  onMove: (groups: { ids: number[]; category: string }[]) => void;
};

/** Banner plus review dialog for files named like a category they are not in. */
export function AssetCategorySuggestions({ suggestions, onMove }: Props) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const signature = suggestions.map((item) => item.id).sort((a, b) => a - b).join(',');

  useEffect(() => {
    setDismissed(false);
    setChecked(new Set(suggestions.map((item) => item.id)));
    // Reset the review selection when the suggested set itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const groups = useMemo(() => {
    const map = new Map<string, OmAssetCategorySuggestion[]>();
    for (const item of suggestions) {
      const list = map.get(item.suggested_category) ?? [];
      list.push(item);
      map.set(item.suggested_category, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [suggestions]);

  if (!suggestions.length || dismissed) return null;

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveGroup = (category: string, items: OmAssetCategorySuggestion[]) => {
    const ids = items.map((item) => item.id).filter((id) => checked.has(id));
    if (!ids.length) return;
    setOpen(false);
    onMove([{ ids, category }]);
  };

  const moveChecked = () => {
    const byCategory = new Map<string, number[]>();
    for (const item of suggestions) {
      if (!checked.has(item.id)) continue;
      const list = byCategory.get(item.suggested_category) ?? [];
      list.push(item.id);
      byCategory.set(item.suggested_category, list);
    }
    const moves = [...byCategory.entries()].map(([category, ids]) => ({ category, ids }));
    if (!moves.length) return;
    setOpen(false);
    onMove(moves);
  };

  const checkedCount = suggestions.filter((item) => checked.has(item.id)).length;
  const summary = suggestions.length === 1
    ? `“${suggestions[0].name}” starts with “${categoryLabel(suggestions[0].suggested_category)}” but is filed as ${categoryLabel(suggestions[0].category)}.`
    : `${suggestions.length} files are named like a category they are not in.`;

  return (
    <>
      <Alert
        severity="info"
        sx={{ mb: 2 }}
        action={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button color="inherit" size="small" onClick={() => setDismissed(true)}>Not now</Button>
            <Button color="info" size="small" variant="contained" onClick={() => setOpen(true)}>Review</Button>
          </Box>
        }
      >
        {summary}
      </Alert>

      <Dialog fullWidth maxWidth="sm" open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Move files into the category their name starts with</DialogTitle>
        <DialogContent dividers>
          {groups.map(([category, items]) => {
            const selected = items.filter((item) => checked.has(item.id)).length;
            return (
              <Box key={category} sx={{ mb: 2.5 }}>
                <Box sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2" sx={{ textTransform: 'capitalize', flexGrow: 1 }}>
                    {categoryLabel(category)}
                  </Typography>
                  <Label variant="soft">{selected}/{items.length}</Label>
                  <Button size="small" disabled={!selected} onClick={() => moveGroup(category, items)}>
                    Move these
                  </Button>
                </Box>
                {items.map((item) => (
                  <FormControlLabel
                    key={item.id}
                    sx={{ display: 'flex', mx: 0, alignItems: 'flex-start' }}
                    control={<Checkbox size="small" checked={checked.has(item.id)} onChange={() => toggle(item.id)} />}
                    label={
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                        {item.name}
                        <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.disabled', textTransform: 'capitalize' }}>
                          now {categoryLabel(item.category)}
                        </Typography>
                      </Typography>
                    }
                  />
                ))}
              </Box>
            );
          })}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!checkedCount} onClick={moveChecked}>
            Move {checkedCount} {checkedCount === 1 ? 'file' : 'files'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
