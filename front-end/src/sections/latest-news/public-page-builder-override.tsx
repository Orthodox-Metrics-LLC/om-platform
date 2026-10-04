import type { ReactNode } from 'react';
import type { Page, PageType } from 'src/sections/admin/page-builder/om-pages-api';

import { useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { PageBuilderPublicItem } from './page-builder-public-item';

// ----------------------------------------------------------------------

/**
 * Lets a published Page Builder version replace one of Minimal's standing
 * public surfaces. Until a matching published page exists, the original page
 * remains intact. Draft editor changes never appear here because the API serves
 * the campaign's published version snapshot.
 */
export function PublicPageBuilderOverride({
  pageType,
  fallback,
  id,
}: {
  pageType: PageType;
  fallback: ReactNode;
  /** Preserves the section's deep-link anchor (e.g. /records) once a published override replaces the fallback. */
  id?: string;
}) {
  const [page, setPage] = useState<Page | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/public/latest-news/active?page_type=${pageType}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (live) setPage(data?.campaigns?.[0] || null); })
      .catch(() => { if (live) setPage(null); });
    return () => { live = false; };
  }, [pageType]);

  if (!page) return fallback;

  return (
    <Container id={id} maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
      <Box sx={{ mb: 5, textAlign: 'center' }}>
        <Typography variant="h2">{page.title}</Typography>
        {page.summary && <Typography sx={{ mt: 1.5, color: 'text.secondary' }}>{page.summary}</Typography>}
      </Box>
      <Stack spacing={{ xs: 4, md: 6 }}>
        {(page.items || []).map((item) => <PageBuilderPublicItem key={item.id} item={{ ...item, media: item.media?.length ? item.media : (page.media || []) }} />)}
      </Stack>
    </Container>
  );
}
