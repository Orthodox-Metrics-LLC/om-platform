import type { OmCalendarKind, OmCalendarSource, OmLiturgicalCalendar } from './om-calendar-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Drawer from '@mui/material/Drawer';
import Switch from '@mui/material/Switch';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import ToggleButton from '@mui/material/ToggleButton';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { fToNow } from 'src/utils/format-time';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { ColorPicker } from 'src/components/color-utils';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { omCalendarApi } from './om-calendar-api';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  churchId: number | null;
  colorOptions: string[];
  onChanged: () => void;
};

const KIND_LABEL: Record<OmCalendarKind, string> = { website: 'Parish website (/schedule)', ics: 'iCal / Google Calendar', orthocal: 'Orthodox liturgical calendar' };
const KIND_ICON: Record<OmCalendarKind, string> = { website: 'solar:global-bold-duotone', ics: 'solar:calendar-date-bold', orthocal: 'custom:cross-bold' };

/** Calendars drawer: synced sources, enable/disable, add/remove, default New/Old calendar. */
export function CalendarSourcesPanel({ open, onClose, churchId, colorOptions, onChanged }: Props) {
  const [sources, setSources] = useState<OmCalendarSource[]>([]);
  const [church, setChurch] = useState<{ name: string; website: string | null } | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [defaultCal, setDefaultCal] = useState<OmLiturgicalCalendar>('new');
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [remove, setRemove] = useState<OmCalendarSource | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await omCalendarApi.sources(churchId);
      setSources(r.sources); setChurch(r.church); setCanWrite(r.can_write); setDefaultCal(r.default_calendar);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load calendars'); }
  }, [churchId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); await load(); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} anchor="right" slotProps={{ backdrop: { invisible: true }, paper: { sx: { width: 1, maxWidth: 400 } } }}>
        <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Calendars</Typography>
          {canWrite && (
            <Button size="small" variant="soft" startIcon={<Iconify icon="mingcute:add-line" />} onClick={() => setAddOpen(true)}>Add</Button>
          )}
          <IconButton onClick={onClose} sx={{ ml: 1 }}><Iconify icon="mingcute:close-line" /></IconButton>
        </Box>
        <Divider />

        <Scrollbar>
          <Box sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Default liturgical calendar</Typography>
            <ToggleButtonGroup fullWidth exclusive size="small" value={defaultCal} disabled={!canWrite || busy === 'default'} onChange={(_, v) => v && run('default', () => omCalendarApi.setDefaultCalendar(churchId, v), `Default set to ${v === 'old' ? 'Old' : 'New'} Calendar`)}>
              <ToggleButton value="new">New Calendar</ToggleButton>
              <ToggleButton value="old">Old Calendar</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
              Feasts and fasts come from orthocal.info. Hover a day to see the {defaultCal === 'old' ? 'New' : 'Old'} Calendar equivalent (13 days {defaultCal === 'old' ? 'earlier' : 'later'}).
            </Typography>
          </Box>
          <Divider sx={{ borderStyle: 'dashed' }} />

          <Stack divider={<Divider sx={{ borderStyle: 'dashed' }} />}>
            {sources.map((s) => (
              <Box key={s.id} sx={{ px: 2.5, py: 2, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <Box sx={{ mt: 0.5, width: 12, height: 12, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="subtitle2" noWrap>{s.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Iconify icon={KIND_ICON[s.kind] as any} width={14} />{KIND_LABEL[s.kind]}{s.kind === 'orthocal' ? ` · ${(s.config.calendar || 'new') === 'old' ? 'Old' : 'New'} Calendar` : ''}
                  </Typography>
                  {s.kind !== 'orthocal' && s.url && <Typography variant="caption" noWrap sx={{ color: 'text.disabled', display: 'block' }}>{s.url}</Typography>}
                  {s.last_error ? (
                    <Typography variant="caption" color="error" sx={{ display: 'block' }}>{s.last_error}</Typography>
                  ) : s.last_synced_at ? (
                    <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>Synced {fToNow(s.last_synced_at)}</Typography>
                  ) : null}
                  {canWrite && (
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      <ColorPicker options={colorOptions} value={s.color} onChange={(c) => run(`color-${s.id}`, () => omCalendarApi.updateSource(churchId, s.id, { color: c as string }))} limit={8} />
                    </Box>
                  )}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <Switch size="small" checked={s.enabled} disabled={!canWrite || busy === `en-${s.id}`} onChange={(e) => run(`en-${s.id}`, () => omCalendarApi.updateSource(churchId, s.id, { enabled: e.target.checked }))} />
                  <Box sx={{ display: 'flex' }}>
                    <Tooltip title="Sync now"><IconButton size="small" disabled={busy === `sync-${s.id}`} onClick={() => run(`sync-${s.id}`, async () => { const r = await omCalendarApi.syncSource(churchId, s.id); if (r.source.last_error) throw new Error(r.source.last_error); toast.success(`${r.count} events synced`); })}><Iconify icon="solar:restart-bold" width={18} /></IconButton></Tooltip>
                    {canWrite && <Tooltip title="Remove"><IconButton size="small" color="error" onClick={() => setRemove(s)}><Iconify icon="solar:trash-bin-trash-bold" width={18} /></IconButton></Tooltip>}
                  </Box>
                </Box>
              </Box>
            ))}
          </Stack>

          {church && (
            <Box sx={{ p: 2.5 }}>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                Parish website: {church.website || 'not set — add it on the church manager, priest or deacon account (Profile → Website)'}
              </Typography>
            </Box>
          )}
        </Scrollbar>
      </Drawer>

      <AddSourceDialog open={addOpen} onClose={() => setAddOpen(false)} churchId={churchId} colorOptions={colorOptions} onAdded={() => { load(); onChanged(); }} />

      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} title="Remove calendar" content={<>Remove <strong>{remove?.name}</strong> from this parish&apos;s calendar?</>} action={<Button variant="contained" color="error" onClick={() => { const s = remove!; setRemove(null); run(`rm-${s.id}`, () => omCalendarApi.removeSource(churchId, s.id), 'Calendar removed'); }}>Remove</Button>} />
    </>
  );
}

// ----------------------------------------------------------------------

function AddSourceDialog({ open, onClose, churchId, colorOptions, onAdded }: { open: boolean; onClose: () => void; churchId: number | null; colorOptions: string[]; onAdded: () => void }) {
  const [form, setForm] = useState<{ name: string; kind: OmCalendarKind; url: string; color: string; calendar: OmLiturgicalCalendar }>({ name: '', kind: 'ics', url: '', color: colorOptions[2] ?? '#00B8D9', calendar: 'new' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm({ name: '', kind: 'ics', url: '', color: colorOptions[2] ?? '#00B8D9', calendar: 'new' }); }, [open, colorOptions]);

  const submit = async () => {
    setBusy(true);
    try {
      const s = await omCalendarApi.addSource(churchId, { name: form.name.trim(), kind: form.kind, url: form.kind === 'orthocal' ? undefined : form.url.trim(), color: form.color, config: form.kind === 'orthocal' ? { calendar: form.calendar } : undefined });
      const r = await omCalendarApi.syncSource(churchId, s.id).catch(() => null);
      if (r?.source.last_error) toast.warning(`Added, but sync failed: ${r.source.last_error}`);
      else toast.success(`Calendar added${r ? ` · ${r.count} events` : ''}`);
      onAdded(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add calendar'); } finally { setBusy(false); }
  };

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle>Add calendar</DialogTitle>
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField autoFocus label="Name" placeholder="e.g. OCA Calendar" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <TextField select label="Type" value={form.kind} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value as OmCalendarKind }))}>
          <MenuItem value="ics">iCal / webcal / Google Calendar link</MenuItem>
          <MenuItem value="website">Parish website (reads /schedule)</MenuItem>
          <MenuItem value="orthocal">Orthodox liturgical calendar (orthocal.info)</MenuItem>
        </TextField>
        {form.kind !== 'orthocal' ? (
          <TextField label={form.kind === 'website' ? 'Website' : 'Calendar URL'} placeholder={form.kind === 'website' ? 'https://yourparish.org' : 'https://…/basic.ics or a Google Calendar embed link'} value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))} helperText={form.kind === 'website' ? 'We look for the iCal feed linked from /schedule.' : 'Google Calendar embed links are converted to their public iCal feed.'} />
        ) : (
          <TextField select label="Calendar" value={form.calendar} onChange={(e) => setForm((p) => ({ ...p, calendar: e.target.value as OmLiturgicalCalendar }))}>
            <MenuItem value="new">New Calendar (Gregorian)</MenuItem>
            <MenuItem value="old">Old Calendar (Julian)</MenuItem>
          </TextField>
        )}
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>Color</Typography>
          <ColorPicker options={colorOptions} value={form.color} onChange={(c) => setForm((p) => ({ ...p, color: c as string }))} limit={8} />
        </Box>
        {form.kind === 'ics' && /goarch\.org/i.test(form.url) && <Alert severity="warning">goarch.org blocks automated access; use a direct iCal export URL if one is available.</Alert>}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" loading={busy} disabled={!form.name.trim() || (form.kind !== 'orthocal' && !form.url.trim())} onClick={submit}>Add</Button>
      </DialogActions>
    </Dialog>
  );
}
