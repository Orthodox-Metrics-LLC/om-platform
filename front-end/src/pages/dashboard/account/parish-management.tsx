import { CONFIG } from 'src/global-config';

import ParishDashboard from 'src/sections/account/parish/parish-dashboard';

// ----------------------------------------------------------------------

const metadata = { title: `Parish management | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <ParishDashboard />
    </>
  );
}
