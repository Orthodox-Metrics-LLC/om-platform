/**
 * Family crest display rules for cemetery plots.
 * Crest surname on a grave lot is inherited by marker names unless a full surname is present.
 */

function normalizeToken(value) {
  return String(value || '').trim();
}

/**
 * @param {string} nameRaw marker / occupant string from workbook
 * @param {string|null|undefined} familyCrest lot family crest surname
 */
function parseOccupantForImport(nameRaw, familyCrest) {
  const name = normalizeToken(nameRaw);
  if (!name) return { firstName: '', lastName: '' };

  const crest = normalizeToken(familyCrest);
  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: parts[parts.length - 1],
    };
  }

  if (crest && parts[0].toLowerCase() !== crest.toLowerCase()) {
    return { firstName: parts[0], lastName: crest };
  }

  return { firstName: '', lastName: parts[0] };
}

/**
 * @param {string|null|undefined} firstName
 * @param {string|null|undefined} lastName
 * @param {string|null|undefined} familyCrest
 */
function formatOccupantDisplayName(firstName, lastName, familyCrest) {
  const first = normalizeToken(firstName);
  const last = normalizeToken(lastName);
  const crest = normalizeToken(familyCrest);

  if (first && last) {
    return `${first} ${last}`;
  }
  if (first && crest) {
    return `${first} ${crest}`;
  }
  if (last) return last;
  if (first) return first;
  return '—';
}

/**
 * Panel / hover title when a plot is selected.
 */
function plotPanelTitle({ familyCrest, plotKind, plotNumber, occupants }) {
  const crest = normalizeToken(familyCrest);
  if (crest) return crest;

  if (plotKind === 'cross' && occupants?.length) {
    const o = occupants[0];
    const label = formatOccupantDisplayName(o.firstName, o.lastName, null);
    if (label !== '—') return label;
  }

  return plotNumber ? `Plot ${plotNumber}` : 'Selected Plot';
}

/**
 * @param {string} reviewNote
 * @param {string} [mapStatus]
 */
function detectPlotKind(reviewNote, mapStatus) {
  const review = normalizeToken(reviewNote).toLowerCase();
  const status = normalizeToken(mapStatus).toLowerCase();
  if (review.includes('cross marker') || review.includes('orthodox cross')) return 'cross';
  if (status.includes('cross')) return 'cross';
  return 'grave';
}

module.exports = {
  parseOccupantForImport,
  formatOccupantDisplayName,
  plotPanelTitle,
  detectPlotKind,
};
