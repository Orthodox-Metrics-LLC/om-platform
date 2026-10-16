import { promisePool } from '../../../config/db';
import { Rule, RuleOutcome, ParishConfigurationEntity, RuleCondition, RuleConditionGroup } from './ruleTypes';
import { defaultRules } from './defaultRules';
import { ruleOperators, OperatorContext } from './ruleOperators';
import { ruleResolvers, ResolverContext } from './ruleResolvers';
import { validateRuleSchema } from './ruleSchemaValidator';
import { aliasClergyFieldsForRules } from '../clergyIdentity';
import { aliasLocationFieldsForRules } from '../locationIdentity';
import { ensureTenantDefaultLocations } from '../locationDiscovery';

export class ParishRulesEngine {
  private churchId: number;
  private entities: ParishConfigurationEntity[] = [];
  private rules: Rule[] = [];

  constructor(churchId: number) {
    this.churchId = churchId;
  }

  /**
   * Preloads configuration entities and active rules for the church.
   */
  async init(): Promise<void> {
    // Ensure tenant Church / Cemetery defaults exist before rule evaluation
    try {
      await ensureTenantDefaultLocations(this.churchId);
    } catch (err: any) {
      console.warn(`[Rules Engine] ensureTenantDefaultLocations failed for church ${this.churchId}:`, err?.message);
    }

    // 1. Load active parish configuration entities
    const [entityRows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities 
       WHERE church_id = ? AND is_active = 1`,
      [this.churchId]
    );
    this.entities = entityRows as ParishConfigurationEntity[];

    // 2. Load active platform and church rules from database
    const [ruleRows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_rules 
       WHERE (church_id IS NULL OR church_id = ?) AND is_active = 1
       ORDER BY FIELD(scope, 'global', 'diocesan', 'church'), priority ASC`,
      [this.churchId]
    );

    const dbRules: Rule[] = (ruleRows as any[]).map(r => {
      let conditionsObj = {};
      let actionsObj = [];
      try {
        conditionsObj = typeof r.conditions_json === 'string' ? JSON.parse(r.conditions_json) : r.conditions_json;
        actionsObj = typeof r.actions_json === 'string' ? JSON.parse(r.actions_json) : r.actions_json;
      } catch (_) {}

      return {
        id: r.id,
        church_id: r.church_id,
        scope: r.scope,
        name: r.name,
        description: r.description,
        record_type: r.record_type,
        conditions: conditionsObj,
        actions: actionsObj,
        severity: r.severity,
        is_active: r.is_active === 1,
        priority: r.priority
      } as Rule;
    });

    // Merge default rules with database rules (database rules override defaults by ID or name)
    const ruleMap = new Map<string, Rule>();
    
    // Add default rules first
    for (const rule of defaultRules) {
      ruleMap.set(`default_${rule.name}`, rule);
    }
    
    // Add DB rules, overriding by name
    for (const rule of dbRules) {
      ruleMap.set(rule.name, rule);
    }

    this.rules = Array.from(ruleMap.values()).sort((a, b) => a.priority - b.priority);

    // Validate rules schema to avoid runtime errors
    for (const rule of this.rules) {
      try {
        validateRuleSchema(rule);
      } catch (err: any) {
        console.warn(`[Rules Engine] Skipping invalid rule "${rule.name}": ${err.message}`);
      }
    }
  }

