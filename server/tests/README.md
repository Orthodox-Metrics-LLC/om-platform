# Server tests (repo-level)

Tests formerly at `/prod/test/` live here. Prefer co-located tests under `server/src/**/__tests__` for new work.

This directory is also the canonical home for standalone/manually-run test
and evaluation scripts that don't fit the `src/**/__tests__` colocated
pattern (none of these are wired into an automated test runner today — no
jest/mocha/vitest is configured, so run them directly with `node`/`tsx`):

- `evaluateCorpus.ts` / `evaluate_report.json` — OCR corpus evaluation harness (moved from `server/src/tests/`)
- `test_classifier.js` — OCR classifier smoke test against real feeder jobs (moved from `server/src/tests/`)
- `test-meta-normalization.js` — meta-field normalization unit checks (moved from `server/src/tests/`)
- `fixtures/ocr/` — OCR test fixtures (moved from `server/test-fixtures/ocr/`)
