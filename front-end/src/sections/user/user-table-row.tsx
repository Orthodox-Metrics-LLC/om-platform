import type { OmAdminUser, OmAccountStatus } from './om-users-api';

import { useBoolean, usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import Checkbox from '@mui/material/Checkbox';
import TableCell from '@mui/material/TableCell';
import IconButton from '@mui/material/IconButton';

import { RouterLink } from 'src/routes/components';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomPopover } from 'src/components/custom-popover';

import { omRoleLabel } from 'src/auth/context/om-auth';

import { userFullName, isPlatformRole } from './om-users-api';

// ----------------------------------------------------------------------

export const statusColor = (status: OmAccountStatus) =>
  (status === 'active' && 'success') ||
  (status === 'pending' && 'warning') ||
  (status === 'banned' && 'error') ||
  'default';

type Props = {
  row: OmAdminUser;
  selected: boolean;
  editHref: string;
  /** Role of the signed-in actor — drives which lifecycle actions are offered. */
  actorRole: string;
  onSelectRow: () => void;
  onDeleteRow: () => void;
  onChangeStatus: (status: OmAccountStatus) => void;
};

export function UserTableRow({
  row,
  selected,
  editHref,
  actorRole,
  onSelectRow,
  onDeleteRow,
  onChangeStatus,
}: Props) {
  const menuActions = usePopover();
  const confirmDialog = useBoolean();

  const isSuper = actorRole === 'super_admin';
  const targetIsSuper = row.role === 'super_admin';
  // admins may only ban / un-ban church-role accounts
  const canBan = !targetIsSuper && (isSuper || !isPlatformRole(row.role));
  const canApprove = isSuper && !targetIsSuper && row.account_status !== 'active';
  const canReject = isSuper && !targetIsSuper && row.account_status === 'pending';

  const act = (status: OmAccountStatus) => {
    menuActions.onClose();
    onChangeStatus(status);
  };

  const renderMenuActions = () => (
    <CustomPopover
      open={menuActions.open}
      anchorEl={menuActions.anchorEl}
      onClose={menuActions.onClose}
      slotProps={{ arrow: { placement: 'right-top' } }}
    >
      <MenuList>
        <li>
          <MenuItem component={RouterLink} href={editHref} onClick={() => menuActions.onClose()}>
            <Iconify icon="solar:pen-bold" />
            Edit
          </MenuItem>
        </li>

        {(canApprove || canReject || canBan) && <Divider sx={{ borderStyle: 'dashed' }} />}

        {canApprove && (
          <MenuItem onClick={() => act('active')} sx={{ color: 'success.main' }}>
            <Iconify icon="solar:check-circle-bold" />
            {row.account_status === 'pending' ? 'Approve' : 'Re-activate'}
          </MenuItem>
        )}
        {canReject && (
          <MenuItem onClick={() => act('rejected')}>
            <Iconify icon="mingcute:close-line" />
            Reject
          </MenuItem>
        )}
        {canBan && row.account_status === 'active' && (
          <MenuItem onClick={() => act('banned')} sx={{ color: 'error.main' }}>
            <Iconify icon="solar:forbidden-circle-bold" />
            Ban
          </MenuItem>
        )}
        {canBan && row.account_status === 'banned' && (
          <MenuItem onClick={() => act('active')} sx={{ color: 'success.main' }}>
            <Iconify icon="solar:check-circle-bold" />
            Un-ban
          </MenuItem>
        )}

        {isSuper && !targetIsSuper && (
          <>
            <Divider sx={{ borderStyle: 'dashed' }} />
            <MenuItem
              onClick={() => {
                confirmDialog.onTrue();
                menuActions.onClose();
              }}
              sx={{ color: 'error.main' }}
            >
              <Iconify icon="solar:trash-bin-trash-bold" />
              Delete
            </MenuItem>
          </>
        )}
      </MenuList>
    </CustomPopover>
  );

  const renderConfirmDialog = () => (
    <ConfirmDialog
      open={confirmDialog.value}
      onClose={confirmDialog.onFalse}
      title="Delete user"
      content={
        <>
          Permanently delete <strong>{userFullName(row)}</strong> ({row.email})? This cannot be undone.
        </>
      }
      action={
        <Button
          variant="contained"
          color="error"
          onClick={() => {
            confirmDialog.onFalse();
            onDeleteRow();
          }}
        >
          Delete
        </Button>
      }
    />
  );

  const name = userFullName(row);

  return (
    <>
      <TableRow hover selected={selected} aria-checked={selected} tabIndex={-1}>
        <TableCell padding="checkbox">
          <Checkbox
            checked={selected}
            onClick={onSelectRow}
            slotProps={{
              input: { id: `${row.id}-checkbox`, 'aria-label': `${row.id} checkbox` },
            }}
          />
        </TableCell>

        <TableCell>
          <Box sx={{ gap: 2, display: 'flex', alignItems: 'center' }}>
            <Avatar alt={name} src={row.avatar_url ?? undefined}>
              {name.charAt(0).toUpperCase()}
            </Avatar>

            <Stack sx={{ typography: 'body2', flex: '1 1 auto', alignItems: 'flex-start' }}>
              <Link component={RouterLink} href={editHref} color="inherit" sx={{ cursor: 'pointer' }}>
                {name}
              </Link>
              <Box component="span" sx={{ color: 'text.disabled' }}>
                {row.email}
              </Box>
            </Stack>
          </Box>
        </TableCell>

        <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.phone || '—'}</TableCell>

        <TableCell sx={{ whiteSpace: 'nowrap' }}>
          {row.church_name ? (
            <Tooltip title={`Church ID ${row.church_id}`}>
              <span>{row.church_name}</span>
            </Tooltip>
          ) : isPlatformRole(row.role) ? (
            <Box component="span" sx={{ color: 'text.disabled' }}>
              Platform
            </Box>
          ) : (
            <Label color="warning" variant="soft">
              Unassigned
            </Label>
          )}
        </TableCell>

        <TableCell sx={{ whiteSpace: 'nowrap' }}>{omRoleLabel(row.role)}</TableCell>

        <TableCell>
          <Label variant="soft" color={statusColor(row.account_status)}>
            {row.account_status}
          </Label>
        </TableCell>

        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title="Edit" placement="top" arrow>
              <IconButton component={RouterLink} href={editHref}>
                <Iconify icon="solar:pen-bold" />
              </IconButton>
            </Tooltip>

            <IconButton color={menuActions.open ? 'inherit' : 'default'} onClick={menuActions.onOpen}>
              <Iconify icon="eva:more-vertical-fill" />
            </IconButton>
          </Box>
        </TableCell>
      </TableRow>

      {renderMenuActions()}
      {renderConfirmDialog()}
    </>
  );
}
