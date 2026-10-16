#!/usr/bin/env node
/**
 * Validate cemetery map geometry JSON — duplicates, missing geometry, name checks.
 *
 * Usage:
 *   node server/scripts/cemetery-validate-map.mjs [--church-id 46] [--json path/to/map.json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { churchId: 46, json: null, writeReport: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--church-id') opts.churchId = Number(args[++i]);
    else if (args[i] === '--json') opts.json = args[++i];
    else if (args[i] === '--no-report') opts.writeReport = false;
  }
  return opts;
}

function plotCenter(plot) {
  if (plot.shape === 'rect' && plot.x != null && plot.y != null && plot.w != null && plot.h != null) {
    return { x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 };
  }
  if (plot.shape === 'polygon' && Array.isArray(plot.points) && plot.points.length) {
    const xs = plot.points.map((p) => p.x);
    const ys = plot.points.map((p) => p.y);
    return {
      x: xs.reduce((a, b) => a + b, 0) / xs.length,
      y: ys.reduce((a, b) => a + b, 0) / ys.length,
    };
  }
  return null;
}

function hasValidGeometry(plot) {
  if (plot.shape === 'rect') {
    return plot.x != null && plot.y != null && plot.w > 0 && plot.h > 0;
  }
  if (plot.shape === 'polygon') {
    return Array.isArray(plot.points) && plot.points.length >= 3;
  }
  return false;
}

function validate(doc) {
  const issues = [];
  const warnings = [];
  const plots = doc.plots ?? [];

  const plotNumbers = new Map();
  for (const plot of plots) {
    const key = `${plot.pageNumber}:${plot.plotNumber}`;
    if (plotNumbers.has(key)) {
      issues.push({
        code: 'DUPLICATE_PLOT_NUMBER',
        plotId: plot.id,
        plotNumber: plot.plotNumber,
        pageNumber: plot.pageNumber,
        duplicateOf: plotNumbers.get(key),
        message: `Duplicate plot number "${plot.plotNumber}" on page ${plot.pageNumber}`,
      });
    } else {
      plotNumbers.set(key, plot.id);
    }

    if (!hasValidGeometry(plot)) {
      issues.push({
        code: 'MISSING_GEOMETRY',
        plotId: plot.id,
        plotNumber: plot.plotNumber,
        message: `Plot ${plot.plotNumber} (${plot.id}) has invalid or missing geometry`,
      });
    }

    if (plot.needsReview) {
      warnings.push({
        code: 'NEEDS_REVIEW',
        plotId: plot.id,
        plotNumber: plot.plotNumber,
        message: `Plot ${plot.plotNumber} flagged for review`,
      });
    }

    const page = doc.pages?.find((p) => p.pageNumber === plot.pageNumber);
    if (page) {
      const c = plotCenter(plot);
      if (c && (c.x < 0 || c.y < 0 || c.x > page.normalizedWidth || c.y > page.normalizedHeight)) {
        warnings.push({
          code: 'OUT_OF_BOUNDS',
          plotId: plot.id,
          plotNumber: plot.plotNumber,
          message: `Plot ${plot.plotNumber} center outside page bounds`,
        });
      }
    }
  }

  // Proximity duplicate detection (same page, overlapping plot numbers or very close centers)
  const byPage = new Map();
  for (const plot of plots) {
    if (!byPage.has(plot.pageNumber)) byPage.set(plot.pageNumber, []);
    byPage.get(plot.pageNumber).push(plot);
  }
  for (const [pageNum, pagePlots] of byPage) {
    for (let i = 0; i < pagePlots.length; i++) {
      for (let j = i + 1; j < pagePlots.length; j++) {
        const a = pagePlots[i];
        const b = pagePlots[j];
        const ca = plotCenter(a);
        const cb = plotCenter(b);
        if (!ca || !cb) continue;
        const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
        if (dist < 8 && a.plotNumber !== b.plotNumber) {
          warnings.push({
            code: 'PROXIMITY_OVERLAP',
            plotId: a.id,
            otherPlotId: b.id,
            pageNumber: pageNum,
            message: `Plots ${a.plotNumber} and ${b.plotNumber} are very close (${dist.toFixed(1)} norm units)`,
          });
        }
      }
    }
  }

  // Route graph integrity
  const nodeIds = new Set((doc.routeNodes ?? []).map((n) => n.id));
  for (const edge of doc.routeEdges ?? []) {
    if (!nodeIds.has(edge.from)) {
      issues.push({
        code: 'ROUTE_EDGE_MISSING_FROM',
        edgeId: edge.id,
        message: `Route edge ${edge.id} references missing node "${edge.from}"`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      issues.push({
        code: 'ROUTE_EDGE_MISSING_TO',
        edgeId: edge.id,
        message: `Route edge ${edge.id} references missing node "${edge.to}"`,
      });
    }
  }

  return {
    validatedAt: new Date().toISOString(),
    churchId: doc.churchId,
    plotCount: plots.length,
    issueCount: issues.length,
    warningCount: warnings.length,
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

function main() {
  const { churchId, json, writeReport } = parseArgs();
  const mapPath = json
    ? json
    : join(SERVER_ROOT, 'assets/cemetery-map', `church-${churchId}`, 'map.draft.json');

  if (!existsSync(mapPath)) {
    console.error(`Map JSON not found: ${mapPath}`);
    process.exit(1);
  }

  const doc = JSON.parse(readFileSync(mapPath, 'utf8'));
  const report = validate(doc);

  console.log(`Validated ${mapPath}`);
  console.log(`  plots: ${report.plotCount}`);
  console.log(`  issues: ${report.issueCount}`);
  console.log(`  warnings: ${report.warningCount}`);
  console.log(`  passed: ${report.passed ? 'YES' : 'NO'}`);

  if (report.issues.length) {
    console.log('\nIssues:');
    for (const i of report.issues) console.log(`  [${i.code}] ${i.message}`);
  }
  if (report.warnings.length) {
    console.log('\nWarnings:');
    for (const w of report.warnings.slice(0, 20)) console.log(`  [${w.code}] ${w.message}`);
    if (report.warnings.length > 20) console.log(`  ... and ${report.warnings.length - 20} more`);
  }

  if (writeReport) {
    const reportPath = mapPath.replace(/\.json$/, '.validation.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote report: ${reportPath}`);
  }

  process.exit(report.passed ? 0 : 1);
}

main();
