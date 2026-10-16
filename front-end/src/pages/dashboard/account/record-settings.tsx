import { CONFIG } from 'src/global-config';

import RecordSettingsPage from 'src/sections/account/parish/record-settings-page';

// ----------------------------------------------------------------------

const metadata = { title: `Record settings | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <RecordSettingsPage />
    </>
  );
}
