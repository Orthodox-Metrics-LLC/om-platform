/**
 * Shape an OMStudio governance snapshot for the OM production dashboard.
 * Read-only. Never returns secret values.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const STUDIO_APPROVALS_URL = 'https://omstudio.orthodoxmetrics.com/governance/brain-approvals';

const INFRA_PREFIXES = [
  '[infra-public-dns]',
  '[infra-public-cert]',
  '[infra-pfsense-wan]',
  '[infra-prod-sni-omdev]',
  '[infra-public-file-grant]',
];

function laneOf(row) {
  const ui = row.ui || {};
  const summary = String(row.proposal_summary || ui.summary || '');
  const uiType = String(ui.request_type || '').toLowerCase();
  if (
    uiType.includes('host elevation')
    || ui.grant_requires_approve_sa
    || summary.includes('[host-sa]')
  ) {
    return 'sa';
  }
  if (INFRA_PREFIXES.some((prefix) => summary.includes(prefix))) return 'public-path';
  return 'other';
}

function laneLabel(lane) {
  if (lane === 'sa') return 'SA / host elevation';
  if (lane === 'public-path') return 'Public-path';
  return null;
}

function parseTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function inWindow(value, start, end) {
  const t = parseTime(value);
  return t != null && t >= start && t < end;
}

function changePercent(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function publicRow(row) {
  const lane = laneOf(row);
  return {
    id: row.id ?? null,
    ref: row.ref || null,
    current_state: row.current_state || 'UNKNOWN',
    classification: row.classification || null,
    domains: row.domains || null,
    proposal_summary: row.proposal_summary || row.ui?.summary || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    requester: row.ui?.requester || null,
    lane,
    lane_label: laneLabel(lane),
    review_url: STUDIO_APPROVALS_URL,
  };
}

function secretMeta(row) {
  return {
    name: row.name || row.env_var_name || 'Secret',
    env_var_name: row.env_var_name || null,
    render_target: row.render_target || null,
    value_status: row.value_status || null,
    updated_at: row.updated_at || null,
  };
}

function connectionRows(connectionsPayload, healthPayload) {
  const list = Array.isArray(connectionsPayload?.connections)
    ? connectionsPayload.connections
    : [];
  const systems = healthPayload?.systems && typeof healthPayload.systems === 'object'
    ? healthPayload.systems
    : {};
  const ids = new Set([
    ...list.map((row) => row.id).filter(Boolean),
    ...Object.keys(systems),
  ]);
  return [...ids].map((id) => {
    const summary = list.find((row) => row.id === id) || {};
    const health = systems[id] || {};
    return {
      id,
      name: summary.name || summary.label || id,
      status: health.status || 'not_configured',
      latency_ms: health.latencyMs ?? health.latency_ms ?? null,
    };
  });
}

function countState(rows, state) {
  return rows.filter((row) => row.current_state === state).length;
}

function weekDelta(rows, state, thisStart, prevStart, now) {
  const current = rows.filter((row) => row.current_state === state && inWindow(row.created_at, thisStart, now)).length;
  const previous = rows.filter((row) => row.current_state === state && inWindow(row.created_at, prevStart, thisStart)).length;
  return {
    this_week: current,
    prev_week: previous,
    change_percent: changePercent(current, previous),
  };
}

function daySeries(rows, now) {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - i);
    const end = new Date(start.getTime() + DAY_MS);
    const label = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const submitted = rows.filter((row) => inWindow(row.created_at, start.getTime(), end.getTime())).length;
    const approved = rows.filter((row) => (
      row.current_state === 'APPROVED'
      && inWindow(row.updated_at || row.created_at, start.getTime(), end.getTime())
    )).length;
    days.push({ label, submitted, approved });
  }
  return days;
}

/**
 * @param {{ approvals?: object[], secrets?: object[], connections?: object, health?: object, now?: Date }} input
 */
function shapeStudioDashboard(input) {
  const now = input.now instanceof Date ? input.now : new Date();
  const nowMs = now.getTime();
  const thisStart = nowMs - 7 * DAY_MS;
  const prevStart = nowMs - 14 * DAY_MS;
  const approvals = (input.approvals || []).map(publicRow);
  const secrets = (input.secrets || [])
    .filter((row) => !row.archived_at)
    .map(secretMeta);
  const pendingSecrets = secrets.filter((row) => row.value_status === 'pending');
  const configuredThisWeek = secrets.filter((row) => (
    row.value_status === 'configured' && inWindow(row.updated_at, thisStart, nowMs)
  )).length;
  const connections = connectionRows(input.connections, input.health);
  const byStatus = (status) => connections.filter((row) => row.status === status).length;

  return {
    studio_approvals_url: STUDIO_APPROVALS_URL,
    fetched_at: now.toISOString(),
    counts: {
      submitted: countState(approvals, 'SUBMITTED'),
      approved: countState(approvals, 'APPROVED'),
      rejected: countState(approvals, 'REJECTED'),
    },
    deltas: {
      submitted: weekDelta(approvals, 'SUBMITTED', thisStart, prevStart, nowMs),
      approved: weekDelta(approvals, 'APPROVED', thisStart, prevStart, nowMs),
      rejected: weekDelta(approvals, 'REJECTED', thisStart, prevStart, nowMs),
    },
    shares: {
      approved_percent: approvals.length
        ? Math.round((countState(approvals, 'APPROVED') / approvals.length) * 1000) / 10
        : 0,
      submitted_percent: approvals.length
        ? Math.round((countState(approvals, 'SUBMITTED') / approvals.length) * 1000) / 10
        : 0,
    },
    secrets: {
      pending_count: pendingSecrets.length,
      pending: pendingSecrets.slice(0, 8),
      configured_last_7d: configuredThisWeek,
    },
    connections: {
      total: connections.length,
      healthy: byStatus('healthy'),
      degraded: byStatus('degraded'),
      unreachable: byStatus('unreachable'),
      not_configured: byStatus('not_configured'),
      items: connections,
    },
    series: daySeries(approvals, now),
    approvals,
  };
}

module.exports = {
  shapeStudioDashboard,
  laneOf,
  STUDIO_APPROVALS_URL,
};
