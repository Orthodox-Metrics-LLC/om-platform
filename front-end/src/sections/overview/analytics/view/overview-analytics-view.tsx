import type { ChartsSummary } from 'src/sections/records/om-records-api';

import { useMemo, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fDate } from 'src/utils/format-time';
import { fNumber } from 'src/utils/format-number';

import { CONFIG } from 'src/global-config';
import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
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

type Kind = 'baptism' | 'marriage' | 'funeral';
type Range = '1' | '3' | '5' | '10' | '25' | '50' | 'all';
const RANGES: { value: Range; label: string }[] = [
  { value: '1', label: 'Last year' }, { value: '3', label: 'Last 3 years' }, { value: '5', label: 'Last 5 years' }, { value: '10', label: 'Last 10 years' },
  { value: '25', label: 'Last 25 years' }, { value: '50', label: 'Last 50 years' }, { value: 'all', label: 'All years' },
];
const KINDS: { kind: Kind; title: string; color: 'primary' | 'secondary' | 'warning'; icon: string }[] = [
  { kind: 'baptism', title: 'Baptisms', color: 'primary', icon: 'ic-cross-baptism' },
  { kind: 'marriage', title: 'Marriages', color: 'secondary', icon: 'ic-cross-marriage' },
  { kind: 'funeral', title: 'Funerals', color: 'warning', icon: 'ic-cross-funeral' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sum = (arr: number[]) => arr.reduce((n, v) => n + v, 0);
/** % change of `cur` vs `prev`; 0 when there is nothing to compare against. */
const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur > 0 ? 100 : 0);
const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Parish analytics (legacy /portal/charts) on Minimal's analytics widgets, fed by
 * `/api/churches/:id/charts/summary`. Every figure follows the "Years shown" range:
 * widget totals, trend %, sparklines, and the charts. Header totals are the whole register.
 */
export function OverviewAnalyticsView() {
  const { churchId, platform } = useRecordsChurch();
  const [data, setData] = useState<ChartsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('25');

  useEffect(() => {
    if (!churchId) return;
    setData(null);
    omRecordsApi.charts(churchId).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load analytics'));
  }, [churchId]);

  const view = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const thisYear = now.getFullYear();
    const byYear = data.sacramentsByYear;
    const firstYear = byYear[0]?.year ?? thisYear;
    const n = range === 'all' ? thisYear - firstYear + 1 : Number(range);
    const from = range === 'all' ? firstYear : thisYear - n + 1; // inclusive calendar years
    const prevFrom = from - n;
    const inRange = byYear.filter((y) => y.year >= from && y.year <= thisYear);
    const inPrev = byYear.filter((y) => y.year >= prevFrom && y.year < from);
    const monthly = data.monthlyTrends;
    const clergyByYear = data.clergyByYear ?? [];
    const totals = data.totals ?? {};

    // For a single year, work on the last 12 months instead of the calendar year.
    const last12 = Array.from({ length: 12 }, (_, i) => { const d = new Date(thisYear, now.getMonth() - 11 + i, 1); return ymKey(d); });
    const prev12 = Array.from({ length: 12 }, (_, i) => { const d = new Date(thisYear, now.getMonth() - 23 + i, 1); return ymKey(d); });
    const monthMap = new Map(monthly.map((m) => [m.month, m]));
    const monthVal = (k: string, kind: Kind) => monthMap.get(k)?.[kind] ?? 0;

    const widget = (kind: Kind) => {
      if (range === '1') {
        const series = last12.map((k) => monthVal(k, kind));
        return { total: sum(series), percent: pctChange(sum(series), sum(prev12.map((k) => monthVal(k, kind)))), categories: last12.map((k) => MONTHS[Number(k.slice(5)) - 1]), series, note: 'last 12 months' };
      }
      const cur = sum(inRange.map((y) => y[kind]));
      const prev = sum(inPrev.map((y) => y[kind]));
      if (range === 'all') {
        // whole register incl. undated rows; sparkline by decade; trend = latest full year vs the one before
        const decades = new Map<number, number>();
        byYear.forEach((y) => decades.set(Math.floor(y.year / 10) * 10, (decades.get(Math.floor(y.year / 10) * 10) ?? 0) + y[kind]));
        const keys = [...decades.keys()].sort();
        const lastFull = byYear.find((y) => y.year === thisYear - 1)?.[kind] ?? 0;
        const before = byYear.find((y) => y.year === thisYear - 2)?.[kind] ?? 0;
        return { total: totals[kind]?.total ?? cur, percent: pctChange(lastFull, before), categories: keys.map((k) => `${k}s`), series: keys.map((k) => decades.get(k) ?? 0), note: `all years · ${totals[kind]?.undated ?? 0} undated` };
      }
      const years = Array.from({ length: n }, (_, i) => from + i);
      return { total: cur, percent: pctChange(cur, prev), categories: years.map(String), series: years.map((yr) => byYear.find((y) => y.year === yr)?.[kind] ?? 0), note: `vs previous ${n} yr${n === 1 ? '' : 's'}` };
    };

    // clergy active in range: distinct names with at least one record in the window
    const clergyIn = (lo: number, hi: number) => clergyByYear.filter((c) => c.year >= lo && c.year <= hi);
    // Clergy activity in range, with a per-sacrament breakdown for the tooltip
    const clergyAgg = clergyIn(range === 'all' ? 0 : from, thisYear).reduce<Record<string, { name: string; count: number; baptism: number; marriage: number; funeral: number }>>((acc, c) => {
      const row = acc[c.name] ?? (acc[c.name] = { name: c.name, count: 0, baptism: 0, marriage: 0, funeral: 0 });
      row.count += c.count; row[c.type as Kind] = (row[c.type as Kind] ?? 0) + c.count;
      return acc;
    }, {});
    const clergyRows = Object.values(clergyAgg).sort((a, b) => b.count - a.count);

    // charts
    const yearSeries = range === '1'
      ? { categories: last12.map((k) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`), rows: last12.map((k) => ({ baptism: monthVal(k, 'baptism'), marriage: monthVal(k, 'marriage'), funeral: monthVal(k, 'funeral') })) }
      : (() => { // continuous axis: years without records show as zero
          const years = range === 'all' ? Array.from({ length: thisYear - firstYear + 1 }, (_, i) => firstYear + i) : Array.from({ length: n }, (_, i) => from + i);
          return { categories: years.map(String), rows: years.map((yr) => byYear.find((y) => y.year === yr) ?? { year: yr, baptism: 0, marriage: 0, funeral: 0 }) };
        })();
    const dist = KINDS.map((k) => ({ label: k.title, value: range === 'all' ? totals[k.kind]?.total ?? 0 : widget(k.kind).total }));
    const monthsWindow = monthly.filter((m) => { const y = Number(m.month.slice(0, 4)); return range === '1' ? last12.includes(m.month) : y >= from; }).slice(-36);
    const registerTotal = KINDS.reduce((s, k) => s + (totals[k.kind]?.total ?? sum(byYear.map((y) => y[k.kind]))), 0);
    const undated = KINDS.reduce((s, k) => s + (totals[k.kind]?.undated ?? 0), 0);
    const rangeLabel = RANGES.find((r) => r.value === range)!.label;

    return { widget, clergyRows, yearSeries, dist, monthsWindow, registerTotal, undated, firstYear, thisYear, rangeLabel, from };
  }, [data, range]);

  if (platform && !churchId) return <FileManagerChurchPicker heading="Analytics" basePath={paths.dashboard.general.analytics} />;
  if (!churchId) return <DashboardContent><EmptyContent filled title="Your account is not assigned to a church" sx={{ py: 10 }} /></DashboardContent>;
  if (error) return <DashboardContent><EmptyContent filled title={error} sx={{ py: 10 }} /></DashboardContent>;
  if (!data || !view) return <DashboardContent><LinearProgress /></DashboardContent>;

  const icon = (name: string) => <img alt={name} src={`${CONFIG.assetsDir}/assets/icons/glass/${name}.svg`} />;
  const totals = data.totals ?? {};

  return (
    <DashboardContent maxWidth="xl">
      <Box sx={{ mb: { xs: 3, md: 5 }, display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Typography variant="h4">Parish analytics</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {fNumber(view.registerTotal)} sacramental records · {KINDS.map((k) => `${fNumber(totals[k.kind]?.total ?? 0)} ${k.title.toLowerCase()}`).join(', ')} · {view.firstYear}–{view.thisYear}
            {view.undated > 0 && ` · ${fNumber(view.undated)} without a sacrament date (counted in totals, not in year charts)`}
          </Typography>
        </Box>
        <TextField select size="small" label="Years shown" value={range} onChange={(e) => setRange(e.target.value as Range)} sx={{ minWidth: 170 }}>
          {RANGES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
        </TextField>
      </Box>

      <Grid container spacing={3}>
        {KINDS.map((k) => { const w = view.widget(k.kind); return (
          <Grid key={k.kind} size={{ xs: 12, sm: 6, md: 3 }}>
            <AnalyticsWidgetSummary title={`${k.title} · ${range === 'all' ? 'all years' : view.rangeLabel.toLowerCase()}`} percent={w.percent} total={w.total} color={k.color} icon={icon(k.icon)} chart={{ categories: w.categories, series: w.series }} />
          </Grid>
        ); })}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ p: 2.5, height: 1, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Box sx={{ width: 36, height: 36 }}>{icon('ic-cross-clergy')}</Box>
              <Box>
                <Typography variant="subtitle2">Recent sacraments</Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>Latest entries in the register</Typography>
              </Box>
            </Box>
            <Stack spacing={1} sx={{ flexGrow: 1 }}>
              {(data.recentEvents ?? []).slice(0, 6).map((e) => (
                <Box key={`${e.type}-${e.id}`} component={RouterLink} href={`${paths.dashboard.records.details(e.type, e.id)}${platform ? `?church=${churchId}` : ''}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'inherit', textDecoration: 'none', '&:hover .name': { textDecoration: 'underline' } }}>
                  <Label variant="soft" color={e.type === 'baptism' ? 'primary' : e.type === 'marriage' ? 'secondary' : 'warning'} sx={{ minWidth: 64, justifyContent: 'center', textTransform: 'capitalize' }}>{e.type}</Label>
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography className="name" variant="body2" noWrap>{e.name || '—'}</Typography>
                    <Typography variant="caption" noWrap sx={{ color: 'text.disabled', display: 'block' }}>{fDate(e.date)}{e.clergy ? ` · ${e.clergy}` : ''}</Typography>
                  </Box>
                </Box>
              ))}
              {!(data.recentEvents ?? []).length && <Typography variant="body2" sx={{ color: 'text.disabled' }}>No dated sacraments yet.</Typography>}
            </Stack>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <AnalyticsCurrentVisits title="Records by sacrament" subheader={view.rangeLabel} chart={{ series: view.dist }} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsWebsiteVisits title={range === '1' ? 'Sacraments by month' : 'Sacraments by year'} subheader={range === 'all' ? `Full parish history · ${view.firstYear}–${view.thisYear}` : range === '1' ? 'Last 12 months' : `${view.from}–${view.thisYear}`} chart={{ categories: view.yearSeries.categories, series: [{ name: 'Baptisms', data: view.yearSeries.rows.map((y) => y.baptism) }, { name: 'Marriages', data: view.yearSeries.rows.map((y) => y.marriage) }, { name: 'Funerals', data: view.yearSeries.rows.map((y) => y.funeral) }] }} />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsConversionRates title="Seasonal pattern" subheader="Sacraments by month of the year, across the whole register" chart={{ categories: data.seasonalPatterns.map((m) => m.month), series: [{ name: 'Baptisms', data: data.seasonalPatterns.map((m) => m.baptism) }, { name: 'Marriages', data: data.seasonalPatterns.map((m) => m.marriage) }, { name: 'Funerals', data: data.seasonalPatterns.map((m) => m.funeral) }] }} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <AnalyticsCurrentSubject title="Age at baptism" subheader="Whole register (requires birth and baptism dates)" chart={{ categories: data.baptismAge.map((a) => a.range), series: [{ name: 'Baptisms', data: data.baptismAge.map((a) => a.count) }] }} />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsWebsiteVisits title="Monthly trend" subheader={view.monthsWindow.length ? `${view.monthsWindow.length} months with activity in ${view.rangeLabel.toLowerCase()}` : 'No dated records in this range'} chart={{ categories: view.monthsWindow.map((m) => { const [y, mo] = m.month.split('-'); return `${MONTHS[Number(mo) - 1]} ${y.slice(2)}`; }), series: [{ name: 'Baptisms', data: view.monthsWindow.map((m) => m.baptism) }, { name: 'Marriages', data: view.monthsWindow.map((m) => m.marriage) }, { name: 'Funerals', data: view.monthsWindow.map((m) => m.funeral) }] }} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Card>
            <CardHeader title="Clergy activity" subheader={`Sacraments recorded per clergy · ${view.rangeLabel.toLowerCase()}`} />
            <Stack spacing={2} sx={{ p: 3 }}>
              {view.clergyRows.slice(0, 10).map((p) => {
                const max = view.clergyRows[0]?.count || 1;
                const breakdown = (
                  <Box sx={{ p: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{p.name}</Typography>
                    {KINDS.map((k) => (
                      <Box key={k.kind} sx={{ display: 'flex', justifyContent: 'space-between', gap: 3, typography: 'body2' }}>
                        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><Iconify icon={k.kind === 'baptism' ? 'custom:cross-bold' : k.kind === 'marriage' ? 'solar:heart-bold' : 'solar:calendar-date-bold'} width={14} />{k.title}</Box>
                        <b>{fNumber(p[k.kind])}</b>
                      </Box>
                    ))}
                    <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px dashed rgba(255,255,255,0.3)', display: 'flex', justifyContent: 'space-between', typography: 'body2' }}><span>Total</span><b>{fNumber(p.count)}</b></Box>
                  </Box>
                );
                return (
                  <Tooltip key={p.name} title={breakdown} placement="left" arrow>
                    <Box sx={{ cursor: 'help' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}><Typography variant="body2" noWrap sx={{ maxWidth: '75%' }}>{p.name}</Typography><Typography variant="subtitle2">{fNumber(p.count)}</Typography></Box>
                      <LinearProgress variant="determinate" value={(p.count / max) * 100} sx={{ height: 6, borderRadius: 1 }} />
                    </Box>
                  </Tooltip>
                );
              })}
              {!view.clergyRows.length && <Typography variant="body2" sx={{ color: 'text.disabled' }}>No clergy recorded in this range.</Typography>}
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
