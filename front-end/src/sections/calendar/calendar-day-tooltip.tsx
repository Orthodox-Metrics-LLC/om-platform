import type { OmLiturgicalDay } from './om-calendar-api';

import dayjs from 'dayjs';
import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

type Props = {
  /** Element wrapping the FullCalendar root; day cells are found via [data-date]. */
  containerRef: React.RefObject<HTMLElement | null>;
  days: Map<string, OmLiturgicalDay>;
};

/**
 * Hovering a day shows the liturgical commemoration for the church's default
 * calendar and the equivalent civil date on the other calendar
 * (e.g. Protection of the Theotokos: New Calendar Oct 1 ↔ Old Calendar Oct 14).
 */
export function CalendarDayTooltip({ containerRef, days }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onOver = (e: Event) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.fc-daygrid-day[data-date], .fc-timegrid-col[data-date], .fc-list-day[data-date]');
      if (!cell) return;
      const d = cell.getAttribute('data-date');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { setAnchor(cell); setDate(d); }, 220);
    };
    const onOut = (e: Event) => {
      const to = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (to && to.closest?.('.fc-daygrid-day[data-date], .fc-timegrid-col[data-date], .fc-list-day[data-date]')) return;
      if (timer) clearTimeout(timer);
      setAnchor(null); setDate(null);
    };
    root.addEventListener('mouseover', onOver);
    root.addEventListener('mouseleave', onOut);
    root.addEventListener('mouseout', onOut);
    return () => { root.removeEventListener('mouseover', onOver); root.removeEventListener('mouseleave', onOut); root.removeEventListener('mouseout', onOut); if (timer) clearTimeout(timer); };
  }, [containerRef]);

  const day = date ? days.get(date) : undefined;
  if (!anchor || !date || !day) return null;

  const otherIsLater = day.other.calendar === 'old';

  return (
    <Popper open anchorEl={anchor} placement="top" sx={{ zIndex: (t) => t.zIndex.tooltip, pointerEvents: 'none' }} modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}>
      <Paper elevation={12} sx={{ p: 2, width: 320, borderRadius: 1.5 }}>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {dayjs(day.date).format('dddd, MMMM D')} · {day.calendar === 'old' ? 'Old' : 'New'} Calendar{day.tone ? ` · Tone ${day.tone}` : ''}
        </Typography>
        <Typography variant="subtitle2" sx={{ mt: 0.25 }}>{day.title}</Typography>
        {day.feasts.length > 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{day.feasts.slice(0, 3).join(' · ')}</Typography>
        )}
        {day.saints.length > 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>{day.saints.slice(0, 4).join('; ')}{day.saints.length > 4 ? '…' : ''}</Typography>
        )}
        {day.fast_level_description && (
          <Box sx={{ mt: 1 }}>
            <Label variant="soft" color={/no fast/i.test(day.fast_level_description) ? 'success' : 'warning'}>{day.fast_level_description}{day.fast_exception_description ? ` — ${day.fast_exception_description}` : ''}</Label>
          </Box>
        )}
        <Divider sx={{ my: 1.5, borderStyle: 'dashed' }} />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <Iconify icon="solar:transfer-horizontal-bold-duotone" width={18} sx={{ color: 'info.main', mt: 0.25, flexShrink: 0 }} />
          <Box>
            <Typography variant="caption" sx={{ display: 'block' }}>
              <strong>{day.other.label}:</strong> this commemoration falls on <strong>{dayjs(day.other.date).format('MMMM D')}</strong> ({otherIsLater ? '13 days later' : '13 days earlier'}).
            </Typography>
            {day.other.today_title && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                On {dayjs(day.date).format('MMM D')} the {day.other.label} observes: {day.other.today_title}
              </Typography>
            )}
          </Box>
        </Box>
      </Paper>
    </Popper>
  );
}
