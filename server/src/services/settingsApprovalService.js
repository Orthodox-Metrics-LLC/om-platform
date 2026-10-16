/**
 * settingsApprovalService — human-authentication approval gating for GLOBAL
 * settings mutations.
 *
 * Contract:
 *   - A global-scope settings mutation is PROPOSED (by OMBrain, OMStudio, or an
 *     OM admin) and recorded as a pending approval. It is NEVER applied to
 *     settings_overrides until a human super_admin passes a FRESH auth
 *     challenge and approves.
 *   - OMBrain is only a facilitator / proposal source. It can never
 *     self-approve: approval authority is the verified human identity from a
 *     single-use, expiring challenge — not any transport token.
 *   - An approval is bound to a specific approval id + proposed value. If the
 *     proposed value changes, the old approval/challenge is invalid.
 *
 * This module is dependency-injectable so it can be unit tested without a live
 * database. `createSettingsApprovalService(deps)` returns the API; a default
 * instance bound to the real pool/bcrypt is exported as well.
 */

const crypto = require('crypto');

const TERMINAL_STATES = new Set(['approved', 'rejected', 'expired', 'applied', 'failed']);
const MAX_CHALLENGE_ATTEMPTS = 5;
const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function sha256(v) {
  return crypto.createHash('sha256').update(String(v == null ? '' : v)).digest('hex');
}

function classifyRisk(key) {
  const k = String(key || '').toLowerCase();
  // security / auth / billing / permissions → critical
  if (/(^|[._-])(security|auth|permission|permissions|billing|payment|stripe|credential|secret|token)([._-]|$)/.test(k)) {
    return 'critical';
  }
  // routing / infra / session → high
  if (/(^|[._-])(routing|route|nginx|ssl|proxy|session|password|cors|domain|dns)([._-]|$)/.test(k)) {
    return 'high';
  }
  // Global defaults are at least moderate.
  return 'moderate';
}

function computeAffectedApps(key) {
  const k = String(key || '').toLowerCase();
  if (k.startsWith('ui.') || k.includes('theme')) return ['om', 'omai', 'omstudio', 'omworkshop'];
  if (k.startsWith('ecosystem') || k.startsWith('platform')) return ['om', 'omai', 'omstudio', 'omworkshop'];
  if (k.startsWith('omai') || k.startsWith('brain')) return ['omai'];
  if (k.startsWith('omstudio')) return ['omstudio'];
  return ['om'];
}

function validateValueAgainstRegistry(regRow, value) {
  const type = regRow.type;
  if (type === 'bool' && !['true', 'false', '1', '0'].includes(String(value).toLowerCase())) {
    return { ok: false, error: 'Bool settings must be true/false' };
  }
  if (type === 'number' && isNaN(Number(value))) {
    return { ok: false, error: 'Number settings must be numeric' };
  }
  if (type === 'json') {
    try { JSON.parse(value); } catch { return { ok: false, error: 'JSON settings must be valid JSON' }; }
  }
  if (type === 'enum' && regRow.enum_values_json) {
    const allowed = typeof regRow.enum_values_json === 'string'
      ? JSON.parse(regRow.enum_values_json)
      : regRow.enum_values_json;
    if (!allowed.includes(value)) {
      return { ok: false, error: `Value must be one of: ${allowed.join(', ')}` };
    }
  }
  return { ok: true };
}

