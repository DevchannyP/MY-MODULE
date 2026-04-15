'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveHarnessRuntimeRoute } = require('../../infrastructure/HarnessRuntimeRouter');

function createFlagStub(enabledFlags = []) {
  const enabled = new Set(enabledFlags);
  return {
    isEnabled(flagName) {
      return enabled.has(flagName);
    },
  };
}

test('[harness runtime router] Research mode prefers frontier when enabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Research',
    flagsProvider: createFlagStub(['harness_routing_frontier_research', 'harness_prompt_caching_enabled']),
  });

  assert.equal(route.route_id, 'frontier-research');
  assert.equal(route.selected_model_tier, 'frontier');
  assert.equal(route.prompt_caching_enabled, true);
  assert.equal(typeof route.prompt_version, 'string');
});

test('[harness runtime router] Build mode prefers mini when enabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Build',
    flagsProvider: createFlagStub(['harness_routing_mini_build', 'harness_batch_eval_enabled']),
  });

  assert.equal(route.route_id, 'mini-build');
  assert.equal(route.selected_model_tier, 'mini');
  assert.equal(route.batch_eval_enabled, true);
  assert.equal(route.batch_recommended, false);
});
