import type { RecordType } from './om-records-api';
import type { OrthodoxCalendar, RestrictionPeriod } from './sacramental-date-restrictions';

import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { paths } from 'src/routes/paths';

import { fDate } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { RECORD_TYPES } from './om-records-api';
import { calculatePascha, getRestrictionsForYear, getBaptismDateRestriction, getFuneralDateRestriction, getMarriageDateRestriction } from './sacramental-date-restrictions';

// ----------------------------------------------------------------------

const SACRAMENT_COLOR: Record<RecordType, string> = { baptism: '#00A76F', marriage: '#8E33FF', funeral: '#FFAB00' };
const MONTHS = Array.from({ length: 12 }, (_, i) => i);
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Sacramental calendar — when baptisms, marriages and funerals are restricted (New / Old Calendar). */
export function SacramentalCalendarView() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [calendar, setCalendar] = useState<OrthodoxCalendar>('new');
  const [sacraments, setSacraments] = useState<RecordType[]>(['baptism', 'marriage', 'funeral']);
  const [checkDate, setCheckDate] = useState(dayjs().format('YYYY-MM-DD'));

  const pascha = useMemo(() => calculatePascha(year), [year]);
  const byDate = useMemo(() => {
    const map = new Map<string, RestrictionPeriod[]>();
    getRestrictionsForYear(year, calendar).forEach((p) => { if (!map.has(p.date)) map.set(p.date, []); map.get(p.date)!.push(p); });
    return map;
  }, [year, calendar]);

  const toggleSacrament = (s: RecordType) => setSacraments((p) => (p.includes(s) ? (p.length > 1 ? p.filter((x) => x !== s) : p) : [...p, s]));

  const checks = useMemo(() => {
    const iso = calendar === 'old' ? dayjs(checkDate).subtract(13, 'day').format('YYYY-MM-DD') : checkDate; // rules are expressed in New Calendar dates
    return [
      { type: 'baptism' as RecordType, r: getBaptismDateRestriction(iso) },
      { type: 'marriage' as RecordType, r: getMarriageDateRestriction(iso) },
      { type: 'funeral' as RecordType, r: getFuneralDateRestriction(iso, iso) },
    ];
  }, [checkDate, calendar]);

  const renderMonth = (m: number) => {
    const first = new Date(year, m, 1).getDay();
    const days = new Date(year, m + 1, 0).getDate();
    return (
      <Paper key={m} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{dayjs(new Date(year, m, 1)).format('MMMM')}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.25 }}>
          {DOW.map((d) => <Typography key={d} variant="caption" sx={{ textAlign: 'center', color: 'text.disabled', fontSize: 10 }}>{d}</Typography>)}
          {Array.from({ length: first }).map((_, i) => <Box key={`e${i}`} />)}
          {Array.from({ length: days }).map((_, i) => {
            const iso = `${year}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
            const hits = (byDate.get(iso) || []).filter((p) => sacraments.includes(p.sacrament));
            const isPascha = iso === dayjs(pascha).format('YYYY-MM-DD');
            const colors = [...new Set(hits.map((h) => SACRAMENT_COLOR[h.sacrament]))];
            const bg = colors.length === 0 ? 'transparent' : colors.length === 1 ? colors[0] : `linear-gradient(135deg, ${colors.map((c, k) => `${c} ${(k / colors.length) * 100}% ${((k + 1) / colors.length) * 100}%`).join(', ')})`;
            const warnOnly = hits.length > 0 && hits.every((h) => h.severity === 'warning');
            const cell = (
              <Box sx={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.75, fontSize: 11, cursor: hits.length ? 'help' : 'default', background: bg, opacity: warnOnly ? 0.55 : 1, color: hits.length ? 'common.white' : 'text.primary', fontWeight: hits.length || isPascha ? 700 : 400, outline: isPascha ? '2px solid' : 'none', outlineColor: 'error.main' }}>
                {i + 1}
              </Box>
            );
            return hits.length || isPascha ? (
              <Tooltip key={iso} title={<Box>{isPascha && <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>Pascha</Typography>}{hits.map((h, k) => <Typography key={k} variant="caption" sx={{ display: 'block' }}><b style={{ textTransform: 'capitalize' }}>{h.sacrament}</b>: {h.label}{h.severity === 'warning' ? ' (advisory)' : ''}</Typography>)}</Box>} arrow>
                {cell}
              </Tooltip>
            ) : <Box key={iso}>{cell}</Box>;
          })}
        </Box>
      </Paper>
    );
  };

  return (
    <DashboardContent maxWidth="xl">
      <CustomBreadcrumbs
        heading="Sacramental calendar"
        links={[{ name: 'Portal', href: paths.portal.root }, { name: 'Records', href: paths.portal.records.root }, { name: 'Sacramental calendar' }]}
        action={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button color="inherit" onClick={() => setYear((y) => y - 1)}><Iconify icon="eva:arrow-ios-back-fill" /></Button>
            <Typography variant="h6" sx={{ minWidth: 56, textAlign: 'center' }}>{year}</Typography>
            <Button color="inherit" onClick={() => setYear((y) => y + 1)}><Iconify icon="eva:arrow-ios-forward-fill" /></Button>
            <ToggleButtonGroup exclusive size="small" value={calendar} onChange={(_, v) => v && setCalendar(v)}><ToggleButton value="new">New Calendar</ToggleButton><ToggleButton value="old">Old Calendar</ToggleButton></ToggleButtonGroup>
          </Box>
        }
        sx={{ mb: 3 }}
      />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={3}>
            <Card sx={{ p: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Check a date</Typography>
              <TextField fullWidth size="small" type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} />
              <Stack spacing={1} sx={{ mt: 2 }}>
                {checks.map(({ type, r }) => (
                  <Box key={type} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                    <Iconify icon={r ? (r.severity === 'error' ? 'solar:forbidden-circle-bold' : 'solar:danger-triangle-bold') : 'solar:check-circle-bold'} width={20} sx={{ color: r ? (r.severity === 'error' ? 'error.main' : 'warning.main') : 'success.main', flexShrink: 0, mt: 0.25 }} />
                    <Box><Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>{type}</Typography><Typography variant="caption" sx={{ color: 'text.secondary' }}>{r ? r.message : `${type === 'funeral' ? 'Funerals' : `${type[0].toUpperCase()}${type.slice(1)}s`} may be celebrated on ${fDate(checkDate)}.`}</Typography></Box>
                  </Box>
                ))}
              </Stack>
            </Card>

            <Card sx={{ p: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Show</Typography>
              <Stack spacing={1}>
                {RECORD_TYPES.map((t) => (
                  <Box key={t.value} onClick={() => toggleSacrament(t.value)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', opacity: sacraments.includes(t.value) ? 1 : 0.4 }}>
                    <Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: SACRAMENT_COLOR[t.value] }} /><Typography variant="body2">{t.plural} restricted</Typography>
                  </Box>
                ))}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}><Box sx={{ width: 14, height: 14, borderRadius: 0.5, border: '2px solid', borderColor: 'error.main' }} /><Typography variant="body2">Pascha · {fDate(pascha)}</Typography></Box>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>Faded cells are advisories (e.g. Paschal funeral rite) rather than prohibitions. Fixed feasts shift +13 days on the Old Calendar; Pascha-based periods are shared.</Typography>
              </Stack>
            </Card>

            <Card sx={{ p: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Moveable feasts {year}</Typography>
              <Stack spacing={0.75}>
                {[['Great Lent begins', -48], ['Palm Sunday', -7], ['Great and Holy Friday', -2], ['Pascha', 0], ['Bright Week ends', 6], ['Ascension', 39], ['Pentecost', 49], ["Apostles' Fast begins", 57]].map(([label, off]) => (
                  <Box key={String(label)} sx={{ display: 'flex', justifyContent: 'space-between', typography: 'body2' }}><span>{label}</span><Label variant="soft">{fDate(dayjs(pascha).add(Number(off), 'day').toDate())}</Label></Box>
                ))}
              </Stack>
            </Card>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardHeader title={`${year} — ${calendar === 'old' ? 'Old' : 'New'} Calendar`} subheader="Hover a highlighted day for the reason" />
            <Box sx={{ p: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>{MONTHS.map(renderMonth)}</Box>
          </Card>
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