  /**
   * Evaluates a record's fields against the active rules list.
   */
  async evaluateRecord(
    recordType: string,
    extractedFields: Record<string, any>,
    options: {
      ocrJobId?: number;
      draftId?: number;
      recordIndex?: number;
      confidenceMetadata?: Record<string, number>;
    } = {}
  ): Promise<{
    fields: Record<string, any>;
    outcomes: RuleOutcome[];
    has_blockers: boolean;
    has_warnings: boolean;
  }> {
    const workingFields = aliasLocationFieldsForRules(aliasClergyFieldsForRules({ ...extractedFields }));
    const outcomes: RuleOutcome[] = [];

    const optRecordIndex = options.recordIndex ?? 0;
    const optConfidence = options.confidenceMetadata || {};

    const opContext: OperatorContext = {
      churchId: this.churchId,
      recordType,
      fields: workingFields,
      confidenceMetadata: optConfidence,
      entities: this.entities
    };

    const resContext: ResolverContext = {
      churchId: this.churchId,
      recordType,
      fields: workingFields,
      entities: this.entities
    };

    // Keep track of fields that have been auto-applied to handle conflicts
    const autoAppliedFields = new Map<string, { value: any; ruleId: number | null }>();

    for (const rule of this.rules) {
      // Check record type match
      if (rule.record_type !== 'all' && rule.record_type !== recordType) {
        continue;
      }

      // Evaluate condition tree
      const match = this.evaluateCondition(rule.conditions, workingFields, opContext);
      if (!match) continue;

      for (const action of rule.actions) {
        // Resolve target action value
        let resolvedValue: any = action.value;
        let originalValue = workingFields[action.field]
          ?? workingFields.clergy
          ?? workingFields.performed_by
          ?? workingFields.officiant
          ?? workingFields.place_of_burial
          ?? workingFields.burial_location
          ?? workingFields.church
          ?? null;
        let suggestedValue: any = null;
        let displayExplanation = action.explanation_template;
        let isAmbiguous = false;
        let suggestionList: any[] | null = null;
        let clergyConfident = false;
        let locationConfident = false;
        let resolvedEntityId: number | null = null;

        if (action.resolver) {
          const resolverFn = ruleResolvers[action.resolver];
          if (resolverFn) {
            const res = resolverFn({}, action, resContext);
            if (res == null) {
              continue;
            }
            if (res && typeof res === 'object' && 'canonical_value' in res && 'suggestions' in res) {
              resolvedValue = res.canonical_value;
              suggestionList = res.suggestions;
              isAmbiguous = !!res.is_ambiguous;
              clergyConfident = !!res.confident && action.resolver === 'best_matching_clergy_by_tenure_and_variant';
              locationConfident = !!res.confident && (
                action.resolver === 'best_matching_burial_location' ||
                action.resolver === 'default_tenant_church_location'
              );
              if (res.entity_id != null) resolvedEntityId = Number(res.entity_id);
              if (res.raw_value != null && originalValue == null) {
                originalValue = res.raw_value;
              }
              if (res.raw_value != null && action.resolver === 'best_matching_burial_location') {
                originalValue = res.raw_value;
              }

              if (suggestionList && suggestionList.length > 0) {
                suggestedValue = suggestionList;
                if (action.resolver === 'best_matching_burial_location') {
                  displayExplanation = locationConfident
                    ? `Normalized burial location to ${suggestionList[0].canonical_value} (raw: ${originalValue || 'n/a'}). ${suggestionList[0].reason}`
                    : (res.explanation || `Burial location needs review: ${suggestionList.map((s: any) => s.canonical_value).join(', ') || originalValue}`);
                } else if (action.resolver === 'default_tenant_church_location') {
                  displayExplanation = `Defaulted service location to tenant Church “${suggestionList[0].canonical_value}” (implied by church_id).`;
                } else {
                  displayExplanation = clergyConfident
                    ? `Normalized officiant to ${suggestionList[0].canonical_value} (raw: ${originalValue || 'n/a'}). ${suggestionList[0].reason}`
                    : `Suggested officiant: ${suggestionList[0].canonical_value} (${suggestionList[0].role}). Reason: ${suggestionList[0].reason}`;
                }
              } else if (res.explanation) {
                displayExplanation = res.explanation;
                isAmbiguous = true;
              }
            } else {
              resolvedValue = res;
              suggestedValue = res;
            }
          }
        } else {
          suggestedValue = action.value;
        }

        // Check Server-Side Auto-Apply Allowlist conditions:
        let canAutoApply = false;

        // Confident unique clergy identity match may normalize even when rule auto_apply is false
        const isClergyNormalize =
          action.resolver === 'best_matching_clergy_by_tenure_and_variant' &&
          clergyConfident &&
          !isAmbiguous &&
          resolvedValue != null;

        const isLocationNormalize =
          (
            action.resolver === 'best_matching_burial_location' ||
            action.resolver === 'default_tenant_church_location'
          ) &&
          locationConfident &&
          !isAmbiguous &&
          resolvedValue != null;

        if (
          (
            (action.auto_apply === true &&
              (action.type === 'normalize_value' || action.type === 'suggest_value') &&
              !isAmbiguous) ||
            isClergyNormalize ||
            isLocationNormalize
          )
        ) {
          const isSurnameResolver = action.resolver === 'father_surname_from_parents' || action.resolver === 'shared_parent_surname';
          const score = optConfidence[action.field]
            ?? optConfidence.clergy
            ?? optConfidence.performed_by
            ?? optConfidence.officiant
            ?? optConfidence.place_of_burial
            ?? optConfidence.burial_location;
          const isHighConfidence = score == null || score >= 0.85;

          if (!isSurnameResolver && isHighConfidence && resolvedValue !== null) {
            canAutoApply = true;
          }
        }

        // Handle auto-apply conflict
        let autoApplied = false;
        let decision: RuleOutcome['reviewer_decision'] = 'pending';

        if (canAutoApply) {
          const existingApply = autoAppliedFields.get(action.field);
          if (existingApply) {
            if (existingApply.value !== resolvedValue) {
              // CONFLICT: Multiple rules auto-applying different values.
              // Downgrade to manual review and log conflict.
              console.warn(`[Rules Engine] Auto-apply conflict on field "${action.field}" between rule ${rule.id} and rule ${existingApply.ruleId}. Bypassing auto-apply.`);
              autoApplied = false;
              decision = 'pending';
              displayExplanation = `Conflict: Multiple rules tried to auto-apply different values for ${action.field}. Human review required.`;
            } else {
              // Already auto-applied the same value
              autoApplied = true;
              decision = 'auto_applied';
            }
          } else {
            // Apply mutation
            workingFields[action.field] = resolvedValue;
            // Keep OCR review UI keys in sync when normalizing clergy
            if (action.field === 'clergy' || action.resolver === 'best_matching_clergy_by_tenure_and_variant') {
              workingFields.clergy = resolvedValue;
              if ('performed_by' in extractedFields || 'performed_by' in workingFields) {
                workingFields.performed_by = resolvedValue;
              }
              if ('officiant' in extractedFields || 'officiant' in workingFields) {
                workingFields.officiant = resolvedValue;
              }
            }
            if (action.resolver === 'best_matching_burial_location') {
              workingFields.place_of_burial = resolvedValue;
              workingFields.burial_location = resolvedValue;
              if (originalValue && String(originalValue) !== String(resolvedValue)) {
                workingFields.place_of_burial_original = originalValue;
                workingFields.burial_location_original = originalValue;
              }
              if (resolvedEntityId) {
                workingFields.burial_location_id = resolvedEntityId;
                workingFields.location_id = resolvedEntityId;
              }
            }
            if (action.resolver === 'default_tenant_church_location') {
              workingFields.church = resolvedValue;
              if (resolvedEntityId) {
                workingFields.church_location_id = resolvedEntityId;
                workingFields.location_id = resolvedEntityId;
              }
            }
            autoAppliedFields.set(action.field, { value: resolvedValue, ruleId: rule.id });
            autoApplied = true;
            decision = 'auto_applied';
          }
        } else if (
          action.resolver === 'best_matching_burial_location' &&
          (isAmbiguous || !resolvedValue) &&
          originalValue
        ) {
          // Flag unmatched/ambiguous burial locations for review — never silently create
          workingFields.place_of_burial_needs_review = true;
          workingFields.burial_location_original = originalValue;
        }

        const outcome: RuleOutcome = {
          rule_id: rule.id,
          rule_name: rule.name,
          field_path: `fields.${action.field}`,
          target_field: action.field,
          action_type: action.type,
          severity: rule.severity,
          original_value: originalValue ?? null,
          suggested_value: suggestedValue ?? null,
          resolved_value: autoApplied ? resolvedValue : null,
          explanation: displayExplanation,
          auto_applied: autoApplied,
          reviewer_decision: decision,
          created_by_engine_version: '1.0.0'
        };

        outcomes.push(outcome);
      }
    }

    const has_blockers = outcomes.some(o => o.severity === 'blocker' && o.reviewer_decision === 'pending');
    const has_warnings = outcomes.some(o => o.severity === 'warning' || o.severity === 'error');

    return {
      fields: workingFields,
      outcomes,
      has_blockers,
      has_warnings
    };
  }

