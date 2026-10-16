/**
 * Parish-configurable OCR field extraction — Agent 1 vs Agent 2 (single agent per job).
 */

import type { Pool } from 'mysql2/promise';
import {
  extractAgentFieldsForJob,
  extractAgent2FieldsForJob,
  type AgentExtractResult,
} from '../../utils/ocrClassifier';
import {
  recoverMissingRequiredFields,
  recoverThenFindMissingRequired,
} from '../../ocr/missingFieldRecovery';

export type ExtractionAgentMode =
  | 'agent2_fallback_agent1'
  | 'agent2_only'
  | 'agent1_only'
  | 'agent1_fallback_agent2';

export const DEFAULT_EXTRACTION_AGENT_MODE: ExtractionAgentMode = 'agent2_fallback_agent1';

const VALID_MODES = new Set<string>([
  'agent2_fallback_agent1',
  'agent2_only',
  'agent1_only',
  'agent1_fallback_agent2',
]);

export async function loadExtractionAgentMode(
  db: Pool | { query: (...args: any[]) => Promise<any> },
  churchId: number,
): Promise<ExtractionAgentMode> {
  try {
    const [rows] = await db.query(
      `SELECT settings_json FROM ocr_settings WHERE church_id = ? LIMIT 1`,
      [churchId],
    ) as any[];
    if (!rows?.length || !rows[0].settings_json) {
      return DEFAULT_EXTRACTION_AGENT_MODE;
    }
    const json = typeof rows[0].settings_json === 'string'
      ? JSON.parse(rows[0].settings_json)
      : rows[0].settings_json;
    const mode = json?.documentProcessing?.extractionAgentMode
      || json?.extractionAgentMode;
    if (typeof mode === 'string' && VALID_MODES.has(mode)) {
      return mode as ExtractionAgentMode;
    }
  } catch (err: any) {
    console.warn(`[OCR] Failed to load extractionAgentMode for church ${churchId}: ${err.message}`);
  }
  return DEFAULT_EXTRACTION_AGENT_MODE;
}

export function isAgentExtractUsable(result: AgentExtractResult | null | undefined): boolean {
  if (!result) return false;
  const bucket = result.records?.length ? result.records : [result.fields || {}];
  return bucket.some((rec) => Object.values(rec).some((v) => String(v || '').trim().length > 0));
}

export interface RunAgentExtractionOptions {
  jobId: number;
  churchId: number;
  ocrText: string;
  recordTypeHint?: string;
  layoutType?: 'tabular' | 'form' | 'narrative';
  mode?: ExtractionAgentMode;
  settingsDb?: Pool | { query: (...args: any[]) => Promise<any> };
  /** Pre-filled from zone-aware OCR — merged when agent fields are empty */
  zoneFields?: Record<string, string>;
}

export interface AgentExtractionRunResult {
  primary: AgentExtractResult;
  primaryAgent: 'agent1' | 'agent2';
  mode: ExtractionAgentMode;
  usedFallback: boolean;
  fallbackFrom?: 'agent1' | 'agent2';
  skippedAgent?: 'agent1' | 'agent2';
}

async function runAgent1(
  jobId: number,
  ocrText: string,
  recordTypeHint?: string,
  layoutType?: 'tabular' | 'form' | 'narrative',
): Promise<AgentExtractResult> {
  const extract = await extractAgentFieldsForJob(jobId, ocrText, recordTypeHint, layoutType);
  return { ...extract, agent: 'agent1' };
}

async function runAgent2(
  jobId: number,
  recordTypeHint: string | undefined,
  ocrText: string,
): Promise<AgentExtractResult | null> {
  const agent2 = await extractAgent2FieldsForJob(jobId, recordTypeHint, ocrText);
  if (!agent2) return null;
  return { ...agent2, agent: 'agent2' };
}

function applySameRecordRecovery(result: AgentExtractionRunResult): AgentExtractionRunResult {
  const primary = result.primary;
  const records = (primary.records?.length ? primary.records : [primary.fields || {}]).map(
    (rec) => recoverMissingRequiredFields(primary.record_type, rec).fields,
  );
  const recovered = recoverThenFindMissingRequired(primary.record_type, records[0] || primary.fields || {});
  return {
    ...result,
    primary: {
      ...primary,
      fields: recovered.fields,
      records,
      recoveredFrom: recovered.recoveredFrom,
      needs_review: primary.needs_review || recovered.missingRequired.length > 0,
    },
  };
}

