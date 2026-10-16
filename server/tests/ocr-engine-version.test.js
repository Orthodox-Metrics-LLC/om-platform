/**
 * OCR engine version routing — legacy vs v2 vs autonomous
 */
const assert = require('assert');

const DEFAULT_OCR_ENGINE_VERSION = 'v2';
const VALID_VERSIONS = new Set(['legacy', 'v2', 'autonomous']);

function normalizeOcrEngineVersion(raw) {
  const v = String(raw || DEFAULT_OCR_ENGINE_VERSION).trim();
  return VALID_VERSIONS.has(v) ? v : DEFAULT_OCR_ENGINE_VERSION;
}

function effectiveRecordLayoutMode(version, configured) {
  if (version !== 'legacy') return configured;
  if (configured === 'auto' || configured === 'multi_record_split' || configured === 'multi_form_page') {
    return 'single';
  }
  return configured;
}

function effectiveExtractionAgentMode(version, configured) {
  if (version === 'legacy') return 'agent1_only';
  return configured;
}

function shouldRunZoneExtraction(version) {
  return version !== 'legacy';
}

function shouldRunLlamaParseShadow(version) {
  return version !== 'legacy';
}

function shouldRunLayoutIdentification(version) {
  return version !== 'legacy';
}

function shouldUseRecordSnippets(version, configured) {
  if (version === 'legacy') return false;
  return configured;
}

function isAutonomousPipelineAvailable(version) {
  return version !== 'legacy';
}

function shouldRunAutoPipeline(version, autoPipelineEnabled) {
  if (version === 'legacy') return false;
  return autoPipelineEnabled;
}

(function testNormalize() {
  assert.strictEqual(normalizeOcrEngineVersion(undefined), DEFAULT_OCR_ENGINE_VERSION);
  assert.strictEqual(normalizeOcrEngineVersion('legacy'), 'legacy');
  assert.strictEqual(normalizeOcrEngineVersion('bogus'), 'v2');
})();

(function testLegacyRouting() {
  assert.strictEqual(effectiveRecordLayoutMode('legacy', 'auto'), 'single');
  assert.strictEqual(effectiveRecordLayoutMode('legacy', 'multi_record_split'), 'single');
  assert.strictEqual(effectiveRecordLayoutMode('v2', 'auto'), 'auto');
  assert.strictEqual(effectiveExtractionAgentMode('legacy', 'agent2_only'), 'agent1_only');
  assert.strictEqual(effectiveExtractionAgentMode('v2', 'agent2_only'), 'agent2_only');
  assert.strictEqual(shouldRunZoneExtraction('legacy'), false);
  assert.strictEqual(shouldRunZoneExtraction('v2'), true);
  assert.strictEqual(shouldRunLlamaParseShadow('legacy'), false);
  assert.strictEqual(shouldRunAutoPipeline('legacy', true), false);
  assert.strictEqual(shouldRunAutoPipeline('v2', true), true);
  assert.strictEqual(shouldRunAutoPipeline('v2', false), false);
  assert.strictEqual(shouldRunAutoPipeline('autonomous', true), true);
  assert.strictEqual(shouldRunLayoutIdentification('legacy'), false);
  assert.strictEqual(shouldRunLayoutIdentification('v2'), true);
  assert.strictEqual(shouldUseRecordSnippets('legacy', true), false);
  assert.strictEqual(shouldUseRecordSnippets('v2', true), true);
  assert.strictEqual(shouldUseRecordSnippets('v2', false), false);
  assert.strictEqual(isAutonomousPipelineAvailable('legacy'), false);
  assert.strictEqual(isAutonomousPipelineAvailable('v2'), true);
})();

console.log('ocr-engine-version.test.js: OK');
