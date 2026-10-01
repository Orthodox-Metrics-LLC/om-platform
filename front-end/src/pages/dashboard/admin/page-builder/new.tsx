import { CONFIG } from 'src/global-config';

import { PageBuilderEditView } from 'src/sections/admin/page-builder/page-builder-edit-view';

// ----------------------------------------------------------------------

const metadata = { title: `New page | Page Builder - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <PageBuilderEditView />
    </>
  );
}