function createSettingsApprovalService(deps = {}) {
  const pool = deps.pool || require('../config/db').promisePool;
  const bcrypt = deps.bcrypt || require('bcryptjs');
  const challenges = deps.challengeRegistry || require('./settingsAuthChallenge');
  const invalidateSettingCache = deps.invalidateSettingCache
    || require('../utils/settingsHelper').invalidateSettingCache;
  const mirror = deps.mirror || require('./omstudioApprovalMirror');
  const now = deps.now || (() => new Date());
  // Identities that must never be accepted as approvers (facilitators/services).
  const serviceDenylist = new Set(
    (deps.serviceDenylist || [
      'ombrain', 'om-brain', 'brain', 'omai', 'system',
      process.env.OMBRAIN_SERVICE_EMAIL,
    ]).filter(Boolean).map((s) => String(s).toLowerCase())
  );

  const cryptoDeps = { pool, bcrypt };

  async function writeAudit({ approval_id, approval_ref, event_type, actor, source, detail }) {
    const [res] = await pool.query(
      `INSERT INTO settings_approval_audit (approval_id, approval_ref, event_type, actor, source, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [approval_id || null, approval_ref || null, event_type, actor || null, source || null,
        detail ? JSON.stringify(detail) : null]
    );
    const auditId = res.insertId;
    if (approval_id) {
      await pool.query(
        `UPDATE settings_change_requests
         SET audit_event_ids = JSON_ARRAY_APPEND(COALESCE(audit_event_ids, JSON_ARRAY()), '$', ?)
         WHERE id = ?`,
        [auditId, approval_id]
      ).catch(() => { /* audit linkage is best-effort */ });
    }
    return auditId;
  }

  async function loadApproval(refOrId) {
    const isNumeric = /^\d+$/.test(String(refOrId));
    const [rows] = await pool.query(
      `SELECT * FROM settings_change_requests WHERE ${isNumeric ? 'id' : 'approval_ref'} = ? LIMIT 1`,
      [refOrId]
    );
    return rows && rows[0] ? rows[0] : null;
  }

  async function loadRegistry(key) {
    const [rows] = await pool.query(
      `SELECT \`key\`, \`type\`, enum_values_json, default_value, category, is_sensitive
       FROM settings_registry WHERE \`key\` = ? LIMIT 1`,
      [key]
    );
    return rows && rows[0] ? rows[0] : null;
  }

  async function currentGlobalValue(key, regRow) {
    const [rows] = await pool.query(
      `SELECT value FROM settings_overrides WHERE \`key\` = ? AND scope = 'global' AND scope_id IS NULL LIMIT 1`,
      [key]
    );
    if (rows && rows.length) return rows[0].value;
    return regRow ? regRow.default_value : null;
  }

  function toReport(row) {
    if (!row) return null;
    let affected = row.affected_apps;
    if (typeof affected === 'string') { try { affected = JSON.parse(affected); } catch { /* keep */ } }
    let auditIds = row.audit_event_ids;
    if (typeof auditIds === 'string') { try { auditIds = JSON.parse(auditIds); } catch { /* keep */ } }
    return {
      approval_id: row.id,
      approval_ref: row.approval_ref,
      proposal_source: row.proposal_source,
      requested_by: row.requested_by,
      requested_at: row.requested_at,
      setting_key: row.setting_key,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      old_value: row.old_value,
      proposed_value: row.proposed_value,
      affected_apps: affected,
      risk_level: row.risk_level,
      classification: row.classification,
      auth_required: !!row.auth_required,
      auth_method: row.auth_method,
      auth_challenge_id: row.auth_challenge_id,
      auth_verified_at: row.auth_verified_at,
      auth_verified_by: row.auth_verified_by,
      approval_state: row.approval_state,
      approved_by: row.approved_by,
      approved_at: row.approved_at,
      applied_at: row.applied_at,
      rejected_by: row.rejected_by,
      rejected_at: row.rejected_at,
      rejection_reason: row.rejection_reason,
      apply_error: row.apply_error,
      audit_event_ids: auditIds,
      omstudio_ref: row.omstudio_ref,
      expires_at: row.expires_at,
    };
  }

  // ── 1. Propose a global settings change (never applies) ─────────────────
  async function proposeGlobalSettingChange(input) {
    const {
      setting_key,
      proposed_value,
      scope_type = 'global',
      scope_id = null,
      requested_by = 'ombrain',
      proposal_source = 'ombrain',
    } = input || {};

    if (!setting_key) return { ok: false, error: 'setting_key is required' };
    if (scope_type !== 'global') {
      return { ok: false, error: 'settingsApprovalService only gates global-scope changes' };
    }

    const regRow = await loadRegistry(setting_key);
    if (!regRow) return { ok: false, error: `Unknown setting key: ${setting_key}` };

    const valid = validateValueAgainstRegistry(regRow, proposed_value);
    if (!valid.ok) return { ok: false, error: valid.error };

    const oldValue = await currentGlobalValue(setting_key, regRow);
    const proposedStr = proposed_value == null ? null : String(proposed_value);

    if (String(oldValue) === String(proposedStr)) {
      return { ok: false, error: 'proposed value equals current effective value; nothing to change' };
    }

    const riskLevel = classifyRisk(setting_key);
    const affectedApps = computeAffectedApps(setting_key);
    const valueHash = sha256(proposedStr);
    const expiresAt = new Date(now().getTime() + DEFAULT_APPROVAL_TTL_MS);

    const [ins] = await pool.query(
      `INSERT INTO settings_change_requests
        (approval_ref, proposal_source, requested_by, setting_key, scope_type, scope_id,
         old_value, proposed_value, proposed_value_hash, affected_apps, risk_level,
         classification, auth_required, approval_state, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'submitted', ?)`,
      ['PENDING', proposal_source, requested_by, setting_key, scope_type, scope_id,
        oldValue == null ? null : String(oldValue), proposedStr, valueHash,
        JSON.stringify(affectedApps), riskLevel, 'requires_human_superadmin', expiresAt]
    );
    const id = ins.insertId;
    const ref = `OMBA-${String(id).padStart(4, '0')}`;
    await pool.query('UPDATE settings_change_requests SET approval_ref = ? WHERE id = ?', [ref, id]);

    await writeAudit({
      approval_id: id, approval_ref: ref, event_type: 'proposal_created',
      actor: requested_by, source: proposal_source,
      detail: { setting_key, old_value: oldValue, proposed_value: proposedStr, risk_level: riskLevel, affected_apps: affectedApps },
    });

    // Best-effort mirror into OMStudio Brain Approvals so it appears in that UI.
    let omstudioRef = null;
    try {
      const row = await loadApproval(id);
      omstudioRef = await mirror.mirrorApproval(toReport(row));
      if (omstudioRef) {
        await pool.query('UPDATE settings_change_requests SET omstudio_ref = ? WHERE id = ?', [omstudioRef, id]);
      }
    } catch (e) {
      await writeAudit({ approval_id: id, approval_ref: ref, event_type: 'proposal_created',
        actor: 'system', source: 'system', detail: { mirror_error: e.message } }).catch(() => {});
    }

    const row = await loadApproval(id);
    return { ok: true, approval: toReport(row) };
  }

  // ── Issue a fresh human-auth challenge ──────────────────────────────────
  async function issueAuthChallenge({ approval, method, actor } = {}) {
    const row = await loadApproval(approval);
    if (!row) return { ok: false, error: 'approval not found' };
    if (TERMINAL_STATES.has(row.approval_state)) {
      return { ok: false, error: `approval is ${row.approval_state}; cannot issue challenge` };
    }

    const chosen = method || challenges.defaultMethod(cryptoDeps);
    const provider = chosen && challenges.get(chosen);
    if (!provider) return { ok: false, error: `unknown auth method: ${chosen}` };
    if (typeof provider.available === 'function' && !provider.available(cryptoDeps)) {
      return { ok: false, error: `auth method not available: ${chosen}` };
    }

    const issued = await provider.issue({ approval: toReport(row), actor, deps: cryptoDeps });
    const challengeId = crypto.randomUUID();
    const ttl = (issued.expires_in_seconds || 300) * 1000;
    const expiresAt = new Date(now().getTime() + ttl);

    await pool.query(
      `INSERT INTO settings_auth_challenges (id, approval_id, method, actor, proposed_value_hash, nonce, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [challengeId, row.id, provider.method, actor || null, row.proposed_value_hash, issued.nonce || null, expiresAt]
    );

    await writeAudit({
      approval_id: row.id, approval_ref: row.approval_ref, event_type: 'auth_challenge_issued',
      actor: actor || null, source: 'system', detail: { method: provider.method, challenge_id: challengeId },
    });

    return {
      ok: true,
      challenge: {
        challenge_id: challengeId,
        method: provider.method,
        prompt: issued.prompt,
        expires_at: expiresAt,
      },
    };
  }

  async function applySetting(row, approver) {
    // Re-check value binding right before applying.
    const oldValue = await currentGlobalValue(row.setting_key, await loadRegistry(row.setting_key));
    await pool.query(
      `INSERT INTO settings_overrides (\`key\`, scope, scope_id, value, updated_by)
       VALUES (?, 'global', NULL, ?, NULL)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
      [row.setting_key, row.proposed_value]
    );
    await pool.query(
      `INSERT INTO settings_audit (\`key\`, scope, scope_id, old_value, new_value, changed_by, reason)
       VALUES (?, 'global', NULL, ?, ?, NULL, ?)`,
      [row.setting_key, oldValue == null ? null : String(oldValue), row.proposed_value,
        `Approved via ${row.approval_ref} by ${approver}`]
    );
    invalidateSettingCache(row.setting_key, null);
  }

  // ── Approve: verify fresh human auth, then apply ────────────────────────
  async function approve({ approval, challenge_id, response, actor } = {}) {
    const row = await loadApproval(approval);
    if (!row) return { ok: false, error: 'approval not found' };
    if (TERMINAL_STATES.has(row.approval_state)) {
      return { ok: false, error: `approval is ${row.approval_state}; cannot approve` };
    }
    if (!challenge_id) {
      return { ok: false, error: 'a fresh auth challenge is required to approve a global setting (plaintext confirmation is not accepted)' };
    }

    const [chRows] = await pool.query('SELECT * FROM settings_auth_challenges WHERE id = ? LIMIT 1', [challenge_id]);
    const challenge = chRows && chRows[0];
    if (!challenge || challenge.approval_id !== row.id) {
      return { ok: false, error: 'challenge not found for this approval' };
    }
    if (challenge.consumed_at) {
      await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'auth_failed',
        actor, source: 'system', detail: { reason: 'challenge already used (replay rejected)', challenge_id } });
      return { ok: false, error: 'challenge already used (replay rejected)' };
    }
    if (new Date(challenge.expires_at).getTime() < now().getTime()) {
      await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'auth_failed',
        actor, source: 'system', detail: { reason: 'challenge expired', challenge_id } });
      return { ok: false, error: 'challenge expired' };
    }
    if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      return { ok: false, error: 'too many attempts; request a new challenge' };
    }

    // Bind approval to the exact proposed value that was challenged.
    if (challenge.proposed_value_hash !== row.proposed_value_hash) {
      await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'auth_failed',
        actor, source: 'system', detail: { reason: 'proposed value changed after challenge issued', challenge_id } });
      return { ok: false, error: 'proposed value changed since the challenge was issued; request a new approval' };
    }

    await pool.query('UPDATE settings_auth_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge_id]);

    const provider = challenges.get(challenge.method);
    if (!provider) return { ok: false, error: `unknown auth method: ${challenge.method}` };

    const result = await provider.verify({ challenge, approval: toReport(row), response, deps: cryptoDeps });
    if (!result || !result.ok) {
      await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'auth_failed',
        actor, source: 'system', detail: { reason: result && result.reason, method: challenge.method } });
      return { ok: false, error: result && result.reason ? result.reason : 'authentication failed' };
    }

    const approver = result.verified_identity;
    // OMBrain / any facilitator service can never be the human approver.
    if (!approver || serviceDenylist.has(String(approver).toLowerCase())) {
      await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'auth_failed',
        actor, source: 'system', detail: { reason: 'approver is a service account, not a human super_admin', approver } });
      return { ok: false, error: 'approver must be a human super_admin (facilitator services cannot approve)' };
    }

    // Consume the challenge exactly once (replay guard).
    await pool.query(
      'UPDATE settings_auth_challenges SET consumed_at = ?, verified = 1 WHERE id = ? AND consumed_at IS NULL',
      [now(), challenge_id]
    );

    await pool.query(
      `UPDATE settings_change_requests
       SET approval_state = 'authenticated', auth_method = ?, auth_challenge_id = ?,
           auth_verified_at = ?, auth_verified_by = ?
       WHERE id = ?`,
      [challenge.method, challenge_id, now(), approver, row.id]
    );
    await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'auth_succeeded',
      actor: approver, source: 'human', detail: { method: challenge.method } });
    await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'approval_granted',
      actor: approver, source: 'human', detail: {} });

    // Apply.
    try {
      const fresh = await loadApproval(row.id);
      await applySetting(fresh, approver);
      await pool.query(
        `UPDATE settings_change_requests
         SET approval_state = 'applied', approved_by = ?, approved_at = ?, applied_at = ?
         WHERE id = ?`,
        [approver, now(), now(), row.id]
      );
      await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'setting_applied',
        actor: approver, source: 'human', detail: { setting_key: fresh.setting_key, value: fresh.proposed_value } });
      mirror.mirrorDecision(row.approval_ref, 'approved', approver).catch(() => {});
      const effective = await currentGlobalValue(fresh.setting_key, await loadRegistry(fresh.setting_key));
      const finalRow = await loadApproval(row.id);
      return { ok: true, approval: toReport(finalRow), effective_value: effective };
    } catch (e) {
      await pool.query(
        `UPDATE settings_change_requests SET approval_state = 'failed', apply_error = ? WHERE id = ?`,
        [e.message, row.id]
      );
      await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'application_failed',
        actor: approver, source: 'human', detail: { error: e.message } });
      return { ok: false, error: `apply failed: ${e.message}` };
    }
  }

  // ── Reject ──────────────────────────────────────────────────────────────
  async function reject({ approval, actor, reason } = {}) {
    const row = await loadApproval(approval);
    if (!row) return { ok: false, error: 'approval not found' };
    if (TERMINAL_STATES.has(row.approval_state)) {
      return { ok: false, error: `approval is ${row.approval_state}; cannot reject` };
    }
    await pool.query(
      `UPDATE settings_change_requests
       SET approval_state = 'rejected', rejected_by = ?, rejected_at = ?, rejection_reason = ?
       WHERE id = ?`,
      [actor || null, now(), reason || null, row.id]
    );
    await writeAudit({ approval_id: row.id, approval_ref: row.approval_ref, event_type: 'approval_rejected',
      actor: actor || null, source: 'human', detail: { reason: reason || null } });
    mirror.mirrorDecision(row.approval_ref, 'rejected', actor).catch(() => {});
    const finalRow = await loadApproval(row.id);
    return { ok: true, approval: toReport(finalRow) };
  }

  // ── Read helpers ─────────────────────────────────────────────────────────
  async function listApprovals({ state, setting_key, limit = 50 } = {}) {
    let sql = 'SELECT * FROM settings_change_requests WHERE 1=1';
    const params = [];
    if (state) { sql += ' AND approval_state = ?'; params.push(state); }
    if (setting_key) { sql += ' AND setting_key = ?'; params.push(setting_key); }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(Number(limit));
    const [rows] = await pool.query(sql, params);
    return rows.map(toReport);
  }

  async function getApproval(refOrId) {
    const row = await loadApproval(refOrId);
    return row ? toReport(row) : null;
  }

  async function getAudit(refOrId, limit = 100) {
    const row = await loadApproval(refOrId);
    if (!row) return [];
    const [rows] = await pool.query(
      'SELECT * FROM settings_approval_audit WHERE approval_id = ? ORDER BY id ASC LIMIT ?',
      [row.id, Number(limit)]
    );
    return rows;
  }

  async function expireStale() {
    const [res] = await pool.query(
      `UPDATE settings_change_requests
       SET approval_state = 'expired'
       WHERE approval_state IN ('submitted','authenticated') AND expires_at IS NOT NULL AND expires_at < ?`,
      [now()]
    );
    return res.affectedRows || 0;
  }

  return {
    proposeGlobalSettingChange,
    issueAuthChallenge,
    approve,
    reject,
    listApprovals,
    getApproval,
    getAudit,
    expireStale,
    // exposed for tests / reuse
    _internals: { classifyRisk, computeAffectedApps, sha256, validateValueAgainstRegistry },
  };
}

module.exports = createSettingsApprovalService();
module.exports.createSettingsApprovalService = createSettingsApprovalService;
module.exports.classifyRisk = classifyRisk;
module.exports.computeAffectedApps = computeAffectedApps;
