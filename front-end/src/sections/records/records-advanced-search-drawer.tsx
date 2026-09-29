import type { RecordType, ParishSearchAst } from './om-records-api';

import { useState } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import FormControlLabel from '@mui/material/FormControlLabel';

import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { recordsAst, RECORD_TYPES, RECORD_STATUSES } from './om-records-api';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  churchId: number;
  defaultTypes: RecordType[];
  clergyOptions: string[];
  onRun: (ast: ParishSearchAst, label: string) => Promise<void> | void;
};

// Field registry (server-side recordFieldRegistry) — canonical fields work across types.
const FIELDS = [
  { value: 'primary_name', label: 'Name / parties' },
  { value: 'canonical_event_date', label: 'Event date' },
  { value: 'clergy', label: 'Clergy' },
  { value: 'location', label: 'Location' },
  { value: 'status', label: 'Status' },
  { value: 'first_name', label: 'First name (baptism)' }, { value: 'last_name', label: 'Last name (baptism)' }, { value: 'birth_date', label: 'Birth date (baptism)' }, { value: 'birthplace', label: 'Birthplace (baptism)' }, { value: 'sponsors', label: 'Sponsors (baptism)' }, { value: 'parents', label: 'Parents (baptism)' },
  { value: 'fname_groom', label: 'Groom first name' }, { value: 'lname_groom', label: 'Groom last name' }, { value: 'fname_bride', label: 'Bride first name' }, { value: 'lname_bride', label: 'Bride last name' }, { value: 'witness', label: 'Witnesses' },
  { value: 'name', label: 'First name (funeral)' }, { value: 'lastname', label: 'Last name (funeral)' }, { value: 'deceased_date', label: 'Date of death' }, { value: 'burial_location', label: 'Burial place' }, { value: 'age', label: 'Age' },
];
const OPERATORS = [
  { value: 'contains', label: 'contains' }, { value: 'equals', label: 'equals' }, { value: 'not_equals', label: 'does not equal' }, { value: 'starts_with', label: 'starts with' }, { value: 'ends_with', label: 'ends with' },
  { value: 'before', label: 'before' }, { value: 'after', label: 'after' }, { value: 'between', label: 'between' }, { value: 'greater_than', label: 'greater than' }, { value: 'less_than', label: 'less than' },
  { value: 'is_empty', label: 'is empty' }, { value: 'is_not_empty', label: 'is not empty' },
];
type Cond = { field: string; operator: string; value: string; value2: string };
// Server-supported data-quality rules (services/parishRecordsSearch/dataQualityService.js)
const DQ_RULES = [
  { value: 'missing_required_date', label: 'Missing sacrament date', on: true },
  { value: 'invalid_date', label: 'Invalid / unparseable date', on: true },
  { value: 'event_date_in_future', label: 'Event date in the future', on: true },
  { value: 'birth_after_reception', label: 'Birth date after baptism', on: true },
  { value: 'death_after_burial', label: 'Death date after burial', on: true },
  { value: 'implausible_year', label: 'Implausible year', on: true },
  { value: 'ambiguous_date', label: 'Ambiguous date (raw value)', on: false },
  { value: 'inconsistent_raw_date_format', label: 'Inconsistent raw date formats', on: false },
  { value: 'raw_value_differs_from_normalized_value', label: 'Raw value differs from stored value', on: false },
];
const emptyCond = (): Cond => ({ field: 'primary_name', operator: 'contains', value: '', value2: '' });

