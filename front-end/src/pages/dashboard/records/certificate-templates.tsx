import { CONFIG } from 'src/global-config';

import { CertificateTemplatesView } from 'src/sections/records/certificates/templates-view';

// ----------------------------------------------------------------------

const metadata = { title: `Certificate templates | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <CertificateTemplatesView />
    </>
  );
}
