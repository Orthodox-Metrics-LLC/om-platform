import { CONFIG } from 'src/global-config';

import { UserCreateView } from 'src/sections/admin/user-management/view/user-create-view';

// ----------------------------------------------------------------------

const metadata = { title: `Create a new user | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <UserCreateView />
    </>
  );
}
