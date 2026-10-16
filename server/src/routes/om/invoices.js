/**
 * /api/om/invoices — invoices issued by Orthodox Metrics to church tenants (om-platform Minimal UI).
 *
 *   Platform (super_admin / admin):  list, create, update, send, mark paid, cancel, delete drafts,
 *                                    address book (issuer + provisioned churches), analytics.
 *   Church roles (church_admin / manager / priest / deacon): their parish's invoices, details,
 *                                    Stripe Checkout to pay.
 *
 * Storage: orthodoxmetrics_db.invoices + invoice_items (existing), mirrored into the tenant's
 * invoices_received on send/pay. Payment: Stripe Checkout (mode=payment) with invoice metadata;
 * the existing /api/billing/webhook finalizes via markInvoicePaidFromStripe().
 */
const express = require('express');
const { promisePool, getTenantPool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

const PLATFORM_ROLES = ['super_admin', 'admin'];
const CHURCH_ROLES = ['church_admin', 'manager', 'priest', 'deacon'];
const STATUSES = ['draft', 'pending', 'sent', 'paid', 'overdue', 'cancelled'];

/** Issuer shown in the "From" block of every invoice (hard-coded by decision). */
const ISSUER = Object.freeze({
    id: 'orthodox-metrics-llc',
    name: 'Orthodox Metrics LLC',
    company: 'Orthodox Metrics LLC',
    fullAddress: '48 Limerick Ln, Phillipsburg NJ 08865',
    phoneNumber: null,
    email: 'info@orthodoxmetrics.com',
    addressType: 'Issuer',
    primary: true,
});

const getUserId = (req) => req.user?.id || req.session?.user?.id;
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const parseJson = (v, fb = null) => { try { return v == null ? fb : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return fb; } };
const ml = (v) => parseJson(v, null)?.en ?? (typeof v === 'string' && !v.startsWith('{') ? v : '') ?? '';
const toDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const omBaseUrl = () => process.env.OM_PLATFORM_URL || 'https://orthodoxmetrics.com';

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------
async function actorOf(req) {
    const [[u]] = await promisePool.query(
        "SELECT id, role, church_id, email, first_name, last_name FROM orthodoxmetrics_db.users WHERE id = ? AND is_active = 1 AND account_status = 'active'", [getUserId(req)]);
    if (!u) throw Object.assign(new Error('Account is not active'), { status: 403 });
    return { ...u, isPlatform: PLATFORM_ROLES.includes(u.role), isChurch: CHURCH_ROLES.includes(u.role) };
}
function requirePlatform(actor) { if (!actor.isPlatform) throw Object.assign(new Error('Only platform administrators manage invoices'), { status: 403 }); }

async function churchAddress(churchId) {
    const [[c]] = await promisePool.query(
        'SELECT id, COALESCE(name, church_name) AS name, address, city, state_province, postal_code, email, phone, database_name FROM orthodoxmetrics_db.churches WHERE id = ?', [churchId]);
    if (!c) return null;
    const line2 = [c.city, [c.state_province, c.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return {
        id: String(c.id), churchId: c.id, name: c.name, company: null,
        fullAddress: [c.address, line2].filter(Boolean).join(', '),
        phoneNumber: c.phone || null, email: c.email || null, addressType: 'Church', primary: false, provisioned: !!c.database_name,
    };
}

// ---------------------------------------------------------------------------
// shaping (Minimal IInvoice)
// ---------------------------------------------------------------------------
function shapeItem(r) {
    return { id: String(r.id), title: ml(r.name_multilang), description: ml(r.description_multilang), service: r.item_code || r.category || 'service', quantity: Number(r.quantity), price: Number(r.unit_price), total: Number(r.line_total) };
}
async function shapeInvoice(row, items) {
    const its = (items ?? []).map(shapeItem);
    const to = parseJson(row.bill_to_json) || (await churchAddress(row.church_id)) || { name: `Church #${row.church_id}`, fullAddress: '' };
    const overdue = row.status === 'sent' && row.due_date && toDate(row.due_date) < toDate(new Date());
    return {
        id: String(row.id),
        invoiceNumber: row.invoice_number,
        churchId: row.church_id,
        status: overdue ? 'overdue' : row.status,
        createDate: row.issue_date, dueDate: row.due_date,
        sent: row.sent_at ? 1 : 0, sentAt: row.sent_at, paidAt: row.paid_at, viewedAt: row.viewed_at,
        currency: row.currency || 'USD',
        subtotal: Number(row.subtotal), taxes: Number(row.tax_amount), taxRate: Number(row.tax_rate || 0), discount: Number(row.discount_amount), shipping: 0,
        totalAmount: Number(row.total_amount), amountPaid: Number(row.amount_paid || 0), balanceDue: money(Number(row.total_amount) - Number(row.amount_paid || 0)),
        paidMethod: row.paid_method, stripeCheckoutSessionId: row.stripe_checkout_session_id || null,
        notes: ml(row.notes_multilang), paymentTerms: ml(row.payment_terms_multilang), internalNotes: row.internal_notes,
        pdfPath: row.pdf_path,
        invoiceFrom: parseJson(row.bill_from_json) || ISSUER,
        invoiceTo: to,
        items: its,
        createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
async function loadInvoice(id) {
    const [[row]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.invoices WHERE id = ?', [id]);
    if (!row) throw Object.assign(new Error('Invoice not found'), { status: 404 });
    const [items] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.invoice_items WHERE invoice_id = ? ORDER BY sort_order, id', [id]);
    return { row, items, invoice: await shapeInvoice(row, items) };
}

async function nextInvoiceNumber() {
    const [[r]] = await promisePool.query("SELECT MAX(CAST(REGEXP_REPLACE(invoice_number, '[^0-9]', '') AS UNSIGNED)) AS n FROM orthodoxmetrics_db.invoices WHERE invoice_number REGEXP '^INV-[0-9]+$'");
    return `INV-${String((Number(r?.n) || 0) + 1).padStart(5, '0')}`;
}

/** Validates + totals the payload. Items: {title, description, service, quantity, price}. */
function normalizePayload(b) {
    const items = (Array.isArray(b.items) ? b.items : []).map((it, i) => {
        const quantity = Number(it.quantity) || 0; const price = money(it.price);
        return { title: String(it.title || '').trim(), description: String(it.description || ''), service: String(it.service || 'service').slice(0, 50), quantity, price, total: money(quantity * price), sort: i };
    }).filter((it) => it.title);
    if (!items.length) throw Object.assign(new Error('At least one line item with a title is required'), { status: 400 });
    const subtotal = money(items.reduce((n, it) => n + it.total, 0));
    const taxRate = Number(b.taxRate ?? 0) || 0;
    const taxes = b.taxes != null ? money(b.taxes) : money(subtotal * taxRate / 100);
    const discount = money(b.discount ?? 0);
    const total = money(subtotal + taxes - discount);
    // UI uses Minimal's 'pending' for issued-but-unpaid; stored as 'sent'.
    const status = b.status === 'pending' ? 'sent' : STATUSES.includes(b.status) ? b.status : 'draft';
    return { items, subtotal, taxRate, taxes, discount, total, status, createDate: toDate(b.createDate) || toDate(new Date()), dueDate: toDate(b.dueDate), notes: b.notes ?? null, paymentTerms: b.paymentTerms ?? null, internalNotes: b.internalNotes ?? null, invoiceNumber: b.invoiceNumber ? String(b.invoiceNumber).trim() : null, amountPaid: b.amountPaid != null ? money(b.amountPaid) : null };
}

async function writeItems(invoiceId, items) {
    await promisePool.query('DELETE FROM orthodoxmetrics_db.invoice_items WHERE invoice_id = ?', [invoiceId]);
    if (!items.length) return;
    await promisePool.query(
        'INSERT INTO orthodoxmetrics_db.invoice_items (invoice_id, item_code, name_multilang, description_multilang, category, quantity, unit_type, unit_price, line_total, sort_order) VALUES ?',
        [items.map((it) => [invoiceId, it.service, JSON.stringify({ en: it.title }), JSON.stringify({ en: it.description }), 'service', it.quantity, 'each', it.price, it.total, it.sort])]);
}

// ---------------------------------------------------------------------------
// tenant mirror + notifications
// ---------------------------------------------------------------------------
async function mirrorToTenant(row) {
    try {
        const pool = getTenantPool(row.church_id);
        await pool.query(
            `INSERT INTO invoices_received (invoice_id, invoice_number, church_id, status, currency, total_amount, amount_paid, issue_date, due_date, paid_at, pdf_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE invoice_number = VALUES(invoice_number), status = VALUES(status), total_amount = VALUES(total_amount), amount_paid = VALUES(amount_paid),
                                     issue_date = VALUES(issue_date), due_date = VALUES(due_date), paid_at = VALUES(paid_at), pdf_path = VALUES(pdf_path)`,
            [row.id, row.invoice_number, row.church_id, row.status, row.currency || 'USD', row.total_amount, row.amount_paid || 0, toDate(row.issue_date), toDate(row.due_date), row.paid_at, row.pdf_path]);
    } catch (e) { console.warn('[om/invoices] tenant mirror failed:', e.message); }
}
async function churchRecipients(churchId) {
    const [rows] = await promisePool.query(
        "SELECT id FROM orthodoxmetrics_db.users WHERE church_id = ? AND is_active = 1 AND account_status = 'active' AND role IN ('church_admin','manager','priest','deacon')", [churchId]);
    return rows.map((r) => r.id);
}
async function notifyUsers(userIds, type, title, message, options = {}) {
    try {
        const { notificationService } = require('../../api/notifications');
        for (const uid of new Set(userIds.filter(Boolean))) notificationService.createNotification(uid, type, title, message, options).catch(() => {});
    } catch { /* best effort */ }
}
async function syncChurchBilling(churchId) {
    // Drive churches.billing_status (read by the Command Center) from real invoices.
    const [[agg]] = await promisePool.query(
        `SELECT SUM(status = 'sent' AND due_date < CURDATE()) AS overdue, SUM(status IN ('sent','pending')) AS open_cnt, SUM(status = 'paid') AS paid_cnt
           FROM orthodoxmetrics_db.invoices WHERE church_id = ? AND status <> 'cancelled'`, [churchId]);
    const next = Number(agg.overdue) > 0 ? 'past_due' : Number(agg.open_cnt) > 0 ? 'invoice_sent' : Number(agg.paid_cnt) > 0 ? 'paid' : null;
    if (next) await promisePool.query("UPDATE orthodoxmetrics_db.churches SET billing_status = ?, paid_at = IF(? = 'paid', COALESCE(paid_at, NOW()), paid_at) WHERE id = ?", [next, next, churchId]);
}

/** Called by the Stripe webhook (checkout.session.completed with metadata.om_invoice_id). */
async function markInvoicePaidFromStripe(invoiceId, { sessionId, paymentIntentId, amountTotal }) {
    const [[row]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.invoices WHERE id = ?', [invoiceId]);
    if (!row || row.status === 'paid') return row;
    const paid = amountTotal != null ? money(amountTotal / 100) : Number(row.total_amount);
    await promisePool.query(
        "UPDATE orthodoxmetrics_db.invoices SET status = 'paid', amount_paid = ?, paid_at = NOW(), paid_method = 'stripe', stripe_checkout_session_id = COALESCE(?, stripe_checkout_session_id), stripe_payment_intent_id = ? WHERE id = ?",
        [paid, sessionId || null, paymentIntentId || null, invoiceId]);
    const [[next]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.invoices WHERE id = ?', [invoiceId]);
    await mirrorToTenant(next);
    await syncChurchBilling(next.church_id);
    const admins = (await promisePool.query("SELECT id FROM orthodoxmetrics_db.users WHERE role = 'super_admin' AND is_active = 1"))[0].map((r) => r.id);
    const to = parseJson(next.bill_to_json);
    notifyUsers(admins, 'invoice_paid', `Invoice ${next.invoice_number} paid`, `${to?.name || `Church #${next.church_id}`} paid $${paid.toFixed(2)} via Stripe.`, { actionUrl: `/dashboard/invoice/${next.id}`, actionText: 'View invoice', data: { invoiceId: next.id } });
    notifyUsers(await churchRecipients(next.church_id), 'invoice_paid', `Payment received — ${next.invoice_number}`, `Thank you. $${paid.toFixed(2)} was received for invoice ${next.invoice_number}.`, { actionUrl: `/dashboard/invoice/${next.id}`, actionText: 'View receipt', data: { invoiceId: next.id } });
    return next;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        console.error('[om/invoices]', err);
        res.status(500).json({ success: false, message: 'Invoice error' });
    }
};

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
router.get('/address-book', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req);
    requirePlatform(actor);
    const [rows] = await promisePool.query("SELECT id FROM orthodoxmetrics_db.churches WHERE is_active = 1 OR database_name IS NOT NULL ORDER BY COALESCE(name, church_name)");
    const to = (await Promise.all(rows.map((r) => churchAddress(r.id)))).filter(Boolean).filter((a) => a.fullAddress);
    res.json({ success: true, from: [ISSUER], to });
}));

router.get('/services', requireAuth, handle(async (req, res) => {
    await actorOf(req);
    const [rows] = await promisePool.query('SELECT item_code AS service, COUNT(*) AS c, ROUND(AVG(unit_price), 2) AS price FROM orthodoxmetrics_db.invoice_items GROUP BY item_code ORDER BY c DESC');
    const defaults = [{ service: 'Records Entry', price: 35 }, { service: 'Records Scanning', price: 35 }, { service: 'Software', price: 0 }, { service: 'Hosting', price: 0 }, { service: 'Setup', price: 0 }, { service: 'Cemetery Map', price: 0 }, { service: 'Consulting', price: 0 }, { service: 'Support', price: 0 }];
    const seen = new Set(); const out = [];
    [...rows.map((r) => ({ service: r.service, price: Number(r.price) })), ...defaults].forEach((s) => { if (s.service && !seen.has(s.service)) { seen.add(s.service); out.push(s); } });
    res.json({ success: true, services: out });
}));

// GET /  — platform: all (filters church_id,status,q); church roles: own parish
router.get('/', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req);
    const where = ['1=1']; const params = [];
    if (actor.isPlatform) { if (req.query.church_id) { where.push('i.church_id = ?'); params.push(Number(req.query.church_id)); } }
    else if (actor.isChurch && actor.church_id) { where.push("i.church_id = ? AND i.status <> 'draft'"); params.push(actor.church_id); }
    else throw Object.assign(new Error('Not permitted'), { status: 403 });
    if (req.query.status && STATUSES.includes(req.query.status)) {
        if (req.query.status === 'overdue') where.push("i.status = 'sent' AND i.due_date < CURDATE()");
        else if (req.query.status === 'sent') where.push("i.status = 'sent' AND (i.due_date IS NULL OR i.due_date >= CURDATE())");
        else { where.push('i.status = ?'); params.push(req.query.status); }
    }
    if (req.query.q) { where.push('(i.invoice_number LIKE ? OR i.bill_to_json LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const [rows] = await promisePool.query(`SELECT i.* FROM orthodoxmetrics_db.invoices i WHERE ${where.join(' AND ')} ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`, params);
    const ids = rows.map((r) => r.id);
    const [items] = ids.length ? await promisePool.query('SELECT * FROM orthodoxmetrics_db.invoice_items WHERE invoice_id IN (?) ORDER BY sort_order, id', [ids]) : [[]];
    const byInv = new Map(); items.forEach((it) => { if (!byInv.has(it.invoice_id)) byInv.set(it.invoice_id, []); byInv.get(it.invoice_id).push(it); });
    const invoices = await Promise.all(rows.map((r) => shapeInvoice(r, byInv.get(r.id) || [])));
    // analytics (same scope)
    const scopeWhere = actor.isPlatform ? (req.query.church_id ? 'church_id = ?' : '1=1') : 'church_id = ? AND status <> \'draft\'';
    const scopeParams = actor.isPlatform ? (req.query.church_id ? [Number(req.query.church_id)] : []) : [actor.church_id];
    const [[a]] = await promisePool.query(
        `SELECT COUNT(*) total_cnt, COALESCE(SUM(total_amount),0) total_amt,
                SUM(status='paid') paid_cnt, COALESCE(SUM(IF(status='paid', total_amount, 0)),0) paid_amt,
                SUM(status='sent' AND (due_date IS NULL OR due_date >= CURDATE())) pending_cnt, COALESCE(SUM(IF(status='sent' AND (due_date IS NULL OR due_date >= CURDATE()), total_amount - amount_paid, 0)),0) pending_amt,
                SUM(status='sent' AND due_date < CURDATE()) overdue_cnt, COALESCE(SUM(IF(status='sent' AND due_date < CURDATE(), total_amount - amount_paid, 0)),0) overdue_amt,
                SUM(status='draft') draft_cnt, COALESCE(SUM(IF(status='draft', total_amount, 0)),0) draft_amt
           FROM orthodoxmetrics_db.invoices WHERE ${scopeWhere} AND status <> 'cancelled'`, scopeParams);
    res.json({ success: true, role: actor.role, canManage: actor.isPlatform, churchId: actor.isPlatform ? null : actor.church_id, invoices, analytics: a });
}));

router.get('/:id', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req);
    const { row, invoice } = await loadInvoice(Number(req.params.id));
    if (!actor.isPlatform) {
        if (!(actor.isChurch && actor.church_id === row.church_id) || row.status === 'draft') throw Object.assign(new Error('Invoice not found'), { status: 404 });
        if (!row.viewed_at) {
            await promisePool.query('UPDATE orthodoxmetrics_db.invoices SET viewed_at = NOW() WHERE id = ?', [row.id]);
            try { await getTenantPool(row.church_id).query('UPDATE invoices_received SET viewed_at = NOW() WHERE invoice_id = ? AND viewed_at IS NULL', [row.id]); } catch { /* ignore */ }
        }
    }
    res.json({ success: true, canManage: actor.isPlatform, canPay: actor.isChurch && actor.church_id === row.church_id && ['sent', 'overdue'].includes(invoice.status) && invoice.balanceDue > 0, stripeEnabled: !!process.env.STRIPE_SECRET_KEY, invoice });
}));

router.post('/', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req); requirePlatform(actor);
    const b = req.body || {};
    const churchId = Number(b.churchId || b.invoiceTo?.churchId || b.invoiceTo?.id);
    const to = churchId ? await churchAddress(churchId) : null;
    if (!to) throw Object.assign(new Error('Select the church this invoice is for'), { status: 400 });
    const v = normalizePayload(b);
    const number = v.invoiceNumber || await nextInvoiceNumber();
    const [r] = await promisePool.query(
        `INSERT INTO orthodoxmetrics_db.invoices (invoice_number, church_id, bill_from_json, bill_to_json, issue_date, due_date, language, currency, subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, status, payment_terms_multilang, notes_multilang, internal_notes, created_by, sent_at, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, 'en', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [number, churchId, JSON.stringify(ISSUER), JSON.stringify({ ...to, ...(b.invoiceTo?.fullAddress ? { fullAddress: b.invoiceTo.fullAddress } : {}) }), v.createDate, v.dueDate, v.subtotal, v.taxRate, v.taxes, v.discount, v.total, v.amountPaid ?? (v.status === 'paid' ? v.total : 0), v.status,
         v.paymentTerms ? JSON.stringify({ en: v.paymentTerms }) : null, v.notes ? JSON.stringify({ en: v.notes }) : null, v.internalNotes, actor.id,
         ['sent', 'paid'].includes(v.status) ? new Date() : null, v.status === 'paid' ? (toDate(b.paidAt) ? new Date(b.paidAt) : new Date()) : null]);
    await writeItems(r.insertId, v.items);
    const { row, invoice } = await loadInvoice(r.insertId);
    if (row.status !== 'draft') { await afterSend(row, actor, v.status === 'sent'); }
    res.json({ success: true, invoice });
}));

async function afterSend(row, actor, notifyChurch) {
    await mirrorToTenant(row);
    await syncChurchBilling(row.church_id);
    if (notifyChurch) {
        notifyUsers(await churchRecipients(row.church_id), 'invoice_received', `New invoice ${row.invoice_number} from Orthodox Metrics`, `$${Number(row.total_amount).toFixed(2)} due ${toDate(row.due_date) || 'on receipt'}. Open Invoices to review and pay.`, { actionUrl: `/dashboard/invoice/${row.id}`, actionText: 'View invoice', priority: 'high', senderId: actor?.id ?? null, data: { invoiceId: row.id } });
    }
}

router.put('/:id', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req); requirePlatform(actor);
    const { row } = await loadInvoice(Number(req.params.id));
    if (row.status === 'paid' && req.body?.status !== 'paid') throw Object.assign(new Error('Paid invoices cannot be edited; cancel and re-issue instead'), { status: 400 });
    const b = req.body || {};
    const v = normalizePayload(b);
    const churchId = Number(b.churchId || b.invoiceTo?.churchId || b.invoiceTo?.id) || row.church_id;
    const to = await churchAddress(churchId);
    const becomingSent = row.status === 'draft' && ['sent', 'paid'].includes(v.status);
    await promisePool.query(
        `UPDATE orthodoxmetrics_db.invoices SET invoice_number = ?, church_id = ?, bill_to_json = ?, issue_date = ?, due_date = ?, subtotal = ?, tax_rate = ?, tax_amount = ?, discount_amount = ?, total_amount = ?, amount_paid = ?, status = ?,
                payment_terms_multilang = ?, notes_multilang = ?, internal_notes = ?, sent_at = COALESCE(sent_at, ?), paid_at = ? WHERE id = ?`,
        [v.invoiceNumber || row.invoice_number, churchId, JSON.stringify({ ...to, ...(b.invoiceTo?.fullAddress ? { fullAddress: b.invoiceTo.fullAddress } : {}) }), v.createDate, v.dueDate, v.subtotal, v.taxRate, v.taxes, v.discount, v.total,
         v.amountPaid ?? (v.status === 'paid' ? v.total : Number(row.amount_paid || 0)), v.status,
         v.paymentTerms ? JSON.stringify({ en: v.paymentTerms }) : null, v.notes ? JSON.stringify({ en: v.notes }) : null, v.internalNotes,
         ['sent', 'paid'].includes(v.status) ? new Date() : null, v.status === 'paid' ? (row.paid_at || (b.paidAt ? new Date(b.paidAt) : new Date())) : null, row.id]);
    await writeItems(row.id, v.items);
    const next = await loadInvoice(row.id);
    if (next.row.status !== 'draft') await afterSend(next.row, actor, becomingSent && v.status === 'sent');
    res.json({ success: true, invoice: next.invoice });
}));

/** Transition helpers: send (draft→sent), mark-paid (manual: check/cash/waived), cancel. */
router.post('/:id/send', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req); requirePlatform(actor);
    const { row } = await loadInvoice(Number(req.params.id));
    if (!['draft', 'pending', 'sent'].includes(row.status)) throw Object.assign(new Error(`Cannot send a ${row.status} invoice`), { status: 400 });
    await promisePool.query("UPDATE orthodoxmetrics_db.invoices SET status = 'sent', sent_at = NOW() WHERE id = ?", [row.id]);
    const next = await loadInvoice(row.id);
    await afterSend(next.row, actor, true);
    res.json({ success: true, invoice: next.invoice });
}));

router.post('/:id/mark-paid', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req); requirePlatform(actor);
    const { row } = await loadInvoice(Number(req.params.id));
    const method = String(req.body?.method || 'check').slice(0, 40);
    const amount = req.body?.amount != null ? money(req.body.amount) : Number(row.total_amount);
    const paidAt = req.body?.paidAt ? new Date(req.body.paidAt) : new Date();
    await promisePool.query("UPDATE orthodoxmetrics_db.invoices SET status = 'paid', amount_paid = ?, paid_at = ?, paid_method = ?, sent_at = COALESCE(sent_at, ?) WHERE id = ?", [amount, paidAt, method, paidAt, row.id]);
    const next = await loadInvoice(row.id);
    await mirrorToTenant(next.row); await syncChurchBilling(next.row.church_id);
    notifyUsers(await churchRecipients(next.row.church_id), 'invoice_paid', `Payment recorded — ${next.row.invoice_number}`, `$${amount.toFixed(2)} received by ${method}. Thank you.`, { actionUrl: `/dashboard/invoice/${next.row.id}`, actionText: 'View receipt', senderId: actor.id, data: { invoiceId: next.row.id } });
    res.json({ success: true, invoice: next.invoice });
}));

router.post('/:id/cancel', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req); requirePlatform(actor);
    const { row } = await loadInvoice(Number(req.params.id));
    if (row.status === 'paid') throw Object.assign(new Error('Paid invoices cannot be cancelled'), { status: 400 });
    await promisePool.query("UPDATE orthodoxmetrics_db.invoices SET status = 'cancelled' WHERE id = ?", [row.id]);
    const next = await loadInvoice(row.id);
    await mirrorToTenant(next.row); await syncChurchBilling(next.row.church_id);
    res.json({ success: true, invoice: next.invoice });
}));

router.delete('/:id', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req); requirePlatform(actor);
    const { row } = await loadInvoice(Number(req.params.id));
    if (!['draft', 'cancelled'].includes(row.status)) throw Object.assign(new Error('Only draft or cancelled invoices can be deleted'), { status: 400 });
    await promisePool.query('DELETE FROM orthodoxmetrics_db.invoice_items WHERE invoice_id = ?', [row.id]);
    await promisePool.query('DELETE FROM orthodoxmetrics_db.invoices WHERE id = ?', [row.id]);
    try { await getTenantPool(row.church_id).query('DELETE FROM invoices_received WHERE invoice_id = ?', [row.id]); } catch { /* ignore */ }
    await syncChurchBilling(row.church_id);
    res.json({ success: true });
}));

/** Church pays with Stripe Checkout (card). Returns the hosted checkout URL. */
router.post('/:id/pay/stripe', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req);
    const { row, invoice } = await loadInvoice(Number(req.params.id));
    const allowed = actor.isPlatform || (actor.isChurch && actor.church_id === row.church_id);
    if (!allowed) throw Object.assign(new Error('Not permitted'), { status: 403 });
    if (!['sent', 'overdue'].includes(invoice.status) || invoice.balanceDue <= 0) throw Object.assign(new Error('This invoice is not payable'), { status: 400 });
    if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Card payments are not configured yet'), { status: 503 });
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const base = omBaseUrl();
    const lineItems = invoice.items.map((it) => ({ quantity: Math.max(1, Math.round(it.quantity)), price_data: { currency: 'usd', unit_amount: Math.round(it.price * 100), product_data: { name: it.title, ...(it.description ? { description: it.description.slice(0, 500) } : {}) } } })).filter((li) => li.price_data.unit_amount > 0);
    // Keep Stripe total identical to the invoice balance (taxes/discounts/partial payments) with a single balancing line.
    const lineTotal = lineItems.reduce((n, li) => n + li.price_data.unit_amount * li.quantity, 0);
    const balanceCents = Math.round(invoice.balanceDue * 100);
    const items = lineTotal === balanceCents ? lineItems : [{ quantity: 1, price_data: { currency: 'usd', unit_amount: balanceCents, product_data: { name: `Invoice ${invoice.invoiceNumber} — Orthodox Metrics LLC`, description: invoice.items.map((it) => it.title).join(', ').slice(0, 500) } } }];
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: items,
        customer_email: actor.email || undefined,
        client_reference_id: `om-invoice-${row.id}`,
        success_url: `${base}/dashboard/invoice/${row.id}?payment=success`,
        cancel_url: `${base}/dashboard/invoice/${row.id}?payment=cancelled`,
        metadata: { om_invoice_id: String(row.id), invoice_number: row.invoice_number, church_id: String(row.church_id), payer_user_id: String(actor.id) },
        payment_intent_data: { metadata: { om_invoice_id: String(row.id), invoice_number: row.invoice_number, church_id: String(row.church_id) }, description: `Orthodox Metrics invoice ${row.invoice_number}` },
    });
    await promisePool.query('UPDATE orthodoxmetrics_db.invoices SET stripe_checkout_session_id = ? WHERE id = ?', [session.id, row.id]);
    res.json({ success: true, url: session.url, sessionId: session.id });
}));

/** After returning from Checkout, confirm the session server-side (covers webhook delay). */
router.post('/:id/pay/stripe/confirm', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req);
    const { row } = await loadInvoice(Number(req.params.id));
    if (!(actor.isPlatform || (actor.isChurch && actor.church_id === row.church_id))) throw Object.assign(new Error('Not permitted'), { status: 403 });
    if (row.status === 'paid') return res.json({ success: true, invoice: (await loadInvoice(row.id)).invoice });
    if (!row.stripe_checkout_session_id || !process.env.STRIPE_SECRET_KEY) return res.json({ success: true, invoice: (await loadInvoice(row.id)).invoice });
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
    if (session.payment_status === 'paid') await markInvoicePaidFromStripe(row.id, { sessionId: session.id, paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id, amountTotal: session.amount_total });
    res.json({ success: true, invoice: (await loadInvoice(row.id)).invoice });
}));

// ---------------------------------------------------------------------------
// Enrollment pipeline tie-in
// ---------------------------------------------------------------------------
/**
 * Mirror an onboarding request's enrollment fee as an OM invoice once the church exists, so the
 * parish sees its receipt (or open invoice) under Invoices. Idempotent (internal_notes = onb:<id>).
 * Amount: Stripe Checkout session / Stripe invoice total when available, else the catalog price.
 */
async function ensureEnrollmentInvoice(onboardingRequestId, opts = {}) {
    const [[req]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.onboarding_requests WHERE onboarding_request_id = ? AND deleted_at IS NULL', [onboardingRequestId]);
    if (!req || !req.church_id) return null;
    if (['not_required', 'waived'].includes(req.payment_status)) return null;
    const tag = `onb:${onboardingRequestId}`;
    const [[existing]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.invoices WHERE internal_notes = ? LIMIT 1', [tag]);
    const paid = req.payment_status === 'paid';
    // amount
    let amountCents = null; let stripeSessionId = req.stripe_checkout_session_id || null; let paymentIntentId = null; let label = 'Parish enrollment — Orthodox Metrics platform';
    if (process.env.STRIPE_SECRET_KEY) {
        try {
            const Stripe = require('stripe'); const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            if (stripeSessionId) {
                const sess = await stripe.checkout.sessions.retrieve(stripeSessionId, { expand: ['line_items'] });
                amountCents = sess.amount_total ?? null; paymentIntentId = typeof sess.payment_intent === 'string' ? sess.payment_intent : sess.payment_intent?.id || null;
                const li = sess.line_items?.data?.[0]; if (li?.description) label = li.description;
            } else if (opts.stripeInvoiceId) {
                const inv = await stripe.invoices.retrieve(opts.stripeInvoiceId);
                amountCents = inv.amount_due ?? inv.total ?? null; label = inv.lines?.data?.[0]?.description || label;
            } else if (process.env.STRIPE_DEFAULT_PRICE_ID) {
                const price = await stripe.prices.retrieve(process.env.STRIPE_DEFAULT_PRICE_ID, { expand: ['product'] });
                amountCents = price.unit_amount ?? null; label = price.product?.name ? `${price.product.name} — enrollment` : label;
            }
        } catch (e) { console.warn('[om/invoices] enrollment amount lookup failed:', e.message); }
    }
    if (amountCents == null && opts.amountCents != null) amountCents = opts.amountCents;
    if (amountCents == null && !existing) return null; // nothing reliable to invoice yet
    const total = money((amountCents ?? 0) / 100);
    const to = await churchAddress(req.church_id);
    const status = paid ? 'paid' : ['invoice_sent', 'pending', 'failed'].includes(req.payment_status) ? 'sent' : 'draft';
    if (existing) {
        if (existing.status !== 'paid' && (status !== existing.status || (amountCents != null && Number(existing.total_amount) !== total))) {
            await promisePool.query("UPDATE orthodoxmetrics_db.invoices SET status = ?, total_amount = IF(? IS NULL, total_amount, ?), subtotal = IF(? IS NULL, subtotal, ?), amount_paid = IF(? = 'paid', total_amount, amount_paid), paid_at = IF(? = 'paid', COALESCE(paid_at, NOW()), paid_at), paid_method = IF(? = 'paid', COALESCE(paid_method, 'stripe'), paid_method), stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?), stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?), sent_at = COALESCE(sent_at, NOW()) WHERE id = ?",
                [status, amountCents, total, amountCents, total, status, status, status, stripeSessionId, paymentIntentId, existing.id]);
            await promisePool.query('UPDATE orthodoxmetrics_db.invoice_items SET unit_price = ?, line_total = ? WHERE invoice_id = ? AND ? IS NOT NULL', [total, total, existing.id, amountCents]);
        }
        const next = await loadInvoice(existing.id); await mirrorToTenant(next.row); await syncChurchBilling(req.church_id);
        return next.invoice;
    }
    const number = await nextInvoiceNumber();
    const [r] = await promisePool.query(
        `INSERT INTO orthodoxmetrics_db.invoices (invoice_number, church_id, bill_from_json, bill_to_json, issue_date, due_date, language, currency, subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, status, notes_multilang, internal_notes, created_by, sent_at, paid_at, paid_method, stripe_checkout_session_id, stripe_payment_intent_id)
         VALUES (?, ?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'en', 'USD', ?, 0, 0, 0, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [number, req.church_id, JSON.stringify(ISSUER), JSON.stringify(to || {}), total, total, paid ? total : 0, status, JSON.stringify({ en: `Enrollment request ${onboardingRequestId} · ${req.parish_name}` }), tag, status === 'draft' ? null : new Date(), paid ? new Date() : null, paid ? 'stripe' : null, stripeSessionId, paymentIntentId]);
    await writeItems(r.insertId, [{ title: label, description: `Enrollment of ${req.parish_name}${req.jurisdiction ? ` (${req.jurisdiction})` : ''} on the Orthodox Metrics platform.`, service: 'Setup', quantity: 1, price: total, total, sort: 0 }]);
    const created = await loadInvoice(r.insertId);
    await mirrorToTenant(created.row); await syncChurchBilling(req.church_id);
    if (status === 'sent') notifyUsers(await churchRecipients(req.church_id), 'invoice_received', `Enrollment invoice ${number} from Orthodox Metrics`, `$${total.toFixed(2)} for your parish enrollment. Open Invoices to review and pay by card.`, { actionUrl: `/dashboard/invoice/${r.insertId}`, actionText: 'View invoice', priority: 'high', data: { invoiceId: r.insertId } });
    return created.invoice;
}

module.exports = router;
module.exports.markInvoicePaidFromStripe = markInvoicePaidFromStripe;
module.exports.ISSUER = ISSUER;
module.exports.ensureEnrollmentInvoice = ensureEnrollmentInvoice;
