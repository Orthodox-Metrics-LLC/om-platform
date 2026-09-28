import { paths } from 'src/routes/paths';
import { useSearchParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';

import { OverviewFileView } from 'src/sections/overview/file/view';
import { FileManagerChurchPicker } from 'src/sections/file-manager/file-manager-church-picker';

import { useAuthContext } from 'src/auth/hooks';

// ----------------------------------------------------------------------

const metadata = { title: `File | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  // super_admin/admin may inspect a specific church with ?church=<id>
  const church = useSearchParams().get('church');
  const churchId = church ? Number(church) : null;
  const { user } = useAuthContext();
  const isPlatformAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  return (
    <>
      <title>{metadata.title}</title>

      {isPlatformAdmin && !churchId ? (
        <FileManagerChurchPicker heading="Files" basePath={paths.dashboard.general.file} />
      ) : (
        <OverviewFileView churchId={churchId} />
      )}
    </>
  );
}
