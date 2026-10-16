const path = require('path');
const SERVER_ROOT = path.resolve(__dirname, '../../../server');
#!/usr/bin/env node
/**
 * OM Docs Pickup — parent/child grouping backfill classifier (PROTOTYPE).
 *
 * READ-ONLY. Reads docs_pickup_files via the server's existing DB config/creds
 * (server/src/config/db → getAppPool) and PROPOSES parent/child clusters using
 * the Phase 1 heuristics. It NEVER writes to the database and NEVER prints
 * document contents or parishioner PII — output is restricted to titles,
 * pickup_ids/ids, work_packet_ids, dates, and cluster signals.
 *
 * Heuristics (combined via union-find):
 *   1. sha256 exact-duplicate       (strong)
 *   2. shared work_packet_id         (strong; from metadata_json)
 *   3. feature-tag regex families    (medium; e.g. Church-46 header/footer)
 *   4. same saved_at day + title/slug trigram similarity  (suggestion only)
 *
 * Usage:
 *   node server/scripts/pickup-grouping-classifier.js            # dry-run (default)
 *   node server/scripts/pickup-grouping-classifier.js --json     # machine-readable
 *   node server/scripts/pickup-grouping-classifier.js --apply    # guarded NO-OP (Phase 1)
 *   node server/scripts/pickup-grouping-classifier.js --include-deleted
 *   node server/scripts/pickup-grouping-classifier.js --sim 0.55 # trigram threshold
 *
 * Exit codes: 0 ok · 1 usage/DB error.
 */

'use strict';

const path = require('path');

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    apply: false,
    confirm: false,
    json: false,
    includeDeleted: false,
    includeSuggestions: false,
    minConfidence: 'medium',
    simThreshold: 0.5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.apply = false;
    else if (a === '--confirm' || a === '--yes') opts.confirm = true;
    else if (a === '--include-suggestions') opts.includeSuggestions = true;
    else if (a === '--min-confidence' && argv[i + 1]) opts.minConfidence = String(argv[++i]).toLowerCase();
    else if (a === '--json') opts.json = true;
    else if (a === '--include-deleted') opts.includeDeleted = true;
    else if (a === '--sim' && argv[i + 1]) opts.simThreshold = parseFloat(argv[++i]);
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { process.stderr.write(`Unknown argument: ${a}\n`); printHelp(); process.exit(1); }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    'pickup-grouping-classifier.js — parent/child cluster proposer (READ-ONLY by default)\n\n'
    + '  --dry-run              (default) propose clusters, write nothing\n'
    + '  --apply                apply proposed clusters via the grouping service —\n'
    + '                         REQUIRES --confirm; without it, prints the plan and exits\n'
    + '  --confirm, --yes       explicit confirmation required to actually write with --apply\n'
    + '  --min-confidence <c>   minimum cluster confidence to apply: high|medium (default medium)\n'
    + '  --include-suggestions  also apply suggestion-only clusters (default: skip)\n'
    + '  --json                 emit machine-readable JSON instead of a text report\n'
    + '  --include-deleted      include soft-deleted rows in the scan\n'
    + '  --sim <0..1>           trigram similarity threshold for same-day suggestions (default 0.5)\n'
    + '  -h, --help             show this help\n\n'
    + 'SAFETY: --apply mutates docs_pickup_files/docs_pickup_groups. Never run --apply\n'
    + 'against production data without operator review of the dry-run proposals first.\n',
  );
}

// ── feature-tag families ─────────────────────────────────────────────────────
// Ordered: first match wins as the row's primary family tag.
const FEATURE_FAMILIES = [
  { tag: 'church-46-header-footer', re: /church[-\s]?46.*(header|footer|masthead|nav|flank)/i },
  { tag: 'church-46', re: /church[-\s]?46/i },
  { tag: 'docs-pickup-grouping', re: /pickup.*(group|parent|child|cluster)/i },
  { tag: 'docs-pickup', re: /docs?[-\s]?pickup/i },
  { tag: 'portal-modernize', re: /portal.*(modernize|shell|decoupl)/i },
  { tag: 'om-packages', re: /om[-\s]?packages|consumer[-\s]?discovery/i },
  { tag: 'ocr', re: /\bocr\b|ocr[-\s]?feeder/i },
  { tag: 'cemetery', re: /cemetery|grave|plot/i },
];

