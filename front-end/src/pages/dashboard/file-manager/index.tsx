import { useSearchParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';

import { FileManagerView } from 'src/sections/file-manager/view';

// ----------------------------------------------------------------------

const metadata = { title: `File manager | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  // super_admin/admin may inspect a specific church with ?church=<id>
  const church = useSearchParams().get('church');
  const churchId = church ? Number(church) : null;

  return (
    <>
      <title>{metadata.title}</title>

      <FileManagerView churchId={churchId} />
    </>
  );
}
