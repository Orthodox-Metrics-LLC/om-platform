import { useSearchParams } from 'src/routes/hooks';

import { AccountAppearance } from '../account-appearance';

// ----------------------------------------------------------------------

export function AccountAppearanceView() {
  // super_admin/admin may edit a specific parish with ?church=<id>
  const church = useSearchParams().get('church');
  return <AccountAppearance churchId={church ? Number(church) : null} />;
}
