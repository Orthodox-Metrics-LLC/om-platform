#!/usr/bin/env node
/** Compatibility shim — canonical: scripts/server/cemetery/cemetery-operator-overrides.mjs */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '../../scripts/server/cemetery/cemetery-operator-overrides.mjs');
const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
