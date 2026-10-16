/**
 * omstudioApprovalMirror — best-effort mirror of a global-settings approval
 * into the OMStudio "Brain Approvals" governance surface so it appears in that
 * UI. Mirroring is NON-authoritative and NON-blocking: OM remains the source of
 * truth for the settings approval + apply. If OMStudio is unreachable or not
 * configured, propose/approve still work.
 *
 * OMStudio governance API (Fork-A):
 *   POST {base}/api/governance/brain/approval-requests   (service token)
 *   POST {base}/api/governance/brain/audit-events        (service token)
 */

function config() {
  const base = process.env.OMSTUDIO_GOVERNANCE_BASE_URL
    || process.env.OMSTUDIO_BRAIN_GOV_BASE_URL
    || '';
  const token = process.env.OMSTUDIO_SERVICE_TOKEN || '';
  const enabled = (process.env.SETTINGS_APPROVAL_MIRROR_ENABLED === '1') || (!!base && !!token);
  return { base: base.replace(/\/+$/, ''), token, enabled };
}

function proposalSummary(report) {
  const apps = Array.isArray(report.affected_apps) ? report.affected_apps.join(',') : '';
  // Space-delimited key=value tokens; values must not contain spaces so the
  // OMStudio UI can parse them back out for the "Global Setting Change" panel.
  const tok = (v) => String(v == null ? '' : v).replace(/\s+/g, '_');
  return [
    '[Global Setting Change]',
    `key=${tok(report.setting_key)}`,
    `old=${report.old_value == null ? '(default)' : tok(report.old_value)}`,
    `new=${tok(report.proposed_value)}`,
    `scope=${tok(report.scope_type)}`,
    `risk=${tok(report.risk_level)}`,
    `affected=${tok(apps)}`,
    `proposed_by=${tok(report.requested_by)}`,
    'auth_required=yes',
  ].join(' ');
}

async function post(path, body) {
  const { base, token } = config();
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Source-System': 'om-settings-approval',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OMStudio ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

/** Returns the OMStudio ref string, or null if mirroring is disabled/failed. */
async function mirrorApproval(report) {
  const { enabled } = config();
  if (!enabled) return null;
  const payload = {
    type: 'brain_approval_request',
    submitted_at: new Date().toISOString(),
    request: {
      approval_local_id: report.approval_id,
      source_decision_id: null,
      session_id: report.approval_ref,
      classification: report.classification,
      domains: Array.isArray(report.affected_apps) ? report.affected_apps.join(',') : null,
      proposal_summary: proposalSummary(report),
      // settings-specific extension fields (consumed by the extended UI if present)
      change_kind: 'global_setting',
      setting_key: report.setting_key,
      scope_type: report.scope_type,
      old_value: report.old_value,
      proposed_value: report.proposed_value,
      affected_apps: report.affected_apps,
      risk_level: report.risk_level,
      auth_required: true,
    },
  };
  const out = await post('/api/governance/brain/approval-requests', payload);
  return out && (out.ref || out.id ? String(out.ref || out.id) : null);
}

async function mirrorDecision(ref, decision, actor) {
  const { enabled } = config();
  if (!enabled) return null;
  return post('/api/governance/brain/audit-events', {
    type: 'brain_settings_decision',
    emitted_at: new Date().toISOString(),
    event: {
      session_id: ref,
      classification: 'requires_human_superadmin',
      decision,
      actor: actor || null,
      note: `Global settings approval ${ref} ${decision} by human super_admin`,
    },
  }).catch(() => null);
}

module.exports = { mirrorApproval, mirrorDecision, _config: config };
