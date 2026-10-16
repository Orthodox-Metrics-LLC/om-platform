/**
 * Work Accountability Command Center API
 * Mounted at /api/work-accountability — super_admin only.
 */

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  aggregateAccountability,
  buildTimeline,
  getThreadById,
  reviewException,
} = require('../services/workAccountabilityAggregatorService');
const {
  buildDailyReport,
  buildSummaryReport,
  exportReport,
  queueEmailReport,
  persistReportRecord,
  PERIOD_DAYS,
  PERIOD_HOURS,
} = require('../services/workAccountabilityReportingService');

const router = express.Router();
const superAdmin = [requireAuth, requireRole(['super_admin'])];

function parseQueryOptions(req) {
  return {
    // `range` is the canonical global filter (24h|7d|30d|3m|6m|12m|custom).
    range: req.query.range,
    hours: req.query.hours ? Number(req.query.hours) : undefined,
    from: req.query.from,
    to: req.query.to,
    period: req.query.period,
    repo: req.query.repo || null,
    agent: req.query.agent || null,
    backfill: req.query.backfill !== '0' && req.query.backfill !== 'false',
  };
}

function parseReportOptions(req) {
  const opts = parseQueryOptions(req);
  if (req.body) {
    if (req.body.range) opts.range = req.body.range;
    if (req.body.period) opts.period = req.body.period;
    if (req.body.from) opts.from = req.body.from;
    if (req.body.to) opts.to = req.body.to;
    if (req.body.hours) opts.hours = Number(req.body.hours);
    if (req.body.repo) opts.repo = req.body.repo;
    if (req.body.agent) opts.agent = req.body.agent;
  }
  return opts;
}

router.get('/overview', ...superAdmin, async (req, res) => {
  try {
    const data = await aggregateAccountability(parseQueryOptions(req));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[work-accountability] overview:', err);
    return res.status(500).json({ error: err.message || 'Failed to load overview' });
  }
});

router.get('/timeline', ...superAdmin, async (req, res) => {
  try {
    const agg = await aggregateAccountability(parseQueryOptions(req));
    const timeline = buildTimeline(agg);
    return res.json({
      success: true,
      data: {
        generated_at: agg.generated_at,
        window: agg.window,
        timeline,
        partial_failures: agg.partial_failures,
      },
    });
  } catch (err) {
    console.error('[work-accountability] timeline:', err);
    return res.status(500).json({ error: err.message || 'Failed to load timeline' });
  }
});

