/**
 * Work Accountability — shared om_daily_items repository.
 *
 * Single source of truth for reading work items into the accountability
 * analytics pipeline. Extracted so the aggregator, reporting service, and any
 * page-level consumer share ONE definition of:
 *
 *   1. Which rows count for historical/completion analytics (archived-completed
 *      items MUST be included — ~90% of Done items get bulk auto-archived after
 *      their month closes, yet their completion still happened inside the window).
 *   2. Which rows count for active/current views (archived rows excluded unless
 *      explicitly requested).
 *   3. How a work item's *actual* completion timestamp is resolved
 *      (completed_at → github_pr_merged_at → completion EVENT timestamp), never
 *      archived_at.
 *
 * `om_daily_items` has NO boolean `archived` column — archival is recorded via a
 * non-NULL `archived_at` timestamp. There is no `completed`/`closed` status; the
 * terminal completed status is `done`.
 */

const ITEM_COLUMNS = `id, title, status, priority, category, repo_target, github_branch,
  github_pr_number, github_pr_url, github_pr_state, github_pr_merged_at,
  agent_tool, assigned_agent,
  updated_at, created_at, completed_at, completed_at_source, archived_at`;

/**
 * om_daily_item_events event types that represent a work item reaching its
 * terminal "done" state, in priority order (earliest matching event wins as the
 * completion timestamp). We also treat any `status_changed` whose `to_status`
 * is `done` as a completion event. `auto_archived` / `archived` are explicitly
 * NOT completion events — archival is not completion.
 */
const COMPLETION_EVENT_TYPES = [
  'completed',
  'work_completed',
  'pr_merged_done',
  'pr_merged_post_review',
  'agent_completed',
];

/**
 * Build the WHERE fragment (and params) selecting work items for a window.
 *
 * @param {object} opts
 * @param {string} opts.sqlFrom - inclusive lower bound (SQL datetime string)
 * @param {string|null} [opts.sqlTo] - optional inclusive upper bound
 * @param {boolean} [opts.includeArchivedCompleted=true]
 *   - true  (historical/completion analytics): include non-archived rows AND
 *     archived rows that are actually completed (status='done' OR completed_at
 *     present). Archived-but-incomplete rows (e.g. archived cancelled) are
 *     dropped so they never inflate analytics.
 *   - false (active/current views): exclude every archived row outright.
 */
function buildItemsWhere({ sqlFrom, sqlTo = null, includeArchivedCompleted = true }) {
  const clauses = ["status != 'cancelled'"];
  const params = [];

  if (includeArchivedCompleted) {
    // Historical: keep non-archived rows plus archived-completed rows.
    clauses.push("(archived_at IS NULL OR status = 'done' OR completed_at IS NOT NULL)");
  } else {
    // Active/current: archived work items are never part of the live queue.
    clauses.push('archived_at IS NULL');
  }

  if (sqlTo) {
    clauses.push(`(
      (completed_at IS NOT NULL AND completed_at >= ? AND completed_at <= ?)
      OR (created_at >= ? AND created_at <= ?)
      OR (updated_at >= ? AND updated_at <= ?)
    )`);
    params.push(sqlFrom, sqlTo, sqlFrom, sqlTo, sqlFrom, sqlTo);
  } else {
    clauses.push('(updated_at >= ? OR created_at >= ? OR (completed_at IS NOT NULL AND completed_at >= ?))');
    params.push(sqlFrom, sqlFrom, sqlFrom);
  }

  return { where: clauses.join('\n       AND '), params };
}

/**
 * Fetch work items for the analytics pipeline.
 *
 * @param {object} pool - mysql2 pool (omai_db)
 * @param {object} opts - see buildItemsWhere plus `limit`
 * @returns {Promise<Array>} rows (with archived_at) ordered newest-completion first
 */
