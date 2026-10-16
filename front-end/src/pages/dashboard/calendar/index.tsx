import { CONFIG } from 'src/global-config';

import { CalendarHubView } from 'src/sections/calendar/view';

// ----------------------------------------------------------------------

const metadata = { title: `Calendar | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <CalendarHubView />
    </>
  );
}
