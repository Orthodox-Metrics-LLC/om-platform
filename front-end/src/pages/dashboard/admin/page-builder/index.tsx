import { CONFIG } from 'src/global-config';

import { PageBuilderListView } from 'src/sections/admin/page-builder/page-builder-list-view';

// ----------------------------------------------------------------------

const metadata = { title: `Page Builder | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <PageBuilderListView />
    </>
  );
}
