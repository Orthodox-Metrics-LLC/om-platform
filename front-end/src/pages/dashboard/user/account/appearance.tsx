import { CONFIG } from 'src/global-config';

import { AccountAppearanceView } from 'src/sections/account/view';

// ----------------------------------------------------------------------

const metadata = { title: `Parish appearance | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <AccountAppearanceView />
    </>
  );
}
