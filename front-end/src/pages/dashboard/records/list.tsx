import { useParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';

import { RECORD_TYPES } from 'src/sections/records/om-records-api';
import { RecordsListView } from 'src/sections/records/records-list-view';

// ----------------------------------------------------------------------

const metadata = { title: `Records | Dashboard - ${CONFIG.appName}` };

export default function Page() {
  const { type } = useParams();
  const t = RECORD_TYPES.find((x) => x.value === type)?.value ?? 'baptism';
  return (
    <>
      <title>{metadata.title}</title>

      <RecordsListView key={t} type={t} />
    </>
  );
}
