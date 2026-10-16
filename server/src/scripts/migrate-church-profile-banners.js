#!/usr/bin/env node
/**
 * Create church_profile_banners in record_template1 and every om_church_## database.
 * Idempotent — CREATE TABLE IF NOT EXISTS.
 *
 * Usage: node server/src/scripts/migrate-church-profile-banners.js
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mysql = require('mysql2/promise');

const SQL = fs.readFileSync(
  path.resolve(__dirname, '../../database/migrations/20261004_tenant_church_profile_banners.sql'),
  'utf8'
);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'orthodoxapps',
  password: process.env.DB_PASSWORD || process.env.DB_PASS,
  connectTimeout: 30000,
  waitForConnections: true,
  connectionLimit: 5,
  charset: 'utf8mb4',
  multipleStatements: true,
});

async function migrate() {
  let failed = 0;
  let succeeded = 0;

  try {
    const [databases] = await pool.query("SHOW DATABASES LIKE 'om\\_church\\_%'");
    const dbNames = databases.map((row) => Object.values(row)[0]);
    dbNames.unshift('record_template1');

    console.log(`Applying church_profile_banners to ${dbNames.length} database(s).\n`);

    for (const dbName of dbNames) {
      if (dbName !== 'record_template1' && !/^om_church_\d+$/.test(dbName)) {
        console.warn(`  Skipping unexpected database name: ${dbName}`);
        continue;
      }
      const conn = await pool.getConnection();
      try {
        await conn.query(`USE \`${dbName}\``);
        await conn.query(SQL);
        console.log(`  ${dbName} — church_profile_banners ready`);
        succeeded++;
      } catch (err) {
        console.error(`  ${dbName} — FAILED: ${err.message}`);
        failed++;
      } finally {
        conn.release();
      }
    }

    console.log(`\nMigration complete: ${succeeded} succeeded, ${failed} failed out of ${dbNames.length} databases.`);
  } catch (err) {
    console.error('Fatal error during migration:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }

  if (failed > 0) process.exit(1);
}

migrate();
