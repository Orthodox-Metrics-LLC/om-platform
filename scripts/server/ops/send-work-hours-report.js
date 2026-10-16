#!/usr/bin/env node
/**
 * Work Hours Report email — monthly totals, weekly trend, repo breakdown.
 *
 * Usage:
 *   node send-work-hours-report.js [--months 3|6] [--to email] [--dry-run] [--end YYYY-MM-DD]
 */
process.chdir('/var/www/om-platform/server');
require('dotenv').config();

const fs = require('fs');
const nodemailer = require('nodemailer');
const { buildWorkAnalytics, formatDuration } = require('/var/www/om-platform/server/src/services/workSessionAnalyticsService');
const { getActiveEmailConfig } = require('/var/www/om-platform/server/src/api/settings');

const USER_ID = 1;
const DEFAULT_RECIPIENT = 'info@orthodoxmetrics.com';

const NAVY = '#1a2e52';
const GOLD = '#d4af37';
const PARCHMENT = '#fdfcf9';
const MUTED = '#6b7280';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { months: 3, dryRun: false, recipient: DEFAULT_RECIPIENT, end: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--months' && args[i + 1]) opts.months = parseInt(args[++i], 10);
    else if (args[i] === '--to' && args[i + 1]) opts.recipient = args[++i];
    else if (args[i] === '--end' && args[i + 1]) opts.end = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node send-work-hours-report.js [--months 3|6] [--to email] [--end YYYY-MM-DD] [--dry-run]`);
      process.exit(0);
    }
  }
  if (![3, 6].includes(opts.months)) {
    console.error('Error: --months must be 3 or 6');
    process.exit(1);
  }
  return opts;
}

function computePeriod(months, endDateStr) {
  const endDate = endDateStr
    ? new Date(endDateStr + 'T12:00:00')
    : new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - months);

  const periodEnd = endDate.toISOString().slice(0, 10);
  const periodStart = startDate.toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}

function shortMonthYear(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatPeriodLabel(periodStart, periodEnd, months) {
  const start = new Date(periodStart + 'T12:00:00');
  const end = new Date(periodEnd + 'T12:00:00');
  const startFmt = start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const endFmt = end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return { display: `${startFmt} – ${endFmt}`, subjectRange: `${shortMonthYear(periodStart)}–${shortMonthYear(periodEnd)}`, months };
}

function hoursFromSeconds(s) {
  return Math.round((s / 3600) * 10) / 10;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(`${y}-${m}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shortMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(`${y}-${m}-01T12:00:00`);
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  return `${mon} '${String(y).slice(2)}`;
}

/** Every YYYY-MM from periodStart through periodEnd (inclusive). */
function enumerateCalendarMonths(periodStart, periodEnd) {
  const months = [];
  let [y, m] = periodStart.slice(0, 7).split('-').map(Number);
  const [endY, endM] = periodEnd.slice(0, 7).split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

function buildMonthlyData(byDay, periodStart, periodEnd) {
  const map = {};
  for (const d of byDay) {
    const m = d.date.slice(0, 7);
    map[m] = (map[m] || 0) + (d.total_seconds || 0);
  }
  return enumerateCalendarMonths(periodStart, periodEnd).map((month) => {
    const seconds = map[month] || 0;
    return {
      month,
      seconds,
      hours: hoursFromSeconds(seconds),
      label: monthLabel(month),
      chartLabel: shortMonthLabel(month),
    };
  });
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekLabel(key) {
  const [, w] = key.split('-W');
  return `W${w}`;
}

function buildWeeklyData(byDay) {
  const map = {};
  for (const d of byDay) {
    if (d.total_seconds <= 0) continue;
    const wk = isoWeekKey(d.date);
    map[wk] = (map[wk] || 0) + d.total_seconds;
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, seconds]) => ({ week, seconds, hours: hoursFromSeconds(seconds), label: weekLabel(week) }));
}

