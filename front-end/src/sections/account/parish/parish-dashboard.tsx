import React, { useState, useEffect } from 'react';

/**
 * Parish management dashboard for the signed-in church.
 * Live record counts, links to parish configuration, and an empty activity list.
 */
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { useActiveChurchId } from 'src/layouts/components/use-active-church';

import { useAuthContext } from 'src/auth/hooks';
import { omApiFetch, isPlatformRole } from 'src/auth/context/om-auth';

import {
  ArrowForwardIcon,
  BrushOutlinedIcon,
  EventOutlinedIcon,
  PeopleOutlinedIcon,
  PaletteOutlinedIcon,
  StorageOutlinedIcon,
} from './parish-icons';

type ParishStats = {
  baptisms: number;
  marriages: number;
  funerals: number;
  total: number;
};

type ActivityRow = {
  description: string;
  userName: string;
  timestamp: string;
};

const statsDef = [
  { key: 'total' as const, name: 'Total records', icon: StorageOutlinedIcon },
  { key: 'baptisms' as const, name: 'Baptisms', icon: PeopleOutlinedIcon },
  { key: 'marriages' as const, name: 'Marriages', icon: EventOutlinedIcon },
  { key: 'funerals' as const, name: 'Funerals', icon: PaletteOutlinedIcon },
];

const quickActions = [
  {
    title: 'Configure database mapping',
    description: 'Map ledger columns to baptism, marriage, and funeral records.',
    Icon: StorageOutlinedIcon,
    href: paths.dashboard.accountParish.databaseMapping,
  },
  {
    title: 'Record table headers',
    description: 'Choose which ledger columns appear and how they are labeled.',
    Icon: BrushOutlinedIcon,
    href: paths.dashboard.accountParish.recordSettings,
  },
  {
    title: 'Search configuration',
    description: 'Set search speed, filters, and how results are shown.',
    Icon: EventOutlinedIcon,
    href: paths.dashboard.accountParish.searchConfiguration,
  },
  {
    title: 'OCR preferences',
    description: 'Language, confidence, and document cleanup for this parish.',
    Icon: PaletteOutlinedIcon,
    href: paths.dashboard.accountParish.ocrPreferences,
  },
];

function formatActivityTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const ParishDashboard: React.FC = () => {
  const churchId = useActiveChurchId();
  const { user } = useAuthContext();
  const actions = isPlatformRole(user?.role)
    ? quickActions
    : quickActions.filter((action) => action.href !== paths.dashboard.accountParish.ocrPreferences);
  const [stats, setStats] = useState<ParishStats | null>(null);
  const [recentActivity] = useState<ActivityRow[]>([]);

  useEffect(() => {
    if (!churchId) {
      setStats(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await omApiFetch(`/api/admin/churches/${churchId}/stats`);
        const json = await res.json().catch(() => null);
        if (!res.ok || cancelled) return;
        setStats({
          baptisms: Number(json?.baptisms ?? 0),
          marriages: Number(json?.marriages ?? 0),
          funerals: Number(json?.funerals ?? 0),
          total: Number(json?.totalRecords ?? 0),
        });
      } catch {
        if (!cancelled) setStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Parish dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Records, configuration shortcuts, and parish setup for the active church.
        </Typography>
        {!churchId && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label="Select a parish to load counts"
            sx={{ mt: 1.5 }}
          />
        )}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        {statsDef.map((stat) => {
          const Icon = stat.icon;
          const value = stats ? stats[stat.key] : '—';
          return (
            <Paper
              key={stat.key}
              sx={{
                p: 2.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: (theme) => theme.shadows[1],
              }}
            >
              <Box
                sx={{
                  p: 0.75,
                  borderRadius: 1.5,
                  bgcolor: 'primary.lighter',
                  display: 'inline-flex',
                  mb: 1.5,
                }}
              >
                <Icon sx={{ fontSize: 20, color: 'primary.main' }} />
              </Box>
              <Typography variant="h4" sx={{ fontSize: '1.375rem', fontWeight: 700, mb: 0.25 }}>
                {typeof value === 'number' ? value.toLocaleString() : value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {stat.name}
              </Typography>
            </Paper>
          );
        })}
      </Box>

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 700 }}>
          Quick actions
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
            gap: 2,
          }}
        >
          {actions.map((action) => {
            const { Icon } = action;
            return (
              <Paper
                key={action.title}
                component={RouterLink}
                href={action.href}
                sx={{
                  textDecoration: 'none',
                  color: 'inherit',
                  p: 2.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: (theme) => theme.shadows[1],
                  cursor: 'default',
                  transition: 'box-shadow 0.2s ease',
                  '&:hover': { boxShadow: (theme) => theme.shadows[4] },
                  '&:hover .action-arrow': { opacity: 1 },
                }}
              >
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                  <Box
                    sx={{
                      p: 1,
                      borderRadius: 1.5,
                      bgcolor: 'primary.lighter',
                      display: 'inline-flex',
                    }}
                  >
                    <Icon sx={{ fontSize: 22, color: 'primary.main' }} />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Typography variant="subtitle2">{action.title}</Typography>
                      <ArrowForwardIcon
                        className="action-arrow"
                        sx={{
                          fontSize: 16,
                          opacity: 0,
                          transition: 'opacity 0.2s',
                          color: 'primary.main',
                        }}
                      />
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 0.25, display: 'block' }}
                    >
                      {action.description}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            );
          })}
        </Box>
      </Box>

      <Paper
        sx={{
          p: 2.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: (theme) => theme.shadows[1],
        }}
      >
        <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 700 }}>
          Recent activity
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {recentActivity.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No recent configuration activity.
            </Typography>
          )}
          {recentActivity.map((activity, i) => (
            <Box
              key={`${activity.timestamp}-${i}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                py: 1.5,
                borderBottom: i < recentActivity.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ minWidth: 0, pr: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {activity.description}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {activity.userName}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {formatActivityTime(activity.timestamp)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
};

export default ParishDashboard;
