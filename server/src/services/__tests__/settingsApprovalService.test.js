#!/usr/bin/env node
/**
 * Unit tests for services/settingsApprovalService.js
 *
 * Proves the human-authentication approval gating contract for GLOBAL settings:
 *   - proposing a change does NOT apply it
 *   - approval with a fresh, verified human challenge DOES apply it
 *   - replay of a consumed challenge is rejected
 *   - changing the proposed value after a challenge invalidates approval
 *   - a facilitator/service (OMBrain) can never self-approve
 *   - plaintext "yes" is insufficient (no challenge => no approval)
 *   - applied setting records the HUMAN approver, and audit shows the source
 *
 * Uses an in-memory fake pool + fake bcrypt via dependency injection, so no
 * live database is required.
 *
 * Run: node server/src/services/__tests__/settingsApprovalService.test.js
 */

const { createSettingsApprovalService } = require('../settingsApprovalService');
const challengeRegistry = require('../settingsAuthChallenge');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Fake DB ────────────────────────────────────────────────────────────────
function makeFakePool() {
  const db = {
    registry: new Map(),
    overrides: [],            // { key, scope, scope_id, value }
    settingsAudit: [],
    approvals: [],            // mutable row objects
    challenges: new Map(),
    approvalAudit: [],
    users: new Map(),
    _apId: 0,
    _auditId: 0,
  };

  function findApproval(field, val) {
    return db.approvals.find((r) => String(r[field]) === String(val)) || null;
  }

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // ── settings_approval_audit insert
    if (/^INSERT INTO settings_approval_audit/i.test(s)) {
      db._auditId += 1;
      const [approval_id, approval_ref, event_type, actor, source, detail] = params;
      db.approvalAudit.push({ id: db._auditId, approval_id, approval_ref, event_type, actor, source, detail });
      return [{ insertId: db._auditId }];
    }
    if (/UPDATE settings_change_requests SET audit_event_ids/i.test(s)) {
      return [{ affectedRows: 1 }];
    }

    // ── registry lookup
    if (/FROM settings_registry WHERE `key` = \?/i.test(s)) {
      const r = db.registry.get(params[0]);
      return [r ? [r] : []];
    }

    // ── current global override value
    if (/SELECT value FROM settings_overrides WHERE `key` = \? AND scope = 'global'/i.test(s)) {
      const ov = db.overrides.find((o) => o.key === params[0] && o.scope === 'global');
      return [ov ? [{ value: ov.value }] : []];
    }

    // ── insert approval
    if (/^INSERT INTO settings_change_requests/i.test(s)) {
      db._apId += 1;
      const [approval_ref, proposal_source, requested_by, setting_key, scope_type, scope_id,
        old_value, proposed_value, proposed_value_hash, affected_apps, risk_level,
        classification, expires_at] = params;
      const row = {
        id: db._apId, approval_ref, proposal_source, requested_by,
        requested_at: new Date(), setting_key, scope_type, scope_id,
        old_value, proposed_value, proposed_value_hash, affected_apps,
        risk_level, classification, auth_required: 1, approval_state: 'submitted',
        auth_method: null, auth_challenge_id: null, auth_verified_at: null, auth_verified_by: null,
        approved_by: null, approved_at: null, applied_at: null,
        rejected_by: null, rejected_at: null, rejection_reason: null, apply_error: null,
        audit_event_ids: null, omstudio_ref: null, expires_at,
      };
      db.approvals.push(row);
      return [{ insertId: db._apId }];
    }
    if (/UPDATE settings_change_requests SET approval_ref = \? WHERE id = \?/i.test(s)) {
      const r = findApproval('id', params[1]); if (r) r.approval_ref = params[0];
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE settings_change_requests SET omstudio_ref/i.test(s)) {
      const r = findApproval('id', params[1]); if (r) r.omstudio_ref = params[0];
      return [{ affectedRows: 1 }];
    }

    // ── load approval
    if (/^SELECT \* FROM settings_change_requests WHERE id = \?/i.test(s)) {
      const r = findApproval('id', params[0]); return [r ? [r] : []];
    }
    if (/^SELECT \* FROM settings_change_requests WHERE approval_ref = \?/i.test(s)) {
      const r = findApproval('approval_ref', params[0]); return [r ? [r] : []];
    }

    // ── challenges
    if (/^INSERT INTO settings_auth_challenges/i.test(s)) {
      const [id, approval_id, method, actor, proposed_value_hash, nonce, expires_at] = params;
      db.challenges.set(id, {
        id, approval_id, method, actor, proposed_value_hash, nonce,
        expires_at, issued_at: new Date(), consumed_at: null, verified: 0, attempts: 0,
      });
      return [{ insertId: id }];
    }
    if (/^SELECT \* FROM settings_auth_challenges WHERE id = \?/i.test(s)) {
      const c = db.challenges.get(params[0]); return [c ? [c] : []];
    }
    if (/UPDATE settings_auth_challenges SET attempts = attempts \+ 1/i.test(s)) {
      const c = db.challenges.get(params[0]); if (c) c.attempts += 1;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE settings_auth_challenges SET consumed_at = \?, verified = 1/i.test(s)) {
      const c = db.challenges.get(params[1]);
      if (c && c.consumed_at == null) { c.consumed_at = params[0]; c.verified = 1; return [{ affectedRows: 1 }]; }
      return [{ affectedRows: 0 }];
    }

    // ── users (for session_reauth provider)
    if (/FROM users WHERE email = \?/i.test(s)) {
      const u = db.users.get(params[0]); return [u ? [u] : []];
    }

    // ── approval state transitions
    if (/UPDATE settings_change_requests SET approval_state = 'authenticated'/i.test(s)) {
      const r = findApproval('id', params[4]);
      if (r) { r.approval_state = 'authenticated'; r.auth_method = params[0]; r.auth_challenge_id = params[1]; r.auth_verified_at = params[2]; r.auth_verified_by = params[3]; }
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE settings_change_requests SET approval_state = 'applied'/i.test(s)) {
      const r = findApproval('id', params[3]);
      if (r) { r.approval_state = 'applied'; r.approved_by = params[0]; r.approved_at = params[1]; r.applied_at = params[2]; }
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE settings_change_requests SET approval_state = 'failed'/i.test(s)) {
      const r = findApproval('id', params[1]);
      if (r) { r.approval_state = 'failed'; r.apply_error = params[0]; }
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE settings_change_requests SET approval_state = 'rejected'/i.test(s)) {
      const r = findApproval('id', params[3]);
      if (r) { r.approval_state = 'rejected'; r.rejected_by = params[0]; r.rejected_at = params[1]; r.rejection_reason = params[2]; }
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE settings_change_requests SET approval_state = 'expired'/i.test(s)) {
      let n = 0;
      for (const r of db.approvals) {
        if (['submitted', 'authenticated'].includes(r.approval_state) && r.expires_at && new Date(r.expires_at) < new Date(params[0])) {
          r.approval_state = 'expired'; n += 1;
        }
      }
      return [{ affectedRows: n }];
    }

    // ── apply: settings_overrides upsert
    if (/^INSERT INTO settings_overrides/i.test(s)) {
      const [key, value] = params;
      const ex = db.overrides.find((o) => o.key === key && o.scope === 'global');
      if (ex) ex.value = value; else db.overrides.push({ key, scope: 'global', scope_id: null, value });
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO settings_audit/i.test(s)) {
      db.settingsAudit.push({ key: params[0], old_value: params[1], new_value: params[2], reason: params[3] });
      return [{ affectedRows: 1 }];
    }

    // ── audit read
    if (/FROM settings_approval_audit WHERE approval_id = \?/i.test(s)) {
      return [db.approvalAudit.filter((a) => a.approval_id === params[0])];
    }

    throw new Error(`fake pool: unhandled query: ${s}`);
  }

  return { db, query };
}

