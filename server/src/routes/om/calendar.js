/**
 * /api/om/calendar — per-church calendar for the om-platform (Applications → Calendar).
 *
 *   Sources (tenant calendar_sources)
 *     website   the parish website's /schedule page → auto-discovers its iCal feed
 *     ics       any iCal/webcal URL (e.g. the OCA public Google calendar)
 *     orthocal  orthocal.info liturgical calendar; config.calendar = 'new' | 'old'
 *   Local events live in the tenant calendar_events table.
 *
 * Feeds are fetched server-side (CORS) and cached in memory for 30 minutes.
 */
const express = require('express');
const { promisePool, getTenantPool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

const PLATFORM_ROLES = ['super_admin', 'admin'];
const CHURCH_WRITE_ROLES = ['church_admin', 'manager', 'priest', 'deacon'];
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_UA = 'OrthodoxMetrics-Calendar/1.0 (+https://orthodoxmetrics.com)';
const OCA_ICS = 'https://calendar.google.com/calendar/ical/c_4tf2klqmebr3cbsvsvloa0st8k%40group.calendar.google.com/public/basic.ics';
const JULIAN_OFFSET_DAYS = 13;

const getUserId = (req) => req.user?.id || req.session?.user?.id;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------
async function resolveContext(req, requestedChurchId) {
    const uid = getUserId(req);
    const [[actor]] = await promisePool.query(
        "SELECT id, role, church_id, email, first_name, last_name, display_name FROM orthodoxmetrics_db.users WHERE id = ? AND is_active = 1 AND account_status = 'active'", [uid]);
    if (!actor) throw Object.assign(new Error('Account is not active'), { status: 403 });
    const isPlatform = PLATFORM_ROLES.includes(actor.role);
    const churchId = isPlatform ? Number(requestedChurchId || actor.church_id) : actor.church_id;
    if (!churchId) throw Object.assign(new Error(isPlatform ? 'church_id is required' : 'Your account is not assigned to a church'), { status: 400 });
    if (actor.role === 'admin') {
        const [rows] = await promisePool.query(
            "SELECT 1 FROM orthodoxmetrics_db.user_roles ur JOIN orthodoxmetrics_db.roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'admin' AND ur.church_id = ?", [actor.id, churchId]);
        if (!rows.length) throw Object.assign(new Error('You are not responsible for this church'), { status: 403 });
    } else if (!isPlatform && actor.church_id !== churchId) throw Object.assign(new Error('Not your church'), { status: 403 });
    const [[church]] = await promisePool.query('SELECT id, COALESCE(church_name, name) AS name, website, database_name FROM orthodoxmetrics_db.churches WHERE id = ?', [churchId]);
    if (!church?.database_name) throw Object.assign(new Error('Church is not provisioned'), { status: 404 });
    const pool = getTenantPool(churchId);
    await ensureDefaultSources(pool, churchId, actor.id, church);
    return { actor, church, pool, isPlatform, canWrite: isPlatform || CHURCH_WRITE_ROLES.includes(actor.role) };
}

/** Website of the church's manager / priest / deacon account (first one set), else churches.website. */
async function parishWebsite(churchId, church) {
    const [rows] = await promisePool.query(
        `SELECT website FROM orthodoxmetrics_db.users
         WHERE church_id = ? AND is_active = 1 AND website IS NOT NULL AND website <> ''
           AND role IN ('church_admin','manager','priest','deacon')
         ORDER BY FIELD(role,'church_admin','manager','priest','deacon'), id LIMIT 1`, [churchId]);
    return rows[0]?.website || church.website || null;
}

async function ensureDefaultSources(pool, churchId, userId, church) {
    const [[{ c }]] = await pool.query('SELECT COUNT(*) c FROM calendar_sources');
    if (c > 0) return;
    const site = await parishWebsite(churchId, church);
    const rows = [];
    if (site) rows.push([churchId, 'Parish schedule', 'website', normalizeOrigin(site), '#00A76F', 1, 0, null, userId]);
    rows.push([churchId, 'OCA Calendar', 'ics', OCA_ICS, '#1877F2', 1, 1, null, userId]);
    rows.push([churchId, 'Orthodox Calendar (orthocal.info)', 'orthocal', 'https://orthocal.info', '#8E33FF', 1, 2, JSON.stringify({ calendar: 'new' }), userId]);
    await pool.query('INSERT INTO calendar_sources (church_id, name, kind, url, color, enabled, sort_order, config, created_by) VALUES ?', [rows]);
}

function normalizeOrigin(site) {
    try {
        const u = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
        return `${u.protocol}//${u.host}`;
    } catch { return site; }
}

const parseConfig = (c) => { try { return (typeof c === 'string' ? JSON.parse(c) : c) || {}; } catch { return {}; } };

function shapeSource(s) {
    return { id: s.id, name: s.name, kind: s.kind, url: s.url, color: s.color, enabled: !!s.enabled, sort_order: s.sort_order, config: parseConfig(s.config), last_synced_at: s.last_synced_at, last_error: s.last_error };
}

// ---------------------------------------------------------------------------
// fetching + cache
// ---------------------------------------------------------------------------
const cache = new Map(); // key → { at, value }
function cached(key, ttl, loader) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = loader().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, { at: Date.now(), value });
    return value;
}

