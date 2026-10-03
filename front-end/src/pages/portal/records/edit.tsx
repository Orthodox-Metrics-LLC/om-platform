import { useState, useEffect } from 'react';

import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';
import { DashboardContent } from 'src/layouts/dashboard';

import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useRecordsChurch } from 'src/sections/records/use-records-church';
import { RecordNewEditForm } from 'src/sections/records/record-new-edit-form';
import { omRecordsApi, RECORD_TYPES, type OmRecord } from 'src/sections/records/om-records-api';

// ----------------------------------------------------------------------

const metadata = { title: `Edit record | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  const { type, id } = useParams();
  const { churchId } = useRecordsChurch();
  const t = RECORD_TYPES.find((x) => x.value === type) ?? RECORD_TYPES[0];
  const [record, setRecord] = useState<OmRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!churchId || !id) return;
    omRecordsApi.get(t.value, Number(id), churchId).then(setRecord).catch((e) => setError(e instanceof Error ? e.message : 'Record not found'));
  }, [churchId, id, t.value]);

  return (
    <>
      <title>{metadata.title}</title>

      <DashboardContent>
        <CustomBreadcrumbs heading={record ? `Edit ${record.title}` : 'Edit record'} links={[{ name: 'Portal', href: paths.portal.root }, { name: t.plural, href: paths.portal.records.list(t.value) }, { name: record ? `#${record.id}` : 'Edit' }]} sx={{ mb: { xs: 3, md: 5 } }} />
        {error ? <EmptyContent filled title={error} sx={{ py: 10 }} /> : !record ? <LinearProgress /> : <RecordNewEditForm type={t.value} currentRecord={record} />}
      </DashboardContent>
    </>
  );
}
