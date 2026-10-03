import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Select from '@mui/material/Select';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TableHead from '@mui/material/TableHead';
import TableCell from '@mui/material/TableCell';
import TableBody from '@mui/material/TableBody';
import TextField from '@mui/material/TextField';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import {
  fetchParish,
  updateParish,
  createParish,
  fetchParishes,
  fetchParishStats,
  type ParishStats,
  type ParishDetail,
  type ParishSummary,
  fetchParishUserCount,
  type CreateParishPayload,
} from './parish-settings-api';

// ----------------------------------------------------------------------

const DETAIL_TABS = [
  'Overview',
  'Portal Settings',
  'Dashboard / Analytics',
  'OCR Settings',
  'Clergy',
  'Locations',
  'Sacraments',
  'Users',
  'Preferences',
  'Integrations',
] as const;

function parishType(row: ParishSummary): string {
  if (row.is_demo) return 'Demo';
  if (row.client_status === 'directory') return 'Directory';
  if (row.client_status) return row.client_status.charAt(0).toUpperCase() + row.client_status.slice(1);
  return 'Production';
}

function parishStatusLabel(row: ParishSummary): { label: string; color: 'success' | 'default' | 'warning' } {
  if (!row.is_active) return { label: 'Inactive', color: 'default' };
  if (row.client_status === 'decommissioned') return { label: 'Decommissioned', color: 'default' };
  return { label: 'Active', color: 'success' };
}

// ----------------------------------------------------------------------

export function ParishSettingsView() {
  const [parishes, setParishes] = useState<ParishSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchParishes();
      const withCounts = await Promise.all(
        list.map(async (p) => ({ ...p, userCount: await fetchParishUserCount(p.id).catch(() => undefined) })),
      );
      setParishes(withCounts);
    } catch (err: any) {
      setError(err?.message || 'Failed to load parishes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      parishes.filter((p) => {
        if (statusFilter !== 'All Statuses' && parishStatusLabel(p).label !== statusFilter) return false;
        if (typeFilter !== 'All Types' && parishType(p) !== typeFilter) return false;
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return p.name.toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q);
      }),
    [parishes, search, statusFilter, typeFilter],
  );

  const selected = selectedId != null ? parishes.find((p) => p.id === selectedId) || null : null;

  const handleCreate = async (payload: CreateParishPayload) => {
    await createParish(payload);
    toast.success('Parish created');
    setAddOpen(false);
    await load();
  };

  return (
    <DashboardContent maxWidth="xl">
      <CustomBreadcrumbs
        heading="Parish Settings"
        links={[
          { name: 'Home', href: paths.dashboard.root },
          { name: 'Churches' },
          { name: 'Parish Settings' },
        ]}
        action={
          !selected && (
            <Button
              variant="contained"
              color="warning"
              startIcon={<Iconify icon="mingcute:add-line" />}
              onClick={() => setAddOpen(true)}
            >
              Add Church
            </Button>
          )
        }
        sx={{ mb: 3 }}
      />

      {!selected ? (
        <ParishListPanel
          rows={visible}
          totalCount={parishes.length}
          loading={loading}
          error={error}
          search={search}
          onSearch={setSearch}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          onOpen={(id) => setSelectedId(id)}
          onRefresh={load}
        />
      ) : (
        <ParishDetailPanel
          summary={selected}
          onBack={() => setSelectedId(null)}
          onRefresh={load}
        />
      )}

      <AddParishDialog open={addOpen} onClose={() => setAddOpen(false)} onCreate={handleCreate} />
    </DashboardContent>
  );
}

// ----------------------------------------------------------------------

