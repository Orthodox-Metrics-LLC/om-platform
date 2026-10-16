/**
 * OM Docs — agent dispatch contract (OMPKT-20260703-0002).
 *
 * Endpoints agents use to work a Dropbox → Agent dispatch:
 *   GET  /agent-queue?agent=<id>            — assigned, unclaimed work
 *   GET  /dispatch/:dispatchId              — dispatch detail + notifications
 *   POST /dispatch/:dispatchId/claim        — exclusive claim with a lease
 *   POST /dispatch/:dispatchId/start        — mark in progress
 *   POST /dispatch/:dispatchId/heartbeat    — extend lease
 *   POST /dispatch/:dispatchId/block        — mark blocked (reason)
 *   POST /dispatch/:dispatchId/return       — return result into OM Docs Pickup
 *   POST /dispatch/:dispatchId/fail         — mark failed (error)
 *   POST /dispatch/:dispatchId/reassign     — operator: reassign agent (pre-claim)
 *   POST /dispatch/:dispatchId/cancel       — operator: cancel (pre-claim)
 *   POST /expire-sweep                      — run lease/timeout sweep
 *
 * Server-side enforcement: only the assigned agent may claim (super_admin may
 * override); claim is idempotent for the current holder; expired leases are
 * reclaimable; terminal dispatches are not reclaimable; every transition writes
 * an audit event and emits an OMBrain governance event.
 */

const express = require('express');
const ApiResponse = require('../utils/apiResponse');
const dispatchService = require('../services/docsDispatchService');
const storageService = require('../services/docsStorageService');

const router = express.Router();

function getUserMeta(req) {
  const user = req.session?.user || req.user || {};
  return {
    id: user.id ?? null,
    email: user.email ?? null,
    name: user.name || user.username || user.email || 'unknown',
    role: user.role ?? null,
  };
}

function agentIdentity(req) {
  const user = getUserMeta(req);
  const explicit = req.body?.agent || req.query?.agent;
  return {
    agentId: explicit || user.name || user.email,
    id: user.id,
    email: user.email,
    name: user.name,
    elevated: user.role === 'super_admin',
  };
}

function isValidDispatchId(id) {
  return id && typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);
}

function handleError(err, res) {
  if (err instanceof dispatchService.DispatchError) {
    return res.status(err.status || 400).json(ApiResponse.error(err.code, err.code, err.status || 400, err.details || undefined));
  }
  console.error('[om-docs] error:', err);
  return res.status(500).json(ApiResponse.error('Dispatch action failed', 'SERVER_ERROR', 500));
}

router.get('/agent-queue', async (req, res) => {
  try {
    const agent = req.query.agent || getUserMeta(req).name;
    if (!agent) return res.status(400).json(ApiResponse.error('agent is required', 'VALIDATION_ERROR', 400));
    const items = await dispatchService.getAgentQueue(String(agent));
    return res.json(ApiResponse.success({ agent: String(agent), items }));
  } catch (err) {
    return handleError(err, res);
  }
});

