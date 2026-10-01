import { useNavigate } from 'react-router';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import CardContent from '@mui/material/CardContent';

import { paths } from 'src/routes/paths';

import { Iconify } from 'src/components/iconify';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { OcrUploadPanel } from './ocr-upload-panel';

// ----------------------------------------------------------------------

type Props = {
  churchId: number | null;
};

export function OcrUploadView({ churchId }: Props) {
  const navigate = useNavigate();

  return (
    <Box sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
      <CustomBreadcrumbs
        heading="New OCR upload"
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'Upload Records', href: paths.dashboard.ocr.root },
          { name: 'New upload' },
        ]}
        action={
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<Iconify icon={'solar:arrow-left-bold' as any} />}
            onClick={() => navigate(paths.dashboard.ocr.root)}
          >
            Back
          </Button>
        }
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      <Card>
        <CardContent>
          <OcrUploadPanel
            churchId={churchId}
            onUploaded={() => navigate(paths.dashboard.ocr.root)}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