type ParishListPanelProps = {
  rows: ParishSummary[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (v: string) => void;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  typeFilter: string;
  onTypeFilter: (v: string) => void;
  onOpen: (id: number) => void;
  onRefresh: () => void;
};

function ParishListPanel({
  rows,
  totalCount,
  loading,
  error,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  typeFilter,
  onTypeFilter,
  onOpen,
  onRefresh,
}: ParishListPanelProps) {
  return (
    <>
      <Alert severity="info" icon={<Iconify icon="solar:info-circle-bold" />} sx={{ mb: 3 }}>
        Select a parish to view or manage settings. Changes here affect the church portal (om_church_##) and all
        church-specific features.
      </Alert>

      <Card>
        <Box sx={{ p: 2, gap: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
          <Box
            sx={{
              px: 1.5,
              flexGrow: 1,
              minWidth: 240,
              height: 40,
              gap: 1,
              display: 'flex',
              borderRadius: 1,
              alignItems: 'center',
              border: (theme) => `solid 1px ${theme.vars.palette.divider}`,
            }}
          >
            <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
            <InputBase
              fullWidth
              placeholder="Search parishes…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </Box>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <Select value={statusFilter} onChange={(e) => onStatusFilter(e.target.value)}>
              {['All Statuses', 'Active', 'Inactive', 'Decommissioned'].map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <Select value={typeFilter} onChange={(e) => onTypeFilter(e.target.value)}>
              {['All Types', 'Production', 'Demo', 'Directory'].map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<Iconify icon={"eva:refresh-fill" as any} />}
            onClick={onRefresh}
          >
            Refresh
          </Button>
        </Box>

        <Divider />

        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}

        <TableContainer component={Scrollbar}>
          <Table sx={{ minWidth: 960 }}>
            <TableHead>
              <TableRow>
                <TableCell>Parish</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Tenant DB</TableCell>
                <TableCell>Users</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    No parishes match your search.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const statusChip = parishStatusLabel(row);
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <Avatar variant="rounded" sx={{ width: 40, height: 40, bgcolor: 'background.neutral' }}>
                            <Iconify icon={"solar:church-bold" as any} sx={{ color: 'text.disabled' }} />
                          </Avatar>
                          <Box>
                            <Typography variant="subtitle2">{row.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              ID {row.id}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {[row.city, row.state_province].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Label color="warning" variant="soft">
                          {parishType(row)}
                        </Label>
                      </TableCell>
                      <TableCell>
                        <Label color={statusChip.color} variant="soft">
                          {statusChip.label}
                        </Label>
                      </TableCell>
                      <TableCell>{row.database_name || '—'}</TableCell>
                      <TableCell>{row.userCount ?? '—'}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          endIcon={<Iconify icon="eva:external-link-fill" />}
                          onClick={() => onOpen(row.id)}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'flex-end' }}>
          <Typography variant="body2" color="text.secondary">
            Showing {rows.length} of {totalCount} parishes
          </Typography>
        </Box>
      </Card>
    </>
  );
}

// ----------------------------------------------------------------------

type ParishDetailPanelProps = {
  summary: ParishSummary;
  onBack: () => void;
  onRefresh: () => void;
};

function ParishDetailPanel({ summary, onBack, onRefresh }: ParishDetailPanelProps) {
  const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]>('Overview');
  const [detail, setDetail] = useState<ParishDetail | null>(null);
  const [stats, setStats] = useState<ParishStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        fetchParish(summary.id),
        fetchParishStats(summary.id).catch(() => null),
      ]);
      setDetail(d);
      setStats(s);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load parish details');
    } finally {
      setLoading(false);
    }
  }, [summary.id]);

  useEffect(() => {
    load();
  }, [load]);

  const statusChip = parishStatusLabel(summary);

  return (
    <>
      <Button
        startIcon={<Iconify icon="eva:arrow-ios-back-fill" />}
        onClick={onBack}
        sx={{ mb: 2 }}
        color="warning"
      >
        Back to Parishes
      </Button>

      <Card sx={{ p: 3, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: { md: 'center' } }}>
          <Avatar variant="rounded" sx={{ width: 72, height: 72, bgcolor: 'background.neutral' }}>
            <Iconify icon={"solar:church-bold" as any} width={36} sx={{ color: 'text.disabled' }} />
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6">{summary.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[summary.city, summary.state_province].filter(Boolean).join(', ')} (ID {summary.id})
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {detail?.email && (
                <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Iconify icon={"eva:email-outline" as any} width={14} /> {detail.email}
                </Typography>
              )}
              {summary.database_name && (
                <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Iconify icon={"eva:hard-drive-outline" as any} width={14} /> {summary.database_name}
                </Typography>
              )}
            </Stack>
            <Label color={statusChip.color} variant="soft" sx={{ mt: 1 }}>
              {statusChip.label}
            </Label>
          </Box>
          <Stack spacing={1} sx={{ minWidth: 220 }}>
            <Typography variant="overline" color="text.secondary">
              Quick Actions
            </Typography>
            <Button
              variant="contained"
              color="warning"
              href={paths.portal.root}
              target="_blank"
              endIcon={<Iconify icon="eva:external-link-fill" />}
            >
              Open Church Portal
            </Button>
            <Button variant="outlined" color="warning" endIcon={<Iconify icon="eva:external-link-fill" />}>
              View Public Site
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<Iconify icon={"eva:refresh-fill" as any} />}
              onClick={() => {
                load();
                onRefresh();
              }}
            >
              Refresh Data
            </Button>
          </Stack>
        </Stack>
      </Card>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }} variant="scrollable" scrollButtons="auto">
        {DETAIL_TABS.map((t) => (
          <Tab key={t} value={t} label={t} />
        ))}
      </Tabs>

      {loading ? (
        <Stack sx={{ py: 10, alignItems: 'center' }}>
          <CircularProgress />
        </Stack>
      ) : tab === 'Overview' ? (
        <OverviewTab detail={detail} stats={stats} onEdit={() => setEditOpen(true)} />
      ) : (
        <Card sx={{ p: 5, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {tab}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This tab is coming soon.
          </Typography>
        </Card>
      )}

      {detail && (
        <EditParishDialog
          open={editOpen}
          detail={detail}
          onClose={() => setEditOpen(false)}
          onSave={async (patch) => {
            await updateParish(detail.id, patch);
            toast.success('Parish updated');
            setEditOpen(false);
            await load();
            onRefresh();
          }}
        />
      )}
    </>
  );
}

