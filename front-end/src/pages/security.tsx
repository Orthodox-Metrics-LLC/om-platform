import { CONFIG } from 'src/global-config';

import { LegalView, SECURITY_DOCUMENT } from 'src/sections/legal';

// ----------------------------------------------------------------------

const metadata = {
  title: `${SECURITY_DOCUMENT.title} - ${CONFIG.appName}`,
  description: SECURITY_DOCUMENT.description,
};

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>
      <meta name="description" content={metadata.description} />

      <LegalView document={SECURITY_DOCUMENT} />
    </>
  );
}
