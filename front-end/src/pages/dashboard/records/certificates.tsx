import { CONFIG } from 'src/global-config';

import { CertificatesView } from 'src/sections/records/certificates-view';

// ----------------------------------------------------------------------

const metadata = { title: `Certificates | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <CertificatesView />
    </>
  );
}
