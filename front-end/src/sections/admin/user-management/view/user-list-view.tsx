import type { IUserTableFilters } from 'src/types/user';
import type { TableHeadCellProps } from 'src/components/table';
import type { OmAdminUser, OmChurchOption, OmAccountStatus } from '../om-users-api';

import { varAlpha } from 'minimal-shared/utils';
import { useState, useEffect, useCallback } from 'react';
import { useBoolean, useSetState } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import TableBody from '@mui/material/TableBody';
import IconButton from '@mui/material/IconButton';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import {
  useTable,
  emptyRows,
  rowInPage,
  TableNoData,
  getComparator,
  TableEmptyRows,
  TableHeadCustom,
  TableSelectedAction,
  TablePaginationCustom,
} from 'src/components/table';

import { useAuthContext } from 'src/auth/hooks';
import { RoleBasedGuard } from 'src/auth/guard';
import { omRoleLabel } from 'src/auth/context/om-auth';

import { UserTableRow } from '../user-table-row';
import { UserTableToolbar } from '../user-table-toolbar';
import { UserApproveDialog } from '../user-approve-dialog';
import { UserTableFiltersResult } from '../user-table-filters-result';
import { omUsersApi, userFullName, OM_ROLE_OPTIONS, ACCOUNT_STATUS_OPTIONS } from '../om-users-api';

// ----------------------------------------------------------------------

const STATUS_OPTIONS = [{ value: 'all', label: 'All' }, ...ACCOUNT_STATUS_OPTIONS];

const TABLE_HEAD: TableHeadCellProps[] = [
  { id: 'name', label: 'Name' },
  { id: 'phone', label: 'Phone number', width: 180 },
  { id: 'church_name', label: 'Church', width: 220 },
  { id: 'role', label: 'Role', width: 160 },
  { id: 'account_status', label: 'Status', width: 110 },
  { id: '', width: 88 },
];

const ROLE_FILTER_OPTIONS = OM_ROLE_OPTIONS.map((r) => r.label);

// ----------------------------------------------------------------------

/** Superadmins and admins only; everyone else gets the template's 403 panel. */
export function UserListView() {
  const { user } = useAuthContext();
  return (
    <RoleBasedGuard hasContent currentRole={user?.role} allowedRoles={['super_admin', 'admin']}>
      <UserListContent actorRole={user?.role ?? ''} />
    </RoleBasedGuard>
  );
}

