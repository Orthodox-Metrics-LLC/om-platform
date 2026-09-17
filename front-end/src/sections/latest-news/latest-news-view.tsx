import type { NewsCampaign, Announcement, AnnouncementStatus } from './latest-news-data';

import { useState, useEffect } from 'react';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { RouterLink } from 'src/routes/components';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

import { ANNOUNCEMENTS, LATEST_NEWS_COPY } from './latest-news-data';

// ----------------------------------------------------------------------

const STATUS_COLOR: Record<AnnouncementStatus, 'success' | 'info' | 'warning'> = {
  active: 'success',
  scheduled: 'info',
  featured: 'warning',
};

export function LatestNewsView() {
  const campaigns = useActiveCampaigns();

  return (
    <>
      <Box
        component="section"
        sx={[
          (theme) => ({
            py: { xs: 8, md: 12 },
            textAlign: 'center',
            bgcolor: 'background.neutral',
            borderBottom: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
          }),
        ]}
      >
        <Container>
          <Label color="primary" variant="soft" sx={{ mb: 2 }}>
            {LATEST_NEWS_COPY.badge}
          </Label>

          <Typography variant="h2" sx={{ mb: 1 }}>
            {LATEST_NEWS_COPY.title}
          </Typography>

          <Typography sx={{ color: 'text.secondary' }}>{LATEST_NEWS_COPY.subtitle}</Typography>
        </Container>
      </Box>

      <Container component="section" sx={{ py: { xs: 8, md: 12 } }}>
        {/* Published campaigns come first when there are any. */}
        {campaigns.map((campaign) => (
          <CampaignBlock key={campaign.id} campaign={campaign} />
        ))}

        <Stack spacing={{ xs: 6, md: 8 }}>
          {ANNOUNCEMENTS.map((item) => (
            <AnnouncementBlock key={item.id} item={item} />
          ))}
        </Stack>
      </Container>
    </>
  );
}

// ----------------------------------------------------------------------

/**
 * Reads published campaigns from the OM backend.
 *
 * The endpoint returns `{"success":true,"campaigns":[]}` today — the schema
 * exists but nothing has been authored — so this quietly contributes nothing and
 * the standing announcements below carry the page. A failure is not surfaced to
 * the visitor for the same reason: the page is still complete without it.
 */
function useActiveCampaigns() {
  const [campaigns, setCampaigns] = useState<NewsCampaign[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/public/latest-news/active', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && Array.isArray(data.campaigns)) {
          setCampaigns(data.campaigns);
        }
      })
      .catch(() => {
        /* Standing announcements still render. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return campaigns;
}

// ----------------------------------------------------------------------

function CampaignBlock({ campaign }: { campaign: NewsCampaign }) {
  return (
    <Box sx={{ mb: { xs: 6, md: 8 } }}>
      <Typography variant="h4" sx={{ mb: 1 }}>
        {campaign.title}
      </Typography>

      {campaign.summary && (
        <Typography sx={{ color: 'text.secondary', mb: 3 }}>{campaign.summary}</Typography>
      )}

      <Stack spacing={3}>
        {(campaign.items ?? []).map((item) => (
          <Box key={item.id}>
            <Typography variant="subtitle1">{item.title}</Typography>
            {item.subtitle && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {item.subtitle}
              </Typography>
            )}
            {(item.excerpt || item.body) && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {item.excerpt || item.body}
              </Typography>
            )}
            {item.cta_label && item.cta_url && (
              <Button href={item.cta_url} size="small" color="inherit" sx={{ mt: 1 }}>
                {item.cta_label}
              </Button>
            )}
          </Box>
        ))}
      </Stack>

      <Divider sx={{ mt: { xs: 6, md: 8 } }} />
    </Box>
  );
}

// ----------------------------------------------------------------------

function AnnouncementBlock({ item }: { item: Announcement }) {
  return (
    <Box
      sx={[
        (theme) => ({
          p: { xs: 3, md: 5 },
          borderRadius: 2,
          border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
        }),
      ]}
    >
      <Grid container spacing={{ xs: 3, md: 5 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Box
              sx={[
                (theme) => ({
                  width: 56,
                  height: 56,
                  display: 'flex',
                  borderRadius: 1.5,
                  alignItems: 'center',
                  color: 'primary.main',
                  justifyContent: 'center',
                  bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
                }),
              ]}
            >
              <Iconify width={28} icon={item.icon} />
            </Box>

            <Typography variant="overline" sx={{ color: 'text.disabled' }}>
              {item.label}
            </Typography>

            <Typography variant="h5">{item.shortName}</Typography>

            <Label color={STATUS_COLOR[item.statusType]} variant="soft">
              {item.status}
            </Label>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {item.title}
          </Typography>

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {item.body}
          </Typography>

          <Stack component="ul" spacing={1.25} sx={{ m: 0, mb: 3, pl: 0, listStyle: 'none' }}>
            {item.bullets.map((bullet) => (
              <Box key={bullet} component="li" sx={{ gap: 1.5, display: 'flex' }}>
                <Iconify
                  width={18}
                  icon="eva:checkmark-fill"
                  sx={{ mt: '3px', flexShrink: 0, color: 'primary.main' }}
                />
                <Typography variant="body2">{bullet}</Typography>
              </Box>
            ))}
          </Stack>

          <Button
            component={RouterLink}
            href={item.ctaHref}
            color="inherit"
            variant="outlined"
            endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
          >
            {item.cta}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
