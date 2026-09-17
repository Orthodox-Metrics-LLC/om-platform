import { CONFIG } from 'src/global-config';

import { LatestNewsView } from 'src/sections/latest-news';

// ----------------------------------------------------------------------

const metadata = {
  title: `Latest News - ${CONFIG.appName}`,
  description:
    'Product announcements, parish tools, platform updates, and featured Orthodox Metrics services.',
};

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>
      <meta name="description" content={metadata.description} />

      <LatestNewsView />
    </>
  );
}
