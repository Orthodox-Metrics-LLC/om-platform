import type { OmOcrSessionSummary } from '../om-ocr-api';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

type Props = {
  summary: OmOcrSessionSummary;
  onUploadMore: () => void;
  onGoToUploadRecords: () => void;
};

const STAT_TILES: {
  key: keyof OmOcrSessionSummary;
  label: string;
  icon: string;
  color: 'primary' | 'success' | 'warning' | 'error';
}[] = [
  { key: 'totalImages', label: 'Images uploaded', icon: 'solar:gallery-wide-bold-duotone', color: 'primary' },
  { key: 'completed', label: 'Completed', icon: 'solar:check-circle-bold-duotone', color: 'success' },
  { key: 'readyForReview', label: 'Ready for review', icon: 'solar:clipboard-check-bold-duotone', color: 'warning' },
  { key: 'failed', label: 'Failed', icon: 'solar:close-circle-bold-duotone', color: 'error' },
];

export function OcrResultsStep({ summary, onUploadMore, onGoToUploadRecords }: Props) {
  return (
    <Stack spacing={3}>
      <Grid container spacing={2}>
        {STAT_TILES.map((tile) => (
          <Grid key={tile.key} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ p: 3, textAlign: 'center' }}>
              <Box sx={{ width: 48, height: 48, mx: 'auto', mb: 2 }}>
                <Iconify icon={tile.icon as any} width={48} sx={{ color: `${tile.color}.main` }} />
              </Box>
              <Typography variant="h3">{summary[tile.key]}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {tile.label}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ p: 3, textAlign: 'center' }}>
        <Iconify icon={'solar:document-text-bold-duotone' as any} width={56} sx={{ color: 'primary.main', mb: 2 }} />
        <Typography variant="h6">
          {summary.recordsFound > 0
            ? `${summary.recordsFound} record${summary.recordsFound === 1 ? '' : 's'} detected so far`
            : 'Your upload is on its way through OCR'}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          Head to Upload Records to track processing and review detected records once they&apos;re ready.
        </Typography>

        <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', mt: 3 }}>
          <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:add-circle-bold" />} onClick={onUploadMore}>
            Upload more
          </Button>
          <Button variant="contained" endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />} onClick={onGoToUploadRecords}>
            Go to Upload Records
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}
