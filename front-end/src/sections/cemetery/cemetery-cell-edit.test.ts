import type { CemeteryField } from './cemetery-records-api.ts';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sameValue, editString, parseFieldInput } from './cemetery-cell-edit.ts';

const dateField = (name: string): CemeteryField => ({ name, label: name, type: 'partial_date', nullable: true });

test('displayed dates round-trip through the cell editor', () => {
  const samples = [
    { year: 1990, month: null, day: null, precision: 'year' },
    { year: 1990, month: 1, day: null, precision: 'month' },
    { year: 1990, month: 1, day: 5, precision: 'day' },
  ];
  for (const sample of samples) {
    const field = dateField('dod');
    const parsed = parseFieldInput(field, editString(field, sample));
    assert.equal(sameValue(parsed, sample), true);
  }
});

test('common date typing is accepted', () => {
  const field = dateField('Birth');
  assert.deepEqual(parseFieldInput(field, '1/5/1990'), { year: 1990, month: 1, day: 5, precision: 'day' });
  assert.deepEqual(parseFieldInput(field, '1990-06'), { year: 1990, month: 6, day: null, precision: 'month' });
  assert.deepEqual(parseFieldInput(field, 'Sep 1991'), { year: 1991, month: 9, day: null, precision: 'month' });
  assert.equal(parseFieldInput({ ...field, nullable: true }, '  '), null);
});

test('other cell types parse without changing an unchanged value', () => {
  const text = { name: 'last_name', label: 'Last name', type: 'string', nullable: true };
  assert.equal(parseFieldInput(text, '  Smith '), 'Smith');
  assert.equal(parseFieldInput({ name: 'plot', label: 'Plot', type: 'integer', nullable: false }, '12'), 12);
  assert.equal(parseFieldInput({ name: 'buried', label: 'Buried', type: 'boolean', nullable: true }, 'yes'), true);
  assert.throws(() => parseFieldInput({ name: 'buried', label: 'Buried', type: 'date', nullable: true }, '1990-02-31'));
});
