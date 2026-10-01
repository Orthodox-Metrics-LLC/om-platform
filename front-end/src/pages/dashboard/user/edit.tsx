import { useParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';

import { UserEditView } from 'src/sections/admin/user-management/view/user-edit-view';

// ----------------------------------------------------------------------

const metadata = { title: `User edit | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  const { id = '' } = useParams();

  return (
    <>
      <title>{metadata.title}</title>

      <UserEditView id={id} />
    </>
  );
}
