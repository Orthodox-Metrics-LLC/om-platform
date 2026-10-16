/**
 * OM ecosystem GitHub repos — shared constants for work session accountability.
 */

const OM_REPOS = Object.freeze({
  orthodoxmetrics: {
    repo_target: 'orthodoxmetrics',
    github_repo: 'omrecords82/prod-current',
    label: 'OrthodoxMetrics (prod-current)',
    color: '#0369a1',
  },
  omai: {
    repo_target: 'omai',
    github_repo: 'omrecords82/omai',
    label: 'OMAI',
    color: '#8c249d',
  },
  omstudio: {
    repo_target: 'omstudio',
    github_repo: 'omrecords82/omstudio',
    label: 'OMStudio',
    color: '#059669',
  },
  'omai-ops': {
    repo_target: 'omai-ops',
    github_repo: 'omrecords82/omai-ops',
    label: 'OMAI Ops',
    color: '#d97706',
  },
  shared: {
    repo_target: 'shared',
    github_repo: 'cross-repo',
    label: 'Shared / Cross-repo',
    color: '#6b7280',
  },
  unknown: {
    repo_target: 'unknown',
    github_repo: 'unassigned',
    label: 'Orthodox Metrics (OM)',
    color: '#9ca3af',
  },
});

const VALID_REPO_TARGETS = Object.freeze(Object.keys(OM_REPOS));

function normalizeRepoTarget(value) {
  if (!value || typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return VALID_REPO_TARGETS.includes(key) ? key : null;
}

/** Null, empty, or invalid repo_target → unknown (displayed as Orthodox Metrics (OM)). */
function resolveRepoTarget(repoTarget) {
  if (!repoTarget) return 'unknown';
  const key = normalizeRepoTarget(repoTarget);
  return key || 'unknown';
}

function getRepoMeta(repoTarget) {
  const key = resolveRepoTarget(repoTarget);
  return OM_REPOS[key] || OM_REPOS.unknown;
}

function formatDuration(seconds) {
  const n = Number(seconds) || 0;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = {
  OM_REPOS,
  VALID_REPO_TARGETS,
  normalizeRepoTarget,
  resolveRepoTarget,
  getRepoMeta,
  formatDuration,
};