async function fetchText(url, accept = '*/*') {
    const res = await fetch(url.replace(/^webcal:/i, 'https:'), { headers: { 'User-Agent': FETCH_UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    return res.text();
}

/** Find the iCal feed advertised on a parish website's /schedule page. */
async function discoverIcsFromWebsite(origin) {
    return cached(`discover:${origin}`, 6 * 60 * 60 * 1000, async () => {
        const candidates = [`${origin}/schedule`, `${origin}/calendar`, origin];
        for (const page of candidates) {
            let html;
            try { html = await fetchText(page, 'text/html'); } catch { continue; }
            const links = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((m) => m[1]);
            for (const raw of links) {
                let href = raw.replace(/&amp;/g, '&');
                const cid = /calendar\/render\?cid=([^&]+)/i.exec(href);
                if (cid) href = decodeURIComponent(cid[1]);
                if (/^webcal:/i.test(href)) return href.replace(/^webcal:/i, 'https:');
                if (/\.ics(\?|$)/i.test(href)) return new URL(href, page).toString();
                const gsrc = /calendar\.google\.com\/calendar\/(?:u\/\d+\/)?embed\?[^"']*src=([^&"']+)/i.exec(href);
                if (gsrc) return `https://calendar.google.com/calendar/ical/${encodeURIComponent(decodeURIComponent(gsrc[1]))}/public/basic.ics`;
            }
        }
        throw new Error('No iCal feed found on the parish website (/schedule)');
    });
}

// ---------------------------------------------------------------------------
// iCal parsing (folded lines, DATE / DATE-TIME, TZID, simple RRULE expansion)
// ---------------------------------------------------------------------------
function unfold(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
function parseProp(line) {
    const i = line.indexOf(':');
    if (i < 0) return null;
    const [name, ...params] = line.slice(0, i).split(';');
    const p = {};
    params.forEach((kv) => { const [k, v] = kv.split('='); if (k) p[k.toUpperCase()] = v; });
    return { name: name.toUpperCase(), params: p, value: line.slice(i + 1) };
}
const unescapeText = (s) => (s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

/** Returns { date:'YYYY-MM-DD', allDay:true } or { iso:'...Z-ish', allDay:false }. Floating/TZID times are kept as local wall time. */
function parseDt(prop) {
    const v = prop.value.trim();
    if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { allDay: true, date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` };
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    if (!m) return null;
    const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
    return { allDay: false, iso: m[7] ? `${local}Z` : local, date: `${m[1]}-${m[2]}-${m[3]}` };
}

function parseIcs(text) {
    const lines = unfold(text);
    const events = [];
    let cur = null;
    let calName = null;
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
        if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
        const p = parseProp(line);
        if (!p) continue;
        if (!cur) { if (p.name === 'X-WR-CALNAME') calName = p.value; continue; }
        switch (p.name) {
            case 'UID': cur.uid = p.value; break;
            case 'SUMMARY': cur.title = unescapeText(p.value); break;
            case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
            case 'LOCATION': cur.location = unescapeText(p.value); break;
            case 'URL': cur.url = p.value; break;
            case 'DTSTART': cur.start = parseDt(p); break;
            case 'DTEND': cur.end = parseDt(p); break;
            case 'RRULE': cur.rrule = Object.fromEntries(p.value.split(';').map((kv) => kv.split('='))); break;
            case 'EXDATE': (cur.exdates ||= []).push(...p.value.split(',').map((v) => v.slice(0, 8))); break;
            case 'RECURRENCE-ID': cur.recurrenceId = p.value.slice(0, 8); break;
            case 'STATUS': cur.status = p.value; break;
            default:
        }
    }
    return { calName, events };
}

const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Expand an event (with optional RRULE) into occurrences within [rangeStart, rangeEnd]. */
function expand(ev, rangeStart, rangeEnd, limit = 400) {
    if (ev.status === 'CANCELLED') return [];
    const startDate = ev.start.date;
    const durationDays = ev.end?.date ? Math.max(0, Math.round((Date.parse(`${ev.end.date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000)) : 0;
    const timePart = ev.start.allDay ? null : ev.start.iso.slice(10);
    const endTimePart = !ev.end || ev.end.allDay ? null : ev.end.iso.slice(10);

    const make = (date) => {
        const endDate = addDays(date, ev.start.allDay ? Math.max(durationDays, 1) : durationDays);
        return {
            uid: ev.uid, title: ev.title || '(untitled)', description: ev.description || '', location: ev.location || '', url: ev.url || null,
            allDay: !!ev.start.allDay,
            start: ev.start.allDay ? date : `${date}${timePart}`,
            end: ev.start.allDay ? endDate : `${endDate}${endTimePart || timePart}`,
        };
    };

    if (!ev.rrule) return startDate <= rangeEnd && (ev.end?.date || startDate) >= rangeStart ? [make(startDate)] : [];

    const r = ev.rrule;
    const freq = r.FREQ;
    const interval = Number(r.INTERVAL || 1);
    const until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : null;
    let count = r.COUNT ? Number(r.COUNT) : Infinity;
    const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => DOW[d.slice(-2)]).filter((n) => n !== undefined) : null;
    const ex = new Set((ev.exdates || []).map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`));
    const out = [];
    let cursor = startDate;
    let guard = 0;
    while (cursor <= rangeEnd && count > 0 && guard++ < 5000) {
        if (until && cursor > until) break;
        let dates = [cursor];
        if (freq === 'WEEKLY' && byday) {
            const base = new Date(`${cursor}T00:00:00Z`);
            const weekStart = addDays(cursor, -base.getUTCDay());
            dates = byday.map((d) => addDays(weekStart, d)).filter((d) => d >= startDate && (!until || d <= until));
        }
        for (const d of dates) {
            if (count <= 0) break;
            count -= 1;
            if (d >= rangeStart && d <= rangeEnd && !ex.has(d)) out.push(make(d));
            if (out.length >= limit) return out;
        }
        const c = new Date(`${cursor}T00:00:00Z`);
        if (freq === 'DAILY') c.setUTCDate(c.getUTCDate() + interval);
        else if (freq === 'WEEKLY') c.setUTCDate(c.getUTCDate() + 7 * interval);
        else if (freq === 'MONTHLY') c.setUTCMonth(c.getUTCMonth() + interval);
        else if (freq === 'YEARLY') c.setUTCFullYear(c.getUTCFullYear() + interval);
        else break;
        cursor = ymd(c);
    }
    return out;
}

async function icsEvents(url, rangeStart, rangeEnd) {
    const parsed = await cached(`ics:${url}`, CACHE_TTL_MS, async () => parseIcs(await fetchText(url, 'text/calendar')));
    const overridden = new Set(parsed.events.filter((e) => e.recurrenceId).map((e) => `${e.uid}@${e.recurrenceId}`));
    const out = [];
    for (const ev of parsed.events) {
        for (const occ of expand(ev, rangeStart, rangeEnd)) {
            const key = `${ev.uid}@${occ.start.slice(0, 10).replace(/-/g, '')}`;
            if (ev.rrule && overridden.has(key)) continue;
            out.push(occ);
        }
    }
    return { calName: parsed.calName, events: out };
}

// ---------------------------------------------------------------------------
// orthocal.info
// ---------------------------------------------------------------------------
async function orthocalMonth(cal, year, month) {
    return cached(`orthocal:${cal}:${year}-${month}`, 24 * 60 * 60 * 1000, async () => {
        const txt = await fetchText(`https://orthocal.info/api/${cal === 'old' ? 'julian' : 'gregorian'}/${year}/${month}/`, 'application/json');
        return JSON.parse(txt);
    });
}

function monthsBetween(rangeStart, rangeEnd) {
    const out = [];
    let [y, m] = rangeStart.split('-').map(Number);
    const [ey, em] = rangeEnd.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) { out.push([y, m]); m += 1; if (m > 12) { m = 1; y += 1; } }
    return out;
}

function shapeDay(d, cal) {
    // orthocal's julian API is addressed by civil date but reports the *Julian* y/m/d;
    // civil = julian + 13 days. Gregorian reports civil dates directly.
    const reported = `${d.year}-${pad(d.month)}-${pad(d.day)}`;
    const date = cal === 'old' ? addDays(reported, JULIAN_OFFSET_DAYS) : reported;
    const otherDate = cal === 'old' ? addDays(date, -JULIAN_OFFSET_DAYS) : addDays(date, JULIAN_OFFSET_DAYS);
    return {
        date,
        calendar: cal,
        title: d.summary_title || (d.titles || [])[0] || '',
        titles: d.titles || [],
        feasts: d.feasts || [],
        saints: d.saints || [],
        feast_level: d.feast_level,
        feast_level_description: d.feast_level_description,
        fast_level: d.fast_level,
        fast_level_description: d.fast_level_desc || d.fast_level_description,
        fast_exception_description: d.fast_exception_desc || d.fast_exception_description,
        tone: d.tone,
        readings: (d.readings || []).map((r) => r.display || r.short_display || `${r.book} ${r.display || ''}`.trim()),
        // Same commemoration on the other calendar falls on this civil date.
        other: { calendar: cal === 'old' ? 'new' : 'old', label: cal === 'old' ? 'New Calendar' : 'Old Calendar', date: otherDate },
    };
}

async function orthocalDays(cal, rangeStart, rangeEnd) {
    const days = [];
    for (const [y, m] of monthsBetween(rangeStart, rangeEnd)) {
        try {
            const arr = await orthocalMonth(cal, y, m);
            for (const d of arr) { const s = shapeDay(d, cal); if (s.date >= rangeStart && s.date <= rangeEnd) days.push(s); }
        } catch (e) { /* month unavailable */ }
    }
    return days;
}

// ---------------------------------------------------------------------------
// helpers / routes
// ---------------------------------------------------------------------------
const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        console.error('[om/calendar]', err);
        res.status(500).json({ success: false, message: 'Calendar error' });
    }
};
const rangeOf = (q) => {
    const today = ymd(new Date());
    const start = /^\d{4}-\d{2}-\d{2}$/.test(q.start || '') ? q.start : addDays(today, -180);
    const end = /^\d{4}-\d{2}-\d{2}$/.test(q.end || '') ? q.end : addDays(today, 540);
    return { start, end };
};

router.get('/sources', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const [rows] = await ctx.pool.query('SELECT * FROM calendar_sources ORDER BY sort_order, id');
    const orthocal = rows.find((r) => r.kind === 'orthocal');
    res.json({ success: true, church: { id: ctx.church.id, name: ctx.church.name, website: await parishWebsite(ctx.church.id, ctx.church) }, can_write: ctx.canWrite, default_calendar: parseConfig(orthocal?.config).calendar || 'new', sources: rows.map(shapeSource) });
}));

