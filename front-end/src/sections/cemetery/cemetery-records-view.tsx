import type { GridColDef, GridSortModel } from '@mui/x-data-grid';
import type { CemeteryRow, CemeteryField, CemeteryResource, PartialDateValue } from './cemetery-records-api';

import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import { DataGrid, gridClasses } from '@mui/x-data-grid';

import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { FileManagerChurchPicker } from 'src/sections/file-manager/file-manager-church-picker';

import { cemeteryRecordsApi } from './cemetery-records-api';
import { useRecordsChurch } from '../records/use-records-church';
import { sameValue, editString, parseFieldInput } from './cemetery-cell-edit';

// ----------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type GridRow = CemeteryRow & { id: number; __edit?: { field: string; text: string } };
type DateDraft = { year: string; month: string; day: string };
type DraftValue = string | DateDraft;
type EditorState = {
  row: CemeteryRow | null;
  requestId: string;
  note: string;
  draft: Record<string, DraftValue>;
};

function isDateDraft(value: DraftValue | undefined): value is DateDraft {
  return !!value && typeof value === 'object';
}

function dateDraft(value: unknown): DateDraft {
  const date = value && typeof value === 'object' ? (value as PartialDateValue) : null;
  return {
    year: date?.year ? String(date.year) : '',
    month: date?.month ? String(date.month) : '',
    day: date?.day ? String(date.day) : '',
  };
}

function draftFromRow(resource: CemeteryResource, row: CemeteryRow | null): Record<string, DraftValue> {
  const draft: Record<string, DraftValue> = {};
  for (const field of resource.fields) {
    const current = row?.values?.[field.name];
    draft[field.name] = field.type === 'partial_date' ? dateDraft(current) : current == null ? '' : String(current);
  }
  return draft;
}

function partialFromDraft(label: string, draft: DateDraft): PartialDateValue | null {
  const year = draft.year.trim();
  const month = draft.month.trim();
  const day = draft.day.trim();
  if (!year && !month && !day) return null;
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1 || y > 9999) throw new Error(`${label} needs a year from 1 to 9999.`);
  const m = month ? Number(month) : null;
  const d = day ? Number(day) : null;
  if ((m != null && (!Number.isInteger(m) || m < 1 || m > 12)) || (d && !m)) {
    throw new Error(`${label} needs a month before a day.`);
  }
  if (d != null && (!Number.isInteger(d) || d < 1 || d > 31)) throw new Error(`${label} day must be from 1 to 31.`);
  if (d && m) return { year: y, month: m, day: d, precision: 'day' };
  if (m) return { year: y, month: m, day: null, precision: 'month' };
  return { year: y, month: null, day: null, precision: 'year' };
}

function valuesFromDraft(resource: CemeteryResource, draft: Record<string, DraftValue>) {
  const values: Record<string, unknown> = {};
  for (const field of resource.fields) {
    const current = draft[field.name];
    if (field.type === 'partial_date') {
      values[field.name] = partialFromDraft(field.label, isDateDraft(current) ? current : { year: '', month: '', day: '' });
    } else {
      const text = typeof current === 'string' ? current.trim() : '';
      values[field.name] = text === '' ? null : text;
    }
  }
  return values;
}