async function fetchDailyItemsForAnalytics(pool, opts = {}) {
  const { sqlFrom, sqlTo = null } = opts;
  const cappedLimit = Math.min(Math.max(Number(opts.limit) || 300, 50), 2500);
  const { where, params } = buildItemsWhere({ ...opts, sqlFrom, sqlTo });
  const sql = `SELECT ${ITEM_COLUMNS}
     FROM om_daily_items
     WHERE ${where}
     ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
     LIMIT ${cappedLimit}`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * For Done items that lack both `completed_at` AND `github_pr_merged_at`, look up
 * the canonical completion EVENT timestamp from om_daily_item_events and attach
 * it to the row as `completion_event_at` / `completion_event_type`. This is the
 * required fallback so a completion with a missing completed_at column still
 * lands in the right monthly bucket instead of being silently dropped.
 *
 * Mutates rows in place; safe no-op when nothing needs a fallback.
 */
async function attachCompletionEvents(pool, items) {
  const needing = items.filter(
    (i) => i.status === 'done' && !i.completed_at && !i.github_pr_merged_at,
  );
  if (!needing.length) return items;

  const ids = needing.map((i) => i.id);
  const placeholders = ids.map(() => '?').join(',');
  const typePlaceholders = COMPLETION_EVENT_TYPES.map(() => '?').join(',');

  // Earliest completion event per item — the first transition into "done" is the
  // real completion moment. Matches explicit completion event types OR any
  // status_changed whose to_status is 'done'.
  const [rows] = await pool.query(
    `SELECT item_id, MIN(created_at) AS completion_event_at,
            SUBSTRING_INDEX(GROUP_CONCAT(event_type ORDER BY created_at ASC), ',', 1) AS completion_event_type
     FROM om_daily_item_events
     WHERE item_id IN (${placeholders})
       AND (event_type IN (${typePlaceholders}) OR to_status = 'done')
     GROUP BY item_id`,
    [...ids, ...COMPLETION_EVENT_TYPES],
  );

  const byId = new Map(rows.map((r) => [r.item_id, r]));
  for (const item of needing) {
    const ev = byId.get(item.id);
    if (ev && ev.completion_event_at) {
      item.completion_event_at = ev.completion_event_at;
      item.completion_event_type = ev.completion_event_type || 'completion_event';
    }
  }
  return items;
}

/**
 * Resolve a work item's *actual* completion timestamp, honoring the completion
 * priority. Never uses archived_at. Accepts either a raw om_daily_items row or a
 * formatted work-item ref (both carry the same completion fields).
 *
 *   completed_at → github_pr_merged_at → completion_event_at → null
 *
 * `inferred` marks a completed_at that the DB folded in from updated_at
 * (completed_at_source = 'inferred_from_updated_at') so the UI can flag it
 * rather than silently trusting it.
 *
 * @returns {{ts:(string|Date|null), inferred:boolean, field:(string|null)}}
 */
function resolveCompletionTimestamp(wi) {
  if (!wi) return { ts: null, inferred: false, field: null };
  if (wi.completed_at) {
    return {
      ts: wi.completed_at,
      inferred: wi.completed_at_source === 'inferred_from_updated_at',
      field: 'completed_at',
    };
  }
  if (wi.github_pr_merged_at) {
    return { ts: wi.github_pr_merged_at, inferred: false, field: 'github_pr_merged_at' };
  }
  if (wi.completion_event_at) {
    return {
      ts: wi.completion_event_at,
      inferred: false,
      field: `completion_event:${wi.completion_event_type || 'completion_event'}`,
    };
  }
  return { ts: null, inferred: false, field: null };
}

/**
 * Data-quality drift detection over the fetched item set. Surfaced only in
 * debug/audit diagnostics — never as a noisy operator alert.
 *
 *   - done_without_completion_ts: Done item with no completed_at, no PR-merge, no
 *     completion event → cannot be bucketed; counted as incomplete for monthly
 *     completion.
 *   - archived_completed_missing_ts: archived + completed status but no resolvable
 *     completion timestamp.
 */
function completionDataQuality(items) {
  const drift = {
    done_without_completion_ts: [],
    archived_completed_missing_ts: [],
    inferred_completions: 0,
  };
  for (const item of items) {
    if (item.status !== 'done') continue;
    const { ts, inferred, field } = resolveCompletionTimestamp(item);
    if (inferred) drift.inferred_completions += 1;
    if (!ts) {
      drift.done_without_completion_ts.push({ id: item.id, archived: !!item.archived_at });
      if (item.archived_at) drift.archived_completed_missing_ts.push({ id: item.id });
    } else if (field && field.startsWith('completion_event')) {
      // Recovered via event fallback — informational, not drift, but useful.
    }
  }
  return {
    ...drift,
    done_without_completion_ts_count: drift.done_without_completion_ts.length,
    archived_completed_missing_ts_count: drift.archived_completed_missing_ts.length,
  };
}

module.exports = {
  ITEM_COLUMNS,
  COMPLETION_EVENT_TYPES,
  buildItemsWhere,
  fetchDailyItemsForAnalytics,
  attachCompletionEvents,
  resolveCompletionTimestamp,
  completionDataQuality,
};
