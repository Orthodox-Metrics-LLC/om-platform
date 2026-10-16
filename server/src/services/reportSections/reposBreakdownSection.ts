/**
 * reposBreakdownSection.ts — Weekly/monthly report: time and work by GitHub repo.
 */

const { buildWorkAnalytics, formatDuration, getRepoMeta } = require('../workSessionAnalyticsService');

export async function generate(userId: number, periodStart: string, periodEnd: string) {
  const analytics = await buildWorkAnalytics(userId, periodStart, periodEnd);

  let html = `
    <div style="margin-bottom: 24px;">
      <h2 style="color: #2d1b4e; margin: 0; font-size: 22px; font-weight: 700;">
        Work by Repository
      </h2>
      <div style="height: 3px; background: linear-gradient(90deg, #0369a1, #8c249d); margin: 6px 0 16px 0; border-radius: 2px;"></div>
      <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">
        ${analytics.totals.days_worked} of ${analytics.totals.days_in_period} days with logged work
        · ${analytics.totals.items_completed} items completed
      </p>`;

  if (analytics.by_repo.length > 0) {
    html += `
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: #f9fafb;">
            <th style="text-align: left; padding: 8px 12px; font-size: 13px;">Repository</th>
            <th style="text-align: center; padding: 8px 12px; font-size: 13px;">Sessions</th>
            <th style="text-align: center; padding: 8px 12px; font-size: 13px;">Items Done</th>
            <th style="text-align: right; padding: 8px 12px; font-size: 13px;">Time</th>
          </tr>
        </thead>
        <tbody>`;

    for (const r of analytics.by_repo) {
      html += `
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px;">
              <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${r.color}; margin-right: 8px;"></span>
              <strong>${r.label}</strong><br/>
              <span style="font-size: 11px; color: #9ca3af;">${r.github_repo}</span>
            </td>
            <td style="text-align: center; padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${r.session_count}</td>
            <td style="text-align: center; padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${r.items_completed}</td>
            <td style="text-align: right; padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: 600;">${r.total_formatted}</td>
          </tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html += `<p style="color: #6b7280; font-size: 14px;">No repo-attributed work logged this period.</p>`;
  }

  const activeDays = analytics.by_day.filter(d => d.total_seconds > 0);
  if (activeDays.length > 0) {
    html += `
      <h3 style="color: #374151; font-size: 16px; margin: 16px 0 8px 0;">Daily Accountability</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f9fafb;">
            <th style="text-align: left; padding: 6px 10px;">Day</th>
            <th style="text-align: right; padding: 6px 10px;">Time</th>
            <th style="text-align: left; padding: 6px 10px;">Repos / Focus</th>
          </tr>
        </thead>
        <tbody>`;

    for (const d of activeDays) {
      const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      const repoSummary = d.repos.map(r => `${r.label} (${r.total_formatted})`).join(', ')
        || '—';
      const focus = d.items_worked?.length
        ? d.items_worked.map(i => i.title).slice(0, 2).join('; ')
        : (d.sessions[0]?.work_focus || d.sessions[0]?.summary_note || '—');

      html += `
          <tr>
            <td style="padding: 6px 10px; border-bottom: 1px solid #f3f4f6;">${dayLabel}</td>
            <td style="text-align: right; padding: 6px 10px; border-bottom: 1px solid #f3f4f6; font-weight: 600;">${d.total_formatted}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #f3f4f6; color: #4b5563;">
              ${repoSummary}<br/><span style="font-size: 11px; color: #9ca3af;">${String(focus).slice(0, 120)}</span>
            </td>
          </tr>`;
    }
    html += `</tbody></table>`;
  }

  if (analytics.accountability.missing_days.length > 0 && analytics.accountability.missing_days.length <= 14) {
    html += `
      <p style="margin-top: 16px; font-size: 13px; color: #92400e; background: #fffbeb; padding: 10px 12px; border-radius: 6px;">
        <strong>Days without logged work:</strong>
        ${analytics.accountability.missing_days.map(d =>
          new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        ).join(', ')}
      </p>`;
  }

  html += '</div>';

  return {
    html,
    data: analytics,
  };
}