function svgBarChart(items, opts = {}) {
  const { width = 520, height = 200, barColor = NAVY, accent = GOLD, valueKey = 'hours', labelKey = 'label' } = opts;
  if (!items.length) return '<p style="color:#888;">No data</p>';
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const maxVal = Math.max(...items.map((i) => i[valueKey]), 1);
  const barGap = 8;
  const barW = Math.min(48, (chartW - barGap * (items.length - 1)) / items.length);

  let bars = '';
  items.forEach((item, idx) => {
    const h = (item[valueKey] / maxVal) * chartH;
    const x = padL + idx * (barW + barGap);
    const y = padT + chartH - h;
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${barColor}" opacity="0.9"/>`;
    bars += `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="${NAVY}" font-weight="600">${item[valueKey]}h</text>`;
    bars += `<text x="${x + barW / 2}" y="${height - 10}" text-anchor="middle" font-size="10" fill="${MUTED}">${item[labelKey]}</text>`;
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((pct) => {
      const y = padT + chartH * (1 - pct);
      const val = Math.round(maxVal * pct);
      return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
              <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="${MUTED}">${val}h</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart">
    ${gridLines}
    ${bars}
    <line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="${accent}" stroke-width="2"/>
  </svg>`;
}

function svgLineChart(items, opts = {}) {
  const { width = 520, height = 180, stroke = GOLD } = opts;
  if (!items.length) return '<p style="color:#888;">No data</p>';
  const padL = 44;
  const padR = 12;
  const padT = 20;
  const padB = 36;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const maxVal = Math.max(...items.map((i) => i.hours), 1);
  const step = items.length > 1 ? chartW / (items.length - 1) : 0;
  const labelEvery = items.length > 14 ? 2 : 1;

  const points = items.map((item, idx) => {
    const x = padL + idx * step;
    const y = padT + chartH - (item.hours / maxVal) * chartH;
    return { x, y, ...item };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  const dots = points
    .map((p, idx) => {
      const label = idx % labelEvery === 0 || idx === points.length - 1
        ? `<text x="${p.x}" y="${height - 10}" text-anchor="middle" font-size="9" fill="${MUTED}">${p.label}</text>`
        : '';
      return `<circle cx="${p.x}" cy="${p.y}" r="${items.length > 20 ? 3 : 4}" fill="${stroke}" stroke="${NAVY}" stroke-width="1.5"/>${label}`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly trend">
    <line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="#e5e7eb"/>
    <polyline points="${polyline}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>
    <polygon points="${polyline} ${points[points.length - 1].x},${padT + chartH} ${points[0].x},${padT + chartH}" fill="${stroke}" opacity="0.12"/>
    ${dots}
  </svg>`;
}

function svgRepoDonut(byRepo, opts = {}) {
  const { size = 200 } = opts;
  if (!byRepo || !byRepo.length) return '<p style="color:#888;">No repo breakdown available</p>';
  const total = byRepo.reduce((s, r) => s + r.total_seconds, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const ir = size * 0.22;
  let angle = -Math.PI / 2;
  let arcs = '';
  let legend = '';

  byRepo.forEach((repo) => {
    const frac = repo.total_seconds / total;
    const sweep = frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep);
    const y2 = cy + r * Math.sin(angle + sweep);
    const ix1 = cx + ir * Math.cos(angle + sweep);
    const iy1 = cy + ir * Math.sin(angle + sweep);
    const ix2 = cx + ir * Math.cos(angle);
    const iy2 = cy + ir * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const color = repo.color || NAVY;
    arcs += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${large} 0 ${ix2} ${iy2} Z" fill="${color}"/>`;
    const pct = Math.round(frac * 100);
    legend += `<tr>
      <td style="padding:4px 8px 4px 0;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};"></span></td>
      <td style="padding:4px 8px;font-size:13px;color:${NAVY};">${repo.label}</td>
      <td style="padding:4px 8px;font-size:13px;color:${MUTED};text-align:right;">${formatDuration(repo.total_seconds)}</td>
      <td style="padding:4px 0;font-size:12px;color:${MUTED};text-align:right;">${pct}%</td>
    </tr>`;
    angle += sweep;
  });

  const centerHours = hoursFromSeconds(total);
  return `<table cellpadding="0" cellspacing="0" width="100%"><tr>
    <td style="vertical-align:middle;width:200px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="18" font-weight="700" fill="${NAVY}">${centerHours}h</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="${MUTED}">total</text>
      </svg>
    </td>
    <td style="vertical-align:middle;padding-left:16px;">
      <table cellpadding="0" cellspacing="0">${legend}</table>
    </td>
  </tr></table>`;
}

function buildHtml(analytics, monthly, weekly, periodLabel) {
  const { totals, by_repo, accountability } = analytics;
  const totalHours = hoursFromSeconds(totals.total_seconds);
  const weeksInPeriod = weekly.length || 1;
  const avgPerWeek = hoursFromSeconds(totals.total_seconds / weeksInPeriod);
  const busiestMonth = monthly
    .filter((m) => m.seconds > 0)
    .reduce((a, b) => (b.seconds > (a?.seconds || 0) ? b : a), null);
  const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Work Hours Report</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${NAVY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(26,46,82,0.1);">
        <tr><td style="height:6px;background:linear-gradient(90deg,${NAVY},${GOLD},${NAVY});"></td></tr>
        <tr><td style="background:${PARCHMENT};padding:28px 32px 20px;text-align:center;border-bottom:1px solid rgba(26,46,82,0.08);">
          <div style="font-size:12px;letter-spacing:0.14em;font-weight:600;color:${GOLD};">ORTHODOX METRICS</div>
          <h1 style="margin:8px 0 4px;font-size:26px;font-weight:700;color:${NAVY};">Work Hours Report</h1>
          <p style="margin:0;font-size:14px;color:${MUTED};">${periodLabel.display}</p>
        </td></tr>

        <tr><td style="padding:28px 32px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="25%" style="padding:8px;">
              <div style="background:${PARCHMENT};border:1px solid rgba(212,175,55,0.25);border-radius:8px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:700;color:${NAVY};">${totalHours}h</div>
                <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;">Total Hours</div>
              </div>
            </td>
            <td width="25%" style="padding:8px;">
              <div style="background:${PARCHMENT};border:1px solid rgba(212,175,55,0.25);border-radius:8px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:700;color:${NAVY};">${avgPerWeek}h</div>
                <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;">Avg / Week</div>
              </div>
            </td>
            <td width="25%" style="padding:8px;">
              <div style="background:${PARCHMENT};border:1px solid rgba(212,175,55,0.25);border-radius:8px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:700;color:${NAVY};">${totals.days_worked}</div>
                <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;">Days Worked</div>
              </div>
            </td>
            <td width="25%" style="padding:8px;">
              <div style="background:${PARCHMENT};border:1px solid rgba(212,175,55,0.25);border-radius:8px;padding:16px;text-align:center;">
                <div style="font-size:22px;font-weight:700;color:${NAVY};line-height:1.2;">${busiestMonth ? busiestMonth.label.split(' ')[0] : '—'}</div>
                <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;">Busiest Month</div>
              </div>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:8px 32px 24px;">
          <h2 style="margin:0 0 4px;font-size:18px;color:${NAVY};">Monthly Totals</h2>
          <div style="height:3px;width:48px;background:${GOLD};margin-bottom:16px;border-radius:2px;"></div>
          ${svgBarChart(monthly, { barColor: NAVY, labelKey: 'chartLabel' })}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;">
            <tr style="background:#f9fafb;">
              <th style="text-align:left;padding:8px 12px;font-size:12px;color:${MUTED};">Month</th>
              <th style="text-align:right;padding:8px 12px;font-size:12px;color:${MUTED};">Hours</th>
              <th style="text-align:right;padding:8px 12px;font-size:12px;color:${MUTED};">Sessions</th>
            </tr>
            ${monthly.map((m) => {
              const sessions = analytics.by_day.filter((d) => d.date.startsWith(m.month) && d.total_seconds > 0)
                .reduce((s, d) => s + d.session_count, 0);
              return `<tr>
                <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;">${m.label}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600;">${m.hours}h</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;">${sessions}</td>
              </tr>`;
            }).join('')}
          </table>
        </td></tr>

        <tr><td style="padding:8px 32px 24px;">
          <h2 style="margin:0 0 4px;font-size:18px;color:${NAVY};">Weekly Trend</h2>
          <div style="height:3px;width:48px;background:${GOLD};margin-bottom:16px;border-radius:2px;"></div>
          ${svgLineChart(weekly)}
        </td></tr>

        <tr><td style="padding:8px 32px 24px;">
          <h2 style="margin:0 0 4px;font-size:18px;color:${NAVY};">By Project / Repo</h2>
          <div style="height:3px;width:48px;background:${GOLD};margin-bottom:16px;border-radius:2px;"></div>
          ${svgRepoDonut(by_repo)}
        </td></tr>

        <tr><td style="padding:8px 32px 24px;">
          <h2 style="margin:0 0 4px;font-size:18px;color:${NAVY};">Accountability Snapshot</h2>
          <div style="height:3px;width:48px;background:${GOLD};margin-bottom:16px;border-radius:2px;"></div>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${PARCHMENT};border-radius:8px;border:1px solid rgba(212,175,55,0.2);">
            <tr><td style="padding:16px 20px;font-size:14px;line-height:1.7;">
              <p style="margin:0 0 8px;"><strong>${totals.session_count}</strong> tracked sessions across <strong>${totals.days_worked}</strong> active days (${totals.days_in_period} calendar days in period).</p>
              <p style="margin:0 0 8px;">Average on active days: <strong>${accountability.avg_formatted}</strong> per day.</p>
              <p style="margin:0 0 8px;"><strong>${totals.items_completed}</strong> OM Daily items completed in this period.</p>
              <p style="margin:0;font-size:13px;color:${MUTED};">Data source: <code>work_sessions</code> (orthodoxmetrics_db) unified with OM Daily item sessions where linked.</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="background:${PARCHMENT};padding:20px 32px;border-top:1px solid rgba(26,46,82,0.08);text-align:center;">
          <p style="margin:0 0 4px;font-size:13px;color:${NAVY};font-weight:600;">Orthodox Metrics — Work Session Tracking</p>
          <p style="margin:0;font-size:11px;color:${MUTED};">Generated ${generatedAt}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmail(html, { recipient, periodStart, periodEnd, periodLabel }) {
  const dbConfig = await getActiveEmailConfig();
  const senderName = dbConfig?.sender_name || 'Orthodox Metrics';
  const senderEmail = dbConfig?.sender_email || process.env.SMTP_USER || 'info@orthodoxmetrics.com';

  const transportOpts = {
    host: dbConfig?.smtp_host || process.env.SMTP_HOST || '127.0.0.1',
    port: dbConfig?.smtp_port || parseInt(process.env.SMTP_PORT || '25', 10),
    secure: !!(dbConfig?.smtp_secure ?? process.env.SMTP_SECURE === 'true'),
  };
  if (dbConfig?.smtp_user && dbConfig?.smtp_pass) {
    transportOpts.auth = { user: dbConfig.smtp_user, pass: dbConfig.smtp_pass };
  }

  const transporter = nodemailer.createTransport(transportOpts);
  const subject = periodLabel.months === 6
    ? `Orthodox Metrics — Work Hours Report (6 Months: ${periodLabel.subjectRange})`
    : `Orthodox Metrics — Work Hours Report (${periodLabel.subjectRange})`;

  const info = await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`,
    to: recipient,
    subject,
    html,
    text: `Work Hours Report: ${periodStart} to ${periodEnd}. Open the HTML version for charts and breakdown.`,
  });

  return { messageId: info.messageId, subject, from: senderEmail, to: recipient };
}

async function main() {
  const opts = parseArgs();
  const { periodStart, periodEnd } = computePeriod(opts.months, opts.end);
  const periodLabel = formatPeriodLabel(periodStart, periodEnd, opts.months);

  console.log(`Building ${opts.months}-month report: ${periodStart} → ${periodEnd}`);

  const analytics = await buildWorkAnalytics(USER_ID, periodStart, periodEnd);
  const monthly = buildMonthlyData(analytics.by_day, periodStart, periodEnd);
  const weekly = buildWeeklyData(analytics.by_day);
  const html = buildHtml(analytics, monthly, weekly, periodLabel);

  const slug = `${periodStart}_to_${periodEnd}`;
  const outPath = `/tmp/work-hours-report-${opts.months}mo-${slug}.html`;
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('HTML written:', outPath);

  if (opts.dryRun) {
    console.log('DRY_RUN: email not sent');
  } else {
    const sendResult = await sendEmail(html, {
      recipient: opts.recipient,
      periodStart,
      periodEnd,
      periodLabel,
    });
    console.log('EMAIL_SENT:', JSON.stringify(sendResult));
  }

  console.log('SUMMARY:', JSON.stringify({
    period: analytics.period,
    totals: analytics.totals,
    totalHours: hoursFromSeconds(analytics.totals.total_seconds),
    monthly: monthly.map((m) => ({ month: m.label, hours: m.hours })),
    weeklyCount: weekly.length,
    by_repo: analytics.by_repo.map((r) => ({ label: r.label, hours: hoursFromSeconds(r.total_seconds) })),
  }, null, 2));
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
