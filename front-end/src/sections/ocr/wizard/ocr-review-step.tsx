import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Slider from '@mui/material/Slider';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Select from '@mui/material/Select';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ButtonGroup from '@mui/material/ButtonGroup';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import ToggleButton from '@mui/material/ToggleButton';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

import {
  fetchOcrJobs,
  type OmOcrJob,
  ocrJobImageUrl,
} from '../om-ocr-api';

// ----------------------------------------------------------------------
// Image Review — three-column layout:
// 1. Page thumbnail sidebar
// 2. Image viewer with zoom/rotate toolbar
// 3. Batch quality / issues sidebar

type ImageQuality = 'good' | 'needs-review' | 'flagged' | 'duplicate' | 'failed';

type ReviewPage = {
  job: OmOcrJob;
  quality: ImageQuality;
  accepted: boolean;
  issue?: string;
};

function qualityLabel(q: ImageQuality): string {
  switch (q) {
    case 'good': return 'Good quality';
    case 'needs-review': return 'Needs review';
    case 'flagged': return 'Flagged';
    case 'duplicate': return 'Duplicate';
    case 'failed': return 'Failed upload';
    default: return q;
  }
}

function qualityColor(q: ImageQuality): 'success' | 'warning' | 'info' | 'error' | 'default' {
  if (q === 'good') return 'success';
  if (q === 'needs-review' || q === 'flagged') return 'warning';
  if (q === 'duplicate') return 'info';
  if (q === 'failed') return 'error';
  return 'default';
}

type Props = {
  churchId: number | null;
  jobIds: string[];
  onBack: () => void;
  onNext: () => void;
};

