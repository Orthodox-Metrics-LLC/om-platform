import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fDate } from 'src/utils/format-time';
import { fCurrency } from 'src/utils/format-number';

import { PlanPremiumIcon } from 'src/assets/icons';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/** Shape of `GET /api/user/profile/subscription`. */
type OmSubscriptionResponse = {
  church: { id: number; name: string | null } | null;
  account: {
    billing_status: 'paid_in_full' | 'payment_plan' | 'overdue' | 'suspended' | null;
    account_balance: string | number | null;
    last_payment_date: string | null;
    next_payment_due: string | null;
  };
  subscription: {
    status: 'active' | 'suspended' | 'cancelled' | 'trial' | 'expired';
    billing_cycle: 'monthly' | 'quarterly' | 'yearly';
    start_date: string | null;
    end_date: string | null;
    renewal_date: string | null;
    amount: string | number | null;
    currency: string | null;
    payment_method: string | null;
    plan_code: string | null;
    plan_name: string | null;
    limits: { max_users: number | null; max_records: number | null; max_storage_gb: number | null };
  } | null;
  billing_portal_enabled: boolean;
};

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  active: 'success',
  trial: 'info',
  paid_in_full: 'success',
  payment_plan: 'info',
  suspended: 'error',
  overdue: 'warning',
  cancelled: 'default',
  expired: 'default',
};

const titleCase = (s?: string | null) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ----------------------------------------------------------------------

export function AccountSubscription() {
  const [data, setData] = useState<OmSubscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await omApiFetch('/api/user/profile/subscription');
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.message || `Failed (${res.status})`);
        if (!cancelled) setData(json as OmSubscriptionResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load subscription');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card sx={{ p: 3 }}>
        <Typography color="error">{error}</Typography>
      </Card>
    );
  }

  const sub = data?.subscription ?? null;
  const account = data?.account;

  const row = (label: string, value: React.ReactNode) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', typography: 'body2' }}>
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {label}
      </Box>
      <Box component="span" sx={{ fontWeight: 'fontWeightMedium', textAlign: 'right' }}>
        {value}
      </Box>
    </Box>
  );

  return (
    <Grid container spacing={5}>
      <Grid size={{ xs: 12, md: 8 }}>
        <Card>
          <CardHeader title="Plan" subheader={data?.church?.name ?? 'No parish assigned to this account'} />

          <Box sx={{ p: 3, display: 'flex', gap: 3, alignItems: 'flex-start' }}>
            <PlanPremiumIcon sx={{ width: 48, height: 48, flexShrink: 0 }} />

            <Box sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="h6">
                  {sub ? sub.plan_name || titleCase(sub.plan_code) || 'Parish plan' : 'Orthodox Metrics'}
                </Typography>
                {sub && (
                  <Label color={STATUS_COLOR[sub.status] ?? 'default'} variant="soft">
                    {titleCase(sub.status)}
                  </Label>
                )}
              </Box>

              {sub ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {sub.amount != null ? fCurrency(Number(sub.amount)) : '—'} / {sub.billing_cycle}
                  {sub.renewal_date ? ` · renews ${fDate(sub.renewal_date)}` : ''}
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No subscription is on file for this parish yet. Access is provisioned through
                  parish enrollment; questions about your plan go to the Orthodox Metrics office.
                </Typography>
              )}

              {sub && (sub.limits.max_users || sub.limits.max_records || sub.limits.max_storage_gb) && (
                <Stack direction="row" spacing={3} sx={{ mt: 2, typography: 'body2' }}>
                  {sub.limits.max_users && <span>{sub.limits.max_users} users</span>}
                  {sub.limits.max_records && <span>{sub.limits.max_records.toLocaleString()} records</span>}
                  {sub.limits.max_storage_gb && <span>{sub.limits.max_storage_gb} GB storage</span>}
                </Stack>
              )}
            </Box>
          </Box>

          <Divider sx={{ borderStyle: 'dashed' }} />

          <Box sx={{ p: 3, display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
            <Button
              component={RouterLink}
              href={paths.contact}
              variant="outlined"
              color="inherit"
              startIcon={<Iconify icon="solar:letter-bold" />}
            >
              Contact billing
            </Button>
            <Button
              variant="contained"
              disabled={!data?.billing_portal_enabled}
              startIcon={<Iconify icon="solar:bill-list-bold" />}
            >
              {data?.billing_portal_enabled ? 'Manage billing' : 'Billing portal coming soon'}
            </Button>
          </Box>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, md: 4 }}>
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 3 }}>
            Account status
          </Typography>

          <Stack spacing={2}>
            {row(
              'Billing status',
              account?.billing_status ? (
                <Label color={STATUS_COLOR[account.billing_status] ?? 'default'} variant="soft">
                  {titleCase(account.billing_status)}
                </Label>
              ) : (
                '—'
              )
            )}
            {row(
              'Balance',
              account?.account_balance != null ? fCurrency(Number(account.account_balance)) : '—'
            )}
            {row('Last payment', account?.last_payment_date ? fDate(account.last_payment_date) : '—')}
            {row('Next payment due', account?.next_payment_due ? fDate(account.next_payment_due) : '—')}
            {row('Church ID', data?.church?.id ?? '—')}
          </Stack>
        </Card>
      </Grid>
    </Grid>
  );
}
