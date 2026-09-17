import { CONFIG } from 'src/global-config';

import { LegalView, PRIVACY_DOCUMENT } from 'src/sections/legal';

// ----------------------------------------------------------------------

const metadata = {
  title: `${PRIVACY_DOCUMENT.title} - ${CONFIG.appName}`,
  description: PRIVACY_DOCUMENT.description,
};

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>
      <meta name="description" content={metadata.description} />

      <LegalView document={PRIVACY_DOCUMENT} />
    </>
  );
}
