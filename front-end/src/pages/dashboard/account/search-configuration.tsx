import { CONFIG } from 'src/global-config';

import SearchConfigurationPage from 'src/sections/account/parish/search-configuration-page';

// ----------------------------------------------------------------------

const metadata = { title: `Search configuration | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <SearchConfigurationPage />
    </>
  );
}
