import { CONFIG } from 'src/global-config';

import { MenuEditorView } from 'src/sections/admin/menu-editor/menu-editor-view';

// ----------------------------------------------------------------------

const metadata = { title: `Menu editor | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <MenuEditorView />
    </>
  );
}