function UserListContent({ actorRole }: { actorRole: string }) {
  const table = useTable({ defaultOrderBy: 'name' });

  const confirmDialog = useBoolean();
  const approveDialog = useBoolean();

  const [tableData, setTableData] = useState<OmAdminUser[]>([]);
  const [churches, setChurches] = useState<OmChurchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [approveTarget, setApproveTarget] = useState<OmAdminUser | null>(null);

  const filters = useSetState<IUserTableFilters>({ name: '', role: [], status: 'all' });
  const { state: currentFilters, setState: updateFilters } = filters;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, churchList] = await Promise.all([omUsersApi.list(), omUsersApi.churches()]);
      setTableData(users);
      setChurches(churchList);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dataFiltered = applyFilter({
    inputData: tableData,
    comparator: getComparator(table.order, table.orderBy),
    filters: currentFilters,
  });

  const dataInPage = rowInPage(dataFiltered, table.page, table.rowsPerPage);

  const canReset =
    !!currentFilters.name || currentFilters.role.length > 0 || currentFilters.status !== 'all';

  const notFound = !loading && ((!dataFiltered.length && canReset) || !dataFiltered.length);

  const handleDeleteRow = useCallback(
    async (id: number) => {
      try {
        await omUsersApi.remove(id);
        toast.success('User deleted');
        setTableData((prev) => prev.filter((row) => row.id !== id));
        table.onUpdatePageDeleteRow(dataInPage.length);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [dataInPage.length, table]
  );

  const handleDeleteRows = useCallback(async () => {
    const ids = table.selected.map(Number);
    const results = await Promise.allSettled(ids.map((id) => omUsersApi.remove(id)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`${failed} of ${ids.length} could not be deleted`);
    else toast.success(`${ids.length} user${ids.length === 1 ? '' : 's'} deleted`);
    await load();
    table.onUpdatePageDeleteRows(dataInPage.length, dataFiltered.length);
  }, [dataFiltered.length, dataInPage.length, table, load]);

  const applyStatus = useCallback(
    async (row: OmAdminUser, status: OmAccountStatus, churchId?: number | null) => {
      try {
        const res = await omUsersApi.setAccountStatus(row.id, {
          account_status: status,
          ...(churchId !== undefined && { church_id: churchId }),
        });
        toast.success(
          status === 'active' && res.welcome_email_sent
            ? `${userFullName(row)} approved — temporary password emailed`
            : `${userFullName(row)} is now ${status}`
        );
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Status change failed');
        throw e;
      }
    },
    [load]
  );

  const handleChangeStatus = useCallback(
    (row: OmAdminUser, status: OmAccountStatus) => {
      if (status === 'active') {
        // Activation always goes through the dialog so a church can be assigned.
        setApproveTarget(row);
        approveDialog.onTrue();
        return;
      }
      applyStatus(row, status).catch(() => {});
    },
    [applyStatus, approveDialog]
  );

  const handleFilterStatus = useCallback(
    (event: React.SyntheticEvent, newValue: string) => {
      table.onResetPage();
      updateFilters({ status: newValue });
    },
    [updateFilters, table]
  );

  const renderConfirmDialog = () => (
    <ConfirmDialog
      open={confirmDialog.value}
      onClose={confirmDialog.onFalse}
      title="Delete"
      content={
        <>
          Are you sure want to delete <strong> {table.selected.length} </strong> users? This cannot
          be undone.
        </>
      }
      action={
        <Button
          variant="contained"
          color="error"
          onClick={() => {
            handleDeleteRows();
            confirmDialog.onFalse();
          }}
        >
          Delete
        </Button>
      }
    />
  );

  return (
    <>
      <DashboardContent>
        <CustomBreadcrumbs
          heading="Users"
          links={[
            { name: 'Dashboard', href: paths.dashboard.root },
            { name: 'User', href: paths.dashboard.user.root },
            { name: 'List' },
          ]}
          action={
            <Button
              component={RouterLink}
              href={paths.dashboard.user.new}
              variant="contained"
              startIcon={<Iconify icon="mingcute:add-line" />}
            >
              Add user
            </Button>
          }
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        <Card>
          <Tabs
            value={currentFilters.status}
            onChange={handleFilterStatus}
            sx={[
              (theme) => ({
                px: { md: 2.5 },
                boxShadow: `inset 0 -2px 0 0 ${varAlpha(theme.vars.palette.grey['500Channel'], 0.08)}`,
              }),
            ]}
          >
            {STATUS_OPTIONS.map((tab) => (
              <Tab
                key={tab.value}
                iconPosition="end"
                value={tab.value}
                label={tab.label}
                icon={
                  <Label
                    variant={
                      ((tab.value === 'all' || tab.value === currentFilters.status) && 'filled') ||
                      'soft'
                    }
                    color={
                      (tab.value === 'active' && 'success') ||
                      (tab.value === 'pending' && 'warning') ||
                      (tab.value === 'banned' && 'error') ||
                      'default'
                    }
                  >
                    {tab.value === 'all'
                      ? tableData.length
                      : tableData.filter((u) => u.account_status === tab.value).length}
                  </Label>
                }
              />
            ))}
          </Tabs>

          <UserTableToolbar
            filters={filters}
            onResetPage={table.onResetPage}
            options={{ roles: ROLE_FILTER_OPTIONS }}
          />

          {canReset && (
            <UserTableFiltersResult
              filters={filters}
              totalResults={dataFiltered.length}
              onResetPage={table.onResetPage}
              sx={{ p: 2.5, pt: 0 }}
            />
          )}

          <Box sx={{ position: 'relative' }}>
            <TableSelectedAction
              dense={table.dense}
              numSelected={table.selected.length}
              rowCount={dataFiltered.length}
              onSelectAllRows={(checked) =>
                table.onSelectAllRows(
                  checked,
                  dataFiltered.map((row) => String(row.id))
                )
              }
              action={
                actorRole === 'super_admin' ? (
                  <Tooltip title="Delete">
                    <IconButton color="primary" onClick={confirmDialog.onTrue}>
                      <Iconify icon="solar:trash-bin-trash-bold" />
                    </IconButton>
                  </Tooltip>
                ) : null
              }
            />

            <Scrollbar>
              <Table size={table.dense ? 'small' : 'medium'} sx={{ minWidth: 960 }}>
                <TableHeadCustom
                  order={table.order}
                  orderBy={table.orderBy}
                  headCells={TABLE_HEAD}
                  rowCount={dataFiltered.length}
                  numSelected={table.selected.length}
                  onSort={table.onSort}
                  onSelectAllRows={(checked) =>
                    table.onSelectAllRows(
                      checked,
                      dataFiltered.map((row) => String(row.id))
                    )
                  }
                />

                <TableBody>
                  {dataFiltered
                    .slice(
                      table.page * table.rowsPerPage,
                      table.page * table.rowsPerPage + table.rowsPerPage
                    )
                    .map((row) => (
                      <UserTableRow
                        key={row.id}
                        row={row}
                        actorRole={actorRole}
                        selected={table.selected.includes(String(row.id))}
                        onSelectRow={() => table.onSelectRow(String(row.id))}
                        onDeleteRow={() => handleDeleteRow(row.id)}
                        onChangeStatus={(status) => handleChangeStatus(row, status)}
                        editHref={paths.dashboard.user.edit(String(row.id))}
                      />
                    ))}

                  <TableEmptyRows
                    height={table.dense ? 56 : 56 + 20}
                    emptyRows={emptyRows(table.page, table.rowsPerPage, dataFiltered.length)}
                  />

                  <TableNoData notFound={notFound} />
                </TableBody>
              </Table>
            </Scrollbar>
          </Box>

          <TablePaginationCustom
            page={table.page}
            dense={table.dense}
            count={dataFiltered.length}
            rowsPerPage={table.rowsPerPage}
            onPageChange={table.onChangePage}
            onChangeDense={table.onChangeDense}
            onRowsPerPageChange={table.onChangeRowsPerPage}
          />
        </Card>
      </DashboardContent>

      {renderConfirmDialog()}

      <UserApproveDialog
        open={approveDialog.value}
        user={approveTarget}
        churches={churches}
        onClose={approveDialog.onFalse}
        onConfirm={async (churchId) => {
          if (!approveTarget) return;
          await applyStatus(approveTarget, 'active', churchId);
          approveDialog.onFalse();
        }}
      />
    </>
  );
}

// ----------------------------------------------------------------------

type ApplyFilterProps = {
  inputData: OmAdminUser[];
  filters: IUserTableFilters;
  comparator: (a: any, b: any) => number;
};

function applyFilter({ inputData, comparator, filters }: ApplyFilterProps) {
  const { name, status, role } = filters;

  const rows = inputData.map((u) => ({ ...u, name: userFullName(u) }));
  const stabilizedThis = rows.map((el, index) => [el, index] as const);

  stabilizedThis.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) return order;
    return a[1] - b[1];
  });

  let out: OmAdminUser[] = stabilizedThis.map((el) => el[0]);

  if (name) {
    const q = name.toLowerCase();
    out = out.filter(
      (u) =>
        userFullName(u).toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.church_name ?? '').toLowerCase().includes(q)
    );
  }

  if (status !== 'all') {
    out = out.filter((u) => u.account_status === status);
  }

  if (role.length) {
    out = out.filter((u) => role.includes(omRoleLabel(u.role)));
  }

  return out;
}
