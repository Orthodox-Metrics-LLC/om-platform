import type { LegalBlock, LegalDocument } from './legal-documents';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import {
  LEGAL_EMAIL,
  LEGAL_COMPANY,
  LEGAL_WEBSITE,
  LEGAL_EFFECTIVE_DATE,
} from './legal-documents';

// ----------------------------------------------------------------------

type LegalViewProps = { document: LegalDocument };

/**
 * Deliberately free of scroll-reveal animation. These documents are long enough
 * that a single `MotionViewport` can never satisfy its visibility threshold, and
 * legal copy should never be hidden behind an animation that might not fire.
 */
export function LegalView({ document: doc }: LegalViewProps) {
  const renderBlock = (block: LegalBlock, index: number) => {
    switch (block.type) {
      case 'ul':
        return (
          <Box
            key={index}
            component="ul"
            sx={{ pl: 3, m: 0, listStyleType: 'disc', '& li': { mb: 1 } }}
          >
            {block.items.map((item) => (
              <li key={item}>
                <Typography variant="body1" component="span" sx={{ color: 'text.secondary' }}>
                  {item}
                </Typography>
              </li>
            ))}
          </Box>
        );

      case 'contact':
        return (
          <Box key={index} component="address" sx={{ fontStyle: 'normal' }}>
            {block.lines?.map((line) => (
              <Typography key={line} variant="body1" sx={{ color: 'text.secondary' }}>
                {line}
              </Typography>
            ))}
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>
              Email:{' '}
              <Link href={`mailto:${LEGAL_EMAIL}`} sx={{ fontWeight: 'fontWeightSemiBold' }}>
                {LEGAL_EMAIL}
              </Link>
            </Typography>
          </Box>
        );

      case 'p':
      default:
        return (
          <Typography key={index} variant="body1" sx={{ color: 'text.secondary' }}>
            {block.text}
          </Typography>
        );
    }
  };

  const renderMeta = () => (
    <Stack spacing={0.5} sx={{ typography: 'body2', color: 'text.disabled' }}>
      <Box component="span">
        <Box component="strong" sx={{ color: 'text.secondary' }}>
          Effective Date:
        </Box>{' '}
        {LEGAL_EFFECTIVE_DATE}
      </Box>

      <Box component="span">
        <Box component="strong" sx={{ color: 'text.secondary' }}>
          Website:
        </Box>{' '}
        <Link href={LEGAL_WEBSITE} color="inherit" underline="always">
          {LEGAL_WEBSITE}
        </Link>
      </Box>

      {doc.showCompany && (
        <Box component="span">
          <Box component="strong" sx={{ color: 'text.secondary' }}>
            Company:
          </Box>{' '}
          {LEGAL_COMPANY}
        </Box>
      )}
    </Stack>
  );

  return (
    <>
      <Box
        component="section"
        sx={(theme) => ({
          py: { xs: 8, md: 12 },
          textAlign: 'center',
          bgcolor: theme.vars.palette.background.neutral,
        })}
      >
        <Container>
          <Typography variant="overline" sx={{ color: 'text.disabled' }}>
            Legal
          </Typography>
          <Typography variant="h2" component="h1" sx={{ mt: 1.5 }}>
            {doc.title}
          </Typography>
        </Container>
      </Box>

      <Container component="section" sx={{ py: { xs: 8, md: 10 }, maxWidth: 760 }}>
        <Stack spacing={4}>
          {renderMeta()}

          <Typography variant="h6" sx={{ fontWeight: 'fontWeightMedium' }}>
            {doc.intro}
          </Typography>

          <Divider sx={{ borderStyle: 'dashed' }} />

          {doc.sections.map((section) => (
            <Box key={section.title} component="section">
              <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                {section.title}
              </Typography>

              <Stack spacing={2}>{section.blocks.map(renderBlock)}</Stack>
            </Box>
          ))}
        </Stack>
      </Container>
    </>
  );
}
