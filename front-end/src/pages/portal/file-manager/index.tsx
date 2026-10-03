import { paths } from 'src/routes/paths';
import { useSearchParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';
import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { FileManagerView } from 'src/sections/file-manager/view';
import { FileManagerChurchPicker } from 'src/sections/file-manager/file-manager-church-picker';

import { useAuthContext } from 'src/auth/hooks';

// ----------------------------------------------------------------------

const metadata = { title: `File manager | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  // super_admin/admin may inspect a specific church with ?church=<id>
  const church = useSearchParams().get('church');
  const activeChurchId = useActiveChurchId();
  const { user } = useAuthContext();
  const isPlatformAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  // explicit ?church= wins; otherwise platform admins follow the header parish switcher
  const churchId = church ? Number(church) : isPlatformAdmin ? activeChurchId : null;

  return (
    <>
      <title>{metadata.title}</title>

      {isPlatformAdmin && !churchId ? (
        <FileManagerChurchPicker heading="File manager" basePath={paths.portal.fileManager} />
      ) : (
        <FileManagerView key={churchId ?? 'own'} churchId={churchId} />
      )}
    </>
  );
}
