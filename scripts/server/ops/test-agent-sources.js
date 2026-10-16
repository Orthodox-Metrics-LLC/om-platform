const path = require('path');
const SERVER_ROOT = path.resolve(__dirname, '../../../server');
#!/usr/bin/env node
/**
 * Smoke test for workAccountabilityAgentSourcesService against real /home/next dirs.
 * Usage: node scripts/test-agent-sources.js [hours]
 */
const { scanAgentActivity, PLATFORM_SOURCES } = require(SERVER_ROOT + '/src/services/workAccountabilityAgentSourcesService');

const hours = Number(process.argv[2]) || 168;

console.log('=== Agent source paths (configured) ===');
for (const [platform, cfg] of Object.entries(PLATFORM_SOURCES)) {
  console.log(`\n${cfg.label} (${platform}):`);
  for (const s of cfg.sources) {
    console.log(`  [${s.type}] ${s.path}`);
  }
}

console.log(`\n=== Scanning last ${hours} hours ===`);
const result = scanAgentActivity({ hours });

console.log('\nSource status:');
for (const st of result.source_status) {
  const flag = st.available ? 'OK' : (st.reason || 'missing');
  console.log(`  ${st.platform.padEnd(16)} ${st.type.padEnd(20)} ${flag.padEnd(14)} sessions=${st.sessions_found}`);
}

console.log('\nTotals:', result.totals);
console.log(`\nRecent sessions (up to 10 of ${result.sessions.length}):`);
for (const s of result.sessions.slice(0, 10)) {
  console.log(
    `  [${s.platform_label}] ${s.title.slice(0, 72)}`
    + ` | tools=${s.tool_call_count ?? 'n/a'} | ${s.ended_at.slice(0, 19)}`,
  );
}

process.exit(result.sessions.length >= 0 ? 0 : 1);