router.get('/thread/:id', ...superAdmin, async (req, res) => {
  try {
    const result = await getThreadById(req.params.id, parseQueryOptions(req));
    if (!result?.thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    return res.json({
      success: true,
      data: {
        thread: result.thread,
        window: result.window,
        agent_activity: result.agent_activity,
        git_report_summary: result.git_report_summary,
      },
    });
  } catch (err) {
    console.error('[work-accountability] thread:', err);
    return res.status(500).json({ error: err.message || 'Failed to load thread' });
  }
});

router.get('/exceptions', ...superAdmin, async (req, res) => {
  try {
    const agg = await aggregateAccountability(parseQueryOptions(req));
    return res.json({
      success: true,
      data: {
        generated_at: agg.generated_at,
        exceptions: agg.exceptions,
        totals: {
          open: agg.exceptions.filter((e) => e.review_status === 'open').length,
          reviewed: agg.exceptions.filter((e) => e.review_status === 'reviewed').length,
        },
      },
    });
  } catch (err) {
    console.error('[work-accountability] exceptions:', err);
    return res.status(500).json({ error: err.message || 'Failed to load exceptions' });
  }
});

router.post('/exceptions/:id/review', ...superAdmin, async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.user?.id;
    const action = req.body?.action || 'review';
    if (!['review', 'snooze'].includes(action)) {
      return res.status(400).json({ error: 'action must be review or snooze' });
    }
    const result = await reviewException(req.params.id, {
      userId,
      action,
      note: req.body?.note,
      snoozeHours: req.body?.snooze_hours,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[work-accountability] exception review:', err);
    return res.status(500).json({ error: err.message || 'Review failed' });
  }
});

router.post('/reconcile', ...superAdmin, async (req, res) => {
  try {
    const { backfillWorkSessions } = require('../services/workSessionBackfillService');
    const hours = Number(req.body?.hours || req.query.hours) || 168;
    const dryRun = req.body?.dry_run === true;
    const backfill = await backfillWorkSessions({ hours, dryRun });
    const overview = await aggregateAccountability({
      hours: req.body?.hours || 24,
      backfill: false,
    });
    return res.json({
      success: true,
      data: { backfill, kpis: overview.kpis, reconciled_at: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[work-accountability] reconcile:', err);
    return res.status(500).json({ error: err.message || 'Reconcile failed' });
  }
});

router.get('/agents', ...superAdmin, async (req, res) => {
  try {
    const agg = await aggregateAccountability(parseQueryOptions(req));
    const workspaces = (agg.agent_activity?.source_status || []).map((s) => ({
      platform: s.platform,
      type: s.type,
      path: s.path,
      available: s.available,
      reason: s.reason,
      sessions_found: s.sessions_found,
    }));
    const byPlatform = {};
    for (const s of agg.agent_activity?.sessions || []) {
      const key = s.platform || 'unknown';
      if (!byPlatform[key]) {
        byPlatform[key] = { platform: key, label: s.platform_label || key, sessions: [] };
      }
      byPlatform[key].sessions.push(s);
    }
    return res.json({
      success: true,
      data: {
        generated_at: agg.generated_at,
        totals: agg.agent_activity?.totals || {},
        workspaces,
        by_platform: Object.values(byPlatform),
      },
    });
  } catch (err) {
    console.error('[work-accountability] agents:', err);
    return res.status(500).json({ error: err.message || 'Failed to load agents' });
  }
});

router.get('/reports/summary', ...superAdmin, async (req, res) => {
  const started = Date.now();
  try {
    const opts = parseReportOptions(req);
    if (!opts.range && !opts.period && !opts.from && !opts.hours) opts.range = '30d';
    const report = await buildSummaryReport(opts);
    const userId = req.user?.id || req.session?.user?.id;
    await persistReportRecord({
      period: report.period,
      format: 'json',
      userId,
      status: 'completed',
      metadata: { endpoint: 'summary', duration_ms: Date.now() - started },
    });
    res.set('X-Report-Duration-Ms', String(Date.now() - started));
    return res.json({ success: true, data: report });
  } catch (err) {
    console.error(`[work-accountability] reports/summary (${Date.now() - started}ms):`, err);
    return res.status(500).json({ error: err.message || 'Failed to build summary report' });
  }
});

router.get('/reports/export.md', ...superAdmin, async (req, res) => {
  try {
    const opts = parseReportOptions(req);
    if (!opts.range && !opts.period && !opts.from) opts.range = '90d';
    const { content, report } = await exportReport(opts, 'md');
    const userId = req.user?.id || req.session?.user?.id;
    await persistReportRecord({
      period: report.period,
      format: 'md',
      userId,
      status: 'completed',
      metadata: { endpoint: 'export.md' },
    });
    res.set('Content-Type', 'text/markdown');
    res.set('Content-Disposition', `attachment; filename="work-accountability-${report.period.key}.md"`);
    return res.send(content);
  } catch (err) {
    console.error('[work-accountability] export.md:', err);
    return res.status(500).json({ error: err.message || 'Markdown export failed' });
  }
});

router.get('/reports/export.json', ...superAdmin, async (req, res) => {
  try {
    const opts = parseReportOptions(req);
    if (!opts.range && !opts.period && !opts.from) opts.range = '90d';
    const { content, report } = await exportReport(opts, 'json');
    const userId = req.user?.id || req.session?.user?.id;
    await persistReportRecord({
      period: report.period,
      format: 'json',
      userId,
      status: 'completed',
      metadata: { endpoint: 'export.json' },
    });
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="work-accountability-${report.period.key}.json"`);
    return res.send(content);
  } catch (err) {
    console.error('[work-accountability] export.json:', err);
    return res.status(500).json({ error: err.message || 'JSON export failed' });
  }
});

router.get('/reports/export.csv', ...superAdmin, async (req, res) => {
  try {
    const opts = parseReportOptions(req);
    if (!opts.range && !opts.period && !opts.from) opts.range = '90d';
    const { content, report } = await exportReport(opts, 'csv');
    const userId = req.user?.id || req.session?.user?.id;
    await persistReportRecord({
      period: report.period,
      format: 'csv',
      userId,
      status: 'completed',
      metadata: { endpoint: 'export.csv' },
    });
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="work-accountability-${report.period.key}.csv"`);
    return res.send(content);
  } catch (err) {
    console.error('[work-accountability] export.csv:', err);
    return res.status(500).json({ error: err.message || 'CSV export failed' });
  }
});

router.get('/reports/daily', ...superAdmin, async (req, res) => {
  try {
    const report = await buildDailyReport(parseQueryOptions(req));
    const format = req.query.format || 'json';
    if (format === 'md' || format === 'markdown') {
      res.set('Content-Type', 'text/markdown');
      return res.send(report.markdown);
    }
    return res.json({ success: true, data: report });
  } catch (err) {
    console.error('[work-accountability] daily report:', err);
    return res.status(500).json({ error: err.message || 'Failed to build report' });
  }
});

router.post('/reports/email', ...superAdmin, async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.user?.id;
    const opts = parseReportOptions(req);
    if (!opts.range && !opts.period && !opts.from && !opts.hours) {
      opts.range = req.body?.range || '30d';
    }
    const result = await queueEmailReport({
      userId,
      recipient: req.body?.recipient,
      options: opts,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[work-accountability] email report:', err);
    return res.status(500).json({ error: err.message || 'Email queue failed' });
  }
});

router.get('/reports/periods', ...superAdmin, (req, res) => {
  const { RANGE_PRESETS } = require('../services/workAccountabilityRange');
  return res.json({
    success: true,
    data: {
      // Canonical global-range presets — the same values the Command Center's
      // single "Range" filter sends to every endpoint.
      presets: ['24h', '7d', '30d', '3m', '6m', '12m'],
      labels: Object.fromEntries(
        Object.entries(RANGE_PRESETS).map(([k, v]) => [k, v.label]),
      ),
    },
  });
});

module.exports = router;
