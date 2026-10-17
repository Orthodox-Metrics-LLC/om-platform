import type { ISocialLink } from 'src/types/common';

import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import InputAdornment from '@mui/material/InputAdornment';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Form, Field } from 'src/components/hook-form';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

const SOCIALS = [
  { key: 'facebook', label: 'Facebook', icon: 'socials:facebook' },
  { key: 'instagram', label: 'Instagram', icon: 'socials:instagram' },
  { key: 'linkedin', label: 'LinkedIn', icon: 'socials:linkedin' },
  { key: 'twitter', label: 'X', icon: 'socials:twitter' },
] as const satisfies ReadonlyArray<{ key: keyof ISocialLink; label: string; icon: string }>;

const emptyValues: ISocialLink = {
  facebook: '',
  instagram: '',
  linkedin: '',
  twitter: '',
};

function isHttpUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => !value || isHttpUrl(value), { error: 'Enter a valid URL (https://…)' });

const SocialsSchema = z.object({
  facebook: optionalUrl,
  instagram: optionalUrl,
  linkedin: optionalUrl,
  twitter: optionalUrl,
});

function toFormValues(raw: unknown): ISocialLink {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    facebook: typeof source.facebook === 'string' ? source.facebook : '',
    instagram: typeof source.instagram === 'string' ? source.instagram : '',
    linkedin: typeof source.linkedin === 'string' ? source.linkedin : '',
    twitter: typeof source.twitter === 'string' ? source.twitter : '',
  };
}

function normalizeLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// ----------------------------------------------------------------------

export function AccountSocials() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const methods = useForm({
    mode: 'onBlur',
    resolver: zodResolver(SocialsSchema),
    defaultValues: emptyValues,
  });

  const {
    reset,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await omApiFetch('/api/user/profile');
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.message || 'Could not load social links.');
        if (!cancelled) reset(toFormValues(json.profile?.social_links));
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load social links.');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reset]);

  const onSubmit = handleSubmit(async (data) => {
    const social_links = {
      facebook: normalizeLink(data.facebook),
      instagram: normalizeLink(data.instagram),
      linkedin: normalizeLink(data.linkedin),
      twitter: normalizeLink(data.twitter),
    };
    try {
      const res = await omApiFetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ social_links }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Could not save social links.');
      reset(social_links);
      toast.success('Social links saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save social links.');
    }
  });

  if (!loaded) return <LinearProgress />;

  if (loadError) {
    return (
      <Card sx={{ p: 3 }}>
        <Typography color="error">{loadError}</Typography>
      </Card>
    );
  }

  return (
    <Form methods={methods} onSubmit={onSubmit}>
      <Card sx={{ p: 3, gap: 3, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          These links are saved on your profile. Leave a field blank to remove it.
        </Typography>

        {SOCIALS.map((social) => (
          <Field.Text
            key={social.key}
            name={social.key}
            label={social.label}
            type="url"
            placeholder="https://"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Iconify width={24} icon={social.icon} />
                  </InputAdornment>
                ),
              },
              htmlInput: {
                spellCheck: false,
                autoCapitalize: 'off',
                enterKeyHint: 'next',
              },
            }}
          />
        ))}

        <Button type="submit" variant="contained" loading={isSubmitting} sx={{ ml: 'auto' }}>
          Save changes
        </Button>
      </Card>
    </Form>
  );
}