/** Advanced search: filters builder, record activity, duplicate detection, data-quality checks. */
export function RecordsAdvancedSearchDrawer({ open, onClose, churchId, defaultTypes, clergyOptions, onRun }: Props) {
  const [tab, setTab] = useState<'filters' | 'activity' | 'duplicates' | 'quality'>('filters');
  const [types, setTypes] = useState<RecordType[]>(defaultTypes);
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [conds, setConds] = useState<Cond[]>([emptyCond()]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [clergy, setClergy] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [deleted, setDeleted] = useState<'none' | 'include' | 'only'>('none');
  const [dqRules, setDqRules] = useState<string[]>(DQ_RULES.filter((r) => r.on).map((r) => r.value));
  const [activity, setActivity] = useState({ eventTypes: ['any_activity'] as string[], amount: '7', unit: 'days' });
  const [dup, setDup] = useState({ matchLevel: 'standard' as 'strict' | 'standard' | 'loose', mode: 'record_duplicates' as 'record_duplicates' | 'possible_people' | 'both', ocrOnly: false });
  const [busy, setBusy] = useState(false);

  const toggleType = (t: RecordType) => setTypes((p) => (p.includes(t) ? (p.length > 1 ? p.filter((x) => x !== t) : p) : [...p, t]));

  const buildAst = (): { ast: ParishSearchAst; label: string } => {
    const conditions: any[] = [];
    if (tab === 'filters') {
      conds.forEach((c) => {
        if (['is_empty', 'is_not_empty'].includes(c.operator)) conditions.push({ field: c.field, operator: c.operator });
        else if (c.operator === 'between') { if (c.value && c.value2) conditions.push({ field: c.field, operator: 'between', value: [c.value, c.value2] }); }
        else if (c.value.trim()) conditions.push({ field: c.field, operator: c.operator, value: c.value.trim() });
      });
      if (status) conditions.push({ field: 'status', operator: 'equals', value: status });
      if (clergy) conditions.push({ field: 'clergy', operator: 'contains', value: clergy });
      if (yearFrom || yearTo) conditions.push({ field: 'canonical_event_date', operator: 'between', value: [`${yearFrom || '1000'}-01-01`, `${yearTo || '2999'}-12-31`] });
      return { ast: recordsAst(churchId, types, { filters: { operator: logic, conditions }, textSearch: text.trim() || null, ...(deleted !== 'none' ? { includeDeleted: deleted === 'only' ? 'only' : true } : {}) }), label: deleted === 'only' ? `Deleted records (${conditions.length} filters)` : `Advanced filters (${conditions.length})` };
    }
    if (tab === 'activity') {
      return { ast: recordsAst(churchId, types, { operation: { type: 'record_activity' }, mode: 'record_activity', activity: { eventTypes: activity.eventTypes, relativeWindow: { amount: Number(activity.amount) || 7, unit: activity.unit } }, sort: [{ field: 'canonical_event_date', direction: 'desc' }] }), label: `Activity in the last ${activity.amount} ${activity.unit}` };
    }
    if (tab === 'duplicates') {
      return { ast: recordsAst(churchId, types, { operation: { type: 'duplicate_detection', mode: dup.mode, matchLevel: dup.matchLevel, minimumGroupSize: 2, source: dup.ocrOnly ? 'ocr' : null }, mode: 'duplicate_detection' }), label: `Duplicate detection (${dup.matchLevel})` };
    }
    return { ast: recordsAst(churchId, types, { operation: { type: 'data_quality' }, mode: 'data_quality', rules: dqRules.map((rule) => ({ rule })) }), label: `Data quality (${dqRules.length} rules)` };
  };

  const run = async () => { setBusy(true); try { const { ast, label } = buildAst(); await onRun(ast, label); } finally { setBusy(false); } };

  return (
    <Drawer open={open} onClose={onClose} anchor="right" slotProps={{ backdrop: { invisible: true }, paper: { sx: { width: 1, maxWidth: 480 } } }}>
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Advanced search</Typography>
        <IconButton onClick={onClose}><Iconify icon="mingcute:close-line" /></IconButton>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ px: 2, boxShadow: (t) => `inset 0 -2px 0 0 ${t.vars.palette.divider}` }}>
        <Tab value="filters" label="Filters" /><Tab value="activity" label="Activity" /><Tab value="duplicates" label="Duplicates" /><Tab value="quality" label="Data quality" />
      </Tabs>

      <Scrollbar>
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Record types</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>{RECORD_TYPES.map((t) => <FormControlLabel key={t.value} control={<Checkbox size="small" checked={types.includes(t.value)} onChange={() => toggleType(t.value)} />} label={t.plural} />)}</Box>
          </Box>
          <Divider sx={{ borderStyle: 'dashed' }} />

          {tab === 'filters' && (
            <>
              <TextField size="small" label="Text anywhere" value={text} onChange={(e) => setText(e.target.value)} placeholder="name, place, notes…" />
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: '1fr 1fr' }}>
                <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><MenuItem value="">Any</MenuItem>{RECORD_STATUSES.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</MenuItem>)}</TextField>
                <Autocomplete freeSolo size="small" options={clergyOptions} value={clergy} onInputChange={(_, v) => setClergy(v)} renderInput={(p) => <TextField {...p} label="Clergy" />} />
                <TextField size="small" type="number" label="Year from" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} />
                <TextField size="small" type="number" label="Year to" value={yearTo} onChange={(e) => setYearTo(e.target.value)} />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>Conditions</Typography>
                <TextField select size="small" value={logic} onChange={(e) => setLogic(e.target.value as any)} sx={{ width: 110 }}><MenuItem value="and">Match all</MenuItem><MenuItem value="or">Match any</MenuItem></TextField>
              </Box>
              {conds.map((c, i) => (
                <Box key={i} sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1.3fr 1fr 1fr auto', alignItems: 'center' }}>
                  <TextField select size="small" value={c.field} onChange={(e) => setConds((p) => p.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>{FIELDS.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}</TextField>
                  <TextField select size="small" value={c.operator} onChange={(e) => setConds((p) => p.map((x, j) => (j === i ? { ...x, operator: e.target.value } : x)))}>{OPERATORS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}</TextField>
                  {['is_empty', 'is_not_empty'].includes(c.operator) ? <Box /> : c.operator === 'between' ? (
                    <Box sx={{ display: 'flex', gap: 0.5 }}><TextField size="small" placeholder="from" value={c.value} onChange={(e) => setConds((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} /><TextField size="small" placeholder="to" value={c.value2} onChange={(e) => setConds((p) => p.map((x, j) => (j === i ? { ...x, value2: e.target.value } : x)))} /></Box>
                  ) : <TextField size="small" placeholder="value" value={c.value} onChange={(e) => setConds((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />}
                  <IconButton size="small" onClick={() => setConds((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : [emptyCond()]))}><Iconify icon="mingcute:close-line" width={18} /></IconButton>
                </Box>
              ))}
              <Button size="small" color="inherit" startIcon={<Iconify icon="mingcute:add-line" />} onClick={() => setConds((p) => [...p, emptyCond()])} sx={{ alignSelf: 'flex-start' }}>Add condition</Button>
              <TextField select size="small" label="Deleted records" value={deleted} onChange={(e) => setDeleted(e.target.value as any)}>
                <MenuItem value="none">Hide deleted (default)</MenuItem>
                <MenuItem value="include">Include deleted</MenuItem>
                <MenuItem value="only">Deleted only — for restore</MenuItem>
              </TextField>
            </>
          )}

          {tab === 'activity' && (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Find records by what happened to them — created, modified, imported, verified, deleted or restored — within a time window. This is the audit view across the parish.</Typography>
              <Autocomplete multiple size="small" options={['any_activity', 'created', 'modified', 'imported', 'verified', 'deleted', 'restored']} value={activity.eventTypes} onChange={(_, v) => setActivity((p) => ({ ...p, eventTypes: v.length ? v : ['any_activity'] }))} renderInput={(p) => <TextField {...p} label="Activity" />} />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField size="small" type="number" label="Last" value={activity.amount} onChange={(e) => setActivity((p) => ({ ...p, amount: e.target.value }))} sx={{ width: 110 }} />
                <TextField select size="small" value={activity.unit} onChange={(e) => setActivity((p) => ({ ...p, unit: e.target.value }))} sx={{ flexGrow: 1 }}><MenuItem value="hours">hours</MenuItem><MenuItem value="days">days</MenuItem><MenuItem value="weeks">weeks</MenuItem><MenuItem value="months">months</MenuItem></TextField>
              </Box>
            </>
          )}

          {tab === 'duplicates' && (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Group records that appear to be the same sacrament (or the same person) so they can be reviewed, merged or marked as not duplicates.</Typography>
              <TextField select size="small" label="Match level" value={dup.matchLevel} onChange={(e) => setDup((p) => ({ ...p, matchLevel: e.target.value as any }))}><MenuItem value="strict">Strict — exact names and dates</MenuItem><MenuItem value="standard">Standard — tolerant of spelling/OCR</MenuItem><MenuItem value="loose">Loose — possible matches</MenuItem></TextField>
              <TextField select size="small" label="Mode" value={dup.mode} onChange={(e) => setDup((p) => ({ ...p, mode: e.target.value as any }))}><MenuItem value="record_duplicates">Duplicate records</MenuItem><MenuItem value="possible_people">Possible same person across types</MenuItem><MenuItem value="both">Both</MenuItem></TextField>
              <FormControlLabel control={<Checkbox size="small" checked={dup.ocrOnly} onChange={(e) => setDup((p) => ({ ...p, ocrOnly: e.target.checked }))} />} label="Only records that came from OCR imports" />
            </>
          )}

          {tab === 'quality' && (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Lists records that break a rule, with an explanation for each so they can be corrected.</Typography>
              {DQ_RULES.map((r) => (
                <FormControlLabel key={r.value} control={<Checkbox size="small" checked={dqRules.includes(r.value)} onChange={(e) => setDqRules((p) => (e.target.checked ? [...p, r.value] : p.filter((x) => x !== r.value)))} />} label={r.label} />
              ))}
            </>
          )}
        </Box>
      </Scrollbar>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" loading={busy} disabled={tab === 'quality' && !dqRules.length} onClick={run} startIcon={<Iconify icon="eva:search-fill" />}>Run search</Button>
      </Box>
    </Drawer>
  );
}
