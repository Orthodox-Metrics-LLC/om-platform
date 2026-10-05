import { CONFIG } from 'src/global-config';

import { AnnotateView } from 'src/sections/admin/annotate/annotate-view';

// ----------------------------------------------------------------------

const metadata = { title: `Annotate | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <AnnotateView />
    </>
  );
}
