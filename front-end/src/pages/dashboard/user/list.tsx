import { CONFIG } from 'src/global-config';

import { UserListView } from 'src/sections/admin/user-management/view/user-list-view';

// ----------------------------------------------------------------------

const metadata = { title: `User list | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <UserListView />
    </>
  );
}
