import { useState } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import { useSearchParams } from 'src/routes/hooks';

import { SacramentalCalendarView } from 'src/sections/records/sacramental-calendar-view';

import { CalendarView } from './calendar-view';

// ----------------------------------------------------------------------

type CalendarTab = 'calendar' | 'sacramental';

/**
 * Single "Calendar" location that hosts both the regular event calendar and
 * the Sacramental calendar as tabs, so there's one nav entry instead of two.
 * Each tab keeps its own page exactly as it already works (own
 * DashboardContent/heading/breadcrumbs) — this is just a switcher, not a
 * merge of their internals.
 */
export function CalendarHubView() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<CalendarTab>(
    searchParams.get('tab') === 'sacramental' ? 'sacramental' : 'calendar',
  );

  return (
    <>
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, md: 3 } }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)}>
          <Tab value="calendar" label="Calendar" />
          <Tab value="sacramental" label="Sacramental Calendar" />
        </Tabs>
      </Box>

      {tab === 'calendar' ? <CalendarView /> : <SacramentalCalendarView />}
    </>
  );
}