export function CemeteryRecordsView() {
  const { churchId, platform, canManage } = useRecordsChurch();
  const [resources, setResources] = useState<CemeteryResource[]>([]);
  const [table, setTable] = useState('');
  const [rows, setRows] = useState<CemeteryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [pagination, setPagination] = useState({ page: 0, pageSize: 100 });
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: 'last_name', sort: 'asc' }]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const resource = resources.find((item) => item.table === table) ?? null;

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      setAppliedSearch((current) => (current === next ? current : next));
      setPagination((current) => (current.page === 0 ? current : { ...current, page: 0 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!churchId) return undefined;
    let live = true;
    setLoading(true);
    cemeteryRecordsApi
      .resources(churchId)
      .then((result) => {
        if (!live) return;
        setResources(result.resources);
        setTable((current) => (result.resources.some((item) => item.table === current) ? current : result.resources[0]?.table || ''));
        if (!result.resources.length) setLoading(false);
      })
      .catch((error) => {
        if (!live) return;
        setResources([]);
        setLoading(false);
        toast.error(error instanceof Error ? error.message : 'Could not load cemetery records');
      });
    return () => {
      live = false;
    };
  }, [churchId]);

  const load = useCallback(async () => {
    if (!churchId || !resource) return;
    const names = new Set(resource.fields.map((field) => field.name));
    const sort = sortModel
      .filter((item) => item.sort && names.has(item.field))
      .slice(0, 3)
      .map((item) => ({ field: item.field, direction: item.sort as 'asc' | 'desc' }));
    setLoading(true);
    try {
      const result = await cemeteryRecordsApi.browse(churchId, {
        table: resource.table,
        search: appliedSearch,
        page: pagination.page,
        limit: pagination.pageSize,
        sort,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load cemetery records');
    } finally {
      setLoading(false);
    }
  }, [churchId, resource, appliedSearch, pagination, sortModel]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (row: CemeteryRow | null) => {
    if (!resource || !canManage) return;
    setEditor({
      row,
      requestId: crypto.randomUUID(),
      note: '',
      draft: draftFromRow(resource, row),
    });
  };

  const commitCell = useCallback(async (newRow: GridRow, oldRow: GridRow) => {
    if (!resource || !churchId || !newRow.__edit) return oldRow;
    const field = resource.fields.find((item) => item.name === newRow.__edit?.field);
    if (!field) return oldRow;
    const nextValue = parseFieldInput(field, newRow.__edit.text);
    if (sameValue(nextValue, oldRow.values?.[field.name] ?? null)) return oldRow;
    const values: Record<string, unknown> = {};
    for (const item of resource.fields) {
      values[item.name] = item.name === field.name ? nextValue : oldRow.values?.[item.name] ?? null;
    }
    const saved = await cemeteryRecordsApi.save(churchId, {
      table: resource.table,
      row_id: oldRow.row_id,
      values,
      note: `Updated ${field.label} in the grid.`,
      request_id: crypto.randomUUID(),
      fingerprint: oldRow.fingerprint,
    });
    setRows((current) => current.map((row) => (row.row_id === saved.row.row_id ? saved.row : row)));
    toast.success(`Saved ${field.label}`);
    return { ...saved.row, id: saved.row.row_id };
  }, [churchId, resource]);

  const save = async () => {
    if (!editor || !resource || !churchId) return;
    const note = editor.note.trim();
    if (!note) {
      toast.error('Enter a short note explaining this change.');
      return;
    }
    setSaving(true);
    try {
      await cemeteryRecordsApi.save(churchId, {
        table: resource.table,
        row_id: editor.row?.row_id ?? null,
        values: valuesFromDraft(resource, editor.draft),
        note,
        request_id: editor.requestId,
        fingerprint: editor.row?.fingerprint,
      });
      toast.success(editor.row ? 'Cemetery entry updated' : 'Cemetery entry added');
      setEditor(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this entry');
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo<GridColDef[]>(() => {
    if (!resource) return [];
    const dataColumns: GridColDef<GridRow>[] = resource.fields.map((field) => ({
      field: field.name,
      headerName: field.label,
      description: canManage ? 'Double-click to edit this cell' : undefined,
      flex: 1,
      minWidth: field.type === 'partial_date' ? 160 : 120,
      editable: canManage,
      valueGetter: (_value, row) => editString(field, row.values?.[field.name]),
      valueSetter: (value, row) => ({ ...row, __edit: { field: field.name, text: String(value ?? '') } }),
      renderCell: (params) => params.value || '—',
    }));
    return [
      ...dataColumns,
      {
        field: 'origin',
        headerName: 'Source',
        width: 120,
        sortable: false,
        renderCell: (params) => (
          <Label variant="soft" color={params.row.origin === 'manual' ? 'info' : 'default'}>
            {params.row.origin === 'manual' ? 'Added' : 'Imported'}
          </Label>
        ),
      },
      {
        field: 'actions',
        headerName: ' ',
        width: 90,
        sortable: false,
        align: 'right',
        renderCell: (params) =>
          canManage ? (
            <Button size="small" color="inherit" onClick={() => openEditor(params.row)}>
              Edit
            </Button>
          ) : null,
      },
    ];
    // openEditor closes over the latest resource and permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, canManage]);

  if (platform && !churchId) return <FileManagerChurchPicker heading="Cemetery records" basePath={paths.portal.cemetery} />;
  if (!churchId) {
    return (
      <DashboardContent>
        <EmptyContent filled title="Your account is not assigned to a church" sx={{ py: 10 }} />
      </DashboardContent>
    );
  }

  const gridRows = rows.map((row) => ({ ...row, id: row.row_id }));

  return (
    <>
      <DashboardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <CustomBreadcrumbs
          heading="Cemetery records"
          links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Cemetery records' }]}
          action={
            canManage && resource ? (
              <Button variant="contained" startIcon={<Iconify icon="mingcute:add-line" />} onClick={() => openEditor(null)}>
                Add entry
              </Button>
            ) : undefined
          }
          sx={{ mb: { xs: 3, md: 4 } }}
        />

        {!loading && !resources.length ? (
          <EmptyContent filled title="No cemetery import tables for this parish" description="Imported cemetery tables appear here when their names start with dr_import." sx={{ py: 10 }} />
        ) : (
          <Card sx={{ minHeight: 640, flexGrow: { md: 1 }, display: { md: 'flex' }, height: { xs: 800, md: '1px' }, flexDirection: { md: 'column' } }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, p: 2 }}>
              {resources.length > 1 && (
                <TextField select size="small" label="Record set" value={table} onChange={(event) => { setTable(event.target.value); setPagination((current) => ({ ...current, page: 0 })); }} sx={{ minWidth: 240 }}>
                  {resources.map((item) => (
                    <MenuItem key={item.table} value={item.table}>{item.name}</MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                size="small"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, plot, grave, date…"
                slotProps={{ input: { startAdornment: <Iconify icon="eva:search-fill" sx={{ mr: 1, color: 'text.disabled' }} /> } }}
                sx={{ minWidth: 260, flexGrow: 1 }}
              />
              {canManage && (
                <Box sx={{ alignSelf: 'center', color: 'text.secondary', typography: 'caption' }}>
                  Double-click a cell to change it. Press Enter to save.
                </Box>
              )}
            </Box>
            <DataGrid
              rows={gridRows}
              columns={columns}
              editMode="cell"
              processRowUpdate={commitCell}
              onProcessRowUpdateError={(error) => toast.error(error instanceof Error ? error.message : 'Could not save this cell')}
              loading={loading}
              rowCount={total}
              paginationMode="server"
              sortingMode="server"
              paginationModel={pagination}
              onPaginationModelChange={(model) => setPagination({ page: model.page, pageSize: Math.min(model.pageSize, 200) })}
              sortModel={sortModel}
              onSortModelChange={(model) => {
                setSortModel(model.slice(0, 3));
                setPagination((current) => ({ ...current, page: 0 }));
              }}
              pageSizeOptions={[25, 50, 100, 200]}
              disableRowSelectionOnClick
              slots={{
                noRowsOverlay: () => <EmptyContent title={appliedSearch ? 'No matching cemetery entries' : 'No cemetery entries yet'} />,
              }}
              sx={{ [`& .${gridClasses.cell}`]: { display: 'flex', alignItems: 'center' } }}
            />
          </Card>
        )}
      </DashboardContent>

      <Dialog open={!!editor} onClose={() => !saving && setEditor(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editor?.row ? 'Edit cemetery entry' : 'Add cemetery entry'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, pt: 1 }}>
            {resource?.fields.map((field) => (
              <FieldEditor
                key={field.name}
                field={field}
                value={editor?.draft[field.name]}
                onChange={(value) => setEditor((current) => current && ({ ...current, draft: { ...current.draft, [field.name]: value } }))}
              />
            ))}
            <TextField
              label="Change note"
              value={editor?.note ?? ''}
              onChange={(event) => setEditor((current) => current && ({ ...current, note: event.target.value }))}
              required
              multiline
              minRows={2}
              helperText="Say why this entry is being added or changed. The note is kept with the record."
              sx={{ gridColumn: '1 / -1' }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !editor?.note.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function FieldEditor({ field, value, onChange }: { field: CemeteryField; value: DraftValue | undefined; onChange: (value: DraftValue) => void }) {
  if (field.type === 'partial_date') {
    const date = isDateDraft(value) ? value : { year: '', month: '', day: '' };
    const set = (key: keyof DateDraft, next: string) => onChange({ ...date, [key]: next });
    return (
      <Box sx={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1.4fr 1fr' }, gap: 2 }}>
        <TextField label={`${field.label} year`} value={date.year} onChange={(event) => set('year', event.target.value)} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
        <TextField select label={`${field.label} month`} value={date.month} onChange={(event) => set('month', event.target.value)}>
          <MenuItem value="">Unknown</MenuItem>
          {MONTHS.map((month, index) => <MenuItem key={month} value={String(index + 1)}>{month}</MenuItem>)}
        </TextField>
        <TextField label={`${field.label} day`} value={date.day} onChange={(event) => set('day', event.target.value)} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
      </Box>
    );
  }
  return (
    <TextField
      label={field.label}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      fullWidth
    />
  );
}
