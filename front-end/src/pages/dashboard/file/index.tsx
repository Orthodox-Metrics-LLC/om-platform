import { useSearchParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';

import { OverviewFileView } from 'src/sections/overview/file/view';

// ----------------------------------------------------------------------

const metadata = { title: `File | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  // super_admin/admin may inspect a specific church with ?church=<id>
  const church = useSearchParams().get('church');
  const churchId = church ? Number(church) : null;

  return (
    <>
      <title>{metadata.title}</title>

      <OverviewFileView churchId={churchId} />
    </>
  );
}