// ----------------------------------------------------------------------

function OverviewTab({
  detail,
  stats,
  onEdit,
}: {
  detail: ParishDetail | null;
  stats: ParishStats | null;
  onEdit: () => void;
}) {
  const facts: { icon: string; label: string; value: string }[] = detail
    ? [
        { icon: 'solar:church-bold', label: 'Parish Name', value: detail.name },
        { icon: 'eva:pin-outline', label: 'Location', value: [detail.city, detail.state_province].filter(Boolean).join(', ') || '—' },
        { icon: 'eva:person-outline', label: 'Church ID', value: String(detail.id) },
        { icon: 'eva:hard-drive-outline', label: 'Tenant Database', value: detail.database_name || '—' },
        { icon: 'eva:clock-outline', label: 'Status', value: detail.is_active ? 'Active' : 'Inactive' },
        { icon: 'eva:briefcase-outline', label: 'Type', value: detail.setup_complete ? 'Production' : 'Setup pending' },
        { icon: 'eva:email-outline', label: 'Email', value: detail.email || '—' },
        { icon: 'eva:calendar-outline', label: 'Enrollment Date', value: new Date(detail.created_at).toLocaleDateString() },
      ]
    : [];

  const statCards = [
    { icon: 'solar:water-bold-duotone', color: 'info', label: 'Baptisms', value: stats?.baptisms ?? 0 },
    { icon: 'solar:hearts-bold-duotone', color: 'success', label: 'Marriages', value: stats?.marriages ?? 0 },
    { icon: 'solar:candle-bold-duotone', color: 'error', label: 'Funerals', value: stats?.funerals ?? 0 },
    { icon: 'solar:document-bold-duotone', color: 'secondary', label: 'Total Records', value: stats?.totalRecords ?? 0 },
  ] as const;

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Card sx={{ p: 3 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="subtitle1">Church Overview</Typography>
              <Typography variant="caption" color="text.secondary">
                Key information and statistics for this parish.
              </Typography>
            </Box>
            <Button size="small" variant="outlined" color="warning" startIcon={<Iconify icon="solar:pen-bold" />} onClick={onEdit}>
              Edit Details
            </Button>
          </Stack>
          <Grid container spacing={2}>
            {facts.map((fact) => (
              <Grid key={fact.label} size={{ xs: 12, sm: 6 }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Avatar variant="rounded" sx={{ width: 36, height: 36, bgcolor: 'background.neutral' }}>
                    <Iconify icon={fact.icon as any} width={18} sx={{ color: 'text.disabled' }} />
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {fact.label}
                    </Typography>
                    <Typography variant="body2" noWrap>
                      {fact.value}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, md: 5 }}>
        <Card sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            Church Statistics
          </Typography>
          <Grid container spacing={2}>
            {statCards.map((card) => (
              <Grid key={card.label} size={{ xs: 6 }}>
                <Stack
                  spacing={0.5}
                  sx={{
                    p: 1.5,
                    borderRadius: 1.5,
                    bgcolor: (theme) => theme.vars.palette[card.color].lighter,
                  }}
                >
                  <Iconify icon={card.icon as any} width={22} sx={{ color: `${card.color}.dark` }} />
                  <Typography variant="h5">{card.value}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {card.label}
                  </Typography>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Card>

        <Card sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            Recent Activity
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Activity feed not wired yet — follow-up work.
          </Typography>
        </Card>
      </Grid>
    </Grid>
  );
}

// ----------------------------------------------------------------------

function AddParishDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: CreateParishPayload) => Promise<void>;
}) {
  const [form, setForm] = useState<CreateParishPayload>({ name: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<CreateParishPayload>) => setForm((current) => ({ ...current, ...patch }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(form);
      setForm({ name: '', email: '' });
    } catch (err: any) {
      setError(err?.message || 'Failed to create parish');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Church</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Parish name" value={form.name} onChange={(e) => set({ name: e.target.value })} required fullWidth />
          <TextField label="Email" value={form.email} onChange={(e) => set({ email: e.target.value })} required fullWidth />
          <TextField label="City" value={form.city || ''} onChange={(e) => set({ city: e.target.value })} fullWidth />
          <TextField label="State / Province" value={form.state_province || ''} onChange={(e) => set({ state_province: e.target.value })} fullWidth />
          <TextField label="Website" value={form.website || ''} onChange={(e) => set({ website: e.target.value })} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="warning" onClick={handleSave} disabled={saving}>
          {saving ? 'Creating…' : 'Create parish'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ----------------------------------------------------------------------

function EditParishDialog({
  open,
  detail,
  onClose,
  onSave,
}: {
  open: boolean;
  detail: ParishDetail;
  onClose: () => void;
  onSave: (patch: Partial<CreateParishPayload>) => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<CreateParishPayload>>({
    name: detail.name,
    email: detail.email || '',
    phone: detail.phone || '',
    city: detail.city || '',
    state_province: detail.state_province || '',
    website: detail.website || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<CreateParishPayload>) => setForm((current) => ({ ...current, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Details</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Parish name" value={form.name} onChange={(e) => set({ name: e.target.value })} fullWidth />
          <TextField label="Email" value={form.email} onChange={(e) => set({ email: e.target.value })} fullWidth />
          <TextField label="Phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} fullWidth />
          <TextField label="City" value={form.city} onChange={(e) => set({ city: e.target.value })} fullWidth />
          <TextField label="State / Province" value={form.state_province} onChange={(e) => set({ state_province: e.target.value })} fullWidth />
          <TextField label="Website" value={form.website} onChange={(e) => set({ website: e.target.value })} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="warning" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
