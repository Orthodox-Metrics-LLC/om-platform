'use strict';

const path = require('path');

// daily-work is the mounted docs-feed share. /mnt/fileserver01/plans is a local stub on om-prod01.
const DEFAULT_PLANS_ROOT = '/mnt/fileserver01/daily-work';

const LIFECYCLE_DIRS = {
  inbox: '00-inbox',
  working: '10-working',
  review: '20-review',
  approved: '30-approved',
  published: '40-published',
  archived: '90-archive',
  quarantined: '99-quarantine',
};

const DIR_TO_LIFECYCLE = Object.fromEntries(
  Object.entries(LIFECYCLE_DIRS).map(([k, v]) => [v, k]),
);

const PRODUCERS = new Set(['manual', 'omdev', 'om-workshop', 'omai-ops01']);

const PRODUCER_TO_SOURCE = {
  manual: 'HUMAN',
  omdev: 'OMDEV',
  'om-workshop': 'WORKSHOP',
  'omai-ops01': 'OPS',
};

const SOURCE_TO_PRODUCER = {
  HUMAN: 'manual',
  OMDEV: 'omdev',
  WORKSHOP: 'om-workshop',
  OPS: 'omai-ops01',
  SYSTEM: 'omai-ops01',
};

const WORKING_HORIZONS = new Set([
  '24-hours-out',
  '48-hours-out',
  '1-week-out',
  '2-weeks-out',
  '90-days-out',
  '6-months-out',
  '9-months-out',
  '12-months-out',
]);

function getPlansRoot() {
  return path.resolve(process.env.OM_DOCUMENTS_PLANS_ROOT || DEFAULT_PLANS_ROOT);
}

function assertUnderPlans(absolutePath, plansRoot = getPlansRoot()) {
  const root = path.resolve(plansRoot);
  const resolved = path.resolve(absolutePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('PATH_TRAVERSAL');
    err.code = 'PATH_TRAVERSAL';
    throw err;
  }
  return resolved;
}

function toRelative(absolutePath, plansRoot = getPlansRoot()) {
  const abs = assertUnderPlans(absolutePath, plansRoot);
  return path.relative(path.resolve(plansRoot), abs).split(path.sep).join('/');
}

function joinUnderPlans(...parts) {
  const plansRoot = getPlansRoot();
  const joined = path.join(plansRoot, ...parts);
  return assertUnderPlans(joined, plansRoot);
}

function packageDirFor({ lifecycle, producer, horizon, documentId }) {
  if (!LIFECYCLE_DIRS[lifecycle]) {
    throw Object.assign(new Error('INVALID_LIFECYCLE'), { code: 'INVALID_LIFECYCLE' });
  }
  if (lifecycle === 'inbox') {
    if (!PRODUCERS.has(producer)) {
      throw Object.assign(new Error('INVALID_PRODUCER'), { code: 'INVALID_PRODUCER' });
    }
    return joinUnderPlans(LIFECYCLE_DIRS.inbox, producer, documentId);
  }
  if (lifecycle === 'working') {
    const h = horizon || '24-hours-out';
    if (!WORKING_HORIZONS.has(h)) {
      throw Object.assign(new Error('INVALID_HORIZON'), { code: 'INVALID_HORIZON' });
    }
    return joinUnderPlans(LIFECYCLE_DIRS.working, h, documentId);
  }
  return joinUnderPlans(LIFECYCLE_DIRS[lifecycle], documentId);
}

function parsePackageLocation(absoluteOrRelative) {
  const plansRoot = getPlansRoot();
  const abs = path.isAbsolute(absoluteOrRelative)
    ? assertUnderPlans(absoluteOrRelative, plansRoot)
    : joinUnderPlans(absoluteOrRelative);
  const rel = toRelative(abs, plansRoot);
  const parts = rel.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const lifecycleDir = parts[0];
  const lifecycle = DIR_TO_LIFECYCLE[lifecycleDir];
  if (!lifecycle) return null;
  let producer = null;
  let horizon = null;
  let documentId = null;
  if (lifecycle === 'inbox') {
    if (parts.length < 3) return null;
    producer = parts[1];
    documentId = parts[2];
  } else if (lifecycle === 'working') {
    if (parts.length < 3) return null;
    horizon = parts[1];
    documentId = parts[2];
  } else {
    documentId = parts[1];
  }
  return { lifecycle, producer, horizon, documentId, absolutePath: abs, relativePath: rel };
}

function inboxProducerRoots() {
  return [...PRODUCERS].map((p) => joinUnderPlans('00-inbox', p));
}

module.exports = {
  DEFAULT_PLANS_ROOT,
  LIFECYCLE_DIRS,
  DIR_TO_LIFECYCLE,
  PRODUCERS,
  PRODUCER_TO_SOURCE,
  SOURCE_TO_PRODUCER,
  WORKING_HORIZONS,
  getPlansRoot,
  assertUnderPlans,
  toRelative,
  joinUnderPlans,
  packageDirFor,
  parsePackageLocation,
  inboxProducerRoots,
};
