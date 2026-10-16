/**
 * docsFilingApprovalMirror — best-effort mirror of an internal-documentation
 * filing request into the OMStudio "Brain Approvals" governance surface so it
 * appears there for the human super_admin to decide. Mirroring is
 * NON-authoritative and NON-blocking: OM remains the source of truth for the
 * filing request + the deterministic file operation. If OMStudio is unreachable
 * or unconfigured, request/approve/file still work.
 *
 * Operator-facing copy is human-readable. No raw internal routing strings
 * (e.g. "[requires_human_superadmin] OMAI: Proposal touches...") are emitted.
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
  const enabled = (process.env.DOCS_FILING_MIRROR_ENABLED === '1')
    || (process.env.SETTINGS_APPROVAL_MIRROR_ENABLED === '1')
    || (!!base && !!token);
  return { base: base.replace(/\/+$/, ''), token, enabled };
}

/** Human-readable one-liner for the operator queue summary. */
function proposalSummary(req) {
  const title = req.title || req.sourceFilename || 'document';
  return `File '${title}' into ${req.proposedTargetPath}`;
}

async function post(reqPath, body) {
  const { base, token } = config();
  const res = await fetch(`${base}${reqPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Source-System': 'om-docs-filing',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OMStudio ${reqPath} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

/** Returns the OMStudio ref string, or null if mirroring is disabled/failed. */
async function mirrorFilingRequest(req) {
  const { enabled } = config();
  if (!enabled) return null;
  const payload = {
    type: 'brain_approval_request',
    submitted_at: new Date().toISOString(),
    request: {
      approval_local_id: null,
      source_decision_id: null,
      session_id: req.receipt,
      classification: 'requires_human_superadmin',
      domains: Array.isArray(req.domains) ? req.domains.join(',') : null,
      proposal_summary: proposalSummary(req),
      // docs-filing extension fields (consumed by the extended OMStudio UI).
      change_kind: 'internal_doc_filing',
      request_type: 'Internal documentation filing',
      receipt: req.receipt,
      pickup_id: req.pickupId,
      document_title: req.title,
      source_filename: req.sourceFilename,
      proposed_target_path: req.proposedTargetPath,
      category: req.category,
      category_label: req.categoryLabel,
      visibility: req.visibility,
      requesting_actor: req.requestingActor,
      request_source: req.requestSource,
      reason: req.reason,
      checksum: req.checksum,
      auth_required: true,
    },
  };
  const out = await post('/api/governance/brain/approval-requests', payload);
  return out && (out.ref || out.id ? String(out.ref || out.id) : null);
}

async function mirrorFilingDecision(ref, decision, actor, note) {
  const { enabled } = config();
  if (!enabled || !ref) return null;
  return post('/api/governance/brain/audit-events', {
    type: 'brain_docs_filing_decision',
    emitted_at: new Date().toISOString(),
    event: {
      session_id: ref,
      decision,
      actor: actor || null,
      note: note || `Internal documentation filing request ${decision} by human super_admin`,
    },
  }).catch(() => null);
}

module.exports = { mirrorFilingRequest, mirrorFilingDecision, _config: config };
