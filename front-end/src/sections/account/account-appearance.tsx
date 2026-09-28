import type { ParishAppearance } from 'src/layouts/components/use-parish-appearance';

import { useRef, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { parishAppearanceApi, useParishAppearance } from 'src/layouts/components/use-parish-appearance';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';

import { omSocialApi } from 'src/sections/user/om-social-api';

import { useAuthContext } from 'src/auth/hooks';
import { isChurchRole } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Account → Appearance: the parish card shown in every church member's sidebar
 * (church image + name banner). Editable by church_admin / priest / deacon.
 */
export function AccountAppearance({ churchId = null }: { churchId?: number | null }) {
  const { user } = useAuthContext();
  const { appearance, error, setAppearance } = useParishAppearance(true, churchId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ display_name: '', city: '', state: '' });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (appearance) setForm({ display_name: appearance.display_name ?? '', city: appearance.city ?? '', state: appearance.state ?? '' });
  }, [appearance]);

  if (error) return <EmptyContent filled title={error} description={isChurchRole(user?.role) ? undefined : 'Platform administrators can open a church from Asset Manager → Church files.'} sx={{ py: 10 }} />;
  if (!appearance) return <LinearProgress />;

  const canWrite = appearance.can_write;

  const save = async (patch?: Partial<ParishAppearance>) => {
    setSaving(true);
    try {
      const next = await parishAppearanceApi.update({ church_id: churchId, display_name: form.display_name, city: form.city, state: form.state, ...patch });
      setAppearance(next);
      toast.success('Parish appearance saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const [uploaded] = await omSocialApi.upload([file], 'cover');
      await save({ image_url: uploaded.url });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const preview = (
    <Box sx={{ width: 220, mx: 'auto' }}>
      {appearance.image_url ? (
        <Box component="img" alt={form.display_name} src={appearance.image_url} sx={{ width: 1, aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 3, display: 'block', mb: 1.5 }} />
      ) : (
        <Box sx={{ width: 1, aspectRatio: '3 / 4', borderRadius: 3, mb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.neutral', color: 'text.disabled' }}>
          <Iconify icon="custom:cross-bold" width={48} />
        </Box>
      )}
      <Box sx={{ px: 1.5, py: 1.5, borderRadius: 0.5, color: 'common.white', bgcolor: appearance.primary_color || '#2c5aa0', fontFamily: '"Georgia", "Times New Roman", serif', textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.15 }}>
        <Typography component="div" sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 17 }}>{form.display_name || appearance.name}</Typography>
        {(form.city || form.state) && (
          <>
            <Box sx={{ my: 0.75, mx: 'auto', width: '80%', borderTop: '1px solid rgba(255,255,255,0.6)' }} />
            <Typography component="div" sx={{ fontFamily: 'inherit', fontSize: 14 }}>{[form.city, form.state].filter(Boolean).join(', ')}</Typography>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 4 }}>
        <Card sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Sidebar preview</Typography>
          {preview}
          {canWrite && (
            <Box sx={{ mt: 3, display: 'flex', gap: 1, justifyContent: 'center' }}>
              <Button variant="outlined" color="inherit" loading={uploading} startIcon={<Iconify icon="solar:camera-add-bold" />} onClick={() => fileRef.current?.click()}>
                {appearance.image_url ? 'Change image' : 'Upload image'}
              </Button>
              {appearance.image_url && (
                <Button color="error" onClick={() => save({ image_url: null })}>Remove</Button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImage} />
            </Box>
          )}
          <Typography variant="caption" sx={{ mt: 2, display: 'block', color: 'text.disabled' }}>
            Portrait images look best (3:4). Shown to every member of {appearance.name}.
          </Typography>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, md: 8 }}>
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 3 }}>Parish appearance</Typography>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
            <TextField label="Church name" value={form.display_name} onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))} disabled={!canWrite} helperText="Displayed on the banner beneath the church image" sx={{ gridColumn: '1 / -1' }} />
            <TextField label="City" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} disabled={!canWrite} />
            <TextField label="State / province" value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} disabled={!canWrite} />
          </Box>
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
            {!canWrite && <Typography variant="caption" sx={{ color: 'text.disabled' }}>Only church administrators and clergy can change these.</Typography>}
            {canWrite && <Button variant="contained" loading={saving} disabled={!form.display_name.trim()} onClick={() => save()}>Save changes</Button>}
          </Box>
        </Card>
      </Grid>
    </Grid>
  );
}
