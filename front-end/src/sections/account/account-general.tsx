import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { fDate } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Form, Field, schemaUtils } from 'src/components/hook-form';

import { useOmAuth, omApiFetch, omRoleLabel } from 'src/auth/context/om-auth';
import { OM_AVATARS, type OmAvatarPreset, fetchAssetManagerAvatars } from 'src/auth/utils';

// ----------------------------------------------------------------------

/**
 * Shape of `GET /api/user/profile` (prod: server/src/api/user-profile.js).
 * Fields the user cannot edit here (email, role, church) are shown read-only —
 * those are managed by administrators through the OM admin tools.
 */
type OmProfile = {
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string;
  role: string;
  church_id: number | null;
  church_name: string | null;
  church_affiliation: string | null;
  job_title: string | null;
  phone: string | null;
  location: string | null;
  website: string | null;
  bio: string | null;
  profile_image_url: string | null;
  profile_visibility: 'public' | 'friends' | 'private';
  created_at: string | null;
  last_login: string | null;
};

export type UpdateUserSchemaType = z.infer<typeof UpdateUserSchema>;

export const UpdateUserSchema = z.object({
  firstName: z.string().min(1, { error: 'First name is required!' }),
  lastName: z.string().min(1, { error: 'Last name is required!' }),
  email: schemaUtils.email(),
  displayName: z.string(),
  avatarUrl: z.string(),
  phoneNumber: z.union([z.string(), z.null(), z.undefined()]),
  jobTitle: z.string(),
  location: z.string(),
  website: z.union([z.literal(''), z.url({ error: 'Enter a valid URL (https://…)' })]),
  churchAffiliation: z.string(),
  about: z.string(),
  isPublic: z.boolean(),
});

const emptyValues: UpdateUserSchemaType = {
  firstName: '',
  lastName: '',
  email: '',
  displayName: '',
  avatarUrl: '',
  phoneNumber: '',
  jobTitle: '',
  location: '',
  website: '',
  churchAffiliation: '',
  about: '',
  isPublic: false,
};

function toFormValues(p: OmProfile): UpdateUserSchemaType {
  return {
    firstName: p.first_name ?? '',
    lastName: p.last_name ?? '',
    email: p.email ?? '',
    displayName: p.display_name ?? '',
    avatarUrl: p.profile_image_url ?? '',
    phoneNumber: p.phone ?? '',
    jobTitle: p.job_title ?? '',
    location: p.location ?? '',
    website: p.website ?? '',
    churchAffiliation: p.church_affiliation ?? '',
    about: p.bio ?? '',
    isPublic: p.profile_visibility === 'public',
  };
}

// ----------------------------------------------------------------------

