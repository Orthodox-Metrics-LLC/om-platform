import { CONFIG } from 'src/global-config';

import OcrPreferencesPage from 'src/sections/account/parish/ocr-preferences-page';

// ----------------------------------------------------------------------

const metadata = { title: `OCR preferences | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <OcrPreferencesPage />
    </>
  );
}
