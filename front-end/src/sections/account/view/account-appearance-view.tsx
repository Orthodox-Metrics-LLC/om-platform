import { useSearchParams } from 'src/routes/hooks';

import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { useAuthContext } from 'src/auth/hooks';
import { isPlatformRole } from 'src/auth/context/om-auth';

import { AccountAppearance } from '../account-appearance';

// ----------------------------------------------------------------------

export function AccountAppearanceView() {
  const { user } = useAuthContext();
  const church = useSearchParams().get('church');
  const activeChurchId = useActiveChurchId();
  // explicit ?church= wins; platform admins otherwise follow the header parish switcher
  const churchId = church ? Number(church) : isPlatformRole(user?.role) ? activeChurchId : null;
  return <AccountAppearance key={churchId ?? 'own'} churchId={churchId} />;
}
