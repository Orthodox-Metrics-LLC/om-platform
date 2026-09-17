import { varAlpha } from 'minimal-shared/utils';
import { useMemo, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { Iconify } from 'src/components/iconify';
import { LAND_PATH, STATE_BORDERS_PATH } from 'src/components/us-map/paths';
import { VIEWBOX_WIDTH, projectLngLat, VIEWBOX_HEIGHT } from 'src/components/us-map/projection';

// ----------------------------------------------------------------------

export type ParishFeature = {
  id: number;
  name: string;
  city: string;
  state: string;
  street?: string | null;
  zip?: string | null;
  jurisdiction?: string | null;
  lng: number;
  lat: number;
};

type Props = {
  state: string;
  selectedId?: number | null;
  onSelect: (parish: ParishFeature) => void;
};

/**
 * Parish picker for the enrollment wizard.
 *
 * Pins come from `GET /api/crm-public/parishes-geo?state=XX`, which returns
 * GeoJSON point features from the CRM. They are plotted on the same
 * Natural Earth map used by the contact page, projected at runtime with the
 * identical Albers parameters so pins land on the right coastlines.
 *
 * The viewBox is zoomed to the bounding box of the returned parishes rather than
 * to a stored state outline — there is no per-state geometry available here, and
 * the parishes themselves describe the area of interest well enough.
 */
export function EnrollParishMap({ state, selectedId, onSelect }: Props) {
  const { parishes, loading, error } = useParishes(state);

  const projected = useMemo(
    () =>
      parishes.map((p) => {
        const { x, y } = projectLngLat(p.lng, p.lat);
        return { ...p, x, y };
      }),
    [parishes]
  );

  const viewBox = useMemo(() => {
    if (!projected.length) return `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`;

    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Pad generously so a state with one parish still shows context, and keep a
    // 4:3-ish frame so the map does not become a sliver.
    const padX = Math.max((maxX - minX) * 0.5, 40);
    const padY = Math.max((maxY - minY) * 0.5, 30);
    const w = maxX - minX + padX * 2;
    const h = maxY - minY + padY * 2;

    return `${minX - padX} ${minY - padY} ${w} ${h}`;
  }, [projected]);

  if (!state) {
    return (
      <MapFrame>
        <Placeholder icon="mingcute:location-fill" text="Select your state to see parishes on the map." />
      </MapFrame>
    );
  }

  if (loading) {
    return (
      <MapFrame>
        <Placeholder spinner text="Loading parishes…" />
      </MapFrame>
    );
  }

  if (error) {
    return (
      <Alert severity="warning" sx={{ mb: 1 }}>
        {error} You can still enter your parish name below.
      </Alert>
    );
  }

  if (!projected.length) {
    return (
      <MapFrame>
        <Placeholder
          icon="solar:info-circle-bold"
          text={`No parishes are listed for ${state} yet — enter yours below and we will verify it.`}
        />
      </MapFrame>
    );
  }

  return (
    <Box>
      <MapFrame>
        <Box
          component="svg"
          viewBox={viewBox}
          role="group"
          aria-label={`Orthodox parishes in ${state}`}
          sx={{ width: 1, height: 1, display: 'block' }}
        >
          <Box
            component="path"
            d={LAND_PATH}
            sx={(theme) => ({ fill: varAlpha(theme.vars.palette.grey['500Channel'], 0.16) })}
          />
          <Box
            component="path"
            d={STATE_BORDERS_PATH}
            sx={(theme) => ({
              fill: 'none',
              strokeWidth: 0.6,
              stroke: varAlpha(theme.vars.palette.grey['500Channel'], 0.4),
            })}
          />

          {projected.map((p) => {
            const selected = p.id === selectedId;
            return (
              <Tooltip
                key={p.id}
                title={`${p.name} — ${p.city}${p.jurisdiction ? ` (${p.jurisdiction})` : ''}`}
              >
                <Box
                  component="circle"
                  cx={p.x}
                  cy={p.y}
                  r={selected ? 6 : 3.5}
                  tabIndex={0}
                  role="button"
                  aria-label={`Select ${p.name}, ${p.city}`}
                  onClick={() => onSelect(p)}
                  onKeyDown={(event: React.KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(p);
                    }
                  }}
                  sx={(theme) => ({
                    cursor: 'pointer',
                    strokeWidth: 1.5,
                    stroke: theme.vars.palette.common.white,
                    fill: selected
                      ? theme.vars.palette.primary.dark
                      : theme.vars.palette.primary.main,
                    transition: theme.transitions.create(['r', 'fill']),
                    '&:hover': { fill: theme.vars.palette.primary.dark },
                  })}
                />
              </Tooltip>
            );
          })}
        </Box>
      </MapFrame>

      <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
        {projected.length} parish{projected.length === 1 ? '' : 'es'} listed in {state}. Tap a pin to
        select yours, or enter it below if it is not shown.
      </Typography>
    </Box>
  );
}

// ----------------------------------------------------------------------

function MapFrame({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={[
        (theme) => ({
          width: 1,
          aspectRatio: '4/3',
          borderRadius: 2,
          overflow: 'hidden',
          position: 'relative',
          bgcolor: 'background.neutral',
          border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
        }),
      ]}
    >
      {children}
    </Box>
  );
}

function Placeholder({
  icon,
  text,
  spinner,
}: {
  icon?: string;
  text: string;
  spinner?: boolean;
}) {
  return (
    <Box
      sx={{
        inset: 0,
        gap: 1.5,
        display: 'flex',
        position: 'absolute',
        textAlign: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        justifyContent: 'center',
        color: 'text.disabled',
        p: 3,
      }}
    >
      {spinner ? <CircularProgress size={28} /> : icon && <Iconify width={32} icon={icon as never} />}
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}

// ----------------------------------------------------------------------

function useParishes(state: string) {
  const [parishes, setParishes] = useState<ParishFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) {
      setParishes([]);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/crm-public/parishes-geo?state=${encodeURIComponent(state)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (cancelled) return;
        const features = Array.isArray(data?.features) ? data.features : [];
        setParishes(
          features
            // Rows without coordinates cannot be plotted; the backend still
            // returns them, so they are filtered here rather than stacked at 0,0.
            .filter((f: any) => Array.isArray(f?.geometry?.coordinates))
            .map((f: any) => ({
              id: f.properties?.id,
              name: f.properties?.name ?? 'Unnamed parish',
              city: f.properties?.city ?? '',
              state: f.properties?.state ?? state,
              street: f.properties?.street ?? null,
              zip: f.properties?.zip ?? null,
              jurisdiction: f.properties?.affiliation ?? f.properties?.jurisdiction ?? null,
              lng: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
            }))
        );
      })
      .catch(() => {
        if (!cancelled) setError('The parish directory could not be reached.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [state]);

  return { parishes, loading, error };
}
