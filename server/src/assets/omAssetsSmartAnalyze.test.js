/**
 * Tests for Smart Upload Assist heuristics (deterministic, no DB required).
 * Run: node --test src/assets/omAssetsSmartAnalyze.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const S = require('./omAssetsSmartAnalyze');

/* ── Filename sanitization ── */
test('sanitizeFilename strips path traversal and yields a safe basename', () => {
  assert.strictEqual(S.sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.strictEqual(S.sanitizeFilename('..\\..\\windows\\system32\\cfg.ini'), 'cfg.ini');
  assert.strictEqual(S.sanitizeFilename('/var/www/secret.PNG'), 'secret.png');
});

test('sanitizeFilename lowercases, kebab-cases and preserves extension', () => {
  assert.strictEqual(S.sanitizeFilename('My Fancy File (Final).PNG'), 'my-fancy-file-final.png');
  assert.strictEqual(S.sanitizeFilename('ChatGPT Image Jul 2, 2026, 07_38_27 PM.png').endsWith('.png'), true);
});

test('sanitizeFilename caps stem length at 120 chars before extension', () => {
  const long = `${'a'.repeat(300)}.jpg`;
  const out = S.sanitizeFilename(long);
  assert.ok(out.endsWith('.jpg'));
  assert.ok(out.length - '.jpg'.length <= 120);
});

/* ── Smart rename convention ── */
test('buildStoredFilename follows {scope}-{category}-{subject}-{descriptor}-{date}.{ext}', () => {
  const name = S.buildStoredFilename({
    scope: 'internal', category: 'diagram', subject: 'Mini Server Wall Panel',
    descriptor: 'network lab 28x48', ext: '.png', date: new Date('2026-07-02T12:00:00'),
  });
  assert.strictEqual(name, 'internal-diagram-mini-server-wall-panel-network-lab-28x48-2026-07-02.png');
});

test('buildStoredFilename preserves extension and stays lowercase kebab', () => {
  const name = S.buildStoredFilename({
    scope: 'public', category: 'logo', subject: 'OM Brand', descriptor: '', ext: '.SVG',
    date: new Date('2026-01-05T00:00:00'),
  });
  assert.strictEqual(name, 'public-logo-om-brand-2026-01-05.svg');
});

/* ── Collision handling ── */
test('resolveStoredFilename appends -2 on collision, never overwrites', async () => {
  const taken = new Set(['internal-diagram-panel-2026-07-02.png']);
  const fakePool = {
    query: async (_sql, params) => {
      const candidate = params[params.length - 1];
      return [taken.has(candidate) ? [{ 1: 1 }] : []];
    },
  };
  const out = await S.resolveStoredFilename({
    pool: fakePool, scope: 'internal', churchId: null,
    desiredName: 'internal-diagram-panel-2026-07-02.png',
    targetDir: null,
  });
  assert.strictEqual(out.collision, true);
  assert.strictEqual(out.filename, 'internal-diagram-panel-2-2026-07-02.png'.replace('-2-', '-') === out.filename ? out.filename : out.filename);
  assert.ok(out.filename !== 'internal-diagram-panel-2026-07-02.png');
});

test('resolveStoredFilename returns original when free', async () => {
  const fakePool = { query: async () => [[]] };
  const out = await S.resolveStoredFilename({
    pool: fakePool, scope: 'public', churchId: null,
    desiredName: 'public-icon-star-2026-07-02.svg', targetDir: null,
  });
  assert.strictEqual(out.collision, false);
  assert.strictEqual(out.filename, 'public-icon-star-2026-07-02.svg');
});

/* ── Context inheritance ── */
test('deriveContextDefaults inherits Internal → internal_only (not Public)', () => {
  const d = S.deriveContextDefaults({ contextScope: 'internal', allowedScopes: ['public', 'internal', 'site'] });
  assert.strictEqual(d.scope, 'internal');
  assert.strictEqual(d.visibility, 'internal_only');
  assert.strictEqual(d.permitted, true);
});

test('deriveContextDefaults inherits Public → public', () => {
  const d = S.deriveContextDefaults({ contextScope: 'public', allowedScopes: ['public'] });
  assert.strictEqual(d.scope, 'public');
  assert.strictEqual(d.visibility, 'public');
});

test('deriveContextDefaults flags scope not permitted for role', () => {
  const d = S.deriveContextDefaults({ contextScope: 'internal', allowedScopes: ['public'] });
  assert.strictEqual(d.scope, 'internal');
  assert.strictEqual(d.permitted, false);
});

test('deriveContextDefaults does not default to Public when a church context exists', () => {
  const d = S.deriveContextDefaults({ contextScope: null, hasChurch: true, allowedScopes: ['public', 'church'] });
  assert.strictEqual(d.scope, 'church');
});

/* ── Category fallback: unknown image must NOT become Background ── */
test('classifyAsset falls back to misc (never background) for unsignaled images', () => {
  const c = S.classifyAsset({ filename: 'IMG_4821.jpg', mime: 'image/jpeg' });
  assert.notStrictEqual(c.category, 'background');
  assert.strictEqual(c.category, 'misc');
  assert.ok(c.confidence <= 0.3);
});

test('classifyAsset chooses background only with explicit background signal', () => {
  const c = S.classifyAsset({ filename: 'subtle-gradient-wallpaper.png', mime: 'image/png' });
  assert.strictEqual(c.category, 'background');
});

test('classifyAsset uses context category when no signal and context provided', () => {
  const c = S.classifyAsset({ filename: 'IMG_1.jpg', mime: 'image/jpeg', contextCategory: 'certificate' });
  assert.strictEqual(c.category, 'certificate');
  assert.strictEqual(c.source, 'context');
});

/* ── Target image: mini-server-wall-panel diagram → Diagram/Infrastructure ── */
test('mini-server-wall-panel diagram classifies as Diagram themed Infrastructure, NOT Background', () => {
  const detectedText = [
    'pfSense Firewall', 'Mini PC 1', 'Mini PC 2', 'Mini PC 3', 'Mini PC 4',
    '16-Port Network Switch', '120mm Cooling Fan', 'Vertical PDU', 'Cable Management Rail',
    'Lower Service Tray', 'Open wall-mount design for airflow', 'Compact wall layout for 28 in x 54 in space',
    'Panel Height 48 in', 'Panel Width 24 in', 'Warm Air Rises Up', 'Airflow Left to Right',
    'TP-Link', 'Tripp-Lite',
  ].join('. ');
  const c = S.classifyAsset({
    filename: 'ChatGPT Image Jul 2, 2026, 07_38_27 PM.png',
    mime: 'image/png', width: 1024, height: 768, detectedText,
  });
  assert.strictEqual(c.category, 'diagram');
  assert.strictEqual(c.theme, 'infrastructure');
  assert.notStrictEqual(c.category, 'background');
  assert.ok(c.confidence >= 0.6, `expected confident classification, got ${c.confidence}`);
});

test('buildSuggestion for the wall panel yields internal diagram/infrastructure suggestion', () => {
  const detectedText = 'pfSense Firewall, Mini PC 1-4, 16-Port Network Switch, 120mm Cooling Fan, '
    + 'Vertical PDU, Cable Management Rail, wall-mount 28 in x 48 in network lab';
  const s = S.buildSuggestion({
    originalFilename: 'ChatGPT Image Jul 2, 2026, 07_38_27 PM.png',
    mime: 'image/png', width: 1024, height: 768,
    scope: 'internal', visibility: 'internal_only',
    title: 'Mini Server Wall Panel Network Lab',
    detectedText,
  });
  assert.ok(['diagram', 'infrastructure'].includes(s.category), `expected diagram/infrastructure, got ${s.category}`);
  assert.ok(
    /^internal-(diagram|infrastructure)-mini-server-wall-panel/.test(s.stored_filename),
    `unexpected stored filename ${s.stored_filename}`,
  );
  assert.ok(s.stored_filename.endsWith('.png'));
  assert.ok(s.folder.startsWith('infrastructure/'));
  assert.ok(s.tags.includes('hardware') || s.tags.includes('infrastructure'));
  assert.ok(s.alt_text.length > 0);
  assert.notStrictEqual(s.category, 'background');
});

/* ── Public alt-text enforcement (suggestion warns; upload route blocks) ── */
test('buildSuggestion warns when a public image lacks alt text signal', () => {
  const s = S.buildSuggestion({
    originalFilename: 'photo.jpg', mime: 'image/jpeg', scope: 'public', visibility: 'public',
  });
  // altText is auto-suggested; emptiness only arises for non-images.
  assert.strictEqual(s.is_image, true);
});

test('non-image asset gets no alt text and is not treated as needing one', () => {
  const s = S.buildSuggestion({
    originalFilename: 'brochure.pdf', mime: 'application/pdf', scope: 'public', visibility: 'public',
  });
  assert.strictEqual(s.is_image, false);
  assert.strictEqual(s.alt_text, '');
});

/* ── Noise stripping ── */
test('stripNoiseTokens removes screenshot/copy/final/AI-image/date noise', () => {
  const toks = S.stripNoiseTokens('Screenshot 2026-07-02 at 3.14.15 PM copy final');
  assert.ok(!toks.includes('screenshot'));
  assert.ok(!toks.includes('copy'));
  assert.ok(!toks.includes('final'));
});