router.post('/sources', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id);
    if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can manage calendars'), { status: 403 });
    const { name, kind, url, color } = req.body || {};
    if (!name?.trim() || !['website', 'ics', 'orthocal'].includes(kind)) throw Object.assign(new Error('Name and kind are required'), { status: 400 });
    let finalUrl = url ? String(url).trim() : null;
    if (kind !== 'orthocal') {
        if (!finalUrl) throw Object.assign(new Error('URL is required'), { status: 400 });
        const g = /calendar\.google\.com\/calendar\/(?:u\/\d+\/)?embed\?[^"']*src=([^&"']+)/i.exec(finalUrl);
        if (g) finalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(decodeURIComponent(g[1]))}/public/basic.ics`;
        if (kind === 'website') finalUrl = normalizeOrigin(finalUrl);
        else finalUrl = finalUrl.replace(/^webcal:/i, 'https:');
    }
    const [[{ n }]] = await ctx.pool.query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM calendar_sources');
    const [r] = await ctx.pool.query('INSERT INTO calendar_sources (church_id, name, kind, url, color, enabled, sort_order, config, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        [ctx.church.id, name.trim(), kind, finalUrl, color || '#00A76F', n, kind === 'orthocal' ? JSON.stringify({ calendar: req.body?.config?.calendar === 'old' ? 'old' : 'new' }) : null, ctx.actor.id]);
    const [[row]] = await ctx.pool.query('SELECT * FROM calendar_sources WHERE id = ?', [r.insertId]);
    res.json({ success: true, source: shapeSource(row) });
}));

router.patch('/sources/:id', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id || req.query.church_id);
    if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can manage calendars'), { status: 403 });
    const id = Number(req.params.id);
    const [[row]] = await ctx.pool.query('SELECT * FROM calendar_sources WHERE id = ?', [id]);
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    const sets = []; const vals = [];
    const b = req.body || {};
    if (b.name !== undefined) { sets.push('name = ?'); vals.push(String(b.name).trim()); }
    if (b.color !== undefined) { sets.push('color = ?'); vals.push(String(b.color)); }
    if (b.enabled !== undefined) { sets.push('enabled = ?'); vals.push(b.enabled ? 1 : 0); }
    if (b.url !== undefined && row.kind !== 'orthocal') { sets.push('url = ?'); vals.push(row.kind === 'website' ? normalizeOrigin(String(b.url)) : String(b.url).replace(/^webcal:/i, 'https:')); cache.delete(`ics:${row.url}`); cache.delete(`discover:${row.url}`); }
    if (b.config !== undefined) { sets.push('config = ?'); vals.push(JSON.stringify({ ...parseConfig(row.config), ...b.config })); }
    if (!sets.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });
    vals.push(id);
    await ctx.pool.query(`UPDATE calendar_sources SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [[next]] = await ctx.pool.query('SELECT * FROM calendar_sources WHERE id = ?', [id]);
    res.json({ success: true, source: shapeSource(next) });
}));

