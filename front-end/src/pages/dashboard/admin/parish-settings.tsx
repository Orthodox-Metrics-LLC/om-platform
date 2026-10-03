import { CONFIG } from 'src/global-config';

import { ParishSettingsView } from 'src/sections/admin/parish-settings/parish-settings-view';

// ----------------------------------------------------------------------

const metadata = { title: `Parish Settings | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <ParishSettingsView />
    </>
  );
}
