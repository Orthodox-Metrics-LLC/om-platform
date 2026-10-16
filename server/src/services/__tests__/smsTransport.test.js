'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeE164 } = require('../notificationChannels/sms/phone');
const twilio = require('../notificationChannels/sms/twilioAdapter');
const { createMemoryStore, createService, LIFECYCLE } = require('../notificationWorkflow');

const ENV = {
  TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  TWILIO_AUTH_TOKEN: 'secret-token-value',
  TWILIO_FROM_NUMBER: '+15555550199',
};

test('us numbers normalize to E.164', () => {
  assert.equal(normalizeE164('908-657-8088'), '+19086578088');
  assert.equal(normalizeE164('+1 (908) 657-8088'), '+19086578088');
  assert.equal(normalizeE164(''), null);
});

test('sms stays unconfigured until all three Twilio values are present', () => {
  const missing = twilio.health({});
  assert.equal(missing.operational, false);
  assert.deepEqual(missing.missing, [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
  ]);
  assert.equal(twilio.health(ENV).operational, true);
});

test('an unconfigured transport does not call Twilio', async () => {
  let called = 0;
  const result = await twilio.send({ to: '908-657-8088', body: 'hello' }, {}, async () => {
    called += 1;
    return { statusCode: 201, json: { sid: 'SM123' } };
  });
  assert.equal(called, 0);
  assert.equal(result.retryable, false);
  assert.equal(result.error, 'sms_transport_unconfigured');
});

test('the Twilio adapter posts the message and returns the provider id', async () => {
  let captured = null;
  const result = await twilio.send(
    { to: '908-657-8088', body: 'Operator test' },
    ENV,
    async (request) => {
      captured = request;
      return { statusCode: 201, json: { sid: 'SMabc123' } };
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'SMabc123');
  assert.match(captured.url, /Accounts\/AC.+\/Messages\.json$/);
  assert.match(captured.headers.Authorization, /^Basic /);
  assert.match(captured.body, /To=%2B19086578088/);
  assert.match(captured.body, /From=%2B15555550199/);
});

test('Twilio failures stay retryable and do not include the auth token', async () => {
  const result = await twilio.send(
    { to: '908-657-8088', body: 'nope' },
    ENV,
    async () => ({
      statusCode: 401,
      json: { code: 20003, message: `Authenticate secret-token-value` },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.error.includes('secret-token-value'), false);
  assert.match(result.error, /\[redacted\]/);
});

test('a non-retryable sms failure is stored once and is not retried', async () => {
  const store = createMemoryStore({
    assignmentPolicies: [{
      work_item_type: 'brain_approval',
      match_responsibility: '',
      assignee_kind: 'user',
      assignee_value: '7',
      active: 1,
    }],
    notificationPolicies: [{
      work_item_type: 'brain_approval',
      reminder_interval_minutes: 240,
      max_reminders: 3,
      retry_interval_minutes: 15,
      max_attempts: 5,
      escalate_once: 1,
    }],
    users: [{ id: 7, email: 'noc@example.com', phone: '+19086578088', role: 'operator', is_active: 1 }],
    preferences: { 7: { in_app_enabled: 1, email_enabled: 0, sms_enabled: 1, push_enabled: 0 } },
  });
  let calls = 0;
  const service = createService({
    store,
    now: () => new Date('2026-10-05T12:00:00Z'),
    deliver: async (channel) => {
      calls += 1;
      if (channel === 'sms') return { ok: false, error: 'sms_transport_unconfigured', retryable: false };
      return { ok: true, providerMessageId: 'in-app-1' };
    },
  });
  const accepted = await service.acceptDomainEvent({
    event_type: 'service_request.submitted',
    event_id: '66666666-6666-5666-8666-666666666666',
    work_item_type: 'brain_approval',
    work_item_ref: 'sms-gate',
    responsibility: 'super_admin',
    summary: 'SMS gate',
    action_path: '/governance/brain-approvals',
  });
  assert.equal(accepted.status, LIFECYCLE.NOTIFIED);
  assert.equal(store.state.deliveries.find((row) => row.channel === 'in_app').status, 'sent');
  assert.equal(store.state.deliveries.find((row) => row.channel === 'sms').status, 'skipped');
  await service.processDue();
  assert.equal(calls, 2);
});

test('a retryable sms failure is sent again and keeps the provider id', async () => {
  const store = createMemoryStore({
    assignmentPolicies: [{
      work_item_type: 'brain_approval',
      match_responsibility: '',
      assignee_kind: 'user',
      assignee_value: '7',
      active: 1,
    }],
    notificationPolicies: [{
      work_item_type: 'brain_approval',
      reminder_interval_minutes: 240,
      max_reminders: 3,
      retry_interval_minutes: 15,
      max_attempts: 5,
      escalate_once: 1,
    }],
    users: [{ id: 7, email: 'noc@example.com', phone: '+19086578088', role: 'operator', is_active: 1 }],
    preferences: { 7: { in_app_enabled: 0, email_enabled: 0, sms_enabled: 1, push_enabled: 0 } },
  });
  let calls = 0;
  let clock = Date.parse('2026-10-05T12:00:00Z');
  const service = createService({
    store,
    now: () => new Date(clock),
    deliver: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, error: 'twilio_http_503', retryable: true };
      return { ok: true, providerMessageId: 'SMretried' };
    },
  });
  await service.acceptDomainEvent({
    event_type: 'service_request.submitted',
    event_id: '77777777-7777-5777-8777-777777777777',
    work_item_type: 'brain_approval',
    work_item_ref: 'sms-retry',
    responsibility: 'super_admin',
    summary: 'SMS retry',
  });
  assert.equal(store.state.deliveries[0].status, 'failed');
  clock += 16 * 60 * 1000;
  await service.processDue();
  assert.equal(store.state.deliveries[0].status, 'sent');
  assert.equal(store.state.deliveries[0].provider_message_id, 'SMretried');
  assert.equal(calls, 2);
});
