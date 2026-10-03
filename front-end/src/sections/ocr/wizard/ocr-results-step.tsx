import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Select from '@mui/material/Select';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import ToggleButton from '@mui/material/ToggleButton';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

import { OcrFinalAuditStep } from './ocr-final-audit-step';
import {
  fetchOcrJob,
  type OmOcrPage,
  ocrJobImageUrl,
  type OmOcrJobDetail,
  type OmOcrSessionSummary,
} from '../om-ocr-api';

// ----------------------------------------------------------------------
// This component serves TWO wizard steps:
// Step 3 — Record Review: field-by-field review of extracted records
// Step 4 — Final Audit: summary of all records, seeding confirmation

type RecordFieldStatus = 'high' | 'medium' | 'low' | 'modified' | 'confirmed' | 'flagged';

type ExtractedField = {
  key: string;
  label: string;
  value: string;
  original?: string;
  confidence: RecordFieldStatus;
  flagged: boolean;
};

type ReviewRecord = {
  jobId: string;
  pageIndex: number;
  fields: ExtractedField[];
  status: 'unreviewed' | 'in-review' | 'reviewed' | 'attention' | 'skipped' | 'rejected';
  rejectReason?: string;
  filename: string;
};

function mapPageToFields(page: OmOcrPage): ExtractedField[] {
  const data: any = page.tableExtractionJson || page.recordCandidates;
  if (!data) return [];
  const records: any[] | null = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows
    : Array.isArray(data?.records) ? data.records : null;
  if (!records || records.length === 0) return [];
  const first = records[0] || {};
  return Object.entries(first).slice(0, 12).map(([key, val]) => ({
    key,
    label: key.replace(/_/g, ' '),
    value: val === null || val === undefined ? '' : String(val),
    confidence: 'high' as RecordFieldStatus,
    flagged: false,
  }));
}

function confidenceColor(c: RecordFieldStatus): 'success' | 'warning' | 'error' | 'info' | 'default' {
  if (c === 'high' || c === 'confirmed') return 'success';
  if (c === 'medium' || c === 'modified') return 'warning';
  if (c === 'low' || c === 'flagged') return 'error';
  return 'default';
}

// ====================================================================
// RECORD REVIEW (step 3)
// ====================================================================

type ReviewProps = {
  churchId: number | null;
  jobIds: string[];
  onBack: () => void;
  onNext: () => void;
  isFinalAudit?: false;
};