function mergeZonePrefilledFields(
  result: AgentExtractionRunResult,
  zoneFields?: Record<string, string>,
): AgentExtractionRunResult {
  if (!zoneFields || !Object.keys(zoneFields).length) return applySameRecordRecovery(result);

  const primary = { ...result.primary };
  const bucket = primary.records?.length ? primary.records : [primary.fields || {}];
  const target = { ...(bucket[0] || {}) };
  let merged = false;

  for (const [key, value] of Object.entries(zoneFields)) {
    if (!value?.trim()) continue;
    if (!String(target[key] || '').trim()) {
      target[key] = value.trim();
      merged = true;
    }
  }

  if (!merged) return applySameRecordRecovery(result);

  if (primary.records?.length) {
    primary.records = [{ ...primary.records[0], ...target }, ...primary.records.slice(1)];
  } else {
    primary.fields = { ...(primary.fields || {}), ...target };
  }

  return applySameRecordRecovery({ ...result, primary });
}

export async function runConfiguredAgentExtraction(
  opts: RunAgentExtractionOptions,
): Promise<AgentExtractionRunResult> {
  const mode = opts.mode
    || (opts.settingsDb
      ? await loadExtractionAgentMode(opts.settingsDb, opts.churchId)
      : DEFAULT_EXTRACTION_AGENT_MODE);

  const tryAgent2First = mode === 'agent2_fallback_agent1' || mode === 'agent2_only';
  const tryAgent1First = mode === 'agent1_fallback_agent2' || mode === 'agent1_only';
  const allowFallback = mode === 'agent2_fallback_agent1' || mode === 'agent1_fallback_agent2';

  if (tryAgent2First) {
    const agent2 = await runAgent2(opts.jobId, opts.recordTypeHint, opts.ocrText);
    if (isAgentExtractUsable(agent2)) {
      return mergeZonePrefilledFields({
        primary: agent2!,
        primaryAgent: 'agent2',
        mode,
        usedFallback: false,
        skippedAgent: 'agent1',
      }, opts.zoneFields);
    }
    if (mode === 'agent2_only') {
      throw new Error('Agent 2 extraction unavailable for this job');
    }
    if (allowFallback) {
      const agent1 = await runAgent1(opts.jobId, opts.ocrText, opts.recordTypeHint, opts.layoutType);
      return mergeZonePrefilledFields({
        primary: agent1,
        primaryAgent: 'agent1',
        mode,
        usedFallback: true,
        fallbackFrom: 'agent2',
        skippedAgent: 'agent2',
      }, opts.zoneFields);
    }
  }

  if (tryAgent1First) {
    const agent1 = await runAgent1(opts.jobId, opts.ocrText, opts.recordTypeHint, opts.layoutType);
    if (isAgentExtractUsable(agent1) || mode === 'agent1_only') {
      if (isAgentExtractUsable(agent1)) {
        return mergeZonePrefilledFields({
          primary: agent1,
          primaryAgent: 'agent1',
          mode,
          usedFallback: false,
          skippedAgent: 'agent2',
        }, opts.zoneFields);
      }
    }
    if (mode === 'agent1_only') {
      return mergeZonePrefilledFields({
        primary: agent1,
        primaryAgent: 'agent1',
        mode,
        usedFallback: false,
        skippedAgent: 'agent2',
      }, opts.zoneFields);
    }
    if (allowFallback) {
      const agent2 = await runAgent2(opts.jobId, opts.recordTypeHint, opts.ocrText);
      if (isAgentExtractUsable(agent2)) {
        return mergeZonePrefilledFields({
          primary: agent2!,
          primaryAgent: 'agent2',
          mode,
          usedFallback: true,
          fallbackFrom: 'agent1',
          skippedAgent: 'agent1',
        }, opts.zoneFields);
      }
      return mergeZonePrefilledFields({
        primary: agent1,
        primaryAgent: 'agent1',
        mode,
        usedFallback: true,
        fallbackFrom: 'agent2',
        skippedAgent: 'agent2',
      }, opts.zoneFields);
    }
  }

  const agent1 = await runAgent1(opts.jobId, opts.ocrText, opts.recordTypeHint, opts.layoutType);
  return mergeZonePrefilledFields({
    primary: agent1,
    primaryAgent: 'agent1',
    mode: DEFAULT_EXTRACTION_AGENT_MODE,
    usedFallback: false,
    skippedAgent: 'agent2',
  }, opts.zoneFields);
}

export function buildAgentExtractPayload(
  result: AgentExtractionRunResult,
): Record<string, unknown> {
  return {
    ...result.primary,
    agent: result.primaryAgent,
    extraction_mode: result.mode,
    used_fallback: result.usedFallback,
    fallback_from: result.fallbackFrom || null,
    extracted_at: new Date().toISOString(),
    confirmed: false,
  };
}
