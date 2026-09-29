import type { GridColDef, GridRowSelectionModel } from '@mui/x-data-grid';
import type { OmRecord, RecordType, SearchResultRow, ParishSearchAst } from './om-records-api';

import { useBoolean } from 'minimal-shared/hooks';
import { useMemo, useState, useEffect, useCallback } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Toolbar, DataGrid, gridClasses } from '@mui/x-data-grid';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { fDate } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { ToolbarContainer, ToolbarLeftPanel, ToolbarRightPanel, useToolbarSettings, CustomGridActionsCellItem, CustomToolbarColumnsButton, CustomToolbarSettingsButton } from 'src/components/custom-data-grid';

import { FileManagerChurchPicker } from 'src/sections/file-manager/file-manager-church-picker';

import { useRecordsChurch } from './use-records-church';
import { RecordsSearchBar } from './records-search-bar';
import { RecordsExportDialog } from './records-export-dialog';
import { RecordsDuplicatesPanel } from './records-duplicates-panel';
import { RecordsSavedSearchesDrawer } from './records-saved-searches-drawer';
import { RecordsAdvancedSearchDrawer } from './records-advanced-search-drawer';
import { recordsAst, omRecordsApi, RECORD_TYPES, RECORD_STATUSES, parishSearchApi, EVENT_DATE_FIELD } from './om-records-api';

// ----------------------------------------------------------------------

export const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'info' | 'error'> = { Recorded: 'default', Verified: 'success', 'Awaiting Clergy': 'warning', active: 'info', verified: 'success', pending: 'warning', needs_review: 'warning', archived: 'default', deleted: 'error' };

type Mode = { kind: 'list' } | { kind: 'search'; ast: ParishSearchAst; rows: SearchResultRow[]; total: number; label: string; durationMs: number } | { kind: 'duplicates'; ast: ParishSearchAst };

