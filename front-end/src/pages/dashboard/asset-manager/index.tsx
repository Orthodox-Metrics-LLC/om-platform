import { CONFIG } from 'src/global-config';

import { AssetManagerView } from 'src/sections/admin/asset-manager/view/asset-manager-view';

// ----------------------------------------------------------------------

const metadata = { title: `Asset Manager | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <AssetManagerView />
    </>
  );
}
