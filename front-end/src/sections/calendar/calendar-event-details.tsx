import type { OmCalendarEvent } from './om-calendar-api';

import dayjs from 'dayjs';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

/** Read-only details for events that come from a synced source. */
export function CalendarEventDetails({ event, onClose }: { event: OmCalendarEvent | null; onClose: () => void }) {
  if (!event) return null;
  const start = dayjs(event.start as string);
  const end = event.end ? dayjs(event.end as string) : null;
  const when = event.allDay
    ? end && end.diff(start, 'day') > 1 ? `${start.format('ddd, MMM D')} – ${end.subtract(1, 'day').format('ddd, MMM D, YYYY')}` : start.format('dddd, MMMM D, YYYY')
    : `${start.format('dddd, MMMM D, YYYY · h:mm A')}${end ? ` – ${end.format('h:mm A')}` : ''}`;
  const lit = event.liturgical;

  return (
    <Dialog fullWidth maxWidth="xs" open onClose={onClose}>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: event.color, flexShrink: 0 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>{event.title}</Typography>
        </Box>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>{event.source_name} · read-only</Typography>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', typography: 'body2' }}><Iconify icon="solar:calendar-date-bold" width={18} sx={{ color: 'text.secondary' }} />{when}</Box>
        {event.location && <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', typography: 'body2' }}><Iconify icon="mingcute:location-fill" width={18} sx={{ color: 'text.secondary' }} />{event.location}</Box>}
        {lit ? (
          <>
            {lit.fast_level_description && <Label variant="soft" color={/no fast/i.test(lit.fast_level_description) ? 'success' : 'warning'} sx={{ alignSelf: 'flex-start' }}>{lit.fast_level_description}</Label>}
            {lit.feasts.length > 0 && <Typography variant="body2">{lit.feasts.join(' · ')}</Typography>}
            {lit.saints.length > 0 && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{lit.saints.join('; ')}</Typography>}
            {lit.readings.length > 0 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Readings: {lit.readings.join(' · ')}</Typography>}
            <Typography variant="caption" sx={{ color: 'info.main' }}>{lit.other.label}: {dayjs(lit.other.date).format('MMMM D')}</Typography>
          </>
        ) : event.description ? (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{event.description}</Typography>
        ) : null}
        {event.url && <Link href={event.url} target="_blank" rel="noopener" variant="body2">Open source link</Link>}
      </DialogContent>
      <DialogActions><Button variant="outlined" color="inherit" onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}