const fakeBcrypt = {
  async compare(pw, hash) { return `plain:${pw}` === hash; },
};

function makeService(pool) {
  return createSettingsApprovalService({
    pool,
    bcrypt: fakeBcrypt,
    challengeRegistry,
    invalidateSettingCache: () => {},
    mirror: { mirrorApproval: async () => null, mirrorDecision: async () => null },
  });
}

function seed(pool) {
  pool.db.registry.set('ui.theme.policy', {
    key: 'ui.theme.policy', type: 'enum',
    enum_values_json: '["manual","auto_time","auto_solar"]',
    default_value: 'manual',
  });
  pool.db.registry.set('security.session.timeout', {
    key: 'security.session.timeout', type: 'number', enum_values_json: null, default_value: '3600',
  });
  pool.db.users.set('admin@om.org', {
    id: 1, email: 'admin@om.org', role: 'super_admin', is_active: 1, password_hash: 'plain:correct-password',
  });
  pool.db.users.set('editor@om.org', {
    id: 2, email: 'editor@om.org', role: 'editor', is_active: 1, password_hash: 'plain:pw',
  });
}

async function run() {
  // ── Test 1: propose does not apply ────────────────────────────────────────
  console.log('\nTest 1: propose creates pending approval and does NOT apply');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const r = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_solar',
      requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    assert(r.ok, 'propose ok');
    assert(/^OMBA-\d{4}$/.test(r.approval.approval_ref), `ref is OMBA-#### (${r.approval && r.approval.approval_ref})`);
    assert(r.approval.approval_state === 'submitted', 'state=submitted');
    assert(r.approval.risk_level === 'moderate', 'ui.* risk=moderate');
    assert(r.approval.proposal_source === 'ombrain', 'source=ombrain');
    assert(pool.db.overrides.length === 0, 'no override written on propose');
    const created = pool.db.approvalAudit.find((a) => a.event_type === 'proposal_created');
    assert(!!created, 'audit: proposal_created');
  }

  // ── Test 2: approve with fresh human auth applies ─────────────────────────
  console.log('\nTest 2: approve with fresh verified human challenge applies');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_solar', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const ch = await svc.issueAuthChallenge({ approval: approval.approval_ref, method: 'session_reauth', actor: 'admin@om.org' });
    assert(ch.ok, 'challenge issued');
    const res = await svc.approve({
      approval: approval.approval_ref, challenge_id: ch.challenge.challenge_id,
      response: { email: 'admin@om.org', password: 'correct-password' }, actor: 'admin@om.org',
    });
    assert(res.ok, 'approve ok');
    assert(res.approval.approval_state === 'applied', 'state=applied');
    assert(res.approval.approved_by === 'admin@om.org', 'approved_by = human super_admin');
    assert(res.effective_value === 'auto_solar', 'effective value applied');
    assert(pool.db.overrides.some((o) => o.key === 'ui.theme.policy' && o.value === 'auto_solar'), 'override written on approve');
    const evTypes = pool.db.approvalAudit.map((a) => a.event_type);
    assert(evTypes.includes('auth_succeeded'), 'audit: auth_succeeded');
    assert(evTypes.includes('setting_applied'), 'audit: setting_applied');
    const appliedEv = pool.db.approvalAudit.find((a) => a.event_type === 'setting_applied');
    assert(appliedEv.actor === 'admin@om.org', 'applied audit actor = human (not ombrain)');
  }

  // ── Test 3: plaintext confirm insufficient (no challenge) ─────────────────
  console.log('\nTest 3: approval without a challenge is refused');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_time', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const res = await svc.approve({ approval: approval.approval_ref, actor: 'admin@om.org', response: { confirm: 'yes' } });
    assert(!res.ok, 'approve without challenge rejected');
    assert(/fresh auth challenge/i.test(res.error), 'error mentions fresh auth challenge');
    assert(pool.db.overrides.length === 0, 'nothing applied');
  }

  // ── Test 4: wrong password fails, audited ─────────────────────────────────
  console.log('\nTest 4: wrong credentials fail and are audited');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_time', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const ch = await svc.issueAuthChallenge({ approval: approval.approval_ref, method: 'session_reauth', actor: 'admin@om.org' });
    const res = await svc.approve({
      approval: approval.approval_ref, challenge_id: ch.challenge.challenge_id,
      response: { email: 'admin@om.org', password: 'WRONG' }, actor: 'admin@om.org',
    });
    assert(!res.ok, 'wrong password rejected');
    assert(pool.db.overrides.length === 0, 'nothing applied on failed auth');
    assert(pool.db.approvalAudit.some((a) => a.event_type === 'auth_failed'), 'audit: auth_failed');
  }

  // ── Test 5: non-super_admin cannot approve ────────────────────────────────
  console.log('\nTest 5: non-super_admin credentials rejected');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_time', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const ch = await svc.issueAuthChallenge({ approval: approval.approval_ref, method: 'session_reauth', actor: 'editor@om.org' });
    const res = await svc.approve({
      approval: approval.approval_ref, challenge_id: ch.challenge.challenge_id,
      response: { email: 'editor@om.org', password: 'pw' }, actor: 'editor@om.org',
    });
    assert(!res.ok, 'editor rejected');
    assert(/super_admin/i.test(res.error), 'error mentions super_admin');
  }

  // ── Test 6: replay of consumed challenge rejected ─────────────────────────
  console.log('\nTest 6: replay of a consumed challenge is rejected');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_solar', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const ch = await svc.issueAuthChallenge({ approval: approval.approval_ref, method: 'session_reauth', actor: 'admin@om.org' });
    const first = await svc.approve({
      approval: approval.approval_ref, challenge_id: ch.challenge.challenge_id,
      response: { email: 'admin@om.org', password: 'correct-password' }, actor: 'admin@om.org',
    });
    assert(first.ok, 'first approve ok');
    const replay = await svc.approve({
      approval: approval.approval_ref, challenge_id: ch.challenge.challenge_id,
      response: { email: 'admin@om.org', password: 'correct-password' }, actor: 'admin@om.org',
    });
    assert(!replay.ok, 'replay rejected');
    assert(/already/i.test(replay.error) || /is applied/i.test(replay.error), `replay error (${replay.error})`);
  }

  // ── Test 7: changing proposed value after challenge invalidates approval ───
  console.log('\nTest 7: value change after challenge requires a new approval');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_solar', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const ch = await svc.issueAuthChallenge({ approval: approval.approval_ref, method: 'session_reauth', actor: 'admin@om.org' });
    // Tamper: change the stored proposed value + hash after the challenge was issued.
    const row = pool.db.approvals.find((r) => r.approval_ref === approval.approval_ref);
    row.proposed_value = 'manual';
    row.proposed_value_hash = svc._internals.sha256('manual');
    const res = await svc.approve({
      approval: approval.approval_ref, challenge_id: ch.challenge.challenge_id,
      response: { email: 'admin@om.org', password: 'correct-password' }, actor: 'admin@om.org',
    });
    assert(!res.ok, 'approval rejected after value change');
    assert(/changed/i.test(res.error), 'error mentions value changed');
  }

  // ── Test 8: OMBrain / service identity can never self-approve ──────────────
  console.log('\nTest 8: facilitator service identity cannot approve');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    // Register a fake provider that "verifies" but returns a service identity.
    challengeRegistry.register({
      method: 'fake_service', label: 'test', available: () => true,
      async issue() { return { prompt: 'x', expires_in_seconds: 60 }; },
      async verify() { return { ok: true, verified_identity: 'ombrain' }; },
    });
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_solar', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const ch = await svc.issueAuthChallenge({ approval: approval.approval_ref, method: 'fake_service', actor: 'ombrain' });
    const res = await svc.approve({
      approval: approval.approval_ref, challenge_id: ch.challenge.challenge_id, response: {}, actor: 'ombrain',
    });
    assert(!res.ok, 'ombrain self-approval rejected');
    assert(/service account|human super_admin/i.test(res.error), 'error mentions human requirement');
    assert(pool.db.overrides.length === 0, 'nothing applied');
  }

  // ── Test 9: risk classification for security keys ─────────────────────────
  console.log('\nTest 9: security/session keys classified high/critical');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const r = await svc.proposeGlobalSettingChange({
      setting_key: 'security.session.timeout', proposed_value: '7200', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    assert(r.ok, 'propose security key ok');
    assert(['high', 'critical'].includes(r.approval.risk_level), `security key risk elevated (${r.approval.risk_level})`);
  }

  // ── Test 10: reject transitions to rejected ───────────────────────────────
  console.log('\nTest 10: reject moves approval to rejected');
  {
    const pool = makeFakePool(); seed(pool); const svc = makeService(pool);
    const { approval } = await svc.proposeGlobalSettingChange({
      setting_key: 'ui.theme.policy', proposed_value: 'auto_solar', requested_by: 'ombrain', proposal_source: 'ombrain',
    });
    const res = await svc.reject({ approval: approval.approval_ref, actor: 'admin@om.org', reason: 'not now' });
    assert(res.ok, 'reject ok');
    assert(res.approval.approval_state === 'rejected', 'state=rejected');
    assert(pool.db.approvalAudit.some((a) => a.event_type === 'approval_rejected'), 'audit: approval_rejected');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
