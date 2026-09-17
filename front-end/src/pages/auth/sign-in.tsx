import { CONFIG } from 'src/global-config';

import { OmSignInView } from 'src/auth/view';

// ----------------------------------------------------------------------

const metadata = { title: `Sign in - ${CONFIG.appName}` };

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>

      <OmSignInView />
    </>
  );
}
