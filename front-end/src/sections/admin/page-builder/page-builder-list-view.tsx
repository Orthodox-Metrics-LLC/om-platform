import type { Page, PageType, PageStatus } from './om-pages-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { omPagesApi, PAGE_TYPES } from './om-pages-api';

// ----------------------------------------------------------------------

const STATUS_COLOR: Record<PageStatus, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  draft: 'default',
  scheduled: 'warning',
  live: 'success',
  expired: 'error',
  archived: 'info',
};

const ALL_TAB = 'all' as const;

export function PageBuilderListView() {
  const router = useRouter();
  const [tab, setTab] = useState<PageType | typeof ALL_TAB>(ALL_TAB);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveTarget, setArchiveTarget] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (pageType?: PageType) => {
    setLoading(true);
    try {
      const res = await omPagesApi.list(pageType);
      setPages(res.campaigns || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab === ALL_TAB ? undefined : tab);
  }, [tab, load]);

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await omPagesApi.archive(archiveTarget.id);
      toast.success('Page archived');
      setArchiveTarget(null);
      await load(tab === ALL_TAB ? undefined : tab);
    } catch (e: any) {
      toast.error(e.message || 'Failed to archive');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading="Page Builder"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'Page Builder' }]}
        action={
          <Button
            variant="contained"
            startIcon={<Iconify icon="mingcute:add-line" />}
            onClick={() => router.push(paths.dashboard.pageBuilder.new)}
          >
            New page
          </Button>
        }
        sx={{ mb: 3 }}
      />
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, maxWidth: 720 }}>
        Create and publish pages for the public OM site — Latest News announcements, plus the
        coming-soon / maintenance / error surfaces. Draft, save, preview, and publish new versions
        without touching code.
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab value={ALL_TAB} label="All" />
        {PAGE_TYPES.map((pt) => (
          <Tab key={pt.value} value={pt.value} label={pt.label} />
        ))}
      </Tabs>

      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : pages.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">No pages yet for this type.</Typography>
          </Box>
        ) : (
          <Scrollbar>
            <TableContainer sx={{ minWidth: 720 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Page</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Items</TableCell>
                    <TableCell>Schedule</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pages.map((page) => (
                    <TableRow key={page.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{page.title}</Typography>
                        <Typography variant="caption" color="text.secondary">/{page.slug}</Typography>
                      </TableCell>
                      <TableCell>
                        <Label variant="soft">{PAGE_TYPES.find((p) => p.value === page.page_type)?.label || page.page_type}</Label>
                      </TableCell>
                      <TableCell>
                        <Label color={STATUS_COLOR[(page.effective_status || page.status || 'draft') as PageStatus]} variant="soft">
                          {page.effective_status || page.status}
                        </Label>
                      </TableCell>
                      <TableCell>{page.items?.length || 0}</TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ display: 'block' }}>
                          {page.visibility_start_at ? `From ${new Date(page.visibility_start_at).toLocaleString()}` : '—'}
                        </Typography>
                        <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">
                          {page.visibility_end_at ? `Until ${new Date(page.visibility_end_at).toLocaleString()}` : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" component={RouterLink} href={paths.dashboard.pageBuilder.edit(page.id)}>
                          <Iconify icon="solar:pen-bold" width={18} />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => setArchiveTarget(page)}>
                          <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Scrollbar>
        )}
      </Card>

      <ConfirmDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        title="Archive page?"
        content={`Archive "${archiveTarget?.title}"? It will no longer appear as an active page.`}
        action={
          <Button variant="contained" color="error" loading={busy} onClick={confirmArchive}>
            Archive
          </Button>
        }
      />
    </Box>
  );
}
