import { CONFIG } from 'src/global-config';

import { PortalView } from 'src/sections/portal/view';

// ----------------------------------------------------------------------

const metadata = { title: `Parish Portal - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <PortalView />
    </>
  );
}
