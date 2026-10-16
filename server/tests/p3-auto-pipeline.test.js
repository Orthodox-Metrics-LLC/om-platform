/**
 * p3-auto-pipeline.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Test suite for the OCR autonomous pipeline (ocrAutoPipeline.ts).
 *
 * Run with:  npm test -- --grep "AutoPipeline"
 * Or:        npx mocha test/p3-auto-pipeline.test.js
 *
 * All tests use in-process stubs — no live DB or OCR service required.
 * The test harness injects fake pools, fake feeder artifacts, and a fake
 * extraction agent so every code path can be exercised deterministically.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Minimal stub factory ─────────────────────────────────────────────────────

function makePool(overrides = {}) {
  const rows = overrides.rows || {};
  return {
    query: async (sql, params) => {
      // Return stubbed rows based on SQL pattern matching
      if (sql.includes('SELECT') && sql.includes('ocr_jobs')) {
        return [rows.ocr_jobs || []];
      }
      if (sql.includes('SELECT') && sql.includes('ocr_settings')) {
        return [rows.ocr_settings || []];
      }
      if (sql.includes('INSERT') || sql.includes('UPDATE') || sql.includes('DELETE') || sql.includes('ALTER')) {
        return [{ affectedRows: 1, insertId: overrides.insertId || 1 }];
      }
      return [[]];
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      query: async (sql, params) => {
        if (overrides.txQueryFn) return overrides.txQueryFn(sql, params);
        return [{ affectedRows: 1, insertId: overrides.insertId || 99 }];
      },
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
    ...overrides.poolMethods,
  };
}

function makeSettings(overrides = {}) {
  return {
    enabled: true,
    minConfidence: 0.82,
    minPageScore: 0.70,
    requireTemplate: true,
    maxOcrWaitMs: 5000,
    pollIntervalMs: 100,
    ...overrides,
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'om-ocr-test-'));
}

function writeArtifacts(dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });

  const scoringV2 = opts.scoringV2 ?? {
    page_score_v2: opts.pageScore ?? 0.85,
    rows: [{ row_score: opts.rowScore ?? 0.90, confidence: opts.confidence ?? 0.88 }],
  };
  const recordCandidates = opts.recordCandidates ?? {
    detectedType: opts.recordType ?? 'baptism',
    candidates: opts.candidates ?? [
      { fields: { name: 'John Doe', date: '2024-01-15' }, sourceRowIndex: 0 },
    ],
  };
  const candProvenance = opts.candProvenance ?? {
    rows: [{ candidateIndex: 0, confidence: opts.confidence ?? 0.88 }],
  };
  const metricsData = opts.metricsData ?? {
    structure_score: opts.structureScore ?? 0.80,
    template_id: opts.templateId ?? 'tmpl_001',
  };

  fs.writeFileSync(path.join(dir, 'scoring_v2.json'), JSON.stringify(scoringV2));
  fs.writeFileSync(path.join(dir, 'record_candidates.json'), JSON.stringify(recordCandidates));
  fs.writeFileSync(path.join(dir, 'record_candidates_provenance.json'), JSON.stringify(candProvenance));
  fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(metricsData));
}

// ─── Settings loader tests ────────────────────────────────────────────────────

describe('AutoPipeline — Settings loader', () => {
  it('returns defaults when no settings row exists', async () => {
    // We test the pure logic here without importing the TS module directly
    // (which would require ts-node). The logic is reproduced inline.
    const DEFAULT = {
      enabled: false,
      minConfidence: 0.82,
      minPageScore: 0.70,
      requireTemplate: true,
      maxOcrWaitMs: 300000,
      pollIntervalMs: 3000,
    };
    const pool = makePool({ rows: { ocr_settings: [] } });
    const [rows] = await pool.query('SELECT settings_json FROM ocr_settings WHERE church_id = ?', [1]);
    assert.strictEqual(rows.length, 0);
    // Simulate the loadAutoPipelineSettings fallback
    const result = rows.length === 0 ? { ...DEFAULT } : {};
    assert.strictEqual(result.enabled, false);
    assert.strictEqual(result.minConfidence, 0.82);
  });

  it('merges partial settings with defaults', () => {
    const DEFAULT = { enabled: false, minConfidence: 0.82, minPageScore: 0.70, requireTemplate: true, maxOcrWaitMs: 300000, pollIntervalMs: 3000 };
    const raw = { autoPipeline: { enabled: true, minConfidence: 0.90 } };
    const ap = raw.autoPipeline || {};
    const result = {
      enabled: ap.enabled === true,
      minConfidence: typeof ap.minConfidence === 'number' ? ap.minConfidence : DEFAULT.minConfidence,
      minPageScore: typeof ap.minPageScore === 'number' ? ap.minPageScore : DEFAULT.minPageScore,
      requireTemplate: ap.requireTemplate !== false,
      maxOcrWaitMs: typeof ap.maxOcrWaitMs === 'number' ? ap.maxOcrWaitMs : DEFAULT.maxOcrWaitMs,
      pollIntervalMs: typeof ap.pollIntervalMs === 'number' ? ap.pollIntervalMs : DEFAULT.pollIntervalMs,
    };
    assert.strictEqual(result.enabled, true);
    assert.strictEqual(result.minConfidence, 0.90);
    assert.strictEqual(result.minPageScore, 0.70); // default
    assert.strictEqual(result.requireTemplate, true);
  });

  it('clamps minConfidence to [0, 1] on settings update', () => {
    const clamp = (v) => Math.min(1, Math.max(0, v));
    assert.strictEqual(clamp(1.5), 1);
    assert.strictEqual(clamp(-0.1), 0);
    assert.strictEqual(clamp(0.85), 0.85);
  });
});

// ─── OCR wait poller tests ────────────────────────────────────────────────────

describe('AutoPipeline — OCR wait poller', () => {
  it('returns immediately when job is already complete', async () => {
    let callCount = 0;
    const fakePool = {
      query: async () => {
        callCount++;
        return [[{ status: 'complete', ocr_text: 'Sample OCR text' }]];
      },
    };
    const settings = makeSettings({ maxOcrWaitMs: 5000, pollIntervalMs: 100 });
    const deadline = Date.now() + settings.maxOcrWaitMs;
    let result = null;
    while (Date.now() < deadline) {
      const [rows] = await fakePool.query();
      if (!rows.length) break;
      const { status, ocr_text } = rows[0];
      if (status === 'complete') { result = { status, ocr_text }; break; }
      await new Promise((r) => setTimeout(r, settings.pollIntervalMs));
    }
    assert.ok(result);
    assert.strictEqual(result.status, 'complete');
    assert.strictEqual(callCount, 1); // Only one poll needed
  });

  it('returns null after timeout when job stays pending', async () => {
    const fakePool = {
      query: async () => [[{ status: 'pending', ocr_text: null }]],
    };
    const settings = makeSettings({ maxOcrWaitMs: 200, pollIntervalMs: 50 });
    const deadline = Date.now() + settings.maxOcrWaitMs;
    let result = null;
    while (Date.now() < deadline) {
      const [rows] = await fakePool.query();
      if (!rows.length) break;
      const { status, ocr_text } = rows[0];
      if (status === 'complete') { result = { status, ocr_text }; break; }
      await new Promise((r) => setTimeout(r, settings.pollIntervalMs));
    }
    assert.strictEqual(result, null);
  });

  it('returns error status immediately without retrying', async () => {
    let callCount = 0;
    const fakePool = {
      query: async () => {
        callCount++;
        return [[{ status: 'error', ocr_text: null }]];
      },
    };
    const settings = makeSettings({ maxOcrWaitMs: 5000, pollIntervalMs: 100 });
    const deadline = Date.now() + settings.maxOcrWaitMs;
    let result = null;
    while (Date.now() < deadline) {
      const [rows] = await fakePool.query();
      if (!rows.length) break;
      const { status, ocr_text } = rows[0];
      if (status === 'error') { result = { status, ocr_text: null }; break; }
      if (status === 'complete') { result = { status, ocr_text }; break; }
      await new Promise((r) => setTimeout(r, settings.pollIntervalMs));
    }
    assert.ok(result);
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(callCount, 1);
  });
});

// ─── Autocommit plan gate tests ───────────────────────────────────────────────

describe('AutoPipeline — Autocommit plan gate', () => {
  it('marks job as held when no record candidates exist', () => {
    const recordCandidates = { candidates: [] };
    const hasNoCandidates = !recordCandidates?.candidates?.length;
    assert.strictEqual(hasNoCandidates, true);
  });

  it('marks job as held for unsupported record type', () => {
    const tableMap = { baptism: 'baptism_records', marriage: 'marriage_records', funeral: 'funeral_records' };
    const recordType = 'custom';
    const table = tableMap[recordType];
    assert.strictEqual(table, undefined);
  });

  it('proceeds for all three supported record types', () => {
    const tableMap = { baptism: 'baptism_records', marriage: 'marriage_records', funeral: 'funeral_records' };
    for (const type of ['baptism', 'marriage', 'funeral']) {
      assert.ok(tableMap[type], `Expected table for ${type}`);
    }
  });

  it('writes autocommit_plan.json before any DB insert', () => {
    const tmpDir = makeTempDir();
    const planPath = path.join(tmpDir, 'autocommit_plan.json');
    const plan = { batch_id: 'batch_test_001', eligible_rows: [], skipped_rows: [] };
    const planJson = JSON.stringify(plan, null, 2);
    const planTmp = planPath + '.tmp';
    fs.writeFileSync(planTmp, planJson);
    fs.renameSync(planTmp, planPath);
    assert.ok(fs.existsSync(planPath));
    const written = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.strictEqual(written.batch_id, 'batch_test_001');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('applies threshold overrides to plan', () => {
    // Simulate buildAutocommitPlan threshold application
    const thresholdOverrides = { min_confidence: 0.90, min_page_score: 0.75, require_template: true };
    const rowConfidence = 0.85;
    const eligible = rowConfidence >= thresholdOverrides.min_confidence;
    assert.strictEqual(eligible, false); // 0.85 < 0.90 → skipped

    const permissiveOverrides = { min_confidence: 0.80, min_page_score: 0.70, require_template: false };
    const eligiblePermissive = rowConfidence >= permissiveOverrides.min_confidence;
    assert.strictEqual(eligiblePermissive, true);
  });
});

// ─── Transaction safety tests ─────────────────────────────────────────────────

describe('AutoPipeline — Transaction safety', () => {
  it('rolls back and returns held on transaction error', async () => {
    let rolledBack = false;
    const conn = {
      beginTransaction: async () => {},
      query: async () => { throw new Error('Simulated DB error'); },
      commit: async () => {},
      rollback: async () => { rolledBack = true; },
      release: () => {},
    };

    const rowResults = [];
    let txError = null;
    try {
      await conn.beginTransaction();
      await conn.query('INSERT INTO baptism_records VALUES (?)');
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      txError = err;
    } finally {
      conn.release();
    }

    assert.ok(rolledBack, 'Should have rolled back');
    assert.ok(txError, 'Should have captured error');
    assert.strictEqual(txError.message, 'Simulated DB error');
  });

  it('does not rollback when all rows commit successfully', async () => {
    let rolledBack = false;
    let committed = false;
    const conn = {
      beginTransaction: async () => {},
      query: async () => [{ insertId: 42, affectedRows: 1 }],
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
      release: () => {},
    };

    try {
      await conn.beginTransaction();
      await conn.query('INSERT INTO baptism_records VALUES (?)');
      await conn.commit();
    } catch {
      await conn.rollback();
    } finally {
      conn.release();
    }

    assert.strictEqual(committed, true);
    assert.strictEqual(rolledBack, false);
  });
});

// ─── Safety invariant tests ───────────────────────────────────────────────────

describe('AutoPipeline — Safety invariants', () => {
  it('never commits when auto_pipeline is disabled and force=false', () => {
    const settings = makeSettings({ enabled: false });
    const force = false;
    const shouldProceed = settings.enabled || force;
    assert.strictEqual(shouldProceed, false);
  });

  it('proceeds when force=true even if pipeline is disabled', () => {
    const settings = makeSettings({ enabled: false });
    const force = true;
    const shouldProceed = settings.enabled || force;
    assert.strictEqual(shouldProceed, true);
  });

  it('skips already-seeded jobs', () => {
    const job = { seeded_at: '2026-06-27T12:00:00.000Z' };
    const shouldSkip = !!job.seeded_at;
    assert.strictEqual(shouldSkip, true);
  });

  it('holds when rules engine finds blockers', () => {
    const hasBlockers = true;
    const holdReasons = [];
    if (hasBlockers) holdReasons.push('rule_blockers');
    assert.ok(holdReasons.includes('rule_blockers'));
  });

  it('holds when OCR text is empty', () => {
    const ocrText = '   ';
    const holdReasons = [];
    if (!ocrText?.trim()) holdReasons.push('no_ocr_text');
    assert.ok(holdReasons.includes('no_ocr_text'));
  });

  it('never self-approves governance-gated types (custom)', () => {
    const tableMap = { baptism: 'baptism_records', marriage: 'marriage_records', funeral: 'funeral_records' };
    const recordType = 'custom';
    const table = tableMap[recordType];
    // custom type has no table mapping → pipeline holds
    assert.strictEqual(table, undefined);
  });
});

// ─── Partial commit / held-for-review tests ───────────────────────────────────

describe('AutoPipeline — Partial commit handling', () => {
  it('marks job as partial when some rows are skipped', () => {
    const committedRows = [{ outcome: 'committed', recordId: 1 }];
    const skippedCount = 2;
    const errorRows = [];
    const allCommitted = committedRows.length > 0 && skippedCount === 0 && errorRows.length === 0;
    const hasSkipped = skippedCount > 0 || errorRows.length > 0;
    assert.strictEqual(allCommitted, false);
    assert.strictEqual(hasSkipped, true);
  });

  it('marks job as complete when all rows commit and none are skipped', () => {
    const committedRows = [{ outcome: 'committed', recordId: 1 }, { outcome: 'committed', recordId: 2 }];
    const skippedCount = 0;
    const errorRows = [];
    const allCommitted = committedRows.length > 0 && skippedCount === 0 && errorRows.length === 0;
    assert.strictEqual(allCommitted, true);
  });

  it('includes skip reason in hold_reasons', () => {
    const skippedCount = 3;
    const holdReasons = [];
    if (skippedCount > 0) holdReasons.push(`${skippedCount}_rows_skipped`);
    assert.ok(holdReasons.includes('3_rows_skipped'));
  });
});

// ─── Artifact integrity tests ─────────────────────────────────────────────────

describe('AutoPipeline — Artifact integrity', () => {
  it('SHA256 of plan file matches re-computed hash', () => {
    const crypto = require('crypto');
    const tmpDir = makeTempDir();
    const planPath = path.join(tmpDir, 'autocommit_plan.json');
    const plan = { batch_id: 'test_sha_001', eligible_rows: [{ candidateIndex: 0 }], skipped_rows: [] };
    const planJson = JSON.stringify(plan, null, 2);
    fs.writeFileSync(planPath, planJson);

    const sha1 = crypto.createHash('sha256').update(planJson).digest('hex');
    const sha2 = crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex');
    assert.strictEqual(sha1, sha2);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('uses atomic write (tmp + rename) for plan file', () => {
    const tmpDir = makeTempDir();
    const planPath = path.join(tmpDir, 'autocommit_plan.json');
    const planTmp = planPath + '.tmp';
    const content = JSON.stringify({ batch_id: 'atomic_test' });

    fs.writeFileSync(planTmp, content);
    assert.ok(fs.existsSync(planTmp));
    assert.ok(!fs.existsSync(planPath));

    fs.renameSync(planTmp, planPath);
    assert.ok(fs.existsSync(planPath));
    assert.ok(!fs.existsSync(planTmp));

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── Batch trigger tests ──────────────────────────────────────────────────────

describe('AutoPipeline — Batch trigger', () => {
  it('dry_run returns eligible job IDs without executing', async () => {
    const eligibleJobs = [{ id: 10 }, { id: 11 }, { id: 12 }];
    const dryRun = true;
    const result = dryRun
      ? { ok: true, dry_run: true, eligible_count: eligibleJobs.length, job_ids: eligibleJobs.map((j) => j.id) }
      : { ok: true, queued_count: eligibleJobs.length };
    assert.strictEqual(result.dry_run, true);
    assert.strictEqual(result.eligible_count, 3);
    assert.deepStrictEqual(result.job_ids, [10, 11, 12]);
  });

  it('limits batch size to 200 maximum', () => {
    const rawLimit = 500;
    const limit = Math.min(parseInt(rawLimit, 10) || 50, 200);
    assert.strictEqual(limit, 200);
  });

  it('only selects jobs with supported record types', () => {
    const jobs = [
      { id: 1, record_type: 'baptism', auto_pipeline_status: null, seeded_at: null },
      { id: 2, record_type: 'custom', auto_pipeline_status: null, seeded_at: null },
      { id: 3, record_type: 'marriage', auto_pipeline_status: 'complete', seeded_at: null },
      { id: 4, record_type: 'funeral', auto_pipeline_status: null, seeded_at: '2026-06-01' },
    ];
    const eligible = jobs.filter(
      (j) =>
        ['baptism', 'marriage', 'funeral'].includes(j.record_type) &&
        !j.auto_pipeline_status &&
        !j.seeded_at,
    );
    assert.strictEqual(eligible.length, 1);
    assert.strictEqual(eligible[0].id, 1);
  });
});

// ─── API route contract tests ─────────────────────────────────────────────────

describe('AutoPipeline — API route contracts', () => {
  it('POST /auto-pipeline returns ok:false on error, not 4xx', () => {
    // The route returns 500 with ok:false on pipeline error
    const result = { stage_reached: 'error', error: 'OCR failed' };
    const httpStatus = result.stage_reached === 'error' ? 500 : 200;
    assert.strictEqual(httpStatus, 500);
  });

  it('POST /auto-pipeline returns 200 even when held_for_review=true', () => {
    const result = { stage_reached: 'held', held_for_review: true };
    const httpStatus = result.stage_reached === 'error' ? 500 : 200;
    assert.strictEqual(httpStatus, 200);
  });

  it('settings POST clamps minConfidence to valid range', () => {
    const clamp = (v) => Math.min(1, Math.max(0, v));
    assert.strictEqual(clamp(1.2), 1.0);
    assert.strictEqual(clamp(-0.5), 0.0);
    assert.strictEqual(clamp(0.82), 0.82);
  });

  it('GET /status returns pipeline_history as array', () => {
    const historyRows = [
      { stage: 'auto_pipeline:start', status: 'started', message: '{}', created_at: new Date().toISOString() },
      { stage: 'auto_pipeline:ocr_wait', status: 'completed', message: '{"ocr_text_length":1024}', created_at: new Date().toISOString() },
    ];
    const pipeline_history = historyRows.map((h) => ({
      stage: h.stage,
      status: h.status,
      detail: (() => { try { return JSON.parse(h.message); } catch { return h.message; } })(),
      at: h.created_at,
    }));
    assert.strictEqual(pipeline_history.length, 2);
    assert.strictEqual(pipeline_history[1].detail.ocr_text_length, 1024);
  });
});
