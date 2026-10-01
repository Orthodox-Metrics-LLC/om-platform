import { useParams } from 'src/routes/hooks';

import { CONFIG } from 'src/global-config';

import { PageBuilderEditView } from 'src/sections/admin/page-builder/page-builder-edit-view';

// ----------------------------------------------------------------------

const metadata = { title: `Edit page | Page Builder - ${CONFIG.appName}` };

export default function Page() {
  const { id } = useParams();

  return (
    <>
      <title>{metadata.title}</title>

      <PageBuilderEditView id={id ? Number(id) : undefined} />
    </>
  );
}
