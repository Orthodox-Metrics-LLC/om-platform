import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';
import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { RECORD_TYPES } from 'src/sections/records/om-records-api';
import { RecordNewEditForm } from 'src/sections/records/record-new-edit-form';

// ----------------------------------------------------------------------

const metadata = { title: `New record | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  const { type } = useParams();
  const t = RECORD_TYPES.find((x) => x.value === type) ?? RECORD_TYPES[0];
  return (
    <>
      <title>{metadata.title}</title>

      <DashboardContent>
        <CustomBreadcrumbs heading={`Add ${t.label.toLowerCase()} record`} links={[{ name: 'Portal', href: paths.portal.root }, { name: t.plural, href: paths.dashboard.records.list(t.value) }, { name: 'New' }]} sx={{ mb: { xs: 3, md: 5 } }} />
        <RecordNewEditForm type={t.value} />
      </DashboardContent>
    </>
  );
}
