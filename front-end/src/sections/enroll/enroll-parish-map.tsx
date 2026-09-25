import type { GeoJSONSource } from 'maplibre-gl';
import type { Point, FeatureCollection } from 'geojson';
import type { MapRef, LayerProps, MapMouseEvent } from 'react-map-gl/maplibre';

import { varAlpha } from 'minimal-shared/utils';
import { Layer, Source, NavigationControl } from 'react-map-gl/maplibre';
import { useRef, useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import 'src/components/map/styles.css';
import { Iconify } from 'src/components/iconify';
import { Map, MapPopup, MAP_STYLES } from 'src/components/map';
import { UsMapPicker } from 'src/components/us-map/us-map-picker';

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
  onSelectState?: (code: string) => void;
};

const PARISH_SOURCE = 'parishes';
const INTERACTIVE_LAYERS = ['parish-clusters', 'parish-pins', 'parish-labels', 'parish-labels-close'];

/**
 * Parish picker for the enrollment wizard.
 *
 * Before a state is chosen, the schematic US map is the picker. Afterward the
 * parishes from `GET /api/crm-public/parishes-geo?state=XX` are drawn on a
 * street map at their real coordinates, so a member can pan to their town and
 * read the church name on the pin.
 */
export function EnrollParishMap({ state, selectedId, onSelect, onSelectState }: Props) {
  const { parishes, loading, error } = useParishes(state);

  if (!state) {
    return (
      <Box>
        <MapFrame>
          <UsMapPicker
            onSelectState={(code) => onSelectState?.(code)}
            sx={{ width: 1, height: 1 }}
          />
        </MapFrame>

        <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
          Pan and zoom to find your state, or use the dropdown below.
        </Typography>
      </Box>
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

  if (!parishes.length) {
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
    <ParishPinMap
      key={state}
      state={state}
      parishes={parishes}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
}

// ----------------------------------------------------------------------

type ParishPinMapProps = {
  state: string;
  parishes: ParishFeature[];
  selectedId?: number | null;
  onSelect: (parish: ParishFeature) => void;
};

type ParishProps = {
  id: number;
  name: string;
  city: string;
};

function ParishPinMap({ state, parishes, selectedId, onSelect }: ParishPinMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [popupId, setPopupId] = useState<number | null>(null);

  const data = useMemo<FeatureCollection<Point, ParishProps>>(
    () => ({
      type: 'FeatureCollection',
      features: parishes.map((parish) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [parish.lng, parish.lat] },
        properties: { id: parish.id, name: parish.name, city: parish.city },
      })),
    }),
    [parishes]
  );

  const bounds = useMemo(() => parishBounds(parishes), [parishes]);
  const popupParish = parishes.find((parish) => parish.id === popupId) ?? null;

  const handleClick = useCallback(
    async (event: MapMouseEvent) => {
      const feature = event.features?.[0];
      const mapEl = mapRef.current;
      if (!feature || !mapEl) return;

      const props = feature.properties ?? {};
      if (props.cluster) {
        const source = mapEl.getSource(PARISH_SOURCE) as GeoJSONSource | undefined;
        const clusterId = Number(props.cluster_id);
        if (!source?.getClusterExpansionZoom || !Number.isFinite(clusterId)) return;

        const zoom = await source.getClusterExpansionZoom(clusterId);
        if (feature.geometry.type !== 'Point') return;

        mapEl.easeTo({
          center: feature.geometry.coordinates as [number, number],
          zoom: (zoom ?? mapEl.getZoom()) + 0.5,
          duration: 500,
        });
        return;
      }

      const parish = parishes.find((item) => item.id === Number(props.id));
      if (!parish) return;
      setPopupId(parish.id);
      onSelect(parish);
    },
    [parishes, onSelect]
  );

  const handleMouseMove = useCallback((event: MapMouseEvent) => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = event.features?.length ? 'pointer' : '';
  }, []);

  const pinPaint = useMemo(
    () => pinLayer(selectedId ?? null),
    [selectedId]
  );

  return (
    <Box>
      <MapFrame>
        <Map
          ref={mapRef}
          mapStyle={MAP_STYLES.neutral}
          initialViewState={{
            bounds,
            fitBoundsOptions: { padding: 48, maxZoom: 12 },
          }}
          interactiveLayerIds={INTERACTIVE_LAYERS}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          dragRotate={false}
          pitchWithRotate={false}
          touchPitch={false}
          minZoom={4}
          maxZoom={17}
          sx={{
            height: 1,
            '& .maplibregl-popup-content': {
              maxWidth: 280,
              padding: '12px 28px 12px 12px',
            },
          }}
        >
          <NavigationControl position="top-right" showCompass={false} />

          <Source
            id={PARISH_SOURCE}
            type="geojson"
            data={data}
            cluster
            clusterRadius={48}
            clusterMaxZoom={14}
          >
            <Layer {...clusterLayer} />
            <Layer {...clusterCountLayer} />
            <Layer {...pinPaint} />
            <Layer {...labelLayer} />
            <Layer {...closeLabelLayer} />
          </Source>

          {popupParish && (
            <ParishPopup parish={popupParish} onClose={() => setPopupId(null)} />
          )}
        </Map>
      </MapFrame>

      <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
        {parishes.length} parish{parishes.length === 1 ? '' : 'es'} in {state}. Zoom toward your
        town, or tap a numbered cluster, until the church name appears. Tap the pin to select it.
      </Typography>
    </Box>
  );
}

