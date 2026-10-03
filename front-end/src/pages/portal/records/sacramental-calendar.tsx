import { CONFIG } from 'src/global-config';

import { SacramentalCalendarView } from 'src/sections/records/sacramental-calendar-view';

// ----------------------------------------------------------------------

const metadata = { title: `Sacramental calendar | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <SacramentalCalendarView />
    </>
  );
}