router.get('/dispatch/:dispatchId', async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const dispatch = await dispatchService.getDispatch(dispatchId);
    if (!dispatch) return res.status(404).json(ApiResponse.error('Dispatch not found', 'NOT_FOUND', 404));
    const notifications = await dispatchService.getNotificationsForDispatch(dispatchId);
    return res.json(ApiResponse.success({ dispatch, notifications }));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/dispatch/:dispatchId/claim', async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.claimDispatch(dispatchId, agentIdentity(req), {
      leaseMin: Number(req.body?.leaseMinutes) || undefined,
    });
    return res.json(ApiResponse.success(result, result.idempotent ? 'Already claimed' : 'Dispatch claimed'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/dispatch/:dispatchId/start', async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.startDispatch(dispatchId, agentIdentity(req));
    return res.json(ApiResponse.success(result, 'Dispatch in progress'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/dispatch/:dispatchId/heartbeat', async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.heartbeat(dispatchId, agentIdentity(req), {
      leaseMin: Number(req.body?.leaseMinutes) || undefined,
    });
    return res.json(ApiResponse.success(result, 'Heartbeat recorded'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/dispatch/:dispatchId/block', async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.blockDispatch(dispatchId, agentIdentity(req), req.body?.reason);
    return res.json(ApiResponse.success(result, 'Dispatch blocked'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/dispatch/:dispatchId/return', async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.returnDispatch(dispatchId, agentIdentity(req), {
      content: typeof req.body?.content === 'string' ? req.body.content : undefined,
      title: req.body?.title,
      notes: req.body?.notes,
      fileName: req.body?.fileName,
    });
    return res.json(ApiResponse.success(result, 'Result returned to pickup'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/dispatch/:dispatchId/fail', async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.failDispatch(dispatchId, agentIdentity(req), req.body?.error || req.body?.reason);
    return res.json(ApiResponse.success(result, 'Dispatch failed'));
  } catch (err) {
    return handleError(err, res);
  }
});

// ── operator-only dispatch controls ────────────────────────────────────────────
function requireOperator(req, res, next) {
  const role = getUserMeta(req).role;
  if (role !== 'admin' && role !== 'super_admin') {
    return res.status(403).json(ApiResponse.error('Operator role required', 'FORBIDDEN', 403));
  }
  next();
}

router.post('/dispatch/:dispatchId/reassign', requireOperator, async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const newAgent = req.body?.assignedAgent || req.body?.agent;
    if (!newAgent) return res.status(400).json(ApiResponse.error('assignedAgent is required', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.reassignAgent(dispatchId, getUserMeta(req), newAgent);
    return res.json(ApiResponse.success(result, 'Dispatch reassigned'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/dispatch/:dispatchId/cancel', requireOperator, async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!isValidDispatchId(dispatchId)) return res.status(400).json(ApiResponse.error('Invalid dispatch id', 'VALIDATION_ERROR', 400));
    const result = await dispatchService.cancelDispatch(dispatchId, getUserMeta(req), req.body?.reason);
    return res.json(ApiResponse.success(result, 'Dispatch cancelled'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/expire-sweep', requireOperator, async (req, res) => {
  try {
    const result = await dispatchService.expireStaleDispatches();
    return res.json(ApiResponse.success(result, 'Sweep complete'));
  } catch (err) {
    return handleError(err, res);
  }
});

// ── storage contract: manifests, dedupe scan, safe cleanup (admin) ─────────────
// All mutating actions are DRY-RUN by default; a real apply requires
// { dryRun: false, confirm: true } in the body.

function cleanupOpts(req) {
  return {
    dryRun: req.body?.dryRun !== false, // default true
    confirm: req.body?.confirm === true, // default false
    actor: getUserMeta(req),
  };
}

/** Read-only dedupe/orphan/stale scan + a per-file warnings map for the UI. */
router.get('/storage/scan', async (req, res) => {
  try {
    const scan = await storageService.scanStorage();
    const warnings = {};
    const add = (id, w) => { if (!id) return; (warnings[id] = warnings[id] || []).push(w); };
    for (const g of scan.duplicateGroups) g.members.forEach((m) => add(m.dbId, 'duplicate'));
    for (const c of scan.crossCopies) c.pickupCopies.forEach((m) => add(m.dbId, 'copies_drop'));
    for (const t of scan.tests) add(t.dbId, 'test');
    for (const o of scan.orphans) add(o.dbId, 'legacy_orphan');
    for (const s of scan.staleDb) add(s.dbId, 'stale_metadata');
    return res.json(ApiResponse.success({
      summary: scan.summary,
      duplicateGroups: scan.duplicateGroups,
      crossCopies: scan.crossCopies,
      tests: scan.tests,
      orphans: scan.orphans.map((o) => ({ dbId: o.dbId, name: o.name, title: o.title })),
      staleDb: scan.staleDb,
      diskVsManifest: scan.diskVsManifest,
      warnings,
    }));
  } catch (err) {
    return handleError(err, res);
  }
});

/** Compact health summary + warnings map for UI badges. */
router.get('/storage/health', async (req, res) => {
  try {
    const scan = await storageService.scanStorage();
    const warnings = {};
    const add = (id, w) => { if (!id) return; (warnings[id] = warnings[id] || []).push(w); };
    for (const g of scan.duplicateGroups) g.members.forEach((m) => add(m.dbId, 'duplicate'));
    for (const c of scan.crossCopies) c.pickupCopies.forEach((m) => add(m.dbId, 'copies_drop'));
    for (const t of scan.tests) add(t.dbId, 'test');
    for (const o of scan.orphans) add(o.dbId, 'legacy_orphan');
    for (const s of scan.staleDb) add(s.dbId, 'stale_metadata');
    return res.json(ApiResponse.success({ summary: scan.summary, warnings }));
  } catch (err) {
    return handleError(err, res);
  }
});

router.get('/storage/verify', async (req, res) => {
  try {
    return res.json(ApiResponse.success(await storageService.verifyManifests()));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/storage/rebuild-manifests', requireOperator, async (req, res) => {
  try {
    const dryRun = req.body?.apply !== true;
    return res.json(ApiResponse.success(await storageService.rebuildManifests({ dryRun }),
      dryRun ? 'Dry-run — nothing written' : 'Manifests rebuilt'));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/storage/dedupe', requireOperator, async (req, res) => {
  try {
    return res.json(ApiResponse.success(await storageService.dedupeExactPickups(cleanupOpts(req))));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/storage/archive-tests', requireOperator, async (req, res) => {
  try {
    return res.json(ApiResponse.success(await storageService.archiveTests(cleanupOpts(req))));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/storage/quarantine-orphans', requireOperator, async (req, res) => {
  try {
    return res.json(ApiResponse.success(await storageService.quarantineOrphans(cleanupOpts(req))));
  } catch (err) {
    return handleError(err, res);
  }
});

router.post('/storage/repair', requireOperator, async (req, res) => {
  try {
    return res.json(ApiResponse.success(await storageService.repairStale(cleanupOpts(req))));
  } catch (err) {
    return handleError(err, res);
  }
});

/** Per-work-packet append-only event history (events.jsonl). */
router.get('/work-packet/:wp/events', async (req, res) => {
  try {
    const wp = String(req.params.wp || '');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(wp)) return res.status(400).json(ApiResponse.error('Invalid work packet id', 'VALIDATION_ERROR', 400));
    return res.json(ApiResponse.success({ workPacketId: wp, events: storageService.readPacketEvents(wp) }));
  } catch (err) {
    return handleError(err, res);
  }
});

module.exports = router;