  /**
   * Helper to write execution results to database for auditing
   */
  static async persistEvaluationLogs(
    churchId: number,
    ocrJobId: number | null,
    draftId: number | null,
    recordIndex: number,
    outcomes: RuleOutcome[]
  ): Promise<void> {
    if (!outcomes.length) return;

    const values: any[] = [];
    const placeholders = outcomes.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ');

    for (const o of outcomes) {
      values.push(
        churchId,
        ocrJobId,
        draftId,
        recordIndex,
        o.rule_id,
        o.rule_name,
        o.field_path,
        o.target_field,
        o.action_type,
        o.severity,
        typeof o.original_value === 'object' ? JSON.stringify(o.original_value) : String(o.original_value ?? ''),
        typeof o.suggested_value === 'object' ? JSON.stringify(o.suggested_value) : String(o.suggested_value ?? ''),
        typeof o.resolved_value === 'object' ? JSON.stringify(o.resolved_value) : String(o.resolved_value ?? ''),
        o.confidence_score ?? null,
        o.explanation,
        o.auto_applied ? 1 : 0,
        o.reviewer_decision,
        o.decision_notes ?? null,
        o.decided_by ?? (o.auto_applied ? 'system' : null),
        o.created_by_engine_version ?? '1.0.0'
      );
    }

    await promisePool.query(
      `INSERT INTO ocr_rule_evaluation_logs (
        church_id, ocr_job_id, ocr_draft_id, record_index, rule_id, rule_name,
        field_path, target_field, action_type, severity, original_value,
        suggested_value, resolved_value, confidence_score, explanation,
        auto_applied, reviewer_decision, decision_notes, decided_by,
        created_by_engine_version, created_at
      ) VALUES ${placeholders}`,
      values
    );
  }

  /**
   * Helper to evaluate a structured rule condition group or leaf condition.
   */
  private evaluateCondition(
    cond: RuleConditionGroup | RuleCondition,
    fields: Record<string, any>,
    ctx: OperatorContext
  ): boolean {
    if ('all' in cond && cond.all) {
      for (const sub of cond.all) {
        if (!this.evaluateCondition(sub, fields, ctx)) return false;
      }
      return true;
    }

    if ('any' in cond && cond.any) {
      for (const sub of cond.any) {
        if (this.evaluateCondition(sub, fields, ctx)) return true;
      }
      return false;
    }

    // Leaf condition
    const leaf = cond as RuleCondition;
    const val = fields[leaf.field];
    const operatorFn = ruleOperators[leaf.operator];
    if (!operatorFn) {
      console.warn(`[Rules Engine] Unknown condition operator "${leaf.operator}"`);
      return false;
    }

    return operatorFn(val, leaf.value, ctx);
  }
}
