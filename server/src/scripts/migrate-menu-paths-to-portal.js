#!/usr/bin/env node
/**
 * One-time data fix: om_menu_templates.nav_json and om_menu_items.path/children
 * were seeded with Records/OCR/File manager pointing at /dashboard/*, before
 * those routes moved to the church-scoped /portal/* tree in om-platform.
 * `seedIfEmpty()` in routes/om/menus.js only seeds empty tables, so already-
 * seeded rows need a one-time rewrite. Safe to re-run (no-op once migrated).
 *
 * Usage: node server/src/scripts/migrate-menu-paths-to-portal.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { promisePool } = require('../config/db');

const REPLACEMENTS = [
  ['/dashboard/ocr', '/portal/ocr'],
  ['/dashboard/records', '/portal/records'],
  ['/dashboard/file-manager', '/portal/file-manager'],
];

function rewrite(text) {
  let out = text;
  for (const [from, to] of REPLACEMENTS) {
    out = out.split(`"${from}`).join(`"${to}`);
  }
  return out;
}

async function main() {
  let changed = 0;

  const [templates] = await promisePool.query('SELECT id, nav_json FROM om_menu_templates');
  for (const row of templates) {
    const before = typeof row.nav_json === 'string' ? row.nav_json : JSON.stringify(row.nav_json);
    const after = rewrite(before);
    if (after !== before) {
      await promisePool.query('UPDATE om_menu_templates SET nav_json=? WHERE id=?', [after, row.id]);
      changed++;
      console.log(`Updated om_menu_templates.id=${row.id}`);
    }
  }

  const [items] = await promisePool.query('SELECT id, path, children FROM om_menu_items');
  for (const row of items) {
    const newPath = rewrite(JSON.stringify(row.path)).slice(1, -1);
    const childrenBefore = row.children == null ? null : (typeof row.children === 'string' ? row.children : JSON.stringify(row.children));
    const childrenAfter = childrenBefore == null ? null : rewrite(childrenBefore);
    if (newPath !== row.path || childrenAfter !== childrenBefore) {
      await promisePool.query('UPDATE om_menu_items SET path=?, children=? WHERE id=?', [newPath, childrenAfter, row.id]);
      changed++;
      console.log(`Updated om_menu_items.id=${row.id} (${row.path} -> ${newPath})`);
    }
  }

  console.log(`Done. ${changed} row(s) updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
