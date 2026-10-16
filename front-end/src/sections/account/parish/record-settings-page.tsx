import React, { useMemo, useState, useEffect } from 'react';

/**
 * Record table headers for baptism, marriage, and funeral books.
 * Persists under parish settings category `ui` as recordFieldHeaders.
 */
import {
  Box,
  Tab,
  Chip,
  Tabs,
  Alert,
  Paper,
  Stack,
  Table,
  Button,
  Switch,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  IconButton,
  Typography,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { useParishSettings } from './use-parish-settings';
import { RestartAltIcon, ArrowUpwardIcon, SaveOutlinedIcon, ArrowDownwardIcon } from './parish-icons';

type RecordTypeKey = 'baptism' | 'marriage' | 'funeral';

type FieldRow = {
  key: string;
  label: string;
  headerLabel: string;
  required: boolean;
  visible: boolean;
  sortOrder: number;
};

const RECORD_TYPES: Array<{ key: RecordTypeKey; label: string }> = [
  { key: 'baptism', label: 'Baptism' },
  { key: 'marriage', label: 'Marriage' },
  { key: 'funeral', label: 'Funeral' },
];

const DEFAULTS: Record<RecordTypeKey, FieldRow[]> = {
  baptism: [
    { key: 'first_name', label: 'First Name', headerLabel: 'First Name', required: true, visible: true, sortOrder: 0 },
    { key: 'last_name', label: 'Last Name', headerLabel: 'Last Name', required: true, visible: true, sortOrder: 1 },
    { key: 'reception_date', label: 'Baptism Date', headerLabel: 'Date of Baptism', required: true, visible: true, sortOrder: 2 },
    { key: 'father_name', label: 'Father', headerLabel: "Father's Name", required: false, visible: true, sortOrder: 3 },
    { key: 'mother_name', label: 'Mother', headerLabel: "Mother's Name", required: false, visible: true, sortOrder: 4 },
    { key: 'sponsors', label: 'Sponsors', headerLabel: 'Sponsors / Godparents', required: false, visible: false, sortOrder: 5 },
    { key: 'clergy', label: 'Priest', headerLabel: 'Officiating Priest', required: false, visible: true, sortOrder: 6 },
  ],
  marriage: [
    { key: 'fname_groom', label: "Groom's First Name", headerLabel: 'Groom First', required: true, visible: true, sortOrder: 0 },
    { key: 'lname_groom', label: "Groom's Last Name", headerLabel: 'Groom Last', required: true, visible: true, sortOrder: 1 },
    { key: 'fname_bride', label: "Bride's First Name", headerLabel: 'Bride First', required: true, visible: true, sortOrder: 2 },
    { key: 'lname_bride', label: "Bride's Last Name", headerLabel: 'Bride Last', required: true, visible: true, sortOrder: 3 },
    { key: 'mdate', label: 'Marriage Date', headerLabel: 'Date of Marriage', required: true, visible: true, sortOrder: 4 },
    { key: 'witness', label: 'Witnesses', headerLabel: 'Witnesses', required: false, visible: false, sortOrder: 5 },
    { key: 'clergy', label: 'Priest', headerLabel: 'Officiating Priest', required: false, visible: true, sortOrder: 6 },
  ],
  funeral: [
    { key: 'name', label: 'First Name', headerLabel: 'First Name', required: true, visible: true, sortOrder: 0 },
    { key: 'lastname', label: 'Last Name', headerLabel: 'Last Name', required: true, visible: true, sortOrder: 1 },
    { key: 'deceased_date', label: 'Date of Death', headerLabel: 'Date of Death', required: true, visible: true, sortOrder: 2 },
    { key: 'burial_date', label: 'Burial Date', headerLabel: 'Burial Date', required: false, visible: true, sortOrder: 3 },
    { key: 'burial_location', label: 'Burial Location', headerLabel: 'Cemetery / Location', required: false, visible: false, sortOrder: 4 },
    { key: 'clergy', label: 'Priest', headerLabel: 'Officiating Priest', required: false, visible: true, sortOrder: 5 },
  ],
};

function cloneDefaults(): Record<RecordTypeKey, FieldRow[]> {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function reorderRows(rows: FieldRow[], from: number, dir: -1 | 1): FieldRow[] {
  const to = from + dir;
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next.map((r, idx) => ({ ...r, sortOrder: idx }));
}

const RecordSettingsPage: React.FC = () => {
  const { data, loading, saving, error, patch } = useParishSettings<{
    recordFieldHeaders?: Record<RecordTypeKey, FieldRow[]>;
  }>('ui');
  const [activeType, setActiveType] = useState<RecordTypeKey>('baptism');
  const [config, setConfig] = useState(cloneDefaults);
  const [baseline, setBaseline] = useState(cloneDefaults);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loading || loaded) return;
    const saved = data.recordFieldHeaders;
    if (saved) {
      setConfig(saved);
      setBaseline(JSON.parse(JSON.stringify(saved)));
    }
    setLoaded(true);
  }, [loading, loaded, data.recordFieldHeaders]);

  const rows = config[activeType];
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(baseline), [config, baseline]);

  const updateRow = (idx: number, changes: Partial<FieldRow>) => {
    setConfig((prev) => {
      const nextRows = prev[activeType].map((r, i) => (i === idx ? { ...r, ...changes } : r));
      return { ...prev, [activeType]: nextRows };
    });
  };

  const moveRow = (idx: number, dir: -1 | 1) => {
    setConfig((prev) => ({ ...prev, [activeType]: reorderRows(prev[activeType], idx, dir) }));
  };

  const handleReset = () => setConfig(cloneDefaults());

  const handleSave = async () => {
    const ok = await patch({ recordFieldHeaders: config });
    if (!ok) return;
    setBaseline(JSON.parse(JSON.stringify(config)));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5 }}>
            Record table headers
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Match your parish ledger columns for baptism, marriage, and funeral books. Set display labels,
            printed headers, and which fields appear during OCR review.
          </Typography>
          {loading && <Chip size="small" label="Loading saved headers" variant="outlined" sx={{ mt: 1.5 }} />}
        </Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={handleReset}>
            Reset
          </Button>
          <Button
            variant="contained"
            size="large"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save configuration'}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {savedFlash && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Record field configuration saved.
        </Alert>
      )}
      {dirty && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Unsaved changes
        </Typography>
      )}

      <Paper
        sx={{
          borderRadius: 2,
          overflow: 'hidden',
          mb: 2,
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: (theme) => theme.shadows[1],
        }}
      >
        <Tabs
          value={activeType}
          onChange={(_, v) => setActiveType(v)}
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          {RECORD_TYPES.map((rt) => (
            <Tab key={rt.key} value={rt.key} label={rt.label} sx={{ textTransform: 'none', fontWeight: 600 }} />
          ))}
        </Tabs>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 72 }} />
                <TableCell sx={{ fontWeight: 700, width: 160 }}>Field key</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Display label</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Ledger header (as printed)</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 90 }} align="center">
                  Required
                </TableCell>
                <TableCell sx={{ fontWeight: 700, width: 90 }} align="center">
                  Visible
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow key={row.key} sx={{ opacity: row.visible ? 1 : 0.55 }}>
                  <TableCell>
                    <Stack direction="row" spacing={0}>
                      <IconButton size="small" disabled={idx === 0} onClick={() => moveRow(idx, -1)}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" disabled={idx === rows.length - 1} onClick={() => moveRow(idx, 1)}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {row.key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={row.label}
                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={row.headerLabel}
                      onChange={(e) => updateRow(idx, { headerLabel: e.target.value })}
                      placeholder="Column heading on ledger"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={row.required}
                      onChange={(e) => updateRow(idx, { required: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={row.visible}
                      onChange={(e) => updateRow(idx, { visible: e.target.checked })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Alert severity="info">
        These settings apply to OCR review, agent extraction labels, and field highlights. Re-run the agent on
        existing jobs after changing headers so labels stay in sync.
      </Alert>
    </Box>
  );
};

export default RecordSettingsPage;
