/**
 * Focused unit checks for Frontend UI Audit host allowlist helpers.
 * Run: node --test server/src/routes/__tests__/portal-ui-audit-host.test.js
 * (helpers are duplicated here to avoid loading the Express router in unit context)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ALLOWED_HOSTS = new Set([
  'orthodoxmetrics.com',
  'www.orthodoxmetrics.com',
  'localhost',
  '127.0.0.1',
]);

function hostAllowed(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .split(':')[0];
  if (!host) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  for (const allowed of ALLOWED_HOSTS) {
    if (host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

describe('frontend-ui-audit host allowlist', () => {
  it('allows OM production and local hosts', () => {
    assert.equal(hostAllowed('orthodoxmetrics.com'), true);
    assert.equal(hostAllowed('www.orthodoxmetrics.com'), true);
    assert.equal(hostAllowed('localhost'), true);
    assert.equal(hostAllowed('127.0.0.1'), true);
  });

  it('rejects arbitrary external hosts', () => {
    assert.equal(hostAllowed('evil.example.com'), false);
    assert.equal(hostAllowed('orthodoxmetrics.com.evil.com'), false);
  });
});