router.delete('/sources/:id', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can manage calendars'), { status: 403 });
    await ctx.pool.query('DELETE FROM calendar_sources WHERE id = ?', [Number(req.params.id)]);
    res.json({ success: true });
}));

/** Force re-fetch of a source. */
router.post('/sources/:id/sync', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id || req.query.church_id);
    const [[row]] = await ctx.pool.query('SELECT * FROM calendar_sources WHERE id = ?', [Number(req.params.id)]);
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    for (const k of [...cache.keys()]) if (k.includes(row.url || '') || (row.kind === 'orthocal' && k.startsWith('orthocal:'))) cache.delete(k);
    const { start, end } = rangeOf(req.query);
    const result = await loadSource(ctx, row, start, end);
    res.json({ success: true, source: result.source, count: result.events.length });
}));

/** Default liturgical calendar for the church: 'new' | 'old'. */
router.put('/default-calendar', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id);
    if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can change the default calendar'), { status: 403 });
    const cal = req.body?.calendar === 'old' ? 'old' : 'new';
    const [[row]] = await ctx.pool.query("SELECT * FROM calendar_sources WHERE kind = 'orthocal' ORDER BY id LIMIT 1");
    if (row) await ctx.pool.query('UPDATE calendar_sources SET config = ? WHERE id = ?', [JSON.stringify({ ...parseConfig(row.config), calendar: cal }), row.id]);
    else await ctx.pool.query('INSERT INTO calendar_sources (church_id, name, kind, url, color, enabled, sort_order, config, created_by) VALUES (?, ?, ?, ?, ?, 1, 99, ?, ?)', [ctx.church.id, 'Orthodox Calendar (orthocal.info)', 'orthocal', 'https://orthocal.info', '#8E33FF', JSON.stringify({ calendar: cal }), ctx.actor.id]);
    res.json({ success: true, default_calendar: cal });
}));

