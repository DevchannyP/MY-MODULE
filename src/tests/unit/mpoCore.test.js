'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { ContractValidator } = require('../../infrastructure/mpo/ContractValidator');
const { normalizeIntake } = require('../../../scripts/intake-normalizer');
const { decomposeGoal } = require('../../../scripts/goal-decomposer');
const { applyIsolationBoundaries } = require('../../../scripts/isolation-boundary');
const { buildContextEnvelope } = require('../../../scripts/build-context-envelope');
const { allocateTokenBudget } = require('../../../scripts/allocate-token-budget');

const ROOT = path.resolve(__dirname, '../../..');

function sampleRawIntent() {
  return {
    raw_intent: 'MPO 문서와 dry-run 경로를 검증한다.',
    goal: 'MPO 문서와 dry-run 경로를 검증한다.',
    session_context: {
      anchors: {
        current_state: {},
        current_wp: {},
        next_actions: {},
        requirements: {},
      },
    },
  };
}

test('[mpo core] ContractValidator enforces raw-intent schema', () => {
  const validator = new ContractValidator({ root: ROOT });
  const payload = sampleRawIntent();
  assert.doesNotThrow(() => validator.validateInput('contracts/harness/raw-intent.schema.json', payload, 'RawIntent'));
  assert.throws(() => validator.validateInput('contracts/harness/raw-intent.schema.json', { goal: 'missing raw' }, 'RawIntent'));
});

test('[mpo core] planning modules produce executable dag metadata', () => {
  const validator = new ContractValidator({ root: ROOT });
  const intake = normalizeIntake(sampleRawIntent(), { validator });
  assert.equal(intake.packet_type, 'docs');
  const dag = decomposeGoal({ sessionId: 'mpo-test', intakePacket: intake, validator });
  const bounded = applyIsolationBoundaries(dag, { root: ROOT, validator });
  const enveloped = buildContextEnvelope(bounded, { root: ROOT, validator });
  const budgeted = allocateTokenBudget(enveloped, { root: ROOT, validator });

  assert.ok(budgeted.wp_list.length >= 1);
  budgeted.wp_list.forEach((wp) => {
    assert.ok(Array.isArray(wp.allowed_paths));
    assert.ok(wp.context_envelope);
    assert.ok(Number(wp.token_budget.budget) > 0);
  });
});
