import type { OmAdminUser, OmChurchOption, OmAccountStatus } from './om-users-api';

import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { useBoolean } from 'minimal-shared/hooks';
import { useMemo, useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { Form, Field, schemaUtils } from 'src/components/hook-form';

import { useAuthContext } from 'src/auth/hooks';

import { statusColor } from './user-table-row';
import { UserApproveDialog } from './user-approve-dialog';
import { omUsersApi, churchLabel, userFullName, isPlatformRole, OM_ROLE_OPTIONS } from './om-users-api';

// ----------------------------------------------------------------------

export type UserCreateSchemaType = z.infer<typeof UserCreateSchema>;

export const UserCreateSchema = z
  .object({
    firstName: z.string().min(1, { error: 'First name is required!' }),
    lastName: z.string().min(1, { error: 'Last name is required!' }),
    email: schemaUtils.email(),
    phoneNumber: z.union([z.string(), z.null(), z.undefined()]),
    role: z.string().min(1, { error: 'Role is required!' }),
    churchId: z.union([z.number(), z.literal('')]),
    location: z.string(),
    jobTitle: z.string(),
  })
  .refine((v) => isPlatformRole(v.role) || v.churchId !== '', {
    error: 'A church is required for this role',
    path: ['churchId'],
  });

const emptyValues: UserCreateSchemaType = {
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  role: 'viewer',
  churchId: '',
  location: '',
  jobTitle: '',
};

// ----------------------------------------------------------------------

type Props = {
  currentUser?: OmAdminUser;
  onSaved?: () => void;
};

export function UserCreateEditForm({ currentUser, onSaved }: Props) {
  const router = useRouter();
  const { user: actor } = useAuthContext();
  const actorRole: string = actor?.role ?? '';
  const isSuper = actorRole === 'super_admin';
  const isEdit = !!currentUser;
  const targetIsSuper = currentUser?.role === 'super_admin';
  const editingSelf = !!currentUser && Number(actor?.id) === currentUser.id;

  const deleteDialog = useBoolean();
  const approveDialog = useBoolean();

  const [churches, setChurches] = useState<OmChurchOption[]>([]);
  const [adminChurchIds, setAdminChurchIds] = useState<number[]>([]);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    omUsersApi.churches().then(setChurches).catch(() => setChurches([]));
  }, []);

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      omUsersApi
        .adminChurches(currentUser.id)
        .then((rows) => setAdminChurchIds(rows.map((r) => r.church_id)))
        .catch(() => setAdminChurchIds([]));
    }
  }, [currentUser]);

  const values = useMemo<UserCreateSchemaType | undefined>(
    () =>
      currentUser
        ? {
            firstName: currentUser.first_name ?? '',
            lastName: currentUser.last_name ?? '',
            email: currentUser.email,
            phoneNumber: currentUser.phone ?? '',
            role: currentUser.role,
            churchId: currentUser.church_id ?? '',
            location: currentUser.location ?? '',
            jobTitle: currentUser.job_title ?? '',
          }
        : undefined,
    [currentUser]
  );

  const methods = useForm({
    mode: 'onSubmit',
    resolver: zodResolver(UserCreateSchema),
    defaultValues: emptyValues,
    values,
  });

  const {
    watch,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const role = watch('role');
  const roleIsPlatform = isPlatformRole(role);

  /** Roles the actor may assign: admins can never create platform accounts. */
  const roleOptions = OM_ROLE_OPTIONS.filter((r) => isSuper || r.tier === 'church');

  // Email: create → always; edit → super_admin only. Admins/church users never self-edit here.
  const emailEditable = !isEdit || isSuper;

  const onSubmit = handleSubmit(async (data) => {
    try {
      const payload = {
        first_name: data.firstName.trim(),
        last_name: data.lastName.trim(),
        role: data.role,
        church_id: roleIsPlatform || data.churchId === '' ? null : data.churchId,
        // Legacy numbers that are not E.164 render blank in the phone field; never
        // let an untouched blank overwrite a stored value.
        ...((data.phoneNumber || !currentUser?.phone) && { phone: data.phoneNumber || null }),
        location: data.location.trim() || null,
        job_title: data.jobTitle.trim() || null,
      };

      if (currentUser) {
        await omUsersApi.update(currentUser.id, {
          ...payload,
          ...(emailEditable && data.email.trim().toLowerCase() !== currentUser.email && {
            email: data.email.trim().toLowerCase(),
          }),
        });
        if (isSuper && data.role === 'admin') {
          await omUsersApi.setAdminChurches(currentUser.id, adminChurchIds);
        }
        toast.success('User updated');
        onSaved?.();
      } else {
        const res = await omUsersApi.create({ ...payload, email: data.email.trim().toLowerCase() });
        toast.success(
          data.role === 'super_admin'
            ? 'Super admin created'
            : 'User created — pending approval'
        );
        router.push(paths.dashboard.user.edit(String(res.user.id)));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    }
  });

  const changeStatus = async (status: OmAccountStatus, churchId?: number | null) => {
    if (!currentUser) return;
    setStatusBusy(true);
    try {
      const res = await omUsersApi.setAccountStatus(currentUser.id, {
        account_status: status,
        ...(churchId !== undefined && { church_id: churchId }),
      });
      toast.success(
        status === 'active' && res.welcome_email_sent
          ? 'Approved — temporary password emailed'
          : `Account is now ${status}`
      );
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Status change failed');
      throw e;
    } finally {
      setStatusBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!currentUser) return;
    try {
      await omUsersApi.remove(currentUser.id);
      toast.success('User deleted');
      router.push(paths.dashboard.user.list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  // ---- lifecycle controls (edit only) ------------------------------------
  const status = currentUser?.account_status;
  const canBan = isEdit && !targetIsSuper && !editingSelf && (isSuper || !isPlatformRole(currentUser.role));
  const canApprove = isSuper && isEdit && !targetIsSuper && !editingSelf && status !== 'active';
  const canReject = isSuper && isEdit && !targetIsSuper && !editingSelf && status === 'pending';

  const renderLifecycle = () => {
    if (!currentUser) return null;
    if (targetIsSuper) {
      return (
        <Alert severity="info" sx={{ mt: 3 }}>
          Super administrator accounts are always <strong>Active</strong>.
        </Alert>
      );
    }
    return (
      <Stack spacing={1.5} sx={{ mt: 3 }}>
        <Typography variant="subtitle2">Account status</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {status === 'pending' && 'Awaiting approval. The user cannot sign in yet.'}
          {status === 'active' && `Approved${currentUser.approved_at ? ` on ${fDateTime(currentUser.approved_at)}` : ''}.`}
          {status === 'banned' && `Disabled. ${currentUser.lockout_reason ?? ''}`}
          {status === 'rejected' && 'Application declined. The user cannot sign in.'}
        </Typography>

        {!currentUser.church_id && !isPlatformRole(currentUser.role) && (
          <Alert severity="warning">Assign a church before approving this account.</Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {canApprove && (
            <Button
              size="small"
              color="success"
              variant="contained"
              onClick={approveDialog.onTrue}
              startIcon={<Iconify icon="solar:check-circle-bold" />}
            >
              {status === 'pending' ? 'Approve' : 'Activate'}
            </Button>
          )}
          {canReject && (
            <Button size="small" color="inherit" variant="outlined" loading={statusBusy} onClick={() => changeStatus('rejected').catch(() => {})}>
              Reject
            </Button>
          )}
          {canBan && status === 'active' && (
            <Button
              size="small"
              color="error"
              variant="soft"
              loading={statusBusy}
              onClick={() => changeStatus('banned').catch(() => {})}
              startIcon={<Iconify icon="solar:forbidden-circle-bold" />}
            >
              Ban
            </Button>
          )}
          {canBan && status === 'banned' && (
            <Button size="small" color="success" variant="soft" onClick={approveDialog.onTrue}>
              Un-ban
            </Button>
          )}
        </Box>
      </Stack>
    );
  };

  const name = currentUser ? userFullName(currentUser) : '';

  return (
    <>
      <Form methods={methods} onSubmit={onSubmit}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ pt: 8, pb: 5, px: 3 }}>
              {currentUser && (
                <Label
                  color={statusColor(currentUser.account_status)}
                  sx={{ position: 'absolute', top: 24, right: 24, textTransform: 'capitalize' }}
                >
                  {currentUser.account_status}
                </Label>
              )}

              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Avatar
                  src={currentUser?.avatar_url ?? undefined}
                  alt={name}
                  sx={{ width: 128, height: 128, mb: 2, fontSize: 48 }}
                >
                  {name.charAt(0).toUpperCase() || <Iconify icon="solar:user-rounded-bold" width={56} />}
                </Avatar>
                <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>
                  {currentUser
                    ? 'Users choose their own avatar under Account › Profile'
                    : 'The user picks an avatar after first sign-in'}
                </Typography>
              </Box>

              {renderLifecycle()}

              {currentUser && (
                <>
                  <Divider sx={{ my: 3, borderStyle: 'dashed' }} />
                  <Stack spacing={1} sx={{ typography: 'body2', color: 'text.secondary' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>User ID</span>
                      <span>{currentUser.id}</span>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Created</span>
                      <span>{fDateTime(currentUser.created_at)}</span>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Last sign-in</span>
                      <span>{currentUser.last_login ? fDateTime(currentUser.last_login) : 'Never'}</span>
                    </Box>
                  </Stack>
                </>
              )}

              {currentUser && isSuper && !targetIsSuper && !editingSelf && (
                <Stack sx={{ mt: 3, alignItems: 'center' }}>
                  <Button variant="soft" color="error" onClick={deleteDialog.onTrue}>
                    Delete user
                  </Button>
                </Stack>
              )}
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Card sx={{ p: 3 }}>
              <Box
                sx={{
                  rowGap: 3,
                  columnGap: 2,
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)' },
                }}
              >
                <Field.Text name="firstName" label="First name" />
                <Field.Text name="lastName" label="Last name" />

                <Field.Text
                  name="email"
                  label="Email address"
                  disabled={!emailEditable}
                  helperText={
                    !emailEditable ? 'Only a super administrator can change an email address' : undefined
                  }
                />
                <Field.Phone name="phoneNumber" label="Phone number" country="US" />

                <Field.Select
                  name="role"
                  label="Role"
                  disabled={targetIsSuper && !isSuper}
                  helperText={
                    role === 'admin'
                      ? 'Platform administrator — supports the churches assigned below'
                      : roleIsPlatform
                        ? 'Platform role — not tied to a single church'
                        : undefined
                  }
                >
                  {roleOptions.map((r) => (
                    <MenuItem key={r.value} value={r.value}>
                      {r.label}
                    </MenuItem>
                  ))}
                </Field.Select>

                <Field.Select
                  name="churchId"
                  label="Church"
                  disabled={roleIsPlatform}
                  helperText={
                    roleIsPlatform ? 'Not applicable to platform roles' : 'Required — sets the user\u2019s church_id'
                  }
                  slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
                >
                  <MenuItem value="" disabled sx={{ color: 'text.disabled' }}>
                    Select a church…
                  </MenuItem>
                  {churches.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {churchLabel(c)}
                      <Box component="span" sx={{ ml: 1, color: 'text.disabled' }}>
                        #{c.id}
                      </Box>
                    </MenuItem>
                  ))}
                </Field.Select>

                <Field.Text name="jobTitle" label="Title / position" placeholder="e.g. Parish Secretary" />
                <Field.Text name="location" label="Location" placeholder="City, State" />
              </Box>

              {role === 'admin' && isEdit && (
                <>
                  <Divider sx={{ my: 3, borderStyle: 'dashed' }} />
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Responsible for churches
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                    This administrator provides support and can chat with users of these parishes.
                  </Typography>
                  <Autocomplete
                    multiple
                    disabled={!isSuper}
                    options={churches}
                    getOptionLabel={(c) => `${churchLabel(c)} (#${c.id})`}
                    value={churches.filter((c) => adminChurchIds.includes(c.id))}
                    onChange={(_, list) => setAdminChurchIds(list.map((c) => c.id))}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder={adminChurchIds.length ? '' : 'Select churches…'}
                        helperText={!isSuper ? 'Managed by a super administrator' : undefined}
                      />
                    )}
                  />
                </>
              )}

              <Stack sx={{ mt: 3, alignItems: 'flex-end' }}>
                <Button type="submit" variant="contained" loading={isSubmitting}>
                  {!currentUser ? 'Create user' : 'Save changes'}
                </Button>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      </Form>

      <ConfirmDialog
        open={deleteDialog.value}
        onClose={deleteDialog.onFalse}
        title="Delete user"
        content={
          <>
            Permanently delete <strong>{name}</strong>? This cannot be undone.
          </>
        }
        action={
          <Button variant="contained" color="error" onClick={handleDelete}>
            Delete
          </Button>
        }
      />

      <UserApproveDialog
        open={approveDialog.value}
        user={currentUser ?? null}
        churches={churches}
        onClose={approveDialog.onFalse}
        onConfirm={async (churchId) => {
          await changeStatus('active', churchId);
          approveDialog.onFalse();
        }}
      />
    </>
  );
}
