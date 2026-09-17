import { CONFIG } from 'src/global-config';

import { LegalView, TERMS_DOCUMENT } from 'src/sections/legal';

// ----------------------------------------------------------------------

const metadata = {
  title: `${TERMS_DOCUMENT.title} - ${CONFIG.appName}`,
  description: TERMS_DOCUMENT.description,
};

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>
      <meta name="description" content={metadata.description} />

      <LegalView document={TERMS_DOCUMENT} />
    </>
  );
}
