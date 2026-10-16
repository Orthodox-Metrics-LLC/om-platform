import { CONFIG } from 'src/global-config';

import DatabaseMappingPage from 'src/sections/account/parish/database-mapping-page';

// ----------------------------------------------------------------------

const metadata = { title: `Database mapping | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <DatabaseMappingPage />
    </>
  );
}
