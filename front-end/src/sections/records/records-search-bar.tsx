import type { Theme, SxProps } from '@mui/material/styles';
import type { RecordType, Clarification, SearchExecution, ParishSearchAst, InterpretationChip } from './om-records-api';

import { useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import Radio from '@mui/material/Radio';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import RadioGroup from '@mui/material/RadioGroup';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import InputAdornment from '@mui/material/InputAdornment';
import FormControlLabel from '@mui/material/FormControlLabel';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { parishSearchApi } from './om-records-api';

// ----------------------------------------------------------------------

const SUGGESTIONS = ['Baptisms in 1985', 'Marriages by Fr. James Parsells', 'Funerals this year', 'Records modified this week', 'Duplicate baptism records', 'Baptisms with missing birthplace'];

type Props = {
  churchId: number;
  defaultTypes: RecordType[];
  onResult: (exec: SearchExecution, label: string) => void;
  onOpenAdvanced: () => void;
  sx?: SxProps<Theme>;
};

/**
 * Governed parish search: natural-language query → server-side parse into an AST
 * shown as interpretation chips (with clarification prompts) → execute.
 */
export function RecordsSearchBar({ churchId, defaultTypes, onResult, onOpenAdvanced, sx }: Props) {
  const [query, setQuery] = useState('');
  const [chips, setChips] = useState<InterpretationChip[]>([]);
  const [ast, setAst] = useState<ParishSearchAst | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'parse' | 'run' | null>(null);

  const parse = async (extraAnswers?: Record<string, string>) => {
    if (!query.trim()) return;
    setBusy('parse');
    try {
      const r = await parishSearchApi.parse({ query: query.trim(), churchId, clarificationAnswers: { ...answers, ...(extraAnswers ?? {}) } });
      setChips(r.interpretation ?? []);
      setConfidence(r.confidence ?? null);
      if (r.clarifications?.length) { setClarifications(r.clarifications); setAst(r.ast); return; }
      setClarifications([]);
      if (!r.ast) { toast.warning('Could not interpret that query — try the advanced search.'); return; }
      const scoped = { ...r.ast, scope: { ...r.ast.scope, churchId, recordTypes: r.ast.scope.recordTypes?.length ? r.ast.scope.recordTypes : defaultTypes } };
      setAst(scoped);
      await run(scoped);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(null);
    }
  };

  const run = async (a: ParishSearchAst) => {
    setBusy('run');
    try {
      const exec = await parishSearchApi.execute(a);
      if (exec.unsupported?.message) toast.warning(exec.unsupported.message);
      onResult(exec, query.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(null);
    }
  };

  const removeChip = (chip: InterpretationChip) => {
    if (!ast) return;
    const next: ParishSearchAst = { ...ast, filters: { ...ast.filters, conditions: ast.filters.conditions.filter((c: any) => c.field !== chip.field) } };
    setChips((p) => p.filter((c) => c.id !== chip.id));
    setAst(next);
    run(next);
  };

  return (
    <Card sx={[{ p: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <TextField
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && parse()}
          placeholder='Search your parish records in plain language — e.g. "baptisms in 1985 by Fr. James" or "duplicate marriage records"'
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} /></InputAdornment>, endAdornment: query ? <InputAdornment position="end"><Button size="small" color="inherit" onClick={() => { setQuery(''); setChips([]); setAst(null); setConfidence(null); }}>Clear</Button></InputAdornment> : null } }}
        />
        <Button variant="contained" loading={busy === 'parse' || busy === 'run'} onClick={() => parse()} disabled={!query.trim()} sx={{ flexShrink: 0 }}>Search</Button>
        <Button variant="outlined" color="inherit" onClick={onOpenAdvanced} startIcon={<Iconify icon="ic:round-filter-list" />} sx={{ flexShrink: 0 }}>Advanced</Button>
      </Box>

      <Box sx={{ mt: 1.5, display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
        {chips.length ? (
          <>
            <Typography variant="caption" sx={{ color: 'text.disabled', mr: 0.5 }}>Interpreted as{confidence != null ? ` (${Math.round(confidence * 100)}%)` : ''}:</Typography>
            {chips.map((c) => <Chip key={c.id} size="small" color="info" variant="soft" label={`${c.label}: ${c.value}`} onDelete={c.editable === false ? undefined : () => removeChip(c)} />)}
          </>
        ) : (
          <>
            <Typography variant="caption" sx={{ color: 'text.disabled', mr: 0.5 }}>Try:</Typography>
            {SUGGESTIONS.map((s) => <Chip key={s} size="small" variant="outlined" label={s} onClick={() => setQuery(s)} />)}
          </>
        )}
      </Box>

      <Dialog open={!!clarifications.length} onClose={() => setClarifications([])} fullWidth maxWidth="xs">
        <DialogTitle>Quick clarification</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {clarifications.map((c) => (
            <Box key={c.id}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{c.message}</Typography>
              <RadioGroup value={answers[c.id] ?? c.default ?? ''} onChange={(e) => setAnswers((p) => ({ ...p, [c.id]: e.target.value }))}>
                {c.options.map((o) => <FormControlLabel key={o.id} value={o.id} control={<Radio size="small" />} label={o.label} />)}
              </RadioGroup>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setClarifications([])}>Cancel</Button>
          <Button variant="contained" onClick={() => { const a = { ...answers }; clarifications.forEach((c) => { if (!a[c.id] && c.default) a[c.id] = c.default; }); setAnswers(a); setClarifications([]); parse(a); }}>Continue</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
