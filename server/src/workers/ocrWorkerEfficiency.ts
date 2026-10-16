/**
 * Small, testable helpers for OCR feeder worker throughput.
 * Kept out of ocrFeederWorker.ts so unit tests do not load the full pipeline.
 */

export function clampWorkerConcurrency(raw: unknown, fallback = 2): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(4, Math.floor(n));
}

export function resolveWorkerConcurrency(env: NodeJS.ProcessEnv = process.env, registryValue?: unknown): number {
  const envRaw = env.OCR_WORKER_CONCURRENCY;
  if (envRaw != null && String(envRaw).trim() !== '') {
    return clampWorkerConcurrency(envRaw, 2);
  }
  if (registryValue != null && String(registryValue).trim() !== '') {
    return clampWorkerConcurrency(registryValue, 2);
  }
  return 2;
}

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  if (limit === 1 || items.length <= 1) {
    for (const item of items) {
      await fn(item);
    }
    return;
  }

  const pending = new Set<Promise<void>>();
  for (const item of items) {
    const task = (async () => {
      await fn(item);
    })();
    const tracked = task.finally(() => {
      pending.delete(tracked);
    });
    pending.add(tracked);
    if (pending.size >= limit) {
      await Promise.race(pending);
    }
  }
  await Promise.all(pending);
}

export const OCR_WORKER_SCHEMA_STATEMENTS = [
  'ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS classifier_suggested_type VARCHAR(32) NULL',
  'ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS classifier_confidence DECIMAL(5,3) NULL',
  'ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS layout_classification_json TEXT NULL',
  'ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS agent2_extract_json LONGTEXT NULL',
  'ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS agent2_status VARCHAR(32) NULL',
] as const;