export function OcrReviewStep({ churchId, jobIds, onBack, onNext }: Props) {
  const [pages, setPages] = useState<ReviewPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<'all' | 'flagged'>('all');
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState('Glare');
  const [flagNotes, setFlagNotes] = useState('');

  const load = useCallback(async () => {
    if (!churchId) return;
    try {
      const all = await fetchOcrJobs(churchId, { limit: 200 });
      const matched = all.filter((job) => jobIds.includes(String(job.id)));
      setPages(matched.map((job) => ({
        job,
        quality: 'good' as ImageQuality,
        accepted: true,
      })));
    } finally {
      setLoading(false);
    }
  }, [churchId, jobIds]);

  useEffect(() => {
    load();
  }, [load]);

  const flaggedPages = useMemo(
    () => pages.filter((p) => p.quality !== 'good'),
    [pages],
  );

  const visiblePages = filter === 'all' ? pages : flaggedPages;
  const selectedPage = visiblePages[selectedIndex] ?? visiblePages[0] ?? pages[0];

  const counts = useMemo(() => {
    const c = { good: 0, flagged: 0, duplicate: 0, failed: 0 };
    pages.forEach((p) => {
      if (p.quality === 'good') c.good += 1;
      else if (p.quality === 'duplicate') c.duplicate += 1;
      else if (p.quality === 'failed') c.failed += 1;
      else c.flagged += 1;
    });
    return c;
  }, [pages]);

  const acceptPage = () => {
    if (!selectedPage) return;
    setPages((prev) =>
      prev.map((p) =>
        p.job.id === selectedPage.job.id ? { ...p, quality: 'good', accepted: true, issue: undefined } : p,
      ),
    );
    if (selectedIndex < visiblePages.length - 1) setSelectedIndex(selectedIndex + 1);
  };

  const submitFlag = () => {
    if (!selectedPage) return;
    const q: ImageQuality = flagReason === 'Duplicate' ? 'duplicate' : flagReason === 'Unreadable' ? 'failed' : 'flagged';
    setPages((prev) =>
      prev.map((p) =>
        p.job.id === selectedPage.job.id
          ? { ...p, quality: q, accepted: false, issue: `${flagReason}${flagNotes ? ` — ${flagNotes}` : ''}` }
          : p,
      ),
    );
    setFlagOpen(false);
    setFlagNotes('');
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (pages.length === 0) {
    return (
      <Stack spacing={3}>
        <Alert severity="info">No images found for this upload.</Alert>
        <Button color="inherit" variant="outlined" startIcon={<Iconify icon="eva:arrow-ios-back-fill" />} onClick={onBack}>
          Back
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5">Image Review</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Review source pages before extraction begins — {pages.length} page{pages.length !== 1 ? 's' : ''} uploaded.
          </Typography>
        </Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, v) => { if (v) { setFilter(v); setSelectedIndex(0); } }}
        >
          <ToggleButton value="all" selected={filter === 'all'}>
            All pages ({pages.length})
          </ToggleButton>
          <ToggleButton value="flagged" selected={filter === 'flagged'}>
            Flagged ({flaggedPages.length})
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {/* 3-column layout */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '120px 1fr 280px' }, gap: 2, alignItems: 'start' }}>
        {/* Thumbnail sidebar */}
        <Card sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 700, overflow: 'auto' }}>
          {visiblePages.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              <Iconify icon={'solar:gallery-bold' as any} width={32} sx={{ mb: 1, opacity: 0.5 }} />
              <Typography variant="caption" sx={{ display: 'block' }}>No flagged pages</Typography>
              <Button size="small" variant="text" onClick={() => setFilter('all')}>View all</Button>
            </Box>
          ) : (
            visiblePages.map((page, idx) => (
              <Card
                key={page.job.id}
                variant="outlined"
                onClick={() => setSelectedIndex(idx)}
                sx={{
                  p: 0.75,
                  cursor: 'pointer',
                  textAlign: 'center',
                  borderColor: selectedPage?.job.id === page.job.id ? 'primary.main' : 'divider',
                  borderWidth: selectedPage?.job.id === page.job.id ? 2 : 1,
                  position: 'relative',
                  '&:hover': { borderColor: 'primary.light' },
                }}
              >
                <Box
                  component="img"
                  src={churchId ? ocrJobImageUrl(churchId, page.job.id) : ''}
                  alt={page.job.original_filename}
                  sx={{ width: 1, height: 80, objectFit: 'cover', borderRadius: 0.5, bgcolor: 'background.neutral' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5 }}>
                  Page {String(idx + 1).padStart(2, '0')}
                </Typography>
                <Box
                  sx={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: '2px solid white',
                    bgcolor: `${qualityColor(page.quality)}.main`,
                  }}
                />
              </Card>
            ))
          )}
        </Card>

        {/* Image viewer */}
        <Card sx={{ overflow: 'hidden' }}>
          {/* Viewer header */}
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="h6">
              Page {String((selectedPage ? pages.indexOf(selectedPage) : 0) + 1).padStart(2, '0')}
            </Typography>
            {selectedPage && (
              <Label color={qualityColor(selectedPage.quality)} variant="soft">
                {qualityLabel(selectedPage.quality)}
              </Label>
            )}
          </Stack>

          {/* Toolbar */}
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, p: 1, px: 2, bgcolor: 'background.neutral', flexWrap: 'wrap' }}>
            <IconButton size="small" onClick={() => setZoom((v) => Math.max(25, v - 10))}>
              <Iconify icon={'eva:minus-fill' as any} />
            </IconButton>
            <Slider
              size="small"
              value={zoom}
              min={25}
              max={200}
              onChange={(_, v) => setZoom(v as number)}
              sx={{ width: 100, mx: 1 }}
            />
            <IconButton size="small" onClick={() => setZoom((v) => Math.min(200, v + 10))}>
              <Iconify icon={'eva:plus-fill' as any} />
            </IconButton>
            <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'center' }}>{zoom}%</Typography>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <ButtonGroup size="small" variant="outlined" color="inherit">
              <Button onClick={() => setZoom(100)}>Fit Width</Button>
              <Button onClick={() => setZoom(75)}>Fit Page</Button>
            </ButtonGroup>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <IconButton size="small" onClick={() => setRotation((r) => r - 90)}>
              <Iconify icon="solar:restart-bold" sx={{ transform: 'scaleX(-1)' }} />
            </IconButton>
            <IconButton size="small" onClick={() => setRotation((r) => r + 90)}>
              <Iconify icon="solar:restart-bold" />
            </IconButton>
          </Stack>

          {/* Image display */}
          <Box sx={{ height: 460, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100' }}>
            {selectedPage && churchId ? (
              <Box
                component="img"
                src={ocrJobImageUrl(churchId, selectedPage.job.id)}
                alt={selectedPage.job.original_filename}
                sx={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                  transition: 'transform 0.2s ease',
                  objectFit: 'contain',
                }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">No image selected</Typography>
            )}
          </Box>

          {/* Info message */}
          <Alert
            severity={counts.failed > 0 ? 'error' : flaggedPages.length > 0 ? 'warning' : 'success'}
            sx={{ borderRadius: 0 }}
          >
            {counts.failed > 0
              ? `${counts.failed} page(s) must be replaced before processing.`
              : flaggedPages.length > 0
                ? `${flaggedPages.length} page issue(s) retained for operator review.`
                : 'All pages passed automated checks. Manual inspection is optional.'}
          </Alert>

          {/* Page actions */}
          <Stack direction="row" spacing={1} sx={{ p: 2 }}>
            <Button variant="contained" startIcon={<Iconify icon="eva:checkmark-fill" />} onClick={acceptPage}>
              Accept Page
            </Button>
            <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:flag-bold" />} onClick={() => setFlagOpen(true)}>
              Flag Issue
            </Button>
          </Stack>
        </Card>

        {/* Quality sidebar */}
        <Stack spacing={2}>
          <Card sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>Batch summary</Typography>
            {[
              { label: 'Total pages', value: pages.length, color: 'text.primary' },
              { label: 'Passed', value: counts.good, color: 'success.main' },
              { label: 'Flagged', value: counts.flagged, color: 'warning.main' },
              { label: 'Duplicates', value: counts.duplicate, color: 'info.main' },
              { label: 'Failed', value: counts.failed, color: 'error.main' },
            ].map((item) => (
              <Stack key={item.label} direction="row" sx={{ justifyContent: 'space-between', py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">{item.label}</Typography>
                <Typography variant="subtitle2" sx={{ color: item.color }}>{item.value}</Typography>
              </Stack>
            ))}
          </Card>

          <Card sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
              <Iconify icon={'solar:document-text-bold' as any} width={18} />
              <Typography variant="subtitle1">Issues found</Typography>
            </Stack>
            {flaggedPages.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                No job-level issues on these pages.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {flaggedPages.map((page) => {
                  const pageIdx = pages.indexOf(page);
                  return (
                    <Card
                      key={page.job.id}
                      variant="outlined"
                      onClick={() => {
                        setFilter('all');
                        setSelectedIndex(pageIdx);
                      }}
                      sx={{ p: 1, cursor: 'pointer', bgcolor: 'warning.lighter', '&:hover': { bgcolor: 'warning.light' } }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        Page {String(pageIdx + 1).padStart(2, '0')}
                      </Typography>
                      {page.issue && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'warning.dark' }}>
                          {page.issue}
                        </Typography>
                      )}
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Card>

          <Button
            variant="contained"
            size="large"
            fullWidth
            disabled={counts.failed > 0}
            endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
            onClick={onNext}
          >
            Continue to processing
          </Button>
          {counts.failed > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              Replace failed uploads before continuing.
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Back button */}
      <Box>
        <Button color="inherit" variant="outlined" startIcon={<Iconify icon="eva:arrow-ios-back-fill" />} onClick={onBack}>
          Back to upload
        </Button>
      </Box>

      {/* Flag dialog */}
      <Dialog open={flagOpen} onClose={() => setFlagOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          Flag page {selectedPage ? String(pages.indexOf(selectedPage) + 1).padStart(2, '0') : ''}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Record the image issue before extraction begins.
          </Typography>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <Select value={flagReason} onChange={(e) => setFlagReason(e.target.value)}>
              {['Blur', 'Glare', 'Bad crop', 'Wrong orientation', 'Duplicate', 'Not a record page', 'Unreadable', 'Other'].map((r) => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Optional notes"
            placeholder="Add context for this issue"
            value={flagNotes}
            onChange={(e) => setFlagNotes(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="inherit" onClick={() => setFlagOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={submitFlag}>Flag page</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