/** Sacramental records — Minimal product list re-plumbed onto OM's record APIs. */
export function RecordsListView({ type }: { type: RecordType }) {
  const router = useRouter();
  const { churchId, platform, canManage } = useRecordsChurch();
  const toolbarOptions = useToolbarSettings();
  const meta = RECORD_TYPES.find((t) => t.value === type)!;

  const [rows, setRows] = useState<OmRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<RecordType, number>>>({});
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: EVENT_DATE_FIELD[type], dir: 'desc' });
  const [quick, setQuick] = useState('');
  const [status, setStatus] = useState('');
  const [clergyFilter, setClergyFilter] = useState('');
  const [clergyOptions, setClergyOptions] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([...RECORD_STATUSES]);
  const [selected, setSelected] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const confirmDelete = useBoolean();
  const exportDialog = useBoolean();
  const savedDrawer = useBoolean();
  const advancedDrawer = useBoolean();
  const [deleteTarget, setDeleteTarget] = useState<OmRecord | null>(null);

  useEffect(() => { setSort({ field: EVENT_DATE_FIELD[type], dir: 'desc' }); setPagination((p) => ({ ...p, page: 0 })); setMode({ kind: 'list' }); setQuick(''); setStatus(''); setClergyFilter(''); }, [type]);

  const load = useCallback(async () => {
    if (!churchId) return;
    setLoading(true);
    try {
      const r = await omRecordsApi.list(type, { churchId, page: pagination.page + 1, limit: pagination.pageSize, search: quick, sortField: sort.field, sortDirection: sort.dir });
      let list = r.records;
      if (status) list = list.filter((x) => x.status === status);
      if (clergyFilter) list = list.filter((x) => x.clergy === clergyFilter);
      setRows(list);
      setTotal(r.totalRecords);
      setStatusOptions((prev) => [...new Set([...prev, ...r.records.map((x) => x.status).filter(Boolean)])]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load records');
    } finally {
      setLoading(false);
    }
  }, [churchId, type, pagination, sort, quick, status, clergyFilter]);

  useEffect(() => { if (mode.kind === 'list') load(); }, [load, mode.kind]);

  useEffect(() => {
    if (!churchId) return;
    Promise.all(RECORD_TYPES.map((t) => omRecordsApi.list(t.value, { churchId, limit: 1 }).then((r) => [t.value, r.totalRecords] as const).catch(() => [t.value, 0] as const)))
      .then((pairs) => setCounts(Object.fromEntries(pairs)));
    omRecordsApi.dropdownOptions(type, 'clergy', churchId).then((v) => setClergyOptions(v.map((s) => s.trim()).filter(Boolean))).catch(() => setClergyOptions([]));

  }, [churchId, type]);

  const handleDelete = async () => {
    if (!deleteTarget || !churchId) return;
    try {
      await omRecordsApi.remove(type, deleteTarget.id, churchId);
      toast.success('Record deleted (recoverable from search → restore)');
      setDeleteTarget(null); confirmDelete.onFalse(); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const columns = useMemo<GridColDef[]>(() => [
    { field: 'title', headerName: type === 'marriage' ? 'Groom & Bride' : 'Name', flex: 1, minWidth: 260, sortable: false, renderCell: (p) => (
      <Box component={RouterLink} href={`${paths.dashboard.records.details(type, p.row.id)}${platform && churchId ? `?church=${churchId}` : ''}`} sx={{ py: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
        <Typography variant="subtitle2" noWrap sx={{ '&:hover': { textDecoration: 'underline' } }}>{p.row.title}</Typography>
        {p.row.subtitle && <Typography variant="caption" noWrap sx={{ color: 'text.disabled', display: 'block' }}>{p.row.subtitle}</Typography>}
      </Box>
    ) },
    { field: EVENT_DATE_FIELD[type], headerName: type === 'baptism' ? 'Baptism' : type === 'marriage' ? 'Marriage' : 'Burial', width: 130, valueGetter: (_, row) => row.eventDate, renderCell: (p) => (p.row.eventDate ? fDate(p.row.eventDate) : '—') },
    ...(type !== 'marriage' ? [{ field: type === 'baptism' ? 'birth_date' : 'deceased_date', headerName: type === 'baptism' ? 'Born' : 'Died', width: 130, valueGetter: (_: any, row: OmRecord) => row.secondaryDate, renderCell: (p: any) => (p.row.secondaryDate ? fDate(p.row.secondaryDate) : '—') } as GridColDef] : []),
    { field: 'clergy', headerName: type === 'marriage' ? 'Celebrant' : 'Clergy', width: 200, renderCell: (p) => <Typography variant="body2" noWrap>{p.row.clergy}</Typography> },
    { field: 'place', headerName: type === 'baptism' ? 'Birthplace' : type === 'marriage' ? 'License' : 'Burial place', width: 180, sortable: false, renderCell: (p) => <Typography variant="body2" noWrap>{p.row.place}</Typography> },
    { field: 'status', headerName: 'Status', width: 120, renderCell: (p) => <Label variant="soft" color={STATUS_COLOR[p.row.status] || 'default'} sx={{ textTransform: 'capitalize' }}>{String(p.row.status).replace(/_/g, ' ')}</Label> },
    { field: 'actions', type: 'actions', headerName: ' ', width: 64, align: 'right', getActions: (p) => [
      <CustomGridActionsCellItem key="view" showInMenu label="View" icon={<Iconify icon="solar:eye-bold" />} href={`${paths.dashboard.records.details(type, p.row.id)}${platform && churchId ? `?church=${churchId}` : ''}`} />,
      ...(canManage ? [<CustomGridActionsCellItem key="edit" showInMenu label="Edit" icon={<Iconify icon="solar:pen-bold" />} href={`${paths.dashboard.records.edit(type, p.row.id)}${platform && churchId ? `?church=${churchId}` : ''}`} />] : []),
      <CustomGridActionsCellItem key="cert" showInMenu label="Certificate" icon={<Iconify icon="solar:verified-check-bold" />} href={`${paths.dashboard.records.certificates}?type=${type}&record=${p.row.id}${platform && churchId ? `&church=${churchId}` : ''}`} />,
      ...(canManage ? [<CustomGridActionsCellItem key="del" showInMenu label="Delete" icon={<Iconify icon="solar:trash-bin-trash-bold" />} onClick={() => { setDeleteTarget(p.row); confirmDelete.onTrue(); }} style={{ color: "var(--palette-error-main)" }} />] : []),
    ] },
  ], [type, platform, churchId, canManage, confirmDelete]);

  const searchColumns = useMemo<GridColDef[]>(() => [
    { field: 'recordType', headerName: 'Type', width: 100, renderCell: (p) => <Label variant="soft" color={RECORD_TYPES.find((t) => t.value === p.row.recordType)?.color ?? 'default'} sx={{ textTransform: 'capitalize' }}>{p.row.recordType}</Label> },
    { field: 'primaryName', headerName: 'Name / Parties', flex: 1, minWidth: 240, renderCell: (p) => (
      <Box component={RouterLink} href={`${paths.dashboard.records.details(p.row.recordType, p.row.sourceRecordId)}${platform && churchId ? `?church=${churchId}` : ''}`} sx={{ color: 'inherit', textDecoration: 'none' }}>
        <Typography variant="subtitle2" noWrap>{p.row.primaryName}</Typography>
        {p.row.matchLabel && <Typography variant="caption" sx={{ color: 'text.disabled' }}>{p.row.matchLabel}{p.row.matchConfidence != null ? ` · ${Math.round(p.row.matchConfidence * 100)}%` : ''}</Typography>}
        {p.row.deletedAt && <Label variant="soft" color="error" sx={{ ml: 1 }}>Deleted</Label>}
      </Box>
    ) },
    { field: 'canonicalEventDate', headerName: 'Event date', width: 130, renderCell: (p) => p.row.canonicalEventDateDisplay || (p.row.canonicalEventDate ? fDate(p.row.canonicalEventDate) : '—') },
    { field: 'clergy', headerName: 'Clergy', width: 200 },
    { field: 'location', headerName: 'Location', width: 180 },
    { field: 'status', headerName: 'Status', width: 120, renderCell: (p) => <Label variant="soft" color={STATUS_COLOR[p.row.status || ''] || 'default'} sx={{ textTransform: 'capitalize' }}>{String(p.row.status || '—').replace(/_/g, ' ')}</Label> },
    ...(mode.kind === 'search' && mode.rows.some((r) => r.activityType) ? [{ field: 'activityAt', headerName: 'Activity', width: 220, renderCell: (p: any) => `${p.row.activityType ?? ''} ${p.row.activityAtDisplay ?? ''}`.trim() } as GridColDef] : []),
    ...(mode.kind === 'search' && mode.rows.some((r) => r.issue) ? [{ field: 'issue', headerName: 'Data quality', width: 260, renderCell: (p: any) => `${p.row.issue ?? ''}${p.row.field ? ` (${p.row.field})` : ''}` } as GridColDef] : []),
  ], [mode, platform, churchId]);

  if (platform && !churchId) return <FileManagerChurchPicker heading="Records" basePath={paths.dashboard.records.list(type)} />;
  if (!churchId) return <DashboardContent><EmptyContent filled title="Your account is not assigned to a church" sx={{ py: 10 }} /></DashboardContent>;

  const selectedIds = [...selected.ids].map(Number);
  const exportAst = (): ParishSearchAst => {
    if (mode.kind !== 'list') return mode.ast;
    const conditions: any[] = [];
    if (selectedIds.length) conditions.push({ field: 'source_record_id', operator: 'in', value: selectedIds });
    if (status) conditions.push({ field: 'status', operator: 'equals', value: status });
    if (clergyFilter) conditions.push({ field: 'clergy', operator: 'contains', value: clergyFilter });
    return recordsAst(churchId, [type], { filters: { operator: 'and', conditions }, textSearch: quick || null });
  };

  const gridRows = mode.kind === 'search' ? mode.rows.map((r, i) => ({ ...r, id: `${r.recordType}-${r.sourceRecordId}-${i}` })) : rows;

  const renderToolbar = () => (
    <Toolbar>
      <ToolbarContainer>
        <ToolbarLeftPanel>
          {mode.kind === 'list' ? (
            <>
              <TextField size="small" value={quick} onChange={(e) => { setQuick(e.target.value); setPagination((p) => ({ ...p, page: 0 })); }} placeholder={`Filter ${meta.plural.toLowerCase()}…`} slotProps={{ input: { startAdornment: <Iconify icon="eva:search-fill" sx={{ mr: 1, color: 'text.disabled' }} /> } }} sx={{ minWidth: 220 }} />
              <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 140 }}><MenuItem value="">All</MenuItem>{statusOptions.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</MenuItem>)}</TextField>
              <TextField select size="small" label={type === 'marriage' ? 'Celebrant' : 'Clergy'} value={clergyFilter} onChange={(e) => setClergyFilter(e.target.value)} sx={{ minWidth: 200 }}><MenuItem value="">All</MenuItem>{clergyOptions.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField>
            </>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Label variant="soft" color="info">Search results</Label>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{mode.kind === 'search' ? `${mode.total} match${mode.total === 1 ? '' : 'es'} · ${mode.label}${mode.durationMs ? ` · ${mode.durationMs} ms` : ''}` : 'Duplicate detection'}</Typography>
              <Button size="small" color="inherit" startIcon={<Iconify icon="mingcute:close-line" />} onClick={() => setMode({ kind: 'list' })}>Back to list</Button>
            </Box>
          )}
        </ToolbarLeftPanel>
        <ToolbarRightPanel>
          {!!selectedIds.length && (
            <Button size="small" variant="soft" startIcon={<Iconify icon="solar:verified-check-bold" />} component={RouterLink} href={`${paths.dashboard.records.certificates}?type=${type}&records=${selectedIds.join(',')}${platform ? `&church=${churchId}` : ''}`}>Certificates ({selectedIds.length})</Button>
          )}
          <Button size="small" startIcon={<Iconify icon="solar:export-bold" />} onClick={exportDialog.onTrue}>Export{selectedIds.length ? ` (${selectedIds.length})` : ''}</Button>
          <CustomToolbarColumnsButton />
          <CustomToolbarSettingsButton settings={toolbarOptions.settings} onChangeSettings={toolbarOptions.onChangeSettings} />
        </ToolbarRightPanel>
      </ToolbarContainer>
    </Toolbar>
  );

  return (
    <>
      <DashboardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <CustomBreadcrumbs
          heading="Sacramental records"
          links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Records' }, { name: meta.plural }]}
          action={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="outlined" color="inherit" startIcon={<Iconify icon="eva:star-fill" />} onClick={savedDrawer.onTrue}>Saved searches</Button>
              {canManage && <Button component={RouterLink} href={`${paths.dashboard.records.new(type)}${platform ? `?church=${churchId}` : ''}`} variant="contained" startIcon={<Iconify icon="mingcute:add-line" />}>Add {meta.label.toLowerCase()}</Button>}
            </Box>
          }
          sx={{ mb: { xs: 3, md: 4 } }}
        />

        <RecordsSearchBar
          churchId={churchId}
          defaultTypes={[type]}
          onResult={(exec, label) => { if (exec.mode === 'duplicate_detection' && exec.groups) setMode({ kind: 'duplicates', ast: exec.ast }); else setMode({ kind: 'search', ast: exec.ast, rows: exec.rows, total: exec.total, label, durationMs: exec.durationMs }); setSelected({ type: 'include', ids: new Set() }); }}
          onOpenAdvanced={advancedDrawer.onTrue}
          sx={{ mb: 3 }}
        />

        <Tabs value={type} onChange={(_, v) => router.push(`${paths.dashboard.records.list(v)}${platform ? `?church=${churchId}` : ''}`)} sx={{ mb: 2 }}>
          {RECORD_TYPES.map((t) => <Tab key={t.value} value={t.value} iconPosition="end" label={t.plural} icon={<Label variant={t.value === type ? 'filled' : 'soft'} color={t.color}>{counts[t.value] ?? '…'}</Label>} />)}
        </Tabs>

        {mode.kind === 'duplicates' ? (
          <RecordsDuplicatesPanel churchId={churchId} ast={mode.ast} canManage={canManage} onBack={() => setMode({ kind: 'list' })} />
        ) : (
          <Card sx={{ minHeight: 640, flexGrow: { md: 1 }, display: { md: 'flex' }, height: { xs: 800, md: '1px' }, flexDirection: { md: 'column' } }}>
            <DataGrid
              {...toolbarOptions.settings}
              checkboxSelection={mode.kind === 'list'}
              disableRowSelectionOnClick
              rows={gridRows}
              columns={mode.kind === 'search' ? searchColumns : columns}
              loading={loading && mode.kind === 'list'}
              getRowHeight={() => 'auto'}
              paginationMode={mode.kind === 'list' ? 'server' : 'client'}
              sortingMode={mode.kind === 'list' ? 'server' : 'client'}
              rowCount={mode.kind === 'list' ? total : undefined}
              paginationModel={mode.kind === 'list' ? pagination : undefined}
              onPaginationModelChange={(m) => setPagination(m)}
              onSortModelChange={(m) => { const s = m[0]; if (s?.field) setSort({ field: s.field, dir: (s.sort as 'asc' | 'desc') || 'desc' }); }}
              pageSizeOptions={[10, 25, 50, 100]}
              onRowSelectionModelChange={(m) => setSelected(m)}
              rowSelectionModel={selected}
              slots={{ noRowsOverlay: () => <EmptyContent title={`No ${meta.plural.toLowerCase()} yet`} />, noResultsOverlay: () => <EmptyContent title="No results found" />, toolbar: renderToolbar }}
              sx={{ [`& .${gridClasses.cell}`]: { display: 'flex', alignItems: 'center' } }}
            />
          </Card>
        )}
      </DashboardContent>

      <RecordsExportDialog open={exportDialog.value} onClose={exportDialog.onFalse} ast={exportAst()} count={selectedIds.length || (mode.kind === 'search' ? mode.total : total)} />
      <RecordsSavedSearchesDrawer open={savedDrawer.value} onClose={savedDrawer.onFalse} churchId={churchId} currentAst={mode.kind === 'list' ? null : mode.ast} onRun={(r) => { setMode({ kind: 'search', ast: r.ast, rows: r.rows, total: r.total, label: r.name, durationMs: 0 }); savedDrawer.onFalse(); }} />
      <RecordsAdvancedSearchDrawer open={advancedDrawer.value} onClose={advancedDrawer.onFalse} churchId={churchId} defaultTypes={[type]} clergyOptions={clergyOptions} onRun={async (ast, label) => { try { const exec = await parishSearchApi.executeAll(ast); if (exec.mode === 'duplicate_detection') setMode({ kind: 'duplicates', ast }); else setMode({ kind: 'search', ast, rows: exec.rows, total: exec.total, label, durationMs: exec.durationMs }); advancedDrawer.onFalse(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Search failed'); } }} />

      <ConfirmDialog open={confirmDelete.value} onClose={confirmDelete.onFalse} title="Delete record" content={<>Delete <strong>{deleteTarget?.title}</strong>? The record is soft-deleted and can be restored from search.</>} action={<Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>} />
    </>
  );
}
