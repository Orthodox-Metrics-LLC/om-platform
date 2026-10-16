const {
  buildPlotKey,
  parsePlotLabel,
  normalizeDisplayNumbers,
  isMalformedComposite,
  toCanonicalSection,
  dedupeManifestRows,
} = require('../plotKey');

describe('plotKey', () => {
  test('buildPlotKey composes section|side|row|position', () => {
    expect(buildPlotKey('NS', 'M', 24, 1)).toBe('NS|M|24|1');
    expect(buildPlotKey('1', 'W', '12', '3')).toBe('1|W|12|3');
  });

  test('parsePlotLabel handles side suffix and composites', () => {
    expect(parsePlotLabel('24M')).toEqual({ numbers: ['24'], sideSuffix: 'M' });
    expect(parsePlotLabel('102,101')).toEqual({ numbers: ['102', '101'], sideSuffix: null });
    expect(parsePlotLabel('102101')).toEqual({ numbers: ['102', '101'], sideSuffix: null });
    expect(parsePlotLabel('895,896')).toEqual({ numbers: ['895', '896'], sideSuffix: null });
  });

  test('normalizeDisplayNumbers sorts and dedupes', () => {
    expect(normalizeDisplayNumbers('101,102')).toBe('101,102');
    expect(normalizeDisplayNumbers('102,101')).toBe('101,102');
    expect(normalizeDisplayNumbers('102101')).toBe('101,102');
  });

  test('isMalformedComposite flags concatenated numbers', () => {
    expect(isMalformedComposite('102101')).toBe(true);
    expect(isMalformedComposite('102,101')).toBe(false);
    expect(isMalformedComposite('823')).toBe(false);
  });

  test('toCanonicalSection maps legacy codes', () => {
    expect(toCanonicalSection('W')).toBe('1');
    expect(toCanonicalSection('N')).toBe('NS');
  });

  test('dedupeManifestRows merges same plot_key', () => {
    const rows = dedupeManifestRows([
      {
        section: '1',
        side: 'W',
        row: '10',
        position: '1',
        plot_number: '102101',
        status: 'occupied',
        occupants: ['John'],
      },
      {
        section: '1',
        side: 'W',
        row: '10',
        position: '1',
        plot_number: '102,101',
        status: 'occupied',
        occupants: ['Helen'],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].display_numbers).toBe('101,102');
    expect(rows[0].occupants).toEqual(expect.arrayContaining(['John', 'Helen']));
  });
});
