import type { ChartsSummary } from 'src/sections/records/om-records-api';

import { useMemo, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';

import { fNumber } from 'src/utils/format-number';

import { CONFIG } from 'src/global-config';
import { DashboardContent } from 'src/layouts/dashboard';

import { EmptyContent } from 'src/components/empty-content';

import { omRecordsApi } from 'src/sections/records/om-records-api';
import { useRecordsChurch } from 'src/sections/records/use-records-church';
import { FileManagerChurchPicker } from 'src/sections/file-manager/file-manager-church-picker';

import { AnalyticsCurrentVisits } from '../analytics-current-visits';
import { AnalyticsWebsiteVisits } from '../analytics-website-visits';
import { AnalyticsWidgetSummary } from '../analytics-widget-summary';
import { AnalyticsCurrentSubject } from '../analytics-current-subject';
import { AnalyticsConversionRates } from '../analytics-conversion-rates';

// ----------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parish analytics (legacy /portal/charts) on Minimal's analytics widgets, fed by
 * `/api/churches/:id/charts/summary`: totals, sacraments by year, monthly trends,
 * seasonal pattern, clergy activity, baptism ages and type distribution.
 */
export function OverviewAnalyticsView() {
  const { churchId, platform } = useRecordsChurch();
  const [data, setData] = useState<ChartsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<'all' | '10' | '25' | '50'>('25');

  useEffect(() => {
    if (!churchId) return;
    setData(null);
    omRecordsApi.charts(churchId).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load analytics'));
  }, [churchId]);

  const view = useMemo(() => {
    if (!data) return null;
    const thisYear = new Date().getFullYear();
    const years = range === 'all' ? data.sacramentsByYear : data.sacramentsByYear.filter((y) => y.year >= thisYear - Number(range));
    const total = (k: 'baptism' | 'marriage' | 'funeral') => data.sacramentsByYear.reduce((n, y) => n + y[k], 0);
    const spark = (k: 'baptism' | 'marriage' | 'funeral') => { const last = data.sacramentsByYear.slice(-8); return { categories: last.map((y) => String(y.year)), series: last.map((y) => y[k]) }; };
    const pct = (k: 'baptism' | 'marriage' | 'funeral') => { const l = data.sacramentsByYear.slice(-2); if (l.length < 2 || !l[0][k]) return 0; return Math.round(((l[1][k] - l[0][k]) / l[0][k]) * 1000) / 10; };
    const months = data.monthlyTrends.slice(-24);
    return { years, total, spark, pct, months, allTotal: total('baptism') + total('marriage') + total('funeral') };
  }, [data, range]);

  if (platform && !churchId) return <FileManagerChurchPicker heading="Analytics" basePath={paths.dashboard.general.analytics} />;
  if (!churchId) return <DashboardContent><EmptyContent filled title="Your account is not assigned to a church" sx={{ py: 10 }} /></DashboardContent>;
  if (error) return <DashboardContent><EmptyContent filled title={error} sx={{ py: 10 }} /></DashboardContent>;
  if (!data || !view) return <DashboardContent><LinearProgress /></DashboardContent>;

  const glass = (name: string) => <img alt={name} src={`${CONFIG.assetsDir}/assets/icons/glass/${name}.svg`} />;

  return (
    <DashboardContent maxWidth="xl">
      <Box sx={{ mb: { xs: 3, md: 5 }, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4">Parish analytics</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{fNumber(view.allTotal)} sacramental records · {data.sacramentsByYear[0]?.year}–{data.sacramentsByYear.at(-1)?.year}</Typography>
        </Box>
        <TextField select size="small" label="Years shown" value={range} onChange={(e) => setRange(e.target.value as any)} sx={{ minWidth: 160 }}>
          <MenuItem value="10">Last 10 years</MenuItem><MenuItem value="25">Last 25 years</MenuItem><MenuItem value="50">Last 50 years</MenuItem><MenuItem value="all">All years</MenuItem>
        </TextField>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><AnalyticsWidgetSummary title="Baptisms" percent={view.pct('baptism')} total={view.total('baptism')} icon={glass('ic-glass-users')} chart={view.spark('baptism')} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><AnalyticsWidgetSummary title="Marriages" percent={view.pct('marriage')} total={view.total('marriage')} color="secondary" icon={glass('ic-glass-bag')} chart={view.spark('marriage')} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><AnalyticsWidgetSummary title="Funerals" percent={view.pct('funeral')} total={view.total('funeral')} color="warning" icon={glass('ic-glass-buy')} chart={view.spark('funeral')} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><AnalyticsWidgetSummary title="Clergy on record" percent={0} total={data.byPriest.length} color="error" icon={glass('ic-glass-message')} chart={{ categories: data.byPriest.slice(0, 8).map((p) => p.name.split(' ').pop() || ''), series: data.byPriest.slice(0, 8).map((p) => p.count) }} /></Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <AnalyticsCurrentVisits title="Records by sacrament" chart={{ series: data.typeDistribution.map((t) => ({ label: t.name, value: t.value })) }} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsWebsiteVisits title="Sacraments by year" subheader={range === 'all' ? 'Full parish history' : `Last ${range} years`} chart={{ categories: view.years.map((y) => String(y.year)), series: [{ name: 'Baptisms', data: view.years.map((y) => y.baptism) }, { name: 'Marriages', data: view.years.map((y) => y.marriage) }, { name: 'Funerals', data: view.years.map((y) => y.funeral) }] }} />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsConversionRates title="Seasonal pattern" subheader="Sacraments by month across all years" chart={{ categories: data.seasonalPatterns.map((m) => m.month), series: [{ name: 'Baptisms', data: data.seasonalPatterns.map((m) => m.baptism) }, { name: 'Marriages', data: data.seasonalPatterns.map((m) => m.marriage) }, { name: 'Funerals', data: data.seasonalPatterns.map((m) => m.funeral) }] }} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <AnalyticsCurrentSubject title="Age at baptism" subheader="How old children were when baptized" chart={{ categories: data.baptismAge.map((a) => a.range), series: [{ name: 'Baptisms', data: data.baptismAge.map((a) => a.count) }] }} />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsWebsiteVisits title="Monthly trend" subheader="Last 24 months with activity" chart={{ categories: view.months.map((m) => { const [y, mo] = m.month.split('-'); return `${MONTHS[Number(mo) - 1]} ${y.slice(2)}`; }), series: [{ name: 'Baptisms', data: view.months.map((m) => m.baptism) }, { name: 'Marriages', data: view.months.map((m) => m.marriage) }, { name: 'Funerals', data: view.months.map((m) => m.funeral) }] }} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Card>
            <CardHeader title="Clergy activity" subheader="Sacraments recorded per clergy" />
            <Stack spacing={2} sx={{ p: 3 }}>
              {data.byPriest.slice(0, 10).map((p) => {
                const max = data.byPriest[0]?.count || 1;
                return (
                  <Box key={p.name}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}><Typography variant="body2" noWrap sx={{ maxWidth: '75%' }}>{p.name}</Typography><Typography variant="subtitle2">{fNumber(p.count)}</Typography></Box>
                    <LinearProgress variant="determinate" value={(p.count / max) * 100} sx={{ height: 6, borderRadius: 1 }} />
                  </Box>
                );
              })}
              {!data.byPriest.length && <Typography variant="body2" sx={{ color: 'text.disabled' }}>No clergy recorded.</Typography>}
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
