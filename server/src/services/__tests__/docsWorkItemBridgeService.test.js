/**
 * Unit tests for docsWorkItemBridgeService mappings.
 * Run: node --test server/src/services/__tests__/docsWorkItemBridgeService.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const intakeValidation = require('../docsWorkItemIntakeValidation');
const bridge = require('../docsWorkItemBridgeService');

describe('validateIntakePayload', () => {
  it('requires governed backlog fields', () => {
    const result = intakeValidation.validateGovernedIntake({
      title: 'Test',
      description: 'Desc',
      objective: 'Obj',
      repoTarget: 'orthodoxmetrics',
      taskType: 'docs',
      executionMode: 'single_step',
      requestedOutcome: 'Done',
      acceptanceCriteria: 'Checks pass',
    });
    assert.equal(result.length, 0);
  });

  it('requires relaxed assigned agent', () => {
    const missing = intakeValidation.validateRelaxedIntake({
      title: 'Test',
      instruction: 'Do the thing',
      repoTarget: 'orthodoxmetrics',
      assignedAgent: '',
    });
    assert.ok(missing.some((e) => e.field === 'assignedAgent'));
  });
});

describe('mapTargetSystemToRepoTarget', () => {
  it('maps UI target systems to repo_target', () => {
    assert.equal(bridge.mapTargetSystemToRepoTarget('OrthodoxMetrics'), 'orthodoxmetrics');
    assert.equal(bridge.mapTargetSystemToRepoTarget('OMAI'), 'omai');
    assert.equal(bridge.mapTargetSystemToRepoTarget('OMStudio'), 'omstudio');
    assert.equal(bridge.mapTargetSystemToRepoTarget('Shared'), 'orthodoxmetrics');
  });

  it('blocks OMWorkshop', () => {
    assert.throws(
      () => bridge.mapTargetSystemToRepoTarget('OMWorkshop'),
      (err) => err.code === 'INVALID_REPO_TARGET',
    );
  });
});

describe('mapAssignedAgentToTools', () => {
  it('maps dropbox agents to OMAI fields', () => {
    assert.deepEqual(bridge.mapAssignedAgentToTools('Cursor'), { assigned_agent: 'Cursor', agent_tool: 'cursor' });
    assert.deepEqual(bridge.mapAssignedAgentToTools('OMBrain'), { assigned_agent: 'OMBrain', agent_tool: 'claude_cli' });
    assert.deepEqual(bridge.mapAssignedAgentToTools('OMAI'), { assigned_agent: 'OMAI', agent_tool: 'omai' });
    assert.deepEqual(bridge.mapAssignedAgentToTools('OMStudio'), { assigned_agent: 'OMStudio', agent_tool: 'cursor' });
    assert.deepEqual(bridge.mapAssignedAgentToTools('OMWorkshop'), { assigned_agent: 'OMWorkshop', agent_tool: 'cursor' });
  });

  it('allows empty agent for governed backlog', () => {
    assert.deepEqual(bridge.mapAssignedAgentToTools(''), { assigned_agent: null, agent_tool: null });
  });

  it('treats whitespace-only agent as empty', () => {
    assert.deepEqual(bridge.mapAssignedAgentToTools('   '), { assigned_agent: null, agent_tool: null });
  });
});