function RecordReviewView({ churchId, jobIds, onBack, onNext }: ReviewProps) {
  const [_jobs, setJobs] = useState<OmOcrJobDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filter, setFilter] = useState<'all' | 'attention' | 'reviewed'>('all');
  const [mode, setMode] = useState<'simple' | 'detailed'>('simple');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('Incorrect data');
  const [rejectDetails, setRejectDetails] = useState('');
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  const load = useCallback(async () => {
    if (!churchId) return;
    setLoading(true);
    try {
      const details = await Promise.all(jobIds.map((id) => fetchOcrJob(churchId, id)));
      setJobs(details);
      const recs: ReviewRecord[] = [];
      details.forEach((job) => {
        if (job.pages && job.pages.length > 0) {
          job.pages.forEach((page) => {
            const fields = mapPageToFields(page);
            if (fields.length > 0) {
              recs.push({
                jobId: String(job.id),
                pageIndex: page.pageIndex,
                fields,
                status: 'unreviewed',
                filename: job.original_filename || `Job #${job.id}`,
              });
            }
          });
        } else if (job.ocr_text || job.ocr_result) {
          recs.push({
            jobId: String(job.id),
            pageIndex: 0,
            fields: job.ocr_result
              ? Object.entries(job.ocr_result).slice(0, 12).map(([key, val]) => ({
                  key,
                  label: key.replace(/_/g, ' '),
                  value: val === null || val === undefined ? '' : String(val),
                  confidence: 'high' as RecordFieldStatus,
                  flagged: false,
                }))
              : [],
            status: 'unreviewed',
            filename: job.original_filename || `Job #${job.id}`,
          });
        }
      });
      setRecords(recs.length > 0 ? recs : jobIds.map((id) => ({
        jobId: id,
        pageIndex: 0,
        fields: [],
        status: 'unreviewed' as const,
        filename: `Job #${id}`,
      })));
    } finally {
      setLoading(false);
    }
  }, [churchId, jobIds]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRecords = useMemo(() => {
    if (filter === 'attention') return records.filter((r) => r.status === 'attention' || r.status === 'in-review' || r.fields.some((f) => f.flagged));
    if (filter === 'reviewed') return records.filter((r) => r.status === 'reviewed' || r.status === 'skipped');
    return records;
  }, [records, filter]);

  const currentRecord = filteredRecords[currentIndex] ?? filteredRecords[0];

  const attentionCount = records.filter((r) => r.status === 'attention' || r.fields.some((f) => f.flagged)).length;
  const reviewedCount = records.filter((r) => r.status === 'reviewed' || r.status === 'skipped').length;
  const canFinalize = records.every((r) => r.status === 'reviewed' || r.status === 'skipped' || r.status === 'rejected');

  const updateField = (fieldKey: string, value: string) => {
    setRecords((prev) =>
      prev.map((r) =>
        r === currentRecord
          ? { ...r, status: 'in-review', fields: r.fields.map((f) => f.key === fieldKey ? { ...f, value, original: f.original ?? f.value, confidence: 'modified' } : f) }
          : r,
      ),
    );
  };

  const toggleFlag = (fieldKey: string) => {
    setRecords((prev) =>
      prev.map((r) =>
        r === currentRecord
          ? { ...r, status: 'attention', fields: r.fields.map((f) => f.key === fieldKey ? { ...f, flagged: !f.flagged } : f) }
          : r,
      ),
    );
  };

  const confirmRecord = () => {
    setRecords((prev) =>
      prev.map((r) =>
        r === currentRecord
          ? { ...r, status: 'reviewed', fields: r.fields.map((f) => ({ ...f, confidence: 'confirmed', flagged: false })) }
          : r,
      ),
    );
    if (currentIndex < filteredRecords.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const skipRecord = () => {
    setRecords((prev) => prev.map((r) => r === currentRecord ? { ...r, status: 'skipped' } : r));
    if (currentIndex < filteredRecords.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const rejectRecord = () => {
    setRecords((prev) =>
      prev.map((r) =>
        r === currentRecord
          ? { ...r, status: 'rejected', rejectReason: `${rejectReason}${rejectDetails ? `: ${rejectDetails}` : ''}` }
          : r,
      ),
    );
    setRejectOpen(false);
    setRejectDetails('');
    if (currentIndex < filteredRecords.length - 1) setCurrentIndex(currentIndex + 1);
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (rejectOpen || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'a') confirmRecord();
      if (key === 's') skipRecord();
      if (key === 'r') setRejectOpen(true);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shortcuts use latest record handlers
  }, [rejectOpen, currentIndex, filteredRecords.length, records]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5">Record Review & Correction</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {records.length} record{records.length !== 1 ? 's' : ''} extracted — focus on the records that need a human eye.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            variant="contained"
            disabled={!canFinalize}
            endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
            onClick={onNext}
          >
            Final audit
          </Button>
          {!canFinalize && (
            <Typography variant="caption" color="text.secondary">
              {records.length - reviewedCount} records still need review
            </Typography>
          )}
        </Stack>
      </Stack>

      {/* Review mode cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
        {[
          { key: 'simple' as const, label: 'Simple Review', desc: 'Review extracted information without opening the original scanned pages.', icon: 'solar:eye-bold' },
          { key: 'detailed' as const, label: 'Detailed Review', desc: 'Compare extracted data directly against the original source page.', icon: 'solar:document-text-bold' },
        ].map((m) => (
          <Card
            key={m.key}
            variant="outlined"
            onClick={() => setMode(m.key)}
            sx={{
              p: 2,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              borderColor: mode === m.key ? 'primary.main' : 'divider',
              borderWidth: mode === m.key ? 2 : 1,
              bgcolor: mode === m.key ? 'primary.darker' : 'background.paper',
              color: mode === m.key ? 'white' : 'text.primary',
              '&:hover': mode !== m.key ? { borderColor: 'primary.light' } : {},
            }}
          >
            <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: mode === m.key ? 'rgba(255,255,255,0.12)' : 'primary.lighter', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Iconify icon={m.icon as any} width={20} sx={{ color: mode === m.key ? 'white' : 'primary.dark' }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2">{m.label}</Typography>
              <Typography variant="caption" sx={{ color: mode === m.key ? 'grey.400' : 'text.secondary' }}>{m.desc}</Typography>
            </Box>
            {mode === m.key && <Iconify icon="eva:checkmark-fill" width={20} sx={{ ml: 'auto', flexShrink: 0 }} />}
          </Card>
        ))}
      </Box>

      {/* Summary chips */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Chip label={`${records.length} records`} color="info" size="small" variant="soft" />
        <Chip label={`${records.length - reviewedCount} require review`} color="info" size="small" variant="soft" />
        <Chip label={`${attentionCount} need attention`} color="warning" size="small" variant="soft" />
      </Stack>

      {/* Navigation bar */}
      <Card sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="subtitle2">
          Record {filteredRecords.length ? currentIndex + 1 : 0} of {filteredRecords.length}
        </Typography>
        <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => { if (v) { setFilter(v); setCurrentIndex(0); } }}>
          <ToggleButton value="all" selected={filter === 'all'}>All ({records.length})</ToggleButton>
          <ToggleButton value="attention" selected={filter === 'attention'}>Attention ({attentionCount})</ToggleButton>
          <ToggleButton value="reviewed" selected={filter === 'reviewed'}>Reviewed ({reviewedCount})</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" spacing={0.5}>
          <IconButton size="small" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>
            <Iconify icon="eva:arrow-ios-back-fill" />
          </IconButton>
          <IconButton size="small" disabled={currentIndex >= filteredRecords.length - 1} onClick={() => setCurrentIndex((i) => Math.min(filteredRecords.length - 1, i + 1))}>
            <Iconify icon="eva:arrow-ios-forward-fill" />
          </IconButton>
        </Stack>
      </Card>

      {/* Record workspace */}
      {!currentRecord || filteredRecords.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center' }}>
          <Iconify icon={'solar:document-text-bold' as any} width={48} sx={{ color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6">No records in this filter</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Try &quot;All&quot; or &quot;Reviewed&quot;, or continue to final audit when records are confirmed.
          </Typography>
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', mt: 3 }}>
            <Button variant="outlined" color="inherit" onClick={() => setFilter('all')}>View all records</Button>
            <Button variant="contained" disabled={!canFinalize} onClick={onNext}>Continue to final audit</Button>
          </Stack>
        </Card>
      ) : mode === 'detailed' ? (
        /* Detailed mode — split layout: source image + fields */
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            {/* Source viewer */}
            <Box sx={{ borderRight: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" spacing={0.5} sx={{ p: 1, bgcolor: 'background.neutral', flexWrap: 'wrap', alignItems: 'center' }}>
                <IconButton size="small" onClick={() => setZoom((v) => Math.max(25, v - 10))}><Iconify icon={'eva:minus-fill' as any} /></IconButton>
                <Typography variant="caption">{zoom}%</Typography>
                <IconButton size="small" onClick={() => setZoom((v) => Math.min(200, v + 10))}><Iconify icon={'eva:plus-fill' as any} /></IconButton>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <IconButton size="small" onClick={() => setRotation((r) => r - 90)}><Iconify icon="solar:restart-bold" sx={{ transform: 'scaleX(-1)' }} /></IconButton>
                <IconButton size="small" onClick={() => setRotation((r) => r + 90)}><Iconify icon="solar:restart-bold" /></IconButton>
              </Stack>
              <Box sx={{ height: 450, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100' }}>
                {churchId ? (
                  <Box
                    component="img"
                    src={ocrJobImageUrl(churchId, currentRecord.jobId)}
                    alt={currentRecord.filename}
                    sx={{ maxWidth: '100%', maxHeight: '100%', transform: `scale(${zoom / 100}) rotate(${rotation}deg)`, transition: 'transform 0.2s', objectFit: 'contain' }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">No image available</Typography>
                )}
              </Box>
            </Box>
            {/* Fields panel */}
            <Box>
              <RecordFieldsPanel
                record={currentRecord}
                onUpdate={updateField}
                onToggleFlag={toggleFlag}
                onConfirm={confirmRecord}
                onSkip={skipRecord}
                onReject={() => setRejectOpen(true)}
              />
            </Box>
          </Box>
        </Card>
      ) : (
        /* Simple mode — fields only */
        <Card sx={{ p: 0, overflow: 'hidden' }}>
          <RecordFieldsPanel
            record={currentRecord}
            onUpdate={updateField}
            onToggleFlag={toggleFlag}
            onConfirm={confirmRecord}
            onSkip={skipRecord}
            onReject={() => setRejectOpen(true)}
          />
        </Card>
      )}

      {/* Keyboard hints */}
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'center' }}>
        {[
          { key: 'A', label: 'Accept' },
          { key: 'S', label: 'Skip' },
          { key: 'R', label: 'Reject' },
        ].map((hint) => (
          <Stack key={hint.key} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Chip label={hint.key} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontWeight: 700, minWidth: 28 }} />
            <Typography variant="caption" color="text.secondary">{hint.label}</Typography>
          </Stack>
        ))}
      </Stack>

      {/* Back */}
      <Box>
        <Button color="inherit" variant="outlined" startIcon={<Iconify icon="eva:arrow-ios-back-fill" />} onClick={onBack}>
          Back to processing
        </Button>
      </Box>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reject record?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            The extracted data will be retained with the rejection reason.
          </Typography>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <Select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
              {['Incorrect data', 'Unreadable source', 'Duplicate entry', 'Not a parish record', 'Incomplete extraction', 'Other'].map((r) => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField fullWidth multiline rows={3} label="Additional details" placeholder="Optional context" value={rejectDetails} onChange={(e) => setRejectDetails(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="inherit" onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={rejectRecord}>Reject record</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// Fields panel shared between simple and detailed modes
function RecordFieldsPanel({
  record,
  onUpdate,
  onToggleFlag,
  onConfirm,
  onSkip,
  onReject,
}: {
  record: ReviewRecord;
  onUpdate: (key: string, value: string) => void;
  onToggleFlag: (key: string) => void;
  onConfirm: () => void;
  onSkip: () => void;
  onReject: () => void;
}) {
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ p: 2, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2">{record.filename}</Typography>
        <Label color={record.status === 'reviewed' ? 'success' : record.status === 'attention' ? 'warning' : record.status === 'rejected' ? 'error' : 'default'} variant="soft">
          {record.status.replace(/-/g, ' ')}
        </Label>
      </Stack>
      <Box sx={{ p: 2, maxHeight: 400, overflow: 'auto' }}>
        {record.fields.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            No extracted fields available for this record yet. Processing may still be in progress.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {record.fields.map((field) => (
              <Stack key={field.key} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'capitalize', display: 'block', mb: 0.5 }}>
                    {field.label}
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={field.value}
                    onChange={(e) => onUpdate(field.key, e.target.value)}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <Label
                            color={confidenceColor(field.confidence)}
                            variant="soft"
                            sx={{ fontSize: '0.6rem', height: 20, minWidth: 0, px: 0.75 }}
                          >
                            {field.confidence === 'high' ? 'High' : field.confidence === 'confirmed' ? 'OK' : field.confidence === 'modified' ? 'Mod' : field.confidence}
                          </Label>
                        ),
                      },
                    }}
                    sx={{
                      ...(field.flagged && { '& .MuiOutlinedInput-root': { borderColor: 'error.main' } }),
                    }}
                  />
                  {field.original && field.original !== field.value && (
                    <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.25, display: 'block' }}>
                      Original: {field.original}
                    </Typography>
                  )}
                </Box>
                <IconButton
                  size="small"
                  color={field.flagged ? 'error' : 'default'}
                  onClick={() => onToggleFlag(field.key)}
                  sx={{ mt: 2.5 }}
                >
                  <Iconify icon={(field.flagged ? 'solar:flag-bold' : 'solar:flag-line-duotone') as any} width={18} />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>
      <Divider />
      <Stack direction="row" spacing={1} sx={{ p: 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="error" size="small" onClick={onReject}>Reject</Button>
        <Button variant="outlined" color="inherit" size="small" onClick={onSkip}>Skip for now</Button>
        <Button variant="contained" size="small" startIcon={<Iconify icon="eva:checkmark-fill" />} onClick={onConfirm}>Confirm record</Button>
      </Stack>
    </>
  );
}

type FinalAuditProps = {
  churchId: number | null;
  jobIds: string[];
  isFinalAudit: true;
  summary?: OmOcrSessionSummary;
  onUploadMore?: () => void;
  onGoToRecords?: () => void;
};

type Props = ReviewProps | FinalAuditProps;

export function OcrResultsStep(props: Props) {
  if ('isFinalAudit' in props && props.isFinalAudit) {
    const { summary, onUploadMore, onGoToRecords } = props as FinalAuditProps;
    return <OcrFinalAuditStep summary={summary} onUploadMore={onUploadMore} onGoToRecords={onGoToRecords} />;
  }
  return <RecordReviewView {...(props as ReviewProps)} />;
}
