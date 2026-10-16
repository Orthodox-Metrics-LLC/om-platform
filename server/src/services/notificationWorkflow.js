'use strict';

const channels = require('./notificationChannels');

const TYPE_NAME = 'service_request_action';

const LIFECYCLE = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  NOTIFIED: 'NOTIFIED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  CLOSED: 'CLOSED',
});

const INITIAL_NOTIFICATION_POLICY = Object.freeze({
  reminder_interval_minutes: 240,
  max_reminders: 3,
  retry_interval_minutes: 15,
  max_attempts: 5,
  escalate_once: 1,
});

const INITIAL_ASSIGNMENTS = Object.freeze([
  ['brain_approval', 'role', 'super_admin'],
  ['incident', 'role', 'super_admin'],
  ['operational_work', 'role', 'super_admin'],
  ['deployment_failure', 'role', 'super_admin'],
  ['backup_failure', 'role', 'super_admin'],
  ['ocr_exception', 'role', 'super_admin'],
]);

function selectChannels(pref) {
  const row = pref || {};
  const selected = [];
  if (row.in_app_enabled !== 0 && row.in_app_enabled !== false) selected.push('in_app');
  if (row.email_enabled !== 0 && row.email_enabled !== false) selected.push('email');
  if (row.sms_enabled === 1 || row.sms_enabled === true) selected.push('sms');
  if (row.push_enabled === 1 || row.push_enabled === true) selected.push('push');
  return selected;
}

function reminderPlan(notice, nowMs, policy) {
  const rules = policy || INITIAL_NOTIFICATION_POLICY;
  if (!notice || notice.status !== LIFECYCLE.NOTIFIED) return { kind: 'wait' };
  const due = notice.next_action_at ? new Date(notice.next_action_at).getTime() : 0;
  if (due > nowMs) return { kind: 'wait' };
  const maxReminders = Number(rules.max_reminders);
  if (notice.reminder_count >= maxReminders) {
    if (!rules.escalate_once || notice.escalated_at) return { kind: 'wait' };
    return { kind: 'escalate' };
  }
  return { kind: 'remind' };
}

