'use strict';

const { normalizeIntake } = require('../../../scripts/intake-normalizer');
const { decomposeGoal } = require('../../../scripts/goal-decomposer');
const { applyIsolationBoundaries } = require('../../../scripts/isolation-boundary');
const { buildContextEnvelope } = require('../../../scripts/build-context-envelope');
const { allocateTokenBudget } = require('../../../scripts/allocate-token-budget');
const { resolveValidationProfile } = require('../../../scripts/resolve_validation_profile');

function createModuleRegistry(options = {}) {
  return new Map([
    ['M02', (input) => normalizeIntake(input, options)],
    ['M03', (input) => decomposeGoal(input, options)],
    ['M04', (input) => applyIsolationBoundaries(input, options)],
    ['M05', (input) => buildContextEnvelope(input, options)],
    ['M06', (input) => allocateTokenBudget(input, options)],
    ['M08', (input) => resolveValidationProfile(input, { ...options, mpo: true })],
  ]);
}

module.exports = {
  createModuleRegistry,
};
