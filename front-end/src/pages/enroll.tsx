import { CONFIG } from 'src/global-config';

import { EnrollView } from 'src/sections/enroll';

// ----------------------------------------------------------------------

const metadata = {
  title: `Enroll your parish - ${CONFIG.appName}`,
  description:
    'Enroll your Orthodox parish in Orthodox Metrics — sacramental record digitization, OCR, and modern parish administration.',
};

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>
      <meta name="description" content={metadata.description} />

      <EnrollView />
    </>
  );
}
