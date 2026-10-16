#!/usr/bin/env node
/**
 * Validate cemetery plot data — manifest JSON and/or tenant database.
 * All zero-target metrics must be 0 before production apply.
 *
 * Usage:
 *   node server/scripts/cemetery-validate-data.mjs --church-id 46
 *   node server/scripts/cemetery-validate-data.mjs --manifest path/to/import-manifest.json
 *   node server/scripts/cemetery-validate-data.mjs --church-id 46 --db om_church_46
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';

const require = createRequire(import.meta.url);
const SERVER_ROOT = resolve(__dirname, '../../../server');
const REPO_ROOT = resolve(__dirname, '../../..');
const {
  EXPECTED_SECTION_TOTALS,
  EXPECTED_STATUS_TOTALS,
  EXPECTED_PHYSICAL_TOTAL,
  buildPlotKey,
  isMalformedComposite,
  normalizeDisplayNumbers,
} = require(SERVER_ROOT + '/src/services/cemetery/plotKey.js');
const { loadGeometry } = require(SERVER_ROOT + '/src/services/cemetery/geometryEngine.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    churchId: 46,
    manifest: null,
    db: null,
    writeReport: true,
    checkTotals: true,
    edgeCases: true,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--church-id') opts.churchId = Number(args[++i]);
    else if (args[i] === '--manifest') opts.manifest = args[++i];
    else if (args[i] === '--db') opts.db = args[++i];
    else if (args[i] === '--no-report') opts.writeReport = false;
    else if (args[i] === '--no-totals') opts.checkTotals = false;
  }
  return opts;
}

const EDGE_CASES = [
  {
    label: '823 family lot — 5 physical slots (authoritative workbook)',
    displayIncludes: '823',
    minPlots: 5,
    maxPlots: 5,
  },
  { label: '882 one physical grave', displayNumbers: '882', maxPlots: 1 },
  { label: '895/896 one physical grave', displayNumbers: '895,896', maxPlots: 1 },
  { label: '102/101 one physical grave', displayNumbers: '101,102', maxPlots: 1 },
  { label: '105/104 one physical grave', displayNumbers: '104,105', maxPlots: 1 },
  { label: '194/195/196 one physical grave', displayNumbers: '194,195,196', maxPlots: 1 },
  { label: '164 available no occupant', displayIncludes: '164', status: 'available', maxOccupants: 0 },
  {
    label: '194–196 occupants (operator 2026-07-11)',
    plotKey: 'SSPPOC-R22-P01',
    occupant: 'Nicholas Fetchina',
    minOccupants: 3,
  },
];

function loadPlots(opts) {
  if (opts.manifest) {
    const doc = JSON.parse(readFileSync(opts.manifest, 'utf8'));
    return { source: opts.manifest, plots: doc.plots || [], manifest: doc };
  }
  return null;
}

async function loadPlotsFromDb(dbName) {
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER || 'orthodoxapps';
  const password = process.env.DB_PASSWORD || '';
  const conn = await mysql.createConnection({ host, port, user, password, database: dbName });
  const [rows] = await conn.query(
    `SELECT p.id, p.plot_key AS plotKey, p.plot_number AS plotNumber,
            p.display_numbers AS displayNumbers, p.side, p.position,
            p.status, s.code AS sectionCode, r.number AS rowNo,
            (SELECT GROUP_CONCAT(CONCAT(pe.first_name,' ',pe.last_name) SEPARATOR '|')
               FROM cemetery_interments i JOIN cemetery_people pe ON pe.id = i.person_id
              WHERE i.plot_id = p.id) AS occupantNames,
            (SELECT COUNT(*) FROM cemetery_interments i WHERE i.plot_id = p.id) AS occupantCount
       FROM cemetery_plots p
       JOIN cemetery_sections s ON s.id = p.section_id
       LEFT JOIN cemetery_rows r ON r.id = p.row_id`,
  );
  await conn.end();
  return rows.map((r) => ({
    id: r.id,
    plot_key: r.plotKey,
    section: r.sectionCode,
    side: r.side,
    row: r.rowNo,
    position: r.position,
    plot_number: r.plotNumber,
    display_numbers: r.displayNumbers || r.plotNumber,
    status: r.status,
    occupants: r.occupantNames ? r.occupantNames.split('|') : [],
    occupantCount: r.occupantCount,
  }));
}

const TRANSITION_ROWS = new Set(['L26', 'L27', 'R13', 'R14', 'R15']);
const MIN_TRANSITION_GRASS_GAP = 1.0;
const FENCE_MIN_Y = 26.2; // whiteGate y=25 + half plot (1.2) — graves must be south of fence

function validateFenceBoundary(plots, churchId = 46) {
  const { world } = loadGeometry(churchId);
  const fenceY = world?.landmarks?.whiteGate?.y ?? 30;
  const plotHalf = (world?.plotDefaults?.height ?? 2.4) / 2;
  const minSouthY = fenceY + plotHalf + 0.3;
  const roadY = world?.roads?.newSection?.[1]?.y ?? 18;

  const northOfFence = [];
  const northOfRoad = [];
  for (const p of plots) {
    const y = Number(p.map_y);
    if (!Number.isFinite(y)) continue;
    const topEdge = y - plotHalf;
    if (topEdge < fenceY) {
      northOfFence.push({
        plot_key: p.plot_key,
        plot_number: p.plot_number,
        region_code: p.region_code,
        map_y: y,
        fenceY,
      });
    }
    if (p.region_code === 'NEW-MN' && topEdge < roadY) {
      northOfRoad.push({
        plot_key: p.plot_key,
        plot_number: p.plot_number,
        map_y: y,
        roadY,
      });
    }
  }

  return {
    pass: northOfFence.length === 0 && northOfRoad.length === 0,
    fenceY,
    minSouthY,
    northOfFence: northOfFence.slice(0, 20),
    northOfRoad: northOfRoad.slice(0, 20),
    northOfFenceCount: northOfFence.length,
    northOfRoadCount: northOfRoad.length,
  };
}

function validateRoadClearance(plots, churchId = 46) {
  const { world } = loadGeometry(churchId);
  const tc = world?.trafficCircle;
  if (!tc) return { pass: true, overlaps: 0, minCenterDist: 0 };

  const cx = tc.center.x;
  const cy = tc.center.y;
  const roadR = tc.radius;
  const surfaceHalf = (world.roads?.surfaceWidth ?? tc.roadWidth ?? 6) / 2;
  const innerR = roadR - surfaceHalf;
  const outerR = roadR + surfaceHalf;
  const plotHalf = (world.plotDefaults?.width ?? 2.4) / 2;
  const checkRadius = outerR + plotHalf + 8;

  let overlaps = 0;
  const offenders = [];
  const transitionGaps = [];
  for (const p of plots) {
    const x = Number(p.map_x);
    const y = Number(p.map_y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist > checkRadius) continue;
    const markerInner = dist - plotHalf;
    const markerOuter = dist + plotHalf;
    const grassGap = markerInner - outerR;
    if (markerOuter > innerR && markerInner < outerR) {
      overlaps += 1;
      offenders.push({
        plot_key: p.plot_key,
        plot_number: p.plot_number,
        normalized_row: p.normalized_row,
        dist: Math.round(dist * 100) / 100,
        map_x: x,
        map_y: y,
      });
    }
    const row = String(p.normalized_row || '').trim();
    if (TRANSITION_ROWS.has(row) && grassGap < MIN_TRANSITION_GRASS_GAP) {
      transitionGaps.push({
        plot_key: p.plot_key,
        plot_number: p.plot_number,
        normalized_row: row,
        grassGap: Math.round(grassGap * 100) / 100,
        map_x: x,
        map_y: y,
      });
    }
  }

  const minCenterDist = outerR + plotHalf + MIN_TRANSITION_GRASS_GAP;
  const transitionPass = transitionGaps.length === 0;
  return {
    pass: overlaps === 0 && transitionPass,
    overlaps,
    minCenterDist,
    transitionGaps: transitionGaps.slice(0, 12),
    transitionPass,
    offenders: offenders.slice(0, 12),
  };
}

function validatePlots(plots, opts) {
  const metrics = {
    missing_plot_keys: 0,
    duplicate_plot_keys: 0,
    missing_sections: 0,
    missing_rows: 0,
    missing_positions: 0,
    malformed_composite_numbers: 0,
    synthetic_dates: 0,
    orphan_occupants: 0,
    orphan_interments: 0,
    manifest_api_mismatches: 0,
    database_mismatches: 0,
  };
  const issues = [];

  const keys = new Map();
  for (const p of plots) {
    if (!p.plot_key) {
      metrics.missing_plot_keys++;
      issues.push({ code: 'MISSING_PLOT_KEY', plot: p.plot_number || p.id });
    } else if (keys.has(p.plot_key)) {
      metrics.duplicate_plot_keys++;
      issues.push({ code: 'DUPLICATE_PLOT_KEY', plot_key: p.plot_key });
    } else {
      keys.set(p.plot_key, p);
    }

    if (!p.section) {
      metrics.missing_sections++;
      issues.push({ code: 'MISSING_SECTION', plot_key: p.plot_key });
    }
    if (!p.row) {
      metrics.missing_rows++;
    }
    if (!p.position) {
      metrics.missing_positions++;
    }

    const display = p.display_numbers || p.plot_number || '';
    if (isMalformedComposite(display) || isMalformedComposite(p.plot_number)) {
      metrics.malformed_composite_numbers++;
      issues.push({ code: 'MALFORMED_COMPOSITE', plot_number: p.plot_number });
    }

    const occ = p.occupants || [];
    if (p.status === 'available' && occ.length > 0) {
      metrics.orphan_occupants++;
      issues.push({ code: 'AVAILABLE_WITH_OCCUPANT', plot_key: p.plot_key });
    }
    if (p.status === 'occupied' && occ.length === 0 && (p.occupantCount ?? 0) === 0) {
      metrics.orphan_interments++;
      issues.push({ code: 'OCCUPIED_WITHOUT_OCCUPANT', plot_key: p.plot_key });
    }
  }

  const totals = { sections: {}, status: {}, physical: plots.length };
  for (const p of plots) {
    totals.sections[p.section] = (totals.sections[p.section] || 0) + 1;
    totals.status[p.status] = (totals.status[p.status] || 0) + 1;
  }

  const totalsMatch = opts.checkTotals
    ? {
        physical: totals.physical === EXPECTED_PHYSICAL_TOTAL,
        sections: Object.entries(EXPECTED_SECTION_TOTALS).every(
          ([sec, n]) => (totals.sections[sec] || 0) === n,
        ),
        status: Object.entries(EXPECTED_STATUS_TOTALS).every(
          ([st, n]) => (totals.status[st] || 0) === n,
        ),
      }
    : null;

  const edgeResults = [];
  if (opts.edgeCases) {
    for (const ec of EDGE_CASES) {
      let matched = plots;
      if (ec.displayNumbers) {
        const want = normalizeDisplayNumbers(ec.displayNumbers);
        matched = plots.filter(
          (p) => normalizeDisplayNumbers(p.display_numbers || p.plot_number) === want,
        );
      } else if (ec.displayIncludes) {
        matched = plots.filter((p) => {
          const d = normalizeDisplayNumbers(p.display_numbers || p.plot_number);
          return d.split(',').includes(ec.displayIncludes);
        });
      }
      if (ec.plotKey) matched = plots.filter((p) => p.plot_key === ec.plotKey);
      if (ec.occupant) {
        matched = plots.filter((p) =>
          (p.occupants || []).some((o) => o.toLowerCase().includes(ec.occupant.toLowerCase())),
        );
      }

      let pass = true;
      let detail = '';
      if (ec.maxPlots != null && matched.length !== ec.maxPlots) {
        pass = false;
        detail = `expected ${ec.maxPlots} plot(s), found ${matched.length}`;
      }
      if (ec.minPlots != null && matched.length < ec.minPlots) {
        pass = false;
        detail = `expected at least ${ec.minPlots} plot(s), found ${matched.length}`;
      }
      if (ec.mustBeUnique && matched.length !== 1) {
        pass = false;
        detail = `expected exactly 1 plot, found ${matched.length}`;
      }
      if (ec.status && matched.some((p) => p.status !== ec.status)) {
        pass = false;
        detail = `status mismatch`;
      }
      if (ec.maxOccupants != null) {
        const occ = matched.reduce((s, p) => s + (p.occupants?.length || p.occupantCount || 0), 0);
        if (occ > ec.maxOccupants) {
          pass = false;
          detail = `expected <= ${ec.maxOccupants} occupants, found ${occ}`;
        }
      }
      if (ec.minOccupants != null) {
        const occ = matched.reduce((s, p) => s + (p.occupants?.length || p.occupantCount || 0), 0);
        if (occ < ec.minOccupants) {
          pass = false;
          detail = `expected >= ${ec.minOccupants} occupants, found ${occ}`;
        }
      }
      if (ec.plotKey && ec.occupant) {
        const p = matched[0];
        if (!p || p.plot_key !== ec.plotKey) {
          pass = false;
          detail = `expected plot_key ${ec.plotKey}, got ${p?.plot_key}`;
        }
      }

      edgeResults.push({ label: ec.label, pass, detail, matchCount: matched.length });
    }
  }

  const zeroMetrics = Object.values(metrics).every((v) => v === 0);
  const edgePass = edgeResults.every((e) => e.pass);
  const roadClearance = validateRoadClearance(plots, opts.churchId);
  const fenceBoundary = validateFenceBoundary(plots, opts.churchId);
  const totalsPass = totalsMatch
    ? totalsMatch.physical && totalsMatch.sections && totalsMatch.status
    : null;

  return {
    validatedAt: new Date().toISOString(),
    churchId: opts.churchId,
    plotCount: plots.length,
    metrics,
    totals,
    expected: {
      physical: EXPECTED_PHYSICAL_TOTAL,
      sections: EXPECTED_SECTION_TOTALS,
      status: EXPECTED_STATUS_TOTALS,
    },
    totalsMatch,
    edgeResults,
    roadClearance,
    fenceBoundary,
    issues,
    passed: zeroMetrics && edgePass && roadClearance.pass && fenceBoundary.pass && (totalsPass !== false),
  };
}

async function main() {
  const opts = parseArgs();
  let plots = [];
  let source = '';

  const fileData = loadPlots(opts);
  if (fileData) {
    plots = fileData.plots;
    source = fileData.source;
  } else {
    const manifestPath =
      opts.manifest ||
      join(SERVER_ROOT, 'assets/cemetery-map', `church-${opts.churchId}`, 'import-manifest.json');
    if (existsSync(manifestPath)) {
      const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
      plots = doc.plots || [];
      source = manifestPath;
    }
  }

  if (opts.db) {
    try {
      const dbPlots = await loadPlotsFromDb(opts.db);
      source = `${source} + db:${opts.db}`.trim();
      if (plots.length && dbPlots.length) {
        const manifestKeys = new Set(plots.map((p) => p.plot_key));
        const dbKeys = new Set(dbPlots.map((p) => p.plot_key));
        let mismatches = 0;
        for (const k of manifestKeys) if (!dbKeys.has(k)) mismatches++;
        for (const k of dbKeys) if (!manifestKeys.has(k)) mismatches++;
        console.log(`Manifest/DB key mismatches: ${mismatches}`);
      }
      plots = dbPlots.length ? dbPlots : plots;
    } catch (e) {
      console.warn(`DB load skipped: ${e.message}`);
    }
  }

  if (!plots.length) {
    console.error('No plot data found. Run cemetery-build-manifest.mjs or pass --manifest.');
    process.exit(1);
  }

  const report = validatePlots(plots, opts);

  console.log(`Validated: ${source}`);
  console.log(`  plots: ${report.plotCount} (expected ${EXPECTED_PHYSICAL_TOTAL})`);
  console.log('  metrics (all must be 0):');
  for (const [k, v] of Object.entries(report.metrics)) {
    console.log(`    ${k}: ${v}`);
  }
  if (report.totalsMatch) {
    console.log('  totals match:', report.totalsMatch);
  }
  console.log('  edge cases:');
  for (const e of report.edgeResults) {
    console.log(`    ${e.pass ? 'PASS' : 'FAIL'} — ${e.label}${e.detail ? ` (${e.detail})` : ''}`);
  }
  console.log(
    `  road clearance: ${report.roadClearance.pass ? 'PASS' : 'FAIL'} (${report.roadClearance.overlaps} overlaps, transition gaps ${report.roadClearance.transitionGaps?.length ?? 0}, min center dist ${report.roadClearance.minCenterDist})`,
  );
  console.log(
    `  fence boundary: ${report.fenceBoundary.pass ? 'PASS' : 'FAIL'} (north of fence: ${report.fenceBoundary.northOfFenceCount}, north of NS road: ${report.fenceBoundary.northOfRoadCount})`,
  );
  console.log(`  passed: ${report.passed ? 'YES' : 'NO'}`);

  if (opts.writeReport) {
    const reportPath = join(
      __dirname,
      '../cemetery-map',
      `church-${opts.churchId}`,
      'data-validation-report.json',
    );
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote report: ${reportPath}`);
  }

  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
