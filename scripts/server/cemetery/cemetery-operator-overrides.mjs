/**
 * Operator-confirmed corrections for church-46 cemetery import.
 * Applied after xlsx parse in cemetery-build-manifest.mjs.
 */

/** Region codes excluded from map import (none — NEW-MN enabled 2026-07-12). */
export const EXCLUDED_REGION_CODES = [];

/**
 * Occupant patches keyed by stable_location_id / plot_key.
 * Operator corrections 2026-07-11 (Section 3, graves 185–199).
 */
export const OCCUPANT_OVERRIDES = {
  'SSPPOC-R22-P01': {
    occupants: ['Nicholas Fetchina', 'Constantin Stepan', 'Laura Navmovski'],
    family_crest: 'Fetchina',
    status: 'occupied',
    review_note: 'Operator-confirmed occupants for graves 194–196 (2026-07-11)',
  },
  'SSPPOC-R22-P02': {
    occupants: ['Saso Navmovski'],
    family_crest: 'Navmovski',
    status: 'occupied',
    review_note: 'Operator-confirmed: grave 197 occupied; 198/199 empty (2026-07-11)',
  },
  'SSPPOC-R21-P01': {
    occupants: ['Borica Cavic', 'Natalie Ratzkovich', 'Andrey Napylov', 'Lyubov Napylov'],
    family_crest: 'Cavic',
    status: 'occupied',
    review_note: 'Operator-confirmed left group graves 185–188 (2026-07-11)',
  },
  'SSPPOC-R21-P02': {
    occupants: ['Seraphima Fedorovna', 'Victoria Pylneva', 'George Fetchina'],
    family_crest: 'Fetchina',
    status: 'occupied',
    review_note: 'Operator-confirmed middle group graves 191–193 (2026-07-11)',
  },
  'SSPPOC-R21-P03': {
    occupants: ['John Kachek', 'Theodora Kachek'],
    family_crest: 'Kachek',
    status: 'occupied',
    review_note: 'Operator-confirmed right group graves 189–190 (2026-07-11)',
  },
};

/**
 * @param {Array<Record<string, unknown>>} plots
 * @returns {Array<Record<string, unknown>>}
 */
export function applyOperatorOverrides(plots) {
  const byKey = new Map(plots.map((p) => [p.plot_key || p.stable_location_id, p]));

  for (const [key, patch] of Object.entries(OCCUPANT_OVERRIDES)) {
    const existing = byKey.get(key);
    if (!existing) continue;
    Object.assign(existing, patch);
  }

  return plots;
}

/**
 * @param {Array<Record<string, unknown>>} plots
 * @returns {Array<Record<string, unknown>>}
 */
export function excludeRegions(plots) {
  return plots.filter((p) => !EXCLUDED_REGION_CODES.includes(String(p.region_code || '').trim()));
}
