import type { CardProps } from '@mui/material/Card';
import type { IconifyName } from 'src/components/iconify';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

/**
 * "Parish Resources" quick-access grid.
 *
 * No Minimal demo widget matches the mockup's icon-tile grid, so this is a
 * small portal-specific card in Minimal styling. Items only get an `href`
 * when a real destination exists — matching OM's rule that a missing
 * destination renders non-interactive rather than installing a dead handler.
 */

type ResourceItem = {
  label: string;
  icon: IconifyName;
  href?: string;
};

const ITEMS: ResourceItem[] = [
  { label: 'Parish Directory', icon: 'solar:notebook-bold-duotone' },
  { label: 'Parish Calendar', icon: 'solar:calendar-date-bold' },
  { label: 'Forms & Documents', icon: 'solar:file-text-bold' },
  {
    label: 'Contact Office',
    icon: 'solar:letter-bold',
    href: 'mailto:info@orthodoxmetrics.com',
  },
];

type Props = CardProps & {
  title?: string;
};

export function PortalResources({ title = 'Parish Resources', sx, ...other }: Props) {
  return (
    <Card sx={sx} {...other}>
      <CardHeader title={title} />

      <Box
        sx={{
          p: 3,
          pt: 0,
          gap: 2,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
        }}
      >
        {ITEMS.map((item) => (
          <Box
            key={item.label}
            component={item.href ? 'a' : 'div'}
            href={item.href}
            sx={(theme) => ({
              py: 3,
              gap: 1,
              display: 'flex',
              borderRadius: 1.5,
              alignItems: 'center',
              flexDirection: 'column',
              justifyContent: 'center',
              typography: 'subtitle2',
              color: 'text.secondary',
              textDecoration: 'none',
              bgcolor: 'background.neutral',
              transition: theme.transitions.create(['background-color', 'color']),
              ...(item.href && {
                cursor: 'pointer',
                '&:hover': {
                  color: 'text.primary',
                  bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.16),
                },
              }),
            })}
          >
            <Iconify icon={item.icon} width={32} sx={{ color: 'primary.main' }} />
            {item.label}
          </Box>
        ))}
      </Box>
    </Card>
  );
}
