/**
 * Docs Dropbox work-item intake validation — mirrors OMAI intakeValidationService.
 * Keeps OM bridge aligned with governed backlog + relaxed direct-assignment rules.
 */

const VALID_REPO_TARGETS = Object.freeze([
  'orthodoxmetrics', 'omai', 'omstudio', 'omai-ops', 'shared', 'unknown',
]);
const VALID_WORK_TYPES = Object.freeze([
  'feature', 'enhancement', 'refactor', 'migration', 'chore', 'spike', 'bugfix', 'docs', 'unknown',
]);
const VALID_EXECUTION_MODES = Object.freeze([
  'single_step', 'multi_phase_unordered', 'multi_phase_ordered', 'multi_phase_feedback_gated', 'unknown',
]);
const VALID_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const VALID_AGENT_TOOLS = Object.freeze(['windsurf', 'claude_cli', 'cursor', 'github_copilot', 'omai']);
const VALID_ASSIGNED_AGENTS = Object.freeze(['Cursor', 'OMBrain', 'OMAI', 'OMStudio', 'OMWorkshop', 'Operator']);

function nonEmpty(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function fieldError(field, message) {
  return { field, message };
}

function validateGovernedIntake(payload) {
  const errors = [];
  if (!nonEmpty(payload.title)) errors.push(fieldError('title', 'Title is required'));
  if (!nonEmpty(payload.description)) errors.push(fieldError('description', 'Description is required'));
  if (!nonEmpty(payload.objective)) errors.push(fieldError('objective', 'Objective is required'));
  if (!VALID_REPO_TARGETS.includes(payload.repoTarget)) {
    errors.push(fieldError('repoTarget', `Must be one of: ${VALID_REPO_TARGETS.join(', ')}`));
  }
  if (!payload.taskType || !VALID_WORK_TYPES.includes(payload.taskType)) {
    errors.push(fieldError('taskType', `Must be one of: ${VALID_WORK_TYPES.join(', ')}`));
  }
  if (!payload.executionMode || !VALID_EXECUTION_MODES.includes(payload.executionMode)) {
    errors.push(fieldError('executionMode', `Must be one of: ${VALID_EXECUTION_MODES.join(', ')}`));
  }
  if (!nonEmpty(payload.requestedOutcome)) {
    errors.push(fieldError('requestedOutcome', 'Requested outcome is required'));
  }
  if (!nonEmpty(payload.acceptanceCriteria)) {
    errors.push(fieldError('acceptanceCriteria', 'Acceptance criteria is required'));
  }
  if (payload.priority && !VALID_PRIORITIES.includes(payload.priority)) {
    errors.push(fieldError('priority', `Must be one of: ${VALID_PRIORITIES.join(', ')}`));
  }
  if (payload.agentTool && !VALID_AGENT_TOOLS.includes(payload.agentTool)) {
    errors.push(fieldError('agentTool', `Must be one of: ${VALID_AGENT_TOOLS.join(', ')}`));
  }
  if (payload.assignedAgent && !VALID_ASSIGNED_AGENTS.includes(payload.assignedAgent)) {
    errors.push(fieldError('assignedAgent', `Must be one of: ${VALID_ASSIGNED_AGENTS.join(', ')}`));
  }
  if (payload.repoTarget === 'shared' && !nonEmpty(payload.sharedRepoJustification)) {
    errors.push(fieldError('sharedRepoJustification', 'Justification required when repo target is shared'));
  }
  return errors;
}

function validateRelaxedIntake(payload) {
  const errors = [];
  const instruction = payload.instruction || payload.description;
  if (!nonEmpty(payload.title) && !nonEmpty(instruction)) {
    errors.push(fieldError('title', 'Title or instruction is required'));
  }
  if (!nonEmpty(instruction)) {
    errors.push(fieldError('instruction', 'Instruction is required'));
  }
  if (!VALID_REPO_TARGETS.includes(payload.repoTarget)) {
    errors.push(fieldError('repoTarget', `Must be one of: ${VALID_REPO_TARGETS.join(', ')}`));
  }
  if (!nonEmpty(payload.assignedAgent)) {
    errors.push(fieldError('assignedAgent', 'Assigned agent is required for relaxed items'));
  } else if (!VALID_ASSIGNED_AGENTS.includes(payload.assignedAgent)) {
    errors.push(fieldError('assignedAgent', `Must be one of: ${VALID_ASSIGNED_AGENTS.join(', ')}`));
  }
  if (payload.agentTool && !VALID_AGENT_TOOLS.includes(payload.agentTool)) {
    errors.push(fieldError('agentTool', `Must be one of: ${VALID_AGENT_TOOLS.join(', ')}`));
  }
  if (payload.taskType && !VALID_WORK_TYPES.includes(payload.taskType)) {
    errors.push(fieldError('taskType', `Must be one of: ${VALID_WORK_TYPES.join(', ')}`));
  }
  if (payload.priority && !VALID_PRIORITIES.includes(payload.priority)) {
    errors.push(fieldError('priority', `Must be one of: ${VALID_PRIORITIES.join(', ')}`));
  }
  return errors;
}

function validateIntakePayload(mode, payload) {
  const errors = mode === 'relaxed'
    ? validateRelaxedIntake(payload)
    : validateGovernedIntake(payload);
  return { valid: errors.length === 0, errors };
}

module.exports = {
  VALID_REPO_TARGETS,
  VALID_WORK_TYPES,
  VALID_EXECUTION_MODES,
  VALID_PRIORITIES,
  VALID_AGENT_TOOLS,
  VALID_ASSIGNED_AGENTS,
  validateGovernedIntake,
  validateRelaxedIntake,
  validateIntakePayload,
};