async function loadSource(ctx, row, start, end) {
    const source = shapeSource(row);
    try {
        let events = [];
        if (row.kind === 'website') {
            const ics = await discoverIcsFromWebsite(row.url);
            source.feed_url = ics;
            events = (await icsEvents(ics, start, end)).events;
        } else if (row.kind === 'ics') {
            const r = await icsEvents(row.url, start, end);
            source.feed_name = r.calName;
            events = r.events;
        } else if (row.kind === 'orthocal') {
            const cal = parseConfig(row.config).calendar === 'old' ? 'old' : 'new';
            events = (await orthocalDays(cal, start, end)).map((d) => ({
                uid: `orthocal-${cal}-${d.date}`, title: d.title, description: [d.fast_level_description, ...d.feasts, ...d.saints.slice(0, 6)].filter(Boolean).join('\n'),
                allDay: true, start: d.date, end: addDays(d.date, 1), liturgical: d,
            }));
        }
        await ctx.pool.query('UPDATE calendar_sources SET last_synced_at = NOW(), last_error = NULL WHERE id = ?', [row.id]);
        source.last_synced_at = new Date().toISOString(); source.last_error = null;
        return { source, events: events.map((e, i) => ({ ...e, id: `${row.id}:${e.uid || i}:${e.start}`, source_id: row.id, source_name: row.name, color: row.color, readonly: true })) };
    } catch (e) {
        await ctx.pool.query('UPDATE calendar_sources SET last_error = ? WHERE id = ?', [String(e.message).slice(0, 500), row.id]);
        source.last_error = e.message;
        return { source, events: [] };
    }
}