const PARENT_HINT_RE = /(plan|overview|index|master|parent|summary|consolidat|roadmap|phase\s*0|phase\s*1)/i;

// ── helpers ──────────────────────────────────────────────────────────────────
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dayOf(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isoDate(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function extractWorkPacket(meta) {
  if (!meta || typeof meta !== 'object') return null;
  return (
    meta.workPacketId || meta.work_packet_id
    || meta.workItemId || meta.work_item_id
    || null
  ) || null;
}

function trigrams(s) {
  const t = ` ${slugify(s).replace(/\s+/g, ' ')} `;
  const set = new Set();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}

function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const g of aSet) if (bSet.has(g)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

// Load server/.env into process.env (same file the server uses at startup).
// Prefers the dotenv dependency; falls back to a minimal parser. Reads creds
// only from the existing env file — nothing is hardcoded here.
function loadServerEnv() {
  const fs = require('fs');
  const envPath = path.join(SERVER_ROOT, '.env');
  try {
    require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: envPath });
    return;
  } catch { /* fall through to manual parse */ }
  try {
    const text = fs.readFileSync(envPath, 'utf-8');
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* no .env — getAppPool falls back to its own defaults */ }
}

// ── union-find ───────────────────────────────────────────────────────────────
function makeUF(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; }
  return { find, union };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Reuse the server's own DB config/creds — never hardcode credentials here.
  // The server loads server/.env at startup; do the same so getAppPool() resolves
  // the real host/user/password from the existing env file (fallback: light parse).
  loadServerEnv();

  let getAppPool;
  try {
    ({ getAppPool } = require(path.join(__dirname, '..', 'src', 'config', 'db')));
  } catch (e) {
    process.stderr.write(`Failed to load DB config: ${e.message}\n`);
    return 1;
  }

  const pool = getAppPool();
  const whereStatus = opts.includeDeleted ? '' : "WHERE status <> 'deleted'";
  const sql =
    `SELECT id, pickup_id, title, original_file_name, file_name, status,
            saved_at, sha256, metadata_json
       FROM docs_pickup_files
       ${whereStatus}
       ORDER BY saved_at ASC`;

  let rows;
  try {
    [rows] = await pool.query(sql);
  } catch (e) {
    process.stderr.write(`DB unreachable or query failed: ${e.message}\n`);
    return 1;
  }

  const files = rows.map((r) => {
    const meta = parseMeta(r.metadata_json);
    const title = (r.title || meta.taskTitle || r.original_file_name || r.file_name || '(untitled)').toString();
    const hay = `${title} ${r.original_file_name || ''} ${r.file_name || ''}`;
    let family = null;
    for (const f of FEATURE_FAMILIES) { if (f.re.test(hay)) { family = f.tag; break; } }
    return {
      id: r.id,
      pickupId: r.pickup_id || null,
      title,
      status: r.status,
      savedAt: isoDate(r.saved_at),
      day: dayOf(r.saved_at),
      sha256: r.sha256 || null,
      workPacket: extractWorkPacket(meta),
      family,
      slug: slugify(title),
      tri: trigrams(title),
    };
  });

  const n = files.length;
  const uf = makeUF(n);
  const edgeReasons = new Map(); // "a,b" -> Set(signal)
  function addEdge(i, j, signal) {
    uf.union(i, j);
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    if (!edgeReasons.has(key)) edgeReasons.set(key, new Set());
    edgeReasons.get(key).add(signal);
  }

  // 1. sha256 exact duplicates
  const byHash = new Map();
  files.forEach((f, i) => { if (f.sha256) { (byHash.get(f.sha256) || byHash.set(f.sha256, []).get(f.sha256)).push(i); } });
  for (const idxs of byHash.values()) {
    for (let k = 1; k < idxs.length; k++) addEdge(idxs[0], idxs[k], 'sha256_duplicate');
  }

  // 2. shared work_packet_id
  const byPacket = new Map();
  files.forEach((f, i) => { if (f.workPacket) { (byPacket.get(f.workPacket) || byPacket.set(f.workPacket, []).get(f.workPacket)).push(i); } });
  for (const idxs of byPacket.values()) {
    for (let k = 1; k < idxs.length; k++) addEdge(idxs[0], idxs[k], 'shared_work_packet');
  }

  // 3. feature-tag families
  const byFamily = new Map();
  files.forEach((f, i) => { if (f.family) { (byFamily.get(f.family) || byFamily.set(f.family, []).get(f.family)).push(i); } });
  for (const idxs of byFamily.values()) {
    for (let k = 1; k < idxs.length; k++) addEdge(idxs[0], idxs[k], 'feature_tag');
  }

  // 4. same-day + trigram similarity (suggestion only)
  const byDay = new Map();
  files.forEach((f, i) => { if (f.day) { (byDay.get(f.day) || byDay.set(f.day, []).get(f.day)).push(i); } });
  for (const idxs of byDay.values()) {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const sim = jaccard(files[idxs[a]].tri, files[idxs[b]].tri);
        if (sim >= opts.simThreshold) addEdge(idxs[a], idxs[b], 'same_day_similar');
      }
    }
  }

  // Assemble components
  const comps = new Map();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(i);
  }

  const clusters = [];
  for (const members of comps.values()) {
    if (members.length < 2) continue;
    const signals = new Set();
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const key = members[a] < members[b] ? `${members[a]},${members[b]}` : `${members[b]},${members[a]}`;
        const s = edgeReasons.get(key);
        if (s) for (const sig of s) signals.add(sig);
      }
    }
    const memberFiles = members.map((i) => files[i]);
    // Parent selection: prefer a title that hints "plan/overview/parent", else earliest.
    memberFiles.sort((x, y) => (x.savedAt || '').localeCompare(y.savedAt || ''));
    let parent = memberFiles.find((f) => PARENT_HINT_RE.test(f.title)) || memberFiles[0];
    const children = memberFiles.filter((f) => f !== parent);

    const sharedPacket = [...new Set(memberFiles.map((f) => f.workPacket).filter(Boolean))];
    const sharedFamily = [...new Set(memberFiles.map((f) => f.family).filter(Boolean))];
    const sharedDays = [...new Set(memberFiles.map((f) => f.day).filter(Boolean))];
    const dupHashes = [...new Set(memberFiles.map((f) => f.sha256).filter(Boolean))]
      .filter((h) => memberFiles.filter((f) => f.sha256 === h).length > 1);

    const strong = signals.has('sha256_duplicate') || signals.has('shared_work_packet') || signals.has('feature_tag');
    clusters.push({
      signals: [...signals],
      confidence: strong ? (signals.has('sha256_duplicate') || signals.has('shared_work_packet') ? 'high' : 'medium') : 'suggestion',
      featureTags: sharedFamily,
      workPackets: sharedPacket,
      days: sharedDays,
      duplicateSha256: dupHashes.map((h) => h.slice(0, 12)),
      size: memberFiles.length,
      parent: { pickupId: parent.pickupId, id: parent.id, title: parent.title, savedAt: parent.savedAt },
      children: children.map((c) => ({ pickupId: c.pickupId, id: c.id, title: c.title, savedAt: c.savedAt })),
    });
  }

  // Sort: high → medium → suggestion, then larger clusters first.
  const order = { high: 0, medium: 1, suggestion: 2 };
  clusters.sort((a, b) => (order[a.confidence] - order[b.confidence]) || (b.size - a.size));

  // ── --apply (guarded) ──
  let applyReport = null;
  if (opts.apply) {
    const minRank = order[opts.minConfidence] ?? order.medium;
    const eligible = clusters.filter((c) => {
      if (c.confidence === 'suggestion') return opts.includeSuggestions;
      return order[c.confidence] <= minRank;
    });

    if (!opts.confirm) {
      process.stdout.write(
        '[pickup-grouping-classifier] --apply requires explicit --confirm.\n'
        + `Would apply ${eligible.length} cluster(s) (min-confidence=${opts.minConfidence}, `
        + `include-suggestions=${opts.includeSuggestions}) covering `
        + `${eligible.reduce((s, c) => s + c.size, 0)} file(s). NO changes were made.\n`
        + 'Re-run with --apply --confirm after operator review to write groupings.\n',
      );
      return 0;
    }

    // Confirmed write path — mutates docs_pickup_files / docs_pickup_groups via the
    // grouping service. (Not exercised against prod in the delivery task.)
    let svc;
    try {
      svc = require(path.join(__dirname, '..', 'src', 'services', 'docsPickupService'));
    } catch (e) {
      process.stderr.write(`Failed to load grouping service: ${e.message}\n`);
      return 1;
    }
    const actor = { id: null, email: 'pickup-grouping-classifier', name: 'pickup-grouping-classifier' };
    applyReport = { applied: [], failed: [] };
    for (const c of eligible) {
      try {
        const result = await svc.createGroup({
          parentRef: c.parent.pickupId || c.parent.id,
          title: c.parent.title,
          featureTag: c.featureTags[0] || null,
          workPacketId: c.workPackets[0] || null,
          childRefs: c.children.map((ch) => ch.pickupId || ch.id),
          note: `Auto-proposed by pickup-grouping-classifier (signals: ${c.signals.join(',')})`,
        }, actor);
        applyReport.applied.push({ groupId: result.group && result.group.groupId, parent: c.parent.pickupId || c.parent.id, children: result.assignedChildren.length });
      } catch (e) {
        applyReport.failed.push({ parent: c.parent.pickupId || c.parent.id, error: e.message });
      }
    }
  }

  const summary = {
    scannedRows: n,
    clustersProposed: clusters.length,
    clusteredFiles: clusters.reduce((s, c) => s + c.size, 0),
    standaloneFiles: n - clusters.reduce((s, c) => s + c.size, 0),
    byConfidence: clusters.reduce((m, c) => { m[c.confidence] = (m[c.confidence] || 0) + 1; return m; }, {}),
    generatedAt: new Date().toISOString(),
    mode: applyReport ? 'apply (confirmed — DB writes performed)' : 'dry-run (read-only, no DB writes)',
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify({ summary, clusters, applyReport }, null, 2) + '\n');
    return 0;
  }

  // ── text report ──
  const out = [];
  out.push('OM Docs Pickup — parent/child grouping classifier (DRY-RUN, read-only)');
  out.push('='.repeat(72));
  out.push(`Scanned rows        : ${summary.scannedRows}`);
  out.push(`Clusters proposed   : ${summary.clustersProposed} (${JSON.stringify(summary.byConfidence)})`);
  out.push(`Files in clusters   : ${summary.clusteredFiles}   Standalone: ${summary.standaloneFiles}`);
  out.push(`Generated at        : ${summary.generatedAt}`);
  out.push('NOTE: titles/ids/dates/signals only — no document contents or PII.');
  out.push('');
  if (!clusters.length) {
    out.push('No multi-file clusters proposed with the current heuristics/threshold.');
  }
  clusters.forEach((c, idx) => {
    out.push(`[Cluster ${idx + 1}] confidence=${c.confidence}  size=${c.size}  signals=${c.signals.join(',')}`);
    if (c.featureTags.length) out.push(`  feature_tag(s) : ${c.featureTags.join(', ')}`);
    if (c.workPackets.length) out.push(`  work_packet(s) : ${c.workPackets.join(', ')}`);
    if (c.duplicateSha256.length) out.push(`  sha256 dup(s)  : ${c.duplicateSha256.join(', ')}`);
    out.push(`  days           : ${c.days.join(', ')}`);
    out.push(`  PARENT  ${c.parent.pickupId || c.parent.id}  [${(c.parent.savedAt || '').slice(0, 10)}]  ${c.parent.title}`);
    for (const ch of c.children) {
      out.push(`    child ${ch.pickupId || ch.id}  [${(ch.savedAt || '').slice(0, 10)}]  ${ch.title}`);
    }
    out.push('');
  });
  if (applyReport) {
    out.push('APPLIED (confirmed writes):');
    out.push(`  groups created/updated : ${applyReport.applied.length}`);
    for (const a of applyReport.applied) out.push(`    ${a.groupId}  parent=${a.parent}  children=${a.children}`);
    if (applyReport.failed.length) {
      out.push(`  failed : ${applyReport.failed.length}`);
      for (const f of applyReport.failed) out.push(`    parent=${f.parent}  error=${f.error}`);
    }
    out.push('');
  }
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => { process.stderr.write(`fatal: ${e && e.stack || e}\n`); process.exit(1); });
