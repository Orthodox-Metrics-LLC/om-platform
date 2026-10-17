import { CONFIG } from 'src/global-config';

import { CemeteryRecordsView } from 'src/sections/cemetery/cemetery-records-view';

// ----------------------------------------------------------------------

const metadata = { title: `Cemetery Records | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <CemeteryRecordsView />
    </>
  );
}