// GET /events?church_id&start&end → local + all enabled sources
router.get('/events', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const { start, end } = rangeOf(req.query);
    const [srcRows] = await ctx.pool.query('SELECT * FROM calendar_sources WHERE enabled = 1 ORDER BY sort_order, id');
    const results = await Promise.all(srcRows.map((row) => loadSource(ctx, row, start, end)));
    const [local] = await ctx.pool.query('SELECT * FROM calendar_events WHERE date <= ? AND COALESCE(end_date, date) >= ? ORDER BY date, time', [end, start]);
    const localEvents = local.map((e) => {
        const allDay = e.all_day === null || e.all_day === undefined ? !e.time : !!e.all_day;
        const d = e.date instanceof Date ? ymd(e.date) : String(e.date).slice(0, 10);
        const ed = e.end_date ? (e.end_date instanceof Date ? ymd(e.end_date) : String(e.end_date).slice(0, 10)) : d;
        return {
            id: `local:${e.id}`, local_id: e.id, title: e.title, description: e.details || '', location: e.location || '', type: e.type,
            allDay, start: allDay ? d : `${d}T${(e.time || '00:00').slice(0, 5)}:00`, end: allDay ? addDays(ed, 1) : `${ed}T${(e.end_time || e.time || '00:00').slice(0, 5)}:00`,
            color: e.color || '#FFAB00', source_id: null, source_name: ctx.church.name, readonly: !ctx.canWrite,
        };
    });
    res.json({ success: true, range: { start, end }, can_write: ctx.canWrite, sources: results.map((r) => r.source), events: [...localEvents, ...results.flatMap((r) => r.events)] });
}));

