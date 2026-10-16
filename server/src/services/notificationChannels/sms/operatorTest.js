'use strict';

const crypto = require('crypto');
const { getAppPool } = require('../../../config/db');
const { createSqlStore } = require('../../notificationWorkflow');
const smsChannel = require('../smsChannel');

async function enableSmsForUser(pool, userId) {
  await pool.query(
    `INSERT INTO user_notification_preferences
       (user_id, notification_type_id, email_enabled, push_enabled, in_app_enabled, sms_enabled, frequency)
     SELECT ?, nt.id, COALESCE(unp.email_enabled, nt.default_enabled), COALESCE(unp.push_enabled, 0),
            COALESCE(unp.in_app_enabled, nt.default_enabled), 1, 'immediate'
     FROM notification_types nt
     LEFT JOIN user_notification_preferences unp
       ON unp.notification_type_id = nt.id AND unp.user_id = ?
     WHERE nt.name = 'service_request_action'
     ON DUPLICATE KEY UPDATE sms_enabled = 1`,
    [userId, userId],
  );
}

async function sendOperatorSmsTest(deps) {
  const channel = (deps && deps.channel) || smsChannel;
  const status = channel.health();
  if (!status.operational) {
    return { ok: false, error: 'sms_transport_unconfigured', missing: status.missing, provider: status.provider };
  }
  const pool = (deps && deps.pool) || getAppPool();
  const store = createSqlStore(pool);
  await store.ensure();
  const [users] = await pool.query(
    `SELECT id, phone
     FROM orthodoxmetrics_db.users
     WHERE role = 'super_admin' AND is_active = 1 AND phone IS NOT NULL AND phone <> ''
     ORDER BY id`,
  );
  if (users.length !== 1) {
    return { ok: false, error: 'operator_phone_not_unique', count: users.length };
  }
  const operator = users[0];
  const ref = `sms-test-${crypto.randomUUID()}`;
  const inserted = await store.insertSubmitted({
    event_id: crypto.randomUUID(),
    event_type: 'sms_transport.test',
    work_item_type: 'sms_transport_test',
    work_item_ref: ref,
    responsibility: 'operator',
    summary: 'Operator SMS transport test',
    action_path: null,
    status: 'SUBMITTED',
    next_action_at: new Date(),
  });
  const notice = inserted.row;
  const pending = await store.addDelivery({
    noticeId: notice.id,
    userId: operator.id,
    channel: 'sms',
    stage: 'operator_test',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
  });
  const result = await channel.send({
    to: operator.phone,
    body: 'Orthodox Metrics notification transport test. No approval is waiting.',
    userId: operator.id,
  });
  const deliveryStatus = result.ok ? 'sent' : (result.retryable === false ? 'skipped' : 'failed');
  await store.updateDelivery(pending.row.id, {
    status: deliveryStatus,
    attempts: 1,
    last_error: result.ok ? null : (result.error || 'sms_failed'),
    next_attempt_at: result.ok || result.retryable === false ? null : new Date(Date.now() + 15 * 60 * 1000),
    sent_at: result.ok ? new Date() : null,
    provider_message_id: result.providerMessageId || null,
  });
  await store.addAttempt({
    deliveryId: pending.row.id,
    status: deliveryStatus,
    error: result.ok ? null : (result.error || 'sms_failed'),
    providerMessageId: result.providerMessageId || null,
  });
  await store.closeWorkItem('sms_transport_test', ref);
  if (result.ok) await enableSmsForUser(pool, operator.id);
  return {
    ok: !!result.ok,
    provider: 'twilio',
    provider_message_id: result.providerMessageId || null,
    delivery_status: deliveryStatus,
    error: result.ok ? null : (result.error || 'sms_failed'),
    sms_enabled: !!result.ok,
    notice_id: notice.id,
  };
}

module.exports = { sendOperatorSmsTest, enableSmsForUser };
