'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectChannels,
  reminderPlan,
  matchPolicies,
  resolveAssignees,
  stableEventId,
  createMemoryStore,
  createService,
  LIFECYCLE,
} = require('../notificationWorkflow');

const POLICY = {
  reminder_interval_minutes: 1,
  max_reminders: 1,
  retry_interval_minutes: 15,
  max_attempts: 5,
  escalate_once: 1,
};

function harness(overrides) {
  const options = overrides || {};
  const sent = [];
  const store = createMemoryStore({
    assignmentPolicies: options.assignmentPolicies || [
      {
        work_item_type: 'brain_approval',
        match_responsibility: '',
        assignee_kind: 'user',
        assignee_value: '7',
        active: 1,
      },
    ],
    notificationPolicies: [Object.assign({ work_item_type: 'brain_approval' }, POLICY)],
    users: options.users || [
      { id: 7, email: 'noc@example.com', phone: '+15555550100', role: 'operator', is_active: 1 },
    ],
    preferences: options.preferences || {
      7: { in_app_enabled: 1, email_enabled: 0, sms_enabled: 1, push_enabled: 0 },
    },
  });
  let clock = Date.parse(options.start || '2026-10-05T12:00:00Z');
  const service = createService({
    store,
    now: () => new Date(clock),
    deliver: options.deliver || (async (channel, message) => {
      sent.push({ channel, to: message.to, userId: message.userId, stage: message.data.stage });
      return { ok: true };
    }),
  });
  return {
    store,
    service,
    sent,
    advance(minutes) { clock += minutes * 60 * 1000; },
  };
}

const submitted = {
  event_type: 'service_request.submitted',
  event_id: '11111111-1111-5111-8111-111111111111',
  work_item_type: 'brain_approval',
  work_item_ref: 'oms-app-probe',
  responsibility: 'super_admin',
  summary: 'Probe approval',
  action_path: '/governance/brain-approvals',
};

test('absent sms preference does not select sms', () => {
  assert.deepEqual(selectChannels({
    in_app_enabled: 1,
    email_enabled: 1,
    sms_enabled: 0,
    push_enabled: 0,
  }), ['in_app', 'email']);
});

test('explicit sms preference selects sms', () => {
  assert.deepEqual(selectChannels({
    in_app_enabled: 1,
    email_enabled: 0,
    sms_enabled: 1,
    push_enabled: 0,
  }), ['in_app', 'sms']);
});

test('reminder timing comes from the supplied policy', () => {
  const now = Date.parse('2026-10-05T16:00:00Z');
  const due = {
    status: 'NOTIFIED',
    reminder_count: 0,
    escalated_at: null,
    next_action_at: '2026-10-05T15:00:00Z',
  };
  assert.equal(reminderPlan(due, now, { max_reminders: 3, escalate_once: 1 }).kind, 'remind');
  assert.equal(reminderPlan({ ...due, reminder_count: 3 }, now, { max_reminders: 3, escalate_once: 1 }).kind, 'escalate');
  assert.equal(reminderPlan({ ...due, reminder_count: 1 }, now, { max_reminders: 1, escalate_once: 0 }).kind, 'wait');
  assert.equal(reminderPlan({ ...due, status: 'ACKNOWLEDGED' }, now, POLICY).kind, 'wait');
  assert.equal(reminderPlan({ ...due, status: 'CLOSED' }, now, POLICY).kind, 'wait');
});

test('assignment follows the policy for the work item type', () => {
  const policies = [
    { work_item_type: 'incident', match_responsibility: '', assignee_kind: 'user', assignee_value: '9', active: 1 },
    { work_item_type: 'brain_approval', match_responsibility: 'super_admin', assignee_kind: 'role', assignee_value: 'super_admin', active: 1 },
  ];
  const directory = {
    byRole: { super_admin: [{ id: 3, email: 'sa@example.com' }] },
    byId: { 9: { id: 9, email: 'noc@example.com' } },
  };
  const incidentPolicies = matchPolicies(policies, { work_item_type: 'incident', responsibility: 'super_admin' });
  assert.deepEqual(resolveAssignees(incidentPolicies, directory).map((user) => user.id), [9]);
  const approvalPolicies = matchPolicies(policies, { work_item_type: 'brain_approval', responsibility: 'super_admin' });
  assert.deepEqual(resolveAssignees(approvalPolicies, directory).map((user) => user.id), [3]);
  assert.deepEqual(matchPolicies(policies, { work_item_type: 'unknown', responsibility: 'super_admin' }), []);
});

test('submitted event resolves the assignee, selects channels, and persists attempts', async () => {
  const h = harness();
  const result = await h.service.acceptDomainEvent(submitted);
  assert.equal(result.status, LIFECYCLE.NOTIFIED);
  assert.equal(result.users, 1);
  assert.deepEqual(h.sent.map((row) => row.channel), ['in_app', 'sms']);
  assert.equal(h.store.state.deliveries.length, 2);
  assert.equal(h.store.state.attempts.length, 2);
  assert.equal(h.store.state.notices[0].status, LIFECYCLE.NOTIFIED);
});

test('the same submitted event does not notify twice', async () => {
  const h = harness();
  await h.service.acceptDomainEvent(submitted);
  const again = await h.service.acceptDomainEvent(submitted);
  assert.equal(again.idempotent, true);
  assert.equal(h.sent.length, 2);
  assert.equal(h.store.state.notices.length, 1);
});