export function AccountGeneral() {
  const { user: sessionUser, checkSession } = useOmAuth();
  // Only super admins may change their own email; everyone else asks a super admin.
  const canEditEmail = sessionUser?.role === 'super_admin';

  const [profile, setProfile] = useState<OmProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extraAvatars, setExtraAvatars] = useState<OmAvatarPreset[]>([]);
  const avatarOptions = [...OM_AVATARS, ...extraAvatars];

  const methods = useForm({
    mode: 'all',
    resolver: zodResolver(UpdateUserSchema),
    defaultValues: emptyValues,
    values: profile ? toFormValues(profile) : undefined,
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await omApiFetch('/api/user/profile');
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.message || `Failed (${res.status})`);
        if (!cancelled) setProfile(json.profile as OmProfile);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load profile');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Extra avatar choices from the Asset Manager "avatars public" collection —
  // uploading a new headshot there makes it selectable here automatically.
  useEffect(() => {
    let cancelled = false;
    fetchAssetManagerAvatars().then((avatars) => {
      if (!cancelled) setExtraAvatars(avatars);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = handleSubmit(async (data) => {
    try {
      const res = await omApiFetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: data.firstName.trim(),
          last_name: data.lastName.trim(),
          ...(canEditEmail &&
            data.email.trim().toLowerCase() !== profile?.email && {
              email: data.email.trim().toLowerCase(),
            }),
          display_name: data.displayName.trim() || null,
          profile_image_url: data.avatarUrl || null,
          phone: data.phoneNumber || null,
          job_title: data.jobTitle.trim() || null,
          location: data.location.trim() || null,
          website: data.website.trim() || null,
          church_affiliation: data.churchAffiliation.trim() || null,
          bio: data.about.trim() || null,
          profile_visibility: data.isPublic ? 'public' : 'private',
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || `Failed (${res.status})`);

      toast.success('Profile updated');
      // Refresh the session user so the header avatar/name pick up the change.
      await checkSession();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    }
  });

  if (loadError) {
    return (
      <Card sx={{ p: 3 }}>
        <Typography color="error">{loadError}</Typography>
      </Card>
    );
  }

  const readOnlyProps = { slotProps: { input: { readOnly: true } } } as const;

  return (
    <Form methods={methods} onSubmit={onSubmit}>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ pt: 6, pb: 5, px: 3, textAlign: 'center' }}>
            <Field.AvatarPicker
              name="avatarUrl"
              options={avatarOptions}
              fallbackName={profile?.display_name ?? profile?.first_name ?? profile?.email}
              helperText={
                <Typography
                  variant="caption"
                  sx={{ mt: 1, mx: 'auto', display: 'block', textAlign: 'center', color: 'text.disabled' }}
                >
                  Pick one of the Orthodox Metrics avatars
                </Typography>
              }
            />

            <Field.Switch
              name="isPublic"
              labelPlacement="start"
              label="Public profile"
              helperText="Public profiles appear in Contacts so other parish users can send you a request."
              sx={{ mt: 4 }}
              slotProps={{ helperText: { sx: { textAlign: 'center' } } }}
            />

            {profile && (
              <>
                <Divider sx={{ my: 3, borderStyle: 'dashed' }} />
                <Stack spacing={1} sx={{ typography: 'body2', color: 'text.secondary' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Role</span>
                    <Label color="info" variant="soft">
                      {omRoleLabel(profile.role)}
                    </Label>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Member since</span>
                    <span>{profile.created_at ? fDate(profile.created_at) : '—'}</span>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Last sign-in</span>
                    <span>{profile.last_login ? fDate(profile.last_login) : '—'}</span>
                  </Box>
                </Stack>
              </>
            )}
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ mb: 3 }}>
              Personal information
            </Typography>

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
                name="displayName"
                label="Display name"
                helperText="Shown across the platform; leave blank to use your full name."
              />
              <Field.Text
                name="email"
                label="Email address"
                disabled={!canEditEmail}
                helperText={
                  canEditEmail
                    ? 'Super admins may change their own email'
                    : 'Contact a super administrator to change your email'
                }
              />
              <Field.Phone name="phoneNumber" label="Phone number" country="US" />
              <Field.Text name="jobTitle" label="Title / position" placeholder="e.g. Parish Secretary" />
              <Field.Text name="location" label="Location" placeholder="City, State" />
              <Field.Text name="website" label="Website" placeholder="https://" />
            </Box>

            <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

            <Typography variant="subtitle1" sx={{ mb: 3 }}>
              Parish information
            </Typography>

            <Box
              sx={{
                rowGap: 3,
                columnGap: 2,
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)' },
              }}
            >
              <TextField
                label="Church"
                value={profile?.church_name ?? (profile?.church_id ? `Church #${profile.church_id}` : 'Not assigned')}
                helperText={profile?.church_id ? `Church ID ${profile.church_id}` : 'Assigned by an administrator'}
                {...readOnlyProps}
              />
              <TextField
                label="Role"
                value={omRoleLabel(profile?.role)}
                helperText="Managed by your administrator"
                {...readOnlyProps}
              />
              <Field.Text
                name="churchAffiliation"
                label="Jurisdiction / affiliation"
                placeholder="e.g. OCA, GOARCH, Antiochian"
                sx={{ gridColumn: { sm: 'span 2' } }}
              />
            </Box>

            <Stack spacing={3} sx={{ mt: 3, alignItems: 'flex-end' }}>
              <Field.Text name="about" multiline rows={4} label="About" />

              <Button type="submit" variant="contained" loading={isSubmitting}>
                Save changes
              </Button>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Form>
  );
}
