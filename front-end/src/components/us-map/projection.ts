// ----------------------------------------------------------------------

/**
 * Albers Equal Area Conic projection, matching the parameters used to generate
 * `LAND_PATH` and `STATE_BORDERS_PATH` in this folder.
 *
 * The map artwork was projected offline from public-domain Natural Earth 110m
 * data. Plotting live points (parish coordinates from the API) on top of it
 * requires the identical projection at runtime — otherwise pins drift away from
 * the coastlines they sit on.
 *
 * Standard parallels 29.5N / 45.5N, central meridian 96W, reference latitude 23N.
 */

const RAD = Math.PI / 180;

const PHI_1 = 29.5 * RAD;
const PHI_2 = 45.5 * RAD;
const PHI_0 = 23.0 * RAD;
const LAMBDA_0 = -96.0 * RAD;

const N = 0.5 * (Math.sin(PHI_1) + Math.sin(PHI_2));
const C = Math.cos(PHI_1) ** 2 + 2 * N * Math.sin(PHI_1);
const RHO_0 = Math.sqrt(C - 2 * N * Math.sin(PHI_0)) / N;

/**
 * Affine transform from projected units into the 1000x779 viewBox.
 *
 * The offline generator's scale and offset were not recorded, so these were
 * recovered by least-squares fit against the six pin positions it produced
 * (see `REFERENCE_POINTS`). Worst residual is 0.015 viewBox percent — i.e. the
 * runtime projection reproduces the offline one to well under a pixel.
 * `validateProjection()` re-checks this.
 */
const SCALE_X = 669.6695;
const OFFSET_X = 655.1062;
const SCALE_Y = -669.6634;
const OFFSET_Y = 651.4156;

export const VIEWBOX_WIDTH = 1000;
export const VIEWBOX_HEIGHT = 779;

export type ProjectedPoint = { x: number; y: number };

/** Projects [longitude, latitude] into viewBox coordinates. */
export function projectLngLat(lng: number, lat: number): ProjectedPoint {
  const phi = lat * RAD;
  const lambda = lng * RAD;

  const theta = N * (lambda - LAMBDA_0);
  const rho = Math.sqrt(C - 2 * N * Math.sin(phi)) / N;

  return {
    x: SCALE_X * (rho * Math.sin(theta)) + OFFSET_X,
    y: SCALE_Y * (RHO_0 - rho * Math.cos(theta)) + OFFSET_Y,
  };
}

/** Same point expressed as viewBox percentages, for absolutely-positioned overlays. */
export function projectToPercent(lng: number, lat: number) {
  const { x, y } = projectLngLat(lng, lat);
  return {
    left: `${(x / VIEWBOX_WIDTH) * 100}%`,
    top: `${(y / VIEWBOX_HEIGHT) * 100}%`,
  };
}

/**
 * Known-good reference points taken from the offline-generated pin positions on
 * the contact map. Used by the unit check below to confirm the runtime
 * projection reproduces the offline one.
 */
export const REFERENCE_POINTS = [
  { name: 'Seattle', lng: -122.3321, lat: 47.6062, left: 44.9, top: 42.96 },
  { name: 'Los Angeles', lng: -118.2437, lat: 34.0522, left: 44.32, top: 63.9 },
  { name: 'Dallas', lng: -96.797, lat: 32.7767, left: 64.72, top: 69.02 },
  { name: 'Chicago', lng: -87.6298, lat: 41.8781, left: 72.73, top: 54.83 },
  { name: 'Boston', lng: -71.0589, lat: 42.3601, left: 86.67, top: 50.93 },
  { name: 'Miami', lng: -80.1918, lat: 25.7617, left: 82.24, top: 77.75 },
] as const;

/** Max absolute error, in viewBox percent, against the reference points. */
export function validateProjection() {
  return REFERENCE_POINTS.map((p) => {
    const { x, y } = projectLngLat(p.lng, p.lat);
    return {
      name: p.name,
      dLeft: (x / VIEWBOX_WIDTH) * 100 - p.left,
      dTop: (y / VIEWBOX_HEIGHT) * 100 - p.top,
    };
  });
}