test('a failed delivery is retried and the attempt is kept', async () => {
  let calls = 0;
  const h = harness({
    deliver: async (channel, message) => {
      calls += 1;
      if (calls === 1) return { ok: false, error: 'smtp_down' };
      return { ok: true, channel, to: message.to };
    },
  });
  await h.service.acceptDomainEvent(submitted);
  assert.equal(h.store.state.deliveries[0].status, 'failed');
  h.advance(16);
  const due = await h.service.processDue();
  assert.equal(due.retried >= 1, true);
  assert.equal(h.store.state.deliveries[0].status, 'sent');
  assert.equal(h.store.state.attempts.length >= 3, true);
});

test('reminder and escalation follow policy, acknowledgement stops reminders, closure stops them too', async () => {
  const h = harness({
    preferences: { 7: { in_app_enabled: 1, email_enabled: 0, sms_enabled: 0, push_enabled: 0 } },
  });
  await h.service.acceptDomainEvent(submitted);
  assert.equal(h.sent.length, 1);
  h.advance(2);
  const reminded = await h.service.processDue();
  assert.equal(reminded.reminded, 1);
  assert.equal(h.sent.length, 2);
  const acked = await h.service.acceptDomainEvent({
    event_type: 'service_request.acknowledged',
    work_item_type: 'brain_approval',
    work_item_ref: 'oms-app-probe',
    actor: 'noc@example.com',
  });
  assert.equal(acked.status, LIFECYCLE.ACKNOWLEDGED);
  h.advance(10);
  const afterAck = await h.service.processDue();
  assert.equal(afterAck.reminded, 0);
  assert.equal(afterAck.escalated, 0);
  assert.equal(h.sent.length, 2);

  const other = harness({
    preferences: { 7: { in_app_enabled: 1, email_enabled: 0, sms_enabled: 0, push_enabled: 0 } },
  });
  await other.service.acceptDomainEvent({ ...submitted, work_item_ref: 'oms-app-close', event_id: '22222222-2222-5222-8222-222222222222' });
  await other.service.acceptDomainEvent({
    event_type: 'service_request.closed',
    work_item_type: 'brain_approval',
    work_item_ref: 'oms-app-close',
  });
  other.advance(10);
  const afterClose = await other.service.processDue();
  assert.equal(afterClose.reminded, 0);
  assert.equal(afterClose.escalated, 0);
  assert.equal(other.sent.length, 1);
  assert.equal(other.store.state.notices[0].status, LIFECYCLE.CLOSED);

  const escalated = harness({
    preferences: { 7: { in_app_enabled: 1, email_enabled: 0, sms_enabled: 0, push_enabled: 0 } },
  });
  await escalated.service.acceptDomainEvent({
    ...submitted,
    work_item_ref: 'oms-app-escalate',
    event_id: '33333333-3333-5333-8333-333333333333',
  });
  escalated.advance(2);
  await escalated.service.processDue();
  escalated.advance(2);
  const step = await escalated.service.processDue();
  assert.equal(step.escalated, 1);
  assert.equal(escalated.sent.filter((row) => row.stage === 'escalate').length, 1);
  escalated.advance(2);
  const stopped = await escalated.service.processDue();
  assert.equal(stopped.escalated, 0);
  assert.equal(stopped.reminded, 0);
});

test('a pending delivery survives a worker crash and is sent once by the next worker', async () => {
  const store = createMemoryStore({
    assignmentPolicies: [],
    notificationPolicies: [Object.assign({ work_item_type: 'brain_approval' }, POLICY)],
    users: [{ id: 7, email: 'noc@example.com', phone: null, role: 'operator', is_active: 1 }],
    preferences: { 7: { in_app_enabled: 1, email_enabled: 0, sms_enabled: 0, push_enabled: 0 } },
  });
  const inserted = await store.insertSubmitted({
    event_id: stableEventId('service_request.submitted', 'brain_approval', 'oms-app-crash'),
    event_type: 'service_request.submitted',
    work_item_type: 'brain_approval',
    work_item_ref: 'oms-app-crash',
    responsibility: 'super_admin',
    summary: 'Crash probe',
    action_path: '/governance/brain-approvals',
    status: LIFECYCLE.SUBMITTED,
    next_action_at: new Date('2026-10-05T12:00:00Z'),
  });
  await store.addDelivery({
    noticeId: inserted.row.id,
    userId: 7,
    channel: 'in_app',
    stage: 'initial',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
  });
  let sent = 0;
  const recovered = createService({
    store,
    now: () => new Date('2026-10-05T12:05:00Z'),
    deliver: async () => {
      sent += 1;
      return { ok: true };
    },
  });
  await recovered.processDue();
  await recovered.processDue();
  assert.equal(sent, 1);
  assert.equal(store.state.notices.length, 1);
  assert.equal(store.state.deliveries[0].status, 'sent');
});

test('stable event ids make a replay of the same work item the same event', () => {
  const first = stableEventId('service_request.submitted', 'brain_approval', 'oms-app-2026-09-05');
  const second = stableEventId('service_request.submitted', 'brain_approval', 'oms-app-2026-09-05');
  const closed = stableEventId('service_request.closed', 'brain_approval', 'oms-app-2026-09-05');
  assert.equal(first, second);
  assert.notEqual(first, closed);
});
