import type { SavedSearch, ParishSearchAst, SearchResultRow } from './om-records-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { fToNow } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { parishSearchApi } from './om-records-api';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  churchId: number;
  /** The search currently shown (to save it). */
  currentAst: ParishSearchAst | null;
  onRun: (r: { rows: SearchResultRow[]; total: number; ast: ParishSearchAst; name: string }) => void;
};

export function RecordsSavedSearchesDrawer({ open, onClose, churchId, currentAst, onRun }: Props) {
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<SavedSearch['visibility']>('private');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => parishSearchApi.listSaved(churchId).then(setItems).catch(() => setItems([])), [churchId]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const save = async () => {
    if (!currentAst || !name.trim()) return;
    setBusy('save');
    try { await parishSearchApi.createSaved({ churchId, name: name.trim(), queryAst: currentAst, visibility }); setName(''); toast.success('Search saved'); load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(null); }
  };
  const run = async (s: SavedSearch) => {
    setBusy(`run-${s.id}`);
    try { const r = await parishSearchApi.runSaved(s.id, churchId); onRun({ ...r, name: s.name }); load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not run'); } finally { setBusy(null); }
  };
  const pin = (s: SavedSearch) => parishSearchApi.updateSaved(s.id, { churchId, pinned: !s.pinned }).then(load).catch((e) => toast.error(e.message));
  const remove = (s: SavedSearch) => parishSearchApi.deleteSaved(s.id, churchId).then(() => { toast.success('Deleted'); load(); }).catch((e) => toast.error(e.message));

  const sorted = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastRunAt || '').localeCompare(a.lastRunAt || ''));

  return (
    <Drawer open={open} onClose={onClose} anchor="right" slotProps={{ backdrop: { invisible: true }, paper: { sx: { width: 1, maxWidth: 400 } } }}>
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Saved searches</Typography>
        <IconButton onClick={onClose}><Iconify icon="mingcute:close-line" /></IconButton>
      </Box>
      <Divider />

      {currentAst && (
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, bgcolor: 'background.neutral' }}>
          <Typography variant="subtitle2">Save the current search</Typography>
          <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField select size="small" label="Visible to" value={visibility} onChange={(e) => setVisibility(e.target.value as any)} sx={{ flexGrow: 1 }}>
              <MenuItem value="private">Only me</MenuItem><MenuItem value="parish">Whole parish</MenuItem><MenuItem value="parish_admin">Parish admins</MenuItem>
            </TextField>
            <Button variant="contained" disabled={!name.trim()} loading={busy === 'save'} onClick={save}>Save</Button>
          </Box>
        </Box>
      )}

      <Scrollbar>
        <Stack divider={<Divider sx={{ borderStyle: 'dashed' }} />}>
          {sorted.map((s) => (
            <Box key={s.id} sx={{ px: 2.5, py: 2, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2" noWrap>{s.name}</Typography>
                  {s.pinned && <Iconify icon="eva:star-fill" width={14} sx={{ color: 'warning.main' }} />}
                  <Label variant="soft">{s.visibility.replace('_', ' ')}</Label>
                </Box>
                {s.description && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{s.description}</Typography>}
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  {s.queryAst.scope.recordTypes.join(', ')} · {s.queryAst.filters.conditions.length} filter{s.queryAst.filters.conditions.length === 1 ? '' : 's'} · run {s.runCount}×{s.lastRunAt ? ` · last ${fToNow(s.lastRunAt)}` : ''}{s.lastResultCount != null ? ` · ${s.lastResultCount} results` : ''}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex' }}>
                <Tooltip title="Run"><IconButton size="small" color="primary" disabled={busy === `run-${s.id}`} onClick={() => run(s)}><Iconify icon="solar:play-circle-bold" /></IconButton></Tooltip>
                <Tooltip title={s.pinned ? 'Unpin' : 'Pin'}><IconButton size="small" onClick={() => pin(s)}><Iconify icon={s.pinned ? 'eva:star-fill' : 'eva:star-outline'} /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => remove(s)}><Iconify icon="solar:trash-bin-trash-bold" /></IconButton></Tooltip>
              </Box>
            </Box>
          ))}
          {!items.length && <Typography variant="body2" sx={{ p: 4, textAlign: 'center', color: 'text.disabled' }}>No saved searches yet. Run a search, then save it here.</Typography>}
        </Stack>
      </Scrollbar>
    </Drawer>
  );
}
