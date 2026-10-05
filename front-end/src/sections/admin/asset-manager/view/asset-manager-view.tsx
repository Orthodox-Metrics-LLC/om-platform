import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import { paths } from 'src/routes/paths';
import { useRouter, useSearchParams } from 'src/routes/hooks';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useAuthContext } from 'src/auth/hooks';

import { DocumentsView } from '../documents-view';
import { CloudFilesView } from '../cloud-files-view';
import { ChurchFilesView } from '../church-files-view';
import { WebsiteFilesView } from '../website-files-view';
import { AssetLibraryView } from '../asset-library-view';
import { AdminFilesOverviewView } from '../admin-files-overview-view';

// ----------------------------------------------------------------------

const TABS = [
  { value: 'overview', label: 'Overview', icon: 'solar:chart-square-outline' },
  { value: 'website', label: 'Website', icon: 'solar:global-bold-duotone' },
  { value: 'assets', label: 'Media assets', icon: 'solar:gallery-wide-bold' },
  { value: 'documents', label: 'Documents', icon: 'solar:file-text-bold' },
  { value: 'church-files', label: 'Church files', icon: 'custom:cross-bold' },
  { value: 'cloud-files', label: 'Cloud Files', icon: 'eva:cloud-upload-fill' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

/**
 * Management → Asset Manager (super_admin / admin).
 * Replaces prod's /admin/assets: media assets library, documents manager,
 * plus the administrative view of every church tenant's file storage.
 */
export function AssetManagerView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthContext();
  const tab = (searchParams.get('tab') as TabValue) || 'overview';

  const allowed = user?.role === 'super_admin' || user?.role === 'admin';

  return (
    <DashboardContent maxWidth="xl">
      <CustomBreadcrumbs
        heading="Asset Manager"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'Management' }, { name: 'Asset Manager' }]}
        sx={{ mb: 2 }}
      />

      {!allowed ? (
        <EmptyContent filled title="Administrators only" description="The Asset Manager is available to platform administrators." sx={{ py: 10 }} />
      ) : (
        <>
          <Tabs value={tab} onChange={(_, v) => router.replace(`${paths.dashboard.assetManager}?tab=${v}`)} sx={{ mb: 3 }}>
            {TABS.map((t) => <Tab key={t.value} value={t.value} label={t.label} iconPosition="start" icon={<Iconify icon={t.icon} width={20} />} />)}
          </Tabs>

          {tab === 'overview' && <AdminFilesOverviewView />}
          {tab === 'website' && <WebsiteFilesView />}
          {tab === 'assets' && <AssetLibraryView />}
          {tab === 'documents' && <DocumentsView />}
          {tab === 'church-files' && <ChurchFilesView />}
          {tab === 'cloud-files' && <CloudFilesView />}
        </>
      )}
    </DashboardContent>
  );
}
