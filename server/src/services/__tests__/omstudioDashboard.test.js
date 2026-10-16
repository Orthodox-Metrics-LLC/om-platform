/**
 * Run: node server/src/services/__tests__/omstudioDashboard.test.js
 */
const assert = require('assert');
const { shapeStudioDashboard, laneOf } = require('../omstudioDashboard');

const now = new Date('2026-10-01T18:00:00.000Z');

const approvals = [
  {
    id: 24,
    ref: 'oms-jwt',
    current_state: 'APPROVED',
    classification: 'requires_human_superadmin',
    domains: 'auth,secrets,env',
    proposal_summary: 'Re-provision BRAIN_OPS_JWT (brain-ingest) — expired 2026-09-28',
    created_at: '2026-10-01T17:16:22.000Z',
    updated_at: '2026-10-01T17:17:17.000Z',
    ui: { requester: 'cursor' },
  },
  {
    id: 9,
    ref: 'oms-ssh',
    current_state: 'SUBMITTED',
    classification: 'requires_human_superadmin',
    domains: 'cross_env,ssh,operations,security',
    proposal_summary: '[xenv-ssh p5] om-studio 30m',
    created_at: '2026-09-05T05:23:14.000Z',
    ui: { request_type: 'Cross-env SSH access', priority: 5 },
  },
  {
    id: 3,
    ref: 'oms-sa',
    current_state: 'SUBMITTED',
    classification: 'requires_human_superadmin',
    domains: 'ssh',
    proposal_summary: '[host-sa] omdev 30m package install',
    created_at: '2026-09-28T12:00:00.000Z',
    ui: { grant_requires_approve_sa: true, hostname: 'omdev' },
  },
  {
    id: 4,
    ref: 'oms-dns',
    current_state: 'REJECTED',
    classification: 'requires_human_superadmin',
    domains: 'dns',
    proposal_summary: '[infra-public-dns] files.example',
    created_at: '2026-09-20T12:00:00.000Z',
  },
];

const shaped = shapeStudioDashboard({
  now,
  approvals,
  secrets: [
    {
      name: 'BRAIN_OPS_JWT',
      env_var_name: 'BRAIN_OPS_JWT',
      render_target: '/etc/om-brain/om-brain.env',
      value_status: 'pending',
      value: 'must-not-leak',
    },
    { name: 'old', env_var_name: 'OLD', value_status: 'configured', archived_at: '2026-01-01' },
  ],
  connections: { connections: [{ id: 'om', name: 'Orthodox Metrics' }, { id: 'omai', name: 'OMAI' }] },
  health: {
    systems: {
      om: { status: 'healthy', latencyMs: 6 },
      omai: { status: 'degraded', latencyMs: 40 },
    },
  },
});

assert.equal(shaped.counts.submitted, 2);
assert.equal(shaped.counts.approved, 1);
assert.equal(shaped.counts.rejected, 1);
assert.equal(shaped.secrets.pending_count, 1);
assert.equal(shaped.secrets.pending[0].env_var_name, 'BRAIN_OPS_JWT');
assert.equal(JSON.stringify(shaped).includes('must-not-leak'), false);
assert.equal(laneOf(approvals[2]), 'sa');
assert.equal(laneOf(approvals[3]), 'public-path');
assert.equal(laneOf(approvals[0]), 'other');
assert.equal(shaped.connections.healthy, 1);
assert.equal(shaped.connections.degraded, 1);
assert.equal(shaped.connections.total, 2);
assert.equal(shaped.series.length, 7);
assert.equal(shaped.series[6].submitted >= 1, true);

console.log('omstudioDashboard.test.js ok');