function stableEventId(eventType, workItemType, workItemRef) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256')
    .update([eventType, workItemType, workItemRef].join('\0'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function matchPolicies(policies, event) {
  const active = (policies || []).filter((row) => row.active === 1 || row.active === true);
  const typed = active.filter((row) => row.work_item_type === event.work_item_type);
  const responsibility = event.responsibility || '';
  const exact = typed.filter((row) => (row.match_responsibility || '') === responsibility && responsibility !== '');
  const unrestricted = typed.filter((row) => !row.match_responsibility);
  if (exact.length) return exact;
  if (unrestricted.length) return unrestricted;
  return active.filter((row) => row.work_item_type === '*');
}

function recipientsFor(kind, value, directory) {
  switch (kind) {
    case 'role':
      return directory.byRole[value] || [];
    case 'user': {
      const user = directory.byId[String(value)];
      return user ? [user] : [];
    }
    default:
      return [];
  }
}

function resolveAssignees(policies, directory) {
  const seen = new Set();
  const users = [];
  for (const policy of policies) {
    const matched = recipientsFor(policy.assignee_kind, policy.assignee_value, directory);
    for (const user of matched) {
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      users.push(user);
    }
  }
  return users;
}

function stageName(kind, notice) {
  if (kind === 'escalate') return 'escalate';
  if (kind === 'remind') return `remind:${Number(notice.reminder_count) + 1}`;
  return 'initial';
}

function messageFor(notice, user, stage) {
  const prefix = stage === 'escalate' ? 'Escalation: ' : (stage.indexOf('remind') === 0 ? 'Reminder: ' : '');
  const summary = notice.summary || notice.work_item_ref;
  return {
    userId: user.id,
    toEmail: user.email || null,
    toPhone: user.phone || null,
    typeName: TYPE_NAME,
    subject: `${prefix}Service request waiting`,
    body: `${prefix}${summary}`,
    actionUrl: notice.action_path || null,
    priority: stage === 'escalate' ? 'urgent' : 'high',
    data: {
      work_item_type: notice.work_item_type,
      work_item_ref: notice.work_item_ref,
      stage,
    },
  };
}

function addressFor(channel, built) {
  if (channel === 'email') return built.toEmail;
  if (channel === 'sms') return built.toPhone;
  return null;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + (Number(minutes) * 60 * 1000));
}

function validateSubmitted(event) {
  if (!event || event.event_type !== 'service_request.submitted') return 'unsupported_event';
  if (!event.work_item_type || !event.work_item_ref) return 'work_item_required';
  if (!event.responsibility) return 'responsibility_required';
  return null;
}

async function loadDirectory(store, policies) {
  const directory = { byRole: {}, byId: {} };
  for (const policy of policies) {
    if (policy.assignee_kind === 'role' && !directory.byRole[policy.assignee_value]) {
      directory.byRole[policy.assignee_value] = await store.usersForRole(policy.assignee_value);
    }
    if (policy.assignee_kind === 'user' && !directory.byId[String(policy.assignee_value)]) {
      const user = await store.userById(policy.assignee_value);
      if (user) directory.byId[String(policy.assignee_value)] = user;
    }
  }
  return directory;
}

async function resolveRecipients(store, event) {
  const policies = matchPolicies(await store.assignmentPolicies(), event);
  const directory = await loadDirectory(store, policies);
  return resolveAssignees(policies, directory);
}

function createService(deps) {
  const store = deps.store;
  const deliver = deps.deliver;
  const nowFn = deps.now || (() => new Date());

  async function policyFor(workItemType) {
    return (await store.notificationPolicy(workItemType)) || INITIAL_NOTIFICATION_POLICY;
  }

  async function finishDelivery(row, result, policy, now) {
    const attempts = Number(row.attempts || 0) + 1;
    const skipped = !result.ok && result.retryable === false;
    const status = result.ok ? 'sent' : (skipped ? 'skipped' : 'failed');
    const nextAttemptAt = result.ok || skipped ? null : addMinutes(now, policy.retry_interval_minutes);
    const updated = await store.updateDelivery(row.id, {
      status,
      attempts,
      last_error: result.ok ? null : (result.error || 'delivery_failed'),
      next_attempt_at: nextAttemptAt,
      sent_at: result.ok ? now : null,
      provider_message_id: result.providerMessageId || null,
    });
    await store.addAttempt({
      deliveryId: row.id,
      status,
      error: result.ok ? null : (result.error || 'delivery_failed'),
      providerMessageId: result.providerMessageId || null,
    });
    return updated;
  }

  async function sendOne(notice, user, stage, policy, now) {
    const existing = await store.listDeliveries(notice.id);
    const already = existing.find((row) => row.user_id === user.id && row.channel === stage.channel && row.stage === stage.name);
    if (already && already.status !== 'pending') {
      return { user_id: user.id, channel: stage.channel, stage: stage.name, ok: already.status === 'sent', duplicate: true };
    }
    const row = already || (await store.addDelivery({
      noticeId: notice.id,
      userId: user.id,
      channel: stage.channel,
      stage: stage.name,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
    })).row;
    const built = messageFor(notice, user, stage.name);
    let result;
    try {
      result = await deliver(stage.channel, { ...built, to: addressFor(stage.channel, built) });
    } catch (err) {
      result = { ok: false, error: err && err.message ? String(err.message).slice(0, 500) : 'worker_exception' };
    }
    await finishDelivery(row, result, policy, now);
    return {
      user_id: user.id,
      channel: stage.channel,
      stage: stage.name,
      ok: !!result.ok,
      error: result.ok ? null : (result.error || 'delivery_failed'),
    };
  }

  async function dispatchStage(notice, users, kind, policy, now) {
    const name = stageName(kind, notice);
    const results = [];
    for (const user of users) {
      const pref = await store.preference(user.id);
      for (const channel of selectChannels(pref)) {
        results.push(await sendOne(notice, user, { channel, name }, policy, now));
      }
    }
    return results;
  }

  async function acceptSubmitted(event) {
    const problem = validateSubmitted(event);
    if (problem) return { ok: false, error: problem };
    const now = nowFn();
    const policy = await policyFor(event.work_item_type);
    const eventId = event.event_id || stableEventId(event.event_type, event.work_item_type, event.work_item_ref);
    const inserted = await store.insertSubmitted({
      event_id: eventId,
      event_type: event.event_type,
      work_item_type: String(event.work_item_type).slice(0, 64),
      work_item_ref: String(event.work_item_ref).slice(0, 191),
      responsibility: String(event.responsibility).slice(0, 64),
      summary: String(event.summary || event.work_item_ref).slice(0, 500),
      action_path: event.action_path ? String(event.action_path).slice(0, 500) : null,
      status: LIFECYCLE.SUBMITTED,
      next_action_at: addMinutes(now, policy.retry_interval_minutes),
    });
    const notice = inserted.row;
    if (!notice) return { ok: false, error: 'notice_not_stored' };
    if (notice.status === LIFECYCLE.CLOSED || notice.status === LIFECYCLE.ACKNOWLEDGED || notice.status === LIFECYCLE.NOTIFIED) {
      return {
        ok: true,
        idempotent: true,
        event_id: notice.event_id,
        notice_id: notice.id,
        status: notice.status,
        users: 0,
        deliveries: [],
      };
    }
    const prior = await store.listDeliveries(notice.id);
    if (prior.some((row) => row.stage === 'initial' && row.status !== 'pending')) {
      if (notice.status === LIFECYCLE.SUBMITTED) {
        await store.markNotified(notice.id, addMinutes(now, policy.reminder_interval_minutes));
      }
      return {
        ok: true,
        idempotent: true,
        event_id: notice.event_id,
        notice_id: notice.id,
        status: LIFECYCLE.NOTIFIED,
        users: 0,
        deliveries: [],
      };
    }
    const users = await resolveRecipients(store, notice);
    if (!users.length) {
      return {
        ok: true,
        event_id: notice.event_id,
        notice_id: notice.id,
        status: LIFECYCLE.SUBMITTED,
        users: 0,
        deliveries: [],
        idempotent: !inserted.created,
      };
    }
    const deliveries = await dispatchStage(notice, users, 'initial', policy, now);
    await store.markNotified(notice.id, addMinutes(now, policy.reminder_interval_minutes));
    return {
      ok: true,
      event_id: notice.event_id,
      notice_id: notice.id,
      status: LIFECYCLE.NOTIFIED,
      users: users.length,
      deliveries,
      idempotent: false,
    };
  }

  async function acceptClosed(event) {
    if (!event.work_item_ref) return { ok: false, error: 'work_item_required' };
    const workItemType = event.work_item_type || 'brain_approval';
    const result = await store.closeWorkItem(workItemType, event.work_item_ref);
    return { ok: true, closed: result.changed ? 1 : 0, status: LIFECYCLE.CLOSED, idempotent: !result.changed };
  }

  async function acceptAcknowledged(event, options) {
    if (!event.work_item_ref) return { ok: false, error: 'work_item_required' };
    const workItemType = event.work_item_type || 'brain_approval';
    const notice = await store.findByWorkItem(workItemType, event.work_item_ref);
    if (!notice) return { ok: false, error: 'not_found' };
    if (notice.status === LIFECYCLE.ACKNOWLEDGED) {
      return { ok: true, status: LIFECYCLE.ACKNOWLEDGED, idempotent: true, notice_id: notice.id };
    }
    if (notice.status === LIFECYCLE.CLOSED) return { ok: false, error: 'closed' };
    if (options && options.requireAssignee) {
      if (!event.user_id) return { ok: false, error: 'not_assignee' };
      const users = await resolveRecipients(store, notice);
      const allowed = users.some((user) => Number(user.id) === Number(event.user_id));
      if (!allowed) return { ok: false, error: 'not_assignee' };
    }
    const at = nowFn();
    await store.acknowledge(notice.id, {
      userId: event.user_id || null,
      actor: event.actor || null,
      at,
    });
    return { ok: true, status: LIFECYCLE.ACKNOWLEDGED, idempotent: false, notice_id: notice.id };
  }

  async function acceptDomainEvent(event, options) {
    await store.ensure();
    if (event && event.event_type === 'service_request.closed') return acceptClosed(event);
    if (event && event.event_type === 'service_request.acknowledged') return acceptAcknowledged(event, options);
    return acceptSubmitted(event);
  }

  async function processDue() {
    await store.ensure();
    const now = nowFn();
    const retryable = await store.listRetryable(now);
    let retried = 0;
    for (const row of retryable) {
      if (row.notice_status === LIFECYCLE.CLOSED) continue;
      const policy = await policyFor(row.work_item_type);
      if (Number(row.attempts) >= Number(policy.max_attempts)) continue;
      const built = messageFor(row, { id: row.user_id, email: row.email, phone: row.phone }, row.stage || 'initial');
      let result;
      try {
        result = await deliver(row.channel, { ...built, to: addressFor(row.channel, built) });
      } catch (err) {
        result = { ok: false, error: err && err.message ? String(err.message).slice(0, 500) : 'worker_exception' };
      }
      await finishDelivery(row, result, policy, now);
      if (row.notice_status === LIFECYCLE.SUBMITTED) {
        await store.markNotified(row.notice_id, addMinutes(now, policy.reminder_interval_minutes));
      }
      retried += 1;
    }

    const waiting = await store.listUnassignedDue(now);
    for (const notice of waiting) {
      const policy = await policyFor(notice.work_item_type);
      const users = await resolveRecipients(store, notice);
      if (!users.length) {
        await store.schedule(notice.id, addMinutes(now, policy.retry_interval_minutes));
        continue;
      }
      await dispatchStage(notice, users, 'initial', policy, now);
      await store.markNotified(notice.id, addMinutes(now, policy.reminder_interval_minutes));
    }

    const due = await store.listReminderDue(now);
    let reminded = 0;
    let escalated = 0;
    for (const notice of due) {
      const policy = await policyFor(notice.work_item_type);
      const plan = reminderPlan(notice, now.getTime(), policy);
      if (plan.kind === 'wait') continue;
      const users = await resolveRecipients(store, notice);
      await dispatchStage(notice, users, plan.kind, policy, now);
      if (plan.kind === 'escalate') {
        await store.bumpReminder(notice.id, {
          reminderCount: notice.reminder_count,
          escalatedAt: now,
          nextActionAt: addMinutes(now, policy.reminder_interval_minutes),
        });
        escalated += 1;
      } else {
        await store.bumpReminder(notice.id, {
          reminderCount: Number(notice.reminder_count) + 1,
          escalatedAt: notice.escalated_at,
          nextActionAt: addMinutes(now, policy.reminder_interval_minutes),
        });
        reminded += 1;
      }
    }
    return { retried, reminded, escalated };
  }

  return {
    acceptDomainEvent,
    processDue,
    acknowledge: (event) => acceptDomainEvent(
      { ...event, event_type: 'service_request.acknowledged' },
      { requireAssignee: true },
    ),
  };
}

function createMemoryStore(seed) {
  const source = seed || {};
  const state = {
    notices: [],
    deliveries: [],
    attempts: [],
    assignmentPolicies: (source.assignmentPolicies || []).map((row) => ({ ...row })),
    notificationPolicies: (source.notificationPolicies || []).map((row) => ({ ...row })),
    users: (source.users || []).map((row) => ({ ...row })),
    preferences: { ...(source.preferences || {}) },
    seq: { notice: 1, delivery: 1, attempt: 1 },
  };

  function noticeById(id) {
    return state.notices.find((row) => row.id === id) || null;
  }

  return {
    state,
    async ensure() {},
    async insertSubmitted(row) {
      const existing = state.notices.find((notice) => (
        notice.work_item_type === row.work_item_type && notice.work_item_ref === row.work_item_ref
      )) || state.notices.find((notice) => notice.event_id === row.event_id);
      if (existing) return { row: existing, created: false };
      const notice = {
        id: state.seq.notice,
        reminder_count: 0,
        escalated_at: null,
        notified_at: null,
        acknowledged_at: null,
        acknowledged_by: null,
        acknowledged_actor: null,
        ...row,
      };
      state.seq.notice += 1;
      state.notices.push(notice);
      return { row: notice, created: true };
    },
    async findByWorkItem(workItemType, workItemRef) {
      return state.notices.find((notice) => notice.work_item_type === workItemType && notice.work_item_ref === workItemRef) || null;
    },
    async closeWorkItem(workItemType, workItemRef) {
      const notice = state.notices.find((row) => row.work_item_type === workItemType && row.work_item_ref === workItemRef);
      if (!notice) return { changed: false, status: null };
      if (notice.status === LIFECYCLE.CLOSED) return { changed: false, status: notice.status };
      notice.status = LIFECYCLE.CLOSED;
      return { changed: true, status: notice.status };
    },
    async acknowledge(id, patch) {
      const notice = noticeById(id);
      notice.status = LIFECYCLE.ACKNOWLEDGED;
      notice.acknowledged_at = patch.at;
      notice.acknowledged_by = patch.userId;
      notice.acknowledged_actor = patch.actor;
      return notice;
    },
    async listDeliveries(noticeId) {
      return state.deliveries.filter((row) => row.notice_id === noticeId);
    },
    async addDelivery(input) {
      const existing = state.deliveries.find((row) => (
        row.notice_id === input.noticeId
        && row.user_id === input.userId
        && row.channel === input.channel
        && row.stage === input.stage
      ));
      if (existing) return { row: existing, created: false };
      const row = {
        id: state.seq.delivery,
        notice_id: input.noticeId,
        user_id: input.userId,
        channel: input.channel,
        stage: input.stage,
        status: input.status,
        attempts: input.attempts || 0,
        last_error: null,
        next_attempt_at: input.nextAttemptAt || null,
        sent_at: null,
      };
      state.seq.delivery += 1;
      state.deliveries.push(row);
      return { row, created: true };
    },
    async updateDelivery(id, patch) {
      const row = state.deliveries.find((item) => item.id === id);
      Object.assign(row, patch);
      return row;
    },
    async addAttempt(input) {
      state.attempts.push({
        id: state.seq.attempt,
        delivery_id: input.deliveryId,
        status: input.status,
        error: input.error,
        provider_message_id: input.providerMessageId || null,
      });
      state.seq.attempt += 1;
    },
    async listRetryable(now) {
      return state.deliveries.filter((row) => {
        const notice = noticeById(row.notice_id);
        if (!notice || notice.status === LIFECYCLE.CLOSED) return false;
        if (row.status !== 'pending' && row.status !== 'failed') return false;
        if (row.next_attempt_at && new Date(row.next_attempt_at).getTime() > now.getTime()) return false;
        return true;
      }).map((row) => {
        const notice = noticeById(row.notice_id);
        const user = state.users.find((item) => item.id === row.user_id) || {};
        return {
          ...row,
          summary: notice.summary,
          action_path: notice.action_path,
          work_item_type: notice.work_item_type,
          work_item_ref: notice.work_item_ref,
          notice_status: notice.status,
          email: user.email || null,
          phone: user.phone || null,
        };
      });
    },
    async listUnassignedDue(now) {
      return state.notices.filter((notice) => (
        notice.status === LIFECYCLE.SUBMITTED
        && new Date(notice.next_action_at).getTime() <= now.getTime()
        && !state.deliveries.some((row) => row.notice_id === notice.id)
      ));
    },
    async listReminderDue(now) {
      return state.notices.filter((notice) => (
        notice.status === LIFECYCLE.NOTIFIED
        && new Date(notice.next_action_at).getTime() <= now.getTime()
      ));
    },
    async markNotified(id, nextActionAt) {
      const notice = noticeById(id);
      notice.status = LIFECYCLE.NOTIFIED;
      notice.notified_at = nextActionAt;
      notice.next_action_at = nextActionAt;
      return notice;
    },
    async schedule(id, nextActionAt) {
      const notice = noticeById(id);
      notice.next_action_at = nextActionAt;
      return notice;
    },
    async bumpReminder(id, patch) {
      const notice = noticeById(id);
      notice.reminder_count = patch.reminderCount;
      notice.escalated_at = patch.escalatedAt;
      notice.next_action_at = patch.nextActionAt;
      return notice;
    },
    async assignmentPolicies() {
      return state.assignmentPolicies;
    },
    async notificationPolicy(workItemType) {
      return state.notificationPolicies.find((row) => row.work_item_type === workItemType)
        || state.notificationPolicies.find((row) => row.work_item_type === '*')
        || null;
    },
    async usersForRole(role) {
      return state.users.filter((user) => user.role === role && user.is_active !== 0);
    },
    async userById(id) {
      return state.users.find((user) => Number(user.id) === Number(id)) || null;
    },
    async preference(userId) {
      return state.preferences[userId] || state.preferences[String(userId)] || {
        in_app_enabled: 1,
        email_enabled: 1,
        sms_enabled: 0,
        push_enabled: 0,
      };
    },
  };
}

let schemaReady = false;

async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_request_notices (
      id BIGINT NOT NULL AUTO_INCREMENT,
      event_id CHAR(36) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      work_item_type VARCHAR(64) NOT NULL,
      work_item_ref VARCHAR(191) NOT NULL,
      responsibility VARCHAR(64) NOT NULL,
      summary VARCHAR(500) NOT NULL,
      action_path VARCHAR(500) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED',
      reminder_count INT NOT NULL DEFAULT 0,
      escalated_at DATETIME NULL,
      next_action_at DATETIME NOT NULL,
      notified_at DATETIME NULL,
      acknowledged_at DATETIME NULL,
      acknowledged_by INT NULL,
      acknowledged_actor VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_service_request_event (event_id),
      UNIQUE KEY uq_service_request_item (work_item_type, work_item_ref),
      KEY idx_service_request_open_due (status, next_action_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id BIGINT NOT NULL AUTO_INCREMENT,
      notice_id BIGINT NOT NULL,
      user_id INT NOT NULL,
      channel VARCHAR(16) NOT NULL,
      stage VARCHAR(32) NOT NULL DEFAULT 'initial',
      status VARCHAR(32) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      last_error VARCHAR(500) NULL,
      next_attempt_at DATETIME NULL,
      sent_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_delivery_notice_user_channel_stage (notice_id, user_id, channel, stage),
      KEY idx_delivery_due (status, next_attempt_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
      id BIGINT NOT NULL AUTO_INCREMENT,
      delivery_id BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL,
      error VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_delivery_attempt (delivery_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_request_assignment_policies (
      id BIGINT NOT NULL AUTO_INCREMENT,
      work_item_type VARCHAR(64) NOT NULL,
      match_responsibility VARCHAR(64) NOT NULL DEFAULT '',
      assignee_kind VARCHAR(16) NOT NULL,
      assignee_value VARCHAR(191) NOT NULL,
      active TINYINT NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_assignment_policy (work_item_type, match_responsibility, assignee_kind, assignee_value)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_request_notification_policies (
      work_item_type VARCHAR(64) NOT NULL,
      reminder_interval_minutes INT NOT NULL,
      max_reminders INT NOT NULL,
      retry_interval_minutes INT NOT NULL,
      max_attempts INT NOT NULL,
      escalate_once TINYINT NOT NULL DEFAULT 1,
      PRIMARY KEY (work_item_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await addColumn(pool, 'service_request_notices', 'notified_at', 'notified_at DATETIME NULL');
  await addColumn(pool, 'service_request_notices', 'acknowledged_at', 'acknowledged_at DATETIME NULL');
  await addColumn(pool, 'service_request_notices', 'acknowledged_by', 'acknowledged_by INT NULL');
  await addColumn(pool, 'service_request_notices', 'acknowledged_actor', 'acknowledged_actor VARCHAR(191) NULL');
  await addColumn(pool, 'notification_deliveries', 'stage', "stage VARCHAR(32) NOT NULL DEFAULT 'initial'");
  await addColumn(pool, 'notification_deliveries', 'provider_message_id', 'provider_message_id VARCHAR(64) NULL');
  await addColumn(pool, 'notification_delivery_attempts', 'provider_message_id', 'provider_message_id VARCHAR(64) NULL');
  await ensureIndex(pool, 'service_request_notices', 'uq_service_request_item', 'ADD UNIQUE KEY uq_service_request_item (work_item_type, work_item_ref)');
  await replaceDeliveryUnique(pool);
  await pool.query("UPDATE service_request_notices SET status = 'CLOSED' WHERE status = 'closed'");
  await pool.query("UPDATE service_request_notices SET status = 'NOTIFIED' WHERE status = 'open'");
  for (const [workItemType, kind, value] of INITIAL_ASSIGNMENTS) {
    await pool.query(
      `INSERT INTO service_request_assignment_policies
         (work_item_type, match_responsibility, assignee_kind, assignee_value, active)
       VALUES (?, '', ?, ?, 1)
       ON DUPLICATE KEY UPDATE active = active`,
      [workItemType, kind, value],
    );
  }
  const policyRows = ['*', ...INITIAL_ASSIGNMENTS.map((row) => row[0])];
  for (const workItemType of policyRows) {
    await pool.query(
      `INSERT INTO service_request_notification_policies
         (work_item_type, reminder_interval_minutes, max_reminders, retry_interval_minutes, max_attempts, escalate_once)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE work_item_type = work_item_type`,
      [
        workItemType,
        INITIAL_NOTIFICATION_POLICY.reminder_interval_minutes,
        INITIAL_NOTIFICATION_POLICY.max_reminders,
        INITIAL_NOTIFICATION_POLICY.retry_interval_minutes,
        INITIAL_NOTIFICATION_POLICY.max_attempts,
        INITIAL_NOTIFICATION_POLICY.escalate_once,
      ],
    );
  }
  await pool.query(
    `INSERT INTO notification_types (name, description, category, is_active, default_enabled)
     VALUES (?, ?, 'admin', 1, 1)
     ON DUPLICATE KEY UPDATE is_active = 1`,
    [TYPE_NAME, 'Service-request work item needs a responsible user'],
  );
  schemaReady = true;
}

async function addColumn(pool, table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (Number(rows[0].c) === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function ensureIndex(pool, table, name, clause) {
  const [rows] = await pool.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [name]);
  if (!rows.length) await pool.query(`ALTER TABLE ${table} ${clause}`);
}

async function replaceDeliveryUnique(pool) {
  const [oldKey] = await pool.query(
    "SHOW INDEX FROM notification_deliveries WHERE Key_name = 'uq_delivery_notice_user_channel'",
  );
  if (oldKey.length) {
    await pool.query('ALTER TABLE notification_deliveries DROP INDEX uq_delivery_notice_user_channel');
  }
  await ensureIndex(
    pool,
    'notification_deliveries',
    'uq_delivery_notice_user_channel_stage',
    'ADD UNIQUE KEY uq_delivery_notice_user_channel_stage (notice_id, user_id, channel, stage)',
  );
}

function createSqlStore(pool) {
  return {
    async ensure() {
      await ensureSchema(pool);
    },
    async insertSubmitted(row) {
      const [existing] = await pool.query(
        'SELECT * FROM service_request_notices WHERE work_item_type = ? AND work_item_ref = ? LIMIT 1',
        [row.work_item_type, row.work_item_ref],
      );
      if (existing[0]) return { row: existing[0], created: false };
      try {
        await pool.query(
          `INSERT INTO service_request_notices
             (event_id, event_type, work_item_type, work_item_ref, responsibility, summary, action_path, status, next_action_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.event_id,
            row.event_type,
            row.work_item_type,
            row.work_item_ref,
            row.responsibility,
            row.summary,
            row.action_path,
            row.status,
            row.next_action_at,
          ],
        );
      } catch (err) {
        if (err && err.code !== 'ER_DUP_ENTRY') throw err;
      }
      const [rows] = await pool.query(
        'SELECT * FROM service_request_notices WHERE work_item_type = ? AND work_item_ref = ? LIMIT 1',
        [row.work_item_type, row.work_item_ref],
      );
      const stored = rows[0] || null;
      return { row: stored, created: !!(stored && stored.event_id === row.event_id && !existing[0]) };
    },
    async findByWorkItem(workItemType, workItemRef) {
      const [rows] = await pool.query(
        'SELECT * FROM service_request_notices WHERE work_item_type = ? AND work_item_ref = ? LIMIT 1',
        [workItemType, workItemRef],
      );
      return rows[0] || null;
    },
    async closeWorkItem(workItemType, workItemRef) {
      const [result] = await pool.query(
        `UPDATE service_request_notices SET status = 'CLOSED'
         WHERE work_item_type = ? AND work_item_ref = ? AND status <> 'CLOSED'`,
        [workItemType, workItemRef],
      );
      return { changed: (result.affectedRows || 0) > 0, status: LIFECYCLE.CLOSED };
    },
    async acknowledge(id, patch) {
      await pool.query(
        `UPDATE service_request_notices
         SET status = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ?, acknowledged_actor = ?
         WHERE id = ? AND status IN ('SUBMITTED', 'NOTIFIED')`,
        [patch.at, patch.userId, patch.actor, id],
      );
    },
    async listDeliveries(noticeId) {
      const [rows] = await pool.query(
        'SELECT * FROM notification_deliveries WHERE notice_id = ?',
        [noticeId],
      );
      return rows;
    },
    async addDelivery(input) {
      await pool.query(
        `INSERT INTO notification_deliveries
           (notice_id, user_id, channel, stage, status, attempts, next_attempt_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [
          input.noticeId,
          input.userId,
          input.channel,
          input.stage,
          input.status,
          input.attempts || 0,
          input.nextAttemptAt,
        ],
      );
      const [rows] = await pool.query(
        `SELECT * FROM notification_deliveries
         WHERE notice_id = ? AND user_id = ? AND channel = ? AND stage = ? LIMIT 1`,
        [input.noticeId, input.userId, input.channel, input.stage],
      );
      return { row: rows[0], created: true };
    },
    async updateDelivery(id, patch) {
      await pool.query(
        `UPDATE notification_deliveries
         SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, sent_at = ?, provider_message_id = ?
         WHERE id = ?`,
        [
          patch.status,
          patch.attempts,
          patch.last_error,
          patch.next_attempt_at,
          patch.sent_at,
          patch.provider_message_id || null,
          id,
        ],
      );
      return { id, ...patch };
    },
    async addAttempt(input) {
      await pool.query(
        `INSERT INTO notification_delivery_attempts (delivery_id, status, error, provider_message_id)
         VALUES (?, ?, ?, ?)`,
        [input.deliveryId, input.status, input.error, input.providerMessageId || null],
      );
    },
    async listRetryable(now) {
      const [rows] = await pool.query(
        `SELECT d.*, n.summary, n.action_path, n.work_item_type, n.work_item_ref, n.status AS notice_status,
                u.email, u.phone
         FROM notification_deliveries d
         JOIN service_request_notices n ON n.id = d.notice_id
         JOIN orthodoxmetrics_db.users u ON u.id = d.user_id
         WHERE d.status IN ('pending', 'failed')
           AND n.status <> 'CLOSED'
           AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?)`,
        [now],
      );
      return rows;
    },
    async listUnassignedDue(now) {
      const [rows] = await pool.query(
        `SELECT n.* FROM service_request_notices n
         LEFT JOIN notification_deliveries d ON d.notice_id = n.id
         WHERE n.status = 'SUBMITTED' AND n.next_action_at <= ? AND d.id IS NULL`,
        [now],
      );
      return rows;
    },
    async listReminderDue(now) {
      const [rows] = await pool.query(
        "SELECT * FROM service_request_notices WHERE status = 'NOTIFIED' AND next_action_at <= ?",
        [now],
      );
      return rows;
    },
    async markNotified(id, nextActionAt) {
      await pool.query(
        `UPDATE service_request_notices
         SET status = 'NOTIFIED', notified_at = ?, next_action_at = ?
         WHERE id = ? AND status = 'SUBMITTED'`,
        [nextActionAt, nextActionAt, id],
      );
    },
    async schedule(id, nextActionAt) {
      await pool.query('UPDATE service_request_notices SET next_action_at = ? WHERE id = ?', [nextActionAt, id]);
    },
    async bumpReminder(id, patch) {
      await pool.query(
        `UPDATE service_request_notices
         SET reminder_count = ?, escalated_at = ?, next_action_at = ?
         WHERE id = ?`,
        [patch.reminderCount, patch.escalatedAt, patch.nextActionAt, id],
      );
    },
    async assignmentPolicies() {
      const [rows] = await pool.query(
        'SELECT * FROM service_request_assignment_policies WHERE active = 1',
      );
      return rows;
    },
    async notificationPolicy(workItemType) {
      const [rows] = await pool.query(
        `SELECT * FROM service_request_notification_policies WHERE work_item_type IN (?, '*')`,
        [workItemType],
      );
      return rows.find((row) => row.work_item_type === workItemType)
        || rows.find((row) => row.work_item_type === '*')
        || null;
    },
    async usersForRole(role) {
      const [rows] = await pool.query(
        `SELECT id, email, phone, role, is_active
         FROM orthodoxmetrics_db.users
         WHERE role = ? AND is_active = 1`,
        [role],
      );
      return rows;
    },
    async userById(id) {
      const [rows] = await pool.query(
        `SELECT id, email, phone, role, is_active
         FROM orthodoxmetrics_db.users
         WHERE id = ? AND is_active = 1
         LIMIT 1`,
        [id],
      );
      return rows[0] || null;
    },
    async preference(userId) {
      const [rows] = await pool.query(
        `SELECT
           COALESCE(unp.email_enabled, nt.default_enabled) AS email_enabled,
           COALESCE(unp.push_enabled, 0) AS push_enabled,
           COALESCE(unp.in_app_enabled, nt.default_enabled) AS in_app_enabled,
           COALESCE(unp.sms_enabled, 0) AS sms_enabled
         FROM notification_types nt
         LEFT JOIN user_notification_preferences unp
           ON unp.notification_type_id = nt.id AND unp.user_id = ?
         WHERE nt.name = ?
         LIMIT 1`,
        [userId, TYPE_NAME],
      );
      return rows[0] || { in_app_enabled: 1, email_enabled: 1, sms_enabled: 0, push_enabled: 0 };
    },
  };
}

let defaultService = null;

function service() {
  if (!defaultService) {
    const { getAppPool } = require('../config/db');
    defaultService = createService({
      store: createSqlStore(getAppPool()),
      deliver: (channel, message) => channels.deliver(channel, message),
    });
  }
  return defaultService;
}

function acceptDomainEvent(event) {
  return service().acceptDomainEvent(event);
}

function processDue() {
  return service().processDue();
}

function acknowledgeServiceRequest(event) {
  return service().acknowledge(event);
}

module.exports = {
  TYPE_NAME,
  LIFECYCLE,
  INITIAL_NOTIFICATION_POLICY,
  selectChannels,
  reminderPlan,
  stableEventId,
  matchPolicies,
  resolveAssignees,
  createService,
  createMemoryStore,
  createSqlStore,
  acceptDomainEvent,
  processDue,
  acknowledgeServiceRequest,
};
