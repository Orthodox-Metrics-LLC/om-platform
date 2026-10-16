#!/usr/bin/env node
/**
 * G3 — scheduled OCR setup runtime cache refresh (cron / post-deploy).
 * Usage: node scripts/workflow-runtime-cache-refresh.js [--json]
 */
'use strict';

const path = require('path');
const SERVER_ROOT = require('path').resolve(__dirname, '../../../server');

const fs = require('fs');

process.chdir(SERVER_ROOT);

const envPath = path.join(SERVER_ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

async function main() {
  const { getAppPool } = require(SERVER_ROOT + '/src/config/db');
  const runtimeCache = require(SERVER_ROOT + '/src/services/workflowRuntimeCacheService');
  const pool = getAppPool();
  const payload = await runtimeCache.refreshOcrSetupCache(pool);
  const out = { success: true, cache_key: runtimeCache.CACHE_KEY_OCR_SETUP, payload };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`OCR runtime cache refreshed: ${payload.churches_total} churches`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[workflow-runtime-cache-refresh]', err.message);
  process.exit(1);
});
