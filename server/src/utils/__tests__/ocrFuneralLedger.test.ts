#!/usr/bin/env npx tsx
import assert from 'assert';
import {
  extractFuneralLedgerRecords,
  looksLikeTabularDeathRegister,
} from '../ocrFuneralLedger';

const SAMPLE = `
DEATHS
YEAR 2010
NUMBER MALE FEMALE DATE OF DEATH BURIAL FULL NAME OF DECEDENT AGE
1 Paul Lebedz (NP) Jan 1 Jan 7
2 Charles Keches Mar 9 Mar 13
3 Tatiana Onushack July 9 July 12
4 John Chebra Dec 6 Dec 11
CAUSE OF DEATH
SS. Peter + Paul Cemetery Fr. Jan Parella
`;

assert.strictEqual(looksLikeTabularDeathRegister(SAMPLE), true, 'death register detected');

const records = extractFuneralLedgerRecords(SAMPLE);
assert.strictEqual(records.length, 4, `expected 4 records, got ${records.length}`);
assert.strictEqual(records[0].deceased_last_name, 'Lebedz');
assert.strictEqual(records[1].deceased_last_name, 'Keches');
assert.strictEqual(records[2].deceased_last_name, 'Onushack');
assert.strictEqual(records[3].deceased_last_name, 'Chebra');
assert.ok(records[0].date_of_death);
assert.ok(records[0].date_of_burial);

console.log('ocrFuneralLedger tests passed');