// GET /liturgical?church_id&start&end → day-by-day feasts for the church's default calendar (+ other-calendar equivalent)
router.get('/liturgical', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const { start, end } = rangeOf(req.query);
    const [[row]] = await ctx.pool.query("SELECT config FROM calendar_sources WHERE kind = 'orthocal' ORDER BY id LIMIT 1");
    const cal = parseConfig(row?.config).calendar === 'old' ? 'old' : 'new';
    const days = await orthocalDays(cal, start, end);
    // For hover: what the OTHER calendar commemorates on each civil date too.
    const otherDays = await orthocalDays(cal === 'old' ? 'new' : 'old', start, end);
    const otherByDate = new Map(otherDays.map((d) => [d.date, d]));
    res.json({
        success: true, calendar: cal, range: { start, end },
        days: days.map((d) => ({ ...d, other: { ...d.other, today_title: otherByDate.get(d.date)?.title || null } })),
    });
}));

// local events CRUD (tenant calendar_events)
function localBody(b) {
    const start = String(b.start || '');
    const end = b.end ? String(b.end) : null;
    const allDay = b.allDay !== false && !/T\d{2}:\d{2}/.test(start) ? true : !!b.allDay;
    const date = start.slice(0, 10);
    const time = allDay ? null : start.slice(11, 16);
    let endDate = end ? end.slice(0, 10) : null;
    const endTime = allDay || !end ? null : end.slice(11, 16);
    if (allDay && endDate && endDate > date) endDate = addDays(endDate, -1); // FullCalendar all-day end is exclusive
    return { title: String(b.title || '').trim(), date, time, endDate: endDate && endDate !== date ? endDate : null, endTime, allDay, color: b.color || null, details: b.description ? String(b.description) : null, location: b.location ? String(b.location) : null };
}

router.post('/events', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id);
    if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can add events'), { status: 403 });
    const v = localBody(req.body || {});
    if (!v.title || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw Object.assign(new Error('Title and start are required'), { status: 400 });
    const [r] = await ctx.pool.query("INSERT INTO calendar_events (title, date, time, end_date, end_time, all_day, color, created_by, location, type, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'event', ?)",
        [v.title, v.date, v.time, v.endDate, v.endTime, v.allDay ? 1 : 0, v.color, ctx.actor.id, v.location, v.details]);
    res.json({ success: true, id: `local:${r.insertId}` });
}));

router.put('/events/:id', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id);
    if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can edit events'), { status: 403 });
    const id = Number(String(req.params.id).replace(/^local:/, ''));
    const v = localBody(req.body || {});
    if (!v.title || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw Object.assign(new Error('Title and start are required'), { status: 400 });
    await ctx.pool.query('UPDATE calendar_events SET title = ?, date = ?, time = ?, end_date = ?, end_time = ?, all_day = ?, color = ?, location = ?, details = ? WHERE id = ?',
        [v.title, v.date, v.time, v.endDate, v.endTime, v.allDay ? 1 : 0, v.color, v.location, v.details, id]);
    res.json({ success: true });
}));

router.delete('/events/:id', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can delete events'), { status: 403 });
    await ctx.pool.query('DELETE FROM calendar_events WHERE id = ?', [Number(String(req.params.id).replace(/^local:/, ''))]);
    res.json({ success: true });
}));

module.exports = router;