function ParishPopup({ parish, onClose }: { parish: ParishFeature; onClose: () => void }) {
  const place = [parish.city, parish.state].filter(Boolean).join(', ');
  const locality = [place, parish.zip].filter(Boolean).join(' ');

  return (
    <MapPopup
      longitude={parish.lng}
      latitude={parish.lat}
      onClose={onClose}
      closeOnClick={false}
      offset={18}
      focusAfterOpen={false}
    >
      <Stack spacing={0.25} sx={{ pr: 1, maxWidth: 240 }}>
        <Typography variant="subtitle2">{parish.name}</Typography>
        {!!parish.street && (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {parish.street}
          </Typography>
        )}
        {!!locality && (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {locality}
          </Typography>
        )}
        {!!parish.jurisdiction && (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
            {parish.jurisdiction}
          </Typography>
        )}
      </Stack>
    </MapPopup>
  );
}

// ----------------------------------------------------------------------

const clusterLayer: LayerProps = {
  id: 'parish-clusters',
  type: 'circle',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': '#007867',
    'circle-radius': ['step', ['get', 'point_count'], 16, 8, 20, 24, 26],
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
};

const clusterCountLayer: LayerProps = {
  id: 'parish-cluster-count',
  type: 'symbol',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    'text-font': ['Open Sans Bold', 'Noto Sans Bold'],
    'text-size': 12,
  },
  paint: {
    'text-color': '#ffffff',
  },
};

function pinLayer(selectedId: number | null): LayerProps {
  const selected = selectedId ?? -1;
  return {
    id: 'parish-pins',
    type: 'circle',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['case', ['==', ['get', 'id'], selected], '#004B50', '#00A76F'],
      'circle-radius': ['case', ['==', ['get', 'id'], selected], 9, 6],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  };
}

/** Town names while zooming in. Overlapping labels hide so a dense metro stays readable. */
const labelLayer: LayerProps = {
  id: 'parish-labels',
  type: 'symbol',
  minzoom: 8,
  maxzoom: 13,
  filter: ['!', ['has', 'point_count']],
  layout: {
    'text-field': [
      'step',
      ['zoom'],
      ['get', 'city'],
      11,
      ['concat', ['get', 'name'], '\n', ['get', 'city']],
    ],
    'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
    'text-size': 12,
    'text-offset': [0, 1.05],
    'text-anchor': 'top',
    'text-max-width': 12,
    'text-allow-overlap': false,
  },
  paint: {
    'text-color': '#004B50',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.4,
  },
};

/** At street zoom every nearby church keeps its name, even when the pins sit close together. */
const closeLabelLayer: LayerProps = {
  id: 'parish-labels-close',
  type: 'symbol',
  minzoom: 13,
  filter: ['!', ['has', 'point_count']],
  layout: {
    'text-field': ['concat', ['get', 'name'], '\n', ['get', 'city']],
    'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
    'text-size': 12,
    'text-offset': [0, 1.05],
    'text-anchor': 'top',
    'text-max-width': 12,
    'text-allow-overlap': true,
  },
  paint: {
    'text-color': '#004B50',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.4,
  },
};

/** Fits the camera to the parishes, with enough padding that one church still shows its town. */
function parishBounds(parishes: ParishFeature[]): [[number, number], [number, number]] {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  parishes.forEach((parish) => {
    minLng = Math.min(minLng, parish.lng);
    maxLng = Math.max(maxLng, parish.lng);
    minLat = Math.min(minLat, parish.lat);
    maxLat = Math.max(maxLat, parish.lat);
  });

  const lngPad = Math.max((maxLng - minLng) * 0.15, 0.12);
  const latPad = Math.max((maxLat - minLat) * 0.15, 0.08);

  return [
    [minLng - lngPad, minLat - latPad],
    [maxLng + lngPad, maxLat + latPad],
  ];
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
            .filter((feature: { geometry?: { coordinates?: unknown } }) => {
              const coordinates = feature?.geometry?.coordinates;
              if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
              const lng = Number(coordinates[0]);
              const lat = Number(coordinates[1]);
              return Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
            })
            .map(
              (feature: {
                properties?: Record<string, unknown>;
                geometry: { coordinates: number[] };
              }) => ({
                id: Number(feature.properties?.id),
                name: String(feature.properties?.name ?? 'Unnamed parish'),
                city: String(feature.properties?.city ?? ''),
                state: String(feature.properties?.state ?? state),
                street: (feature.properties?.street as string | null) ?? null,
                zip: (feature.properties?.zip as string | null) ?? null,
                jurisdiction:
                  (feature.properties?.affiliation as string | null) ??
                  (feature.properties?.jurisdiction as string | null) ??
                  null,
                lng: feature.geometry.coordinates[0],
                lat: feature.geometry.coordinates[1],
              })
            )
            .filter((parish: ParishFeature) => Number.isFinite(parish.id))
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
