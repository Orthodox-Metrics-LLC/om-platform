import { useSearchParams } from 'src/routes/hooks';

import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { useAuthContext } from 'src/auth/hooks';
import { isPlatformRole } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Which church the records pages operate on: the user's own parish, or for
 * platform admins the parish chosen in the header switcher (`?church=` wins).
 * Also exposes the record-management permissions used by the legacy UI
 * (deacon+ manage records, priest+ change status).
 */
export function useRecordsChurch() {
  const { user } = useAuthContext();
  const param = useSearchParams().get('church');
  const active = useActiveChurchId();
  const platform = isPlatformRole(user?.role);
  const churchId = param ? Number(param) : platform ? active : (user as any)?.church_id ?? null;
  const role = user?.role ?? '';
  const canManage = platform || ['church_admin', 'manager', 'priest', 'deacon'].includes(role);
  const canChangeStatus = platform || ['church_admin', 'manager', 'priest'].includes(role);
  return { churchId: churchId as number | null, platform, canManage, canChangeStatus, role };
}
