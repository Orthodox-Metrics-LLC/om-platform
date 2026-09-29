import { CONFIG } from 'src/global-config';

import { CertificateDesignerView } from 'src/sections/records/certificates/designer/designer-view';

// ----------------------------------------------------------------------

const metadata = { title: `Certificate designer | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <CertificateDesignerView />
    </>
  );
}
