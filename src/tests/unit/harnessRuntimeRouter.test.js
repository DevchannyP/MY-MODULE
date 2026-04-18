'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveHarnessRuntimeRoute, loadHarnessReleaseMetadata } = require('../../infrastructure/HarnessRuntimeRouter');

function createFlagStub(enabledFlags = []) {
  const enabled = new Set(enabledFlags);
  return {
    isEnabled(flagName) {
      return enabled.has(flagName);
    },
  };
}

// ── Research mode ─────────────────────────────────────────────────────────────

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

test('[harness runtime router] Research mode falls back to standard when frontier flag disabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Research',
    flagsProvider: createFlagStub([]),
  });

  assert.equal(route.route_id, 'standard-research');
  assert.equal(route.selected_model_tier, 'standard');
  assert.equal(route.reasoning_effort, 'medium');
  assert.equal(route.prompt_caching_enabled, false);
});

// ── Build mode ────────────────────────────────────────────────────────────────

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

test('[harness runtime router] Build mode falls back to standard when mini flag disabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Build',
    flagsProvider: createFlagStub([]),
  });

  assert.equal(route.route_id, 'standard-build');
  assert.equal(route.selected_model_tier, 'standard');
});

// ── Debug mode ────────────────────────────────────────────────────────────────

test('[harness runtime router] Debug mode uses frontier-debug when frontier flag enabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Debug',
    flagsProvider: createFlagStub(['harness_routing_frontier_research']),
  });

  assert.equal(route.route_id, 'frontier-debug');
  assert.equal(route.selected_model_tier, 'frontier');
  assert.equal(route.reasoning_effort, 'high');
  assert.equal(route.mode, 'Debug');
});

test('[harness runtime router] Debug mode uses standard-debug when frontier flag disabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Debug',
    flagsProvider: createFlagStub([]),
  });

  assert.equal(route.route_id, 'standard-debug');
  assert.equal(route.selected_model_tier, 'standard');
  assert.equal(route.reasoning_effort, 'high');
});

// ── Operate mode ──────────────────────────────────────────────────────────────

test('[harness runtime router] Operate mode uses mini-operate when mini flag enabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Operate',
    flagsProvider: createFlagStub(['harness_routing_mini_build']),
  });

  assert.equal(route.route_id, 'mini-operate');
  assert.equal(route.selected_model_tier, 'mini');
  assert.equal(route.reasoning_effort, 'medium');
  assert.equal(route.mode, 'Operate');
});

test('[harness runtime router] Operate mode uses standard-operate when mini flag disabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Operate',
    flagsProvider: createFlagStub([]),
  });

  assert.equal(route.route_id, 'standard-operate');
  assert.equal(route.selected_model_tier, 'standard');
});

// ── Policy mode ───────────────────────────────────────────────────────────────

test('[harness runtime router] Policy mode uses frontier-policy when frontier flag enabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Policy',
    flagsProvider: createFlagStub(['harness_routing_frontier_research']),
  });

  assert.equal(route.route_id, 'frontier-policy');
  assert.equal(route.selected_model_tier, 'frontier');
  assert.equal(route.reasoning_effort, 'high');
  assert.equal(route.mode, 'Policy');
});

test('[harness runtime router] Policy mode uses standard-policy when frontier flag disabled', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Policy',
    flagsProvider: createFlagStub([]),
  });

  assert.equal(route.route_id, 'standard-policy');
  assert.equal(route.selected_model_tier, 'standard');
  assert.equal(route.reasoning_effort, 'high');
});

// ── Default / unknown mode ────────────────────────────────────────────────────

test('[harness runtime router] unknown mode falls back to standard-default', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'NONEXISTENT',
    flagsProvider: createFlagStub(['harness_routing_frontier_research', 'harness_routing_mini_build']),
  });

  assert.equal(route.route_id, 'standard-default');
  assert.equal(route.selected_model_tier, 'standard');
  assert.equal(route.reasoning_effort, 'medium');
});

test('[harness runtime router] no flagsProvider → all standard routes and all flags false', () => {
  const route = resolveHarnessRuntimeRoute({ mode: 'Research', flagsProvider: null });

  assert.equal(route.route_id, 'standard-research');
  assert.equal(route.selected_model_tier, 'standard');
  assert.equal(route.prompt_caching_enabled, false);
  assert.equal(route.batch_eval_enabled, false);
  assert.equal(route.batch_recommended, false);
});

// ── batch_recommended logic ───────────────────────────────────────────────────

test('[harness runtime router] batch_recommended true for Research + batchEval', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Research',
    flagsProvider: createFlagStub(['harness_batch_eval_enabled']),
  });
  assert.equal(route.batch_eval_enabled, true);
  assert.equal(route.batch_recommended, true);
});

test('[harness runtime router] batch_recommended true for Policy + batchEval', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Policy',
    flagsProvider: createFlagStub(['harness_batch_eval_enabled']),
  });
  assert.equal(route.batch_recommended, true);
});

test('[harness runtime router] batch_recommended false for Build + batchEval', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Build',
    flagsProvider: createFlagStub(['harness_routing_mini_build', 'harness_batch_eval_enabled']),
  });
  assert.equal(route.batch_eval_enabled, true);
  assert.equal(route.batch_recommended, false);
});

test('[harness runtime router] batch_recommended false for Operate + batchEval', () => {
  const route = resolveHarnessRuntimeRoute({
    mode: 'Operate',
    flagsProvider: createFlagStub(['harness_batch_eval_enabled']),
  });
  assert.equal(route.batch_recommended, false);
});

// ── flags_consumed invariant ──────────────────────────────────────────────────

test('[harness runtime router] flags_consumed always lists all 4 feature flags', () => {
  const route = resolveHarnessRuntimeRoute({ mode: 'Build', flagsProvider: null });
  const expected = [
    'harness_routing_frontier_research',
    'harness_routing_mini_build',
    'harness_prompt_caching_enabled',
    'harness_batch_eval_enabled',
  ];
  assert.deepEqual(route.flags_consumed, expected);
});

// ── loadHarnessReleaseMetadata ────────────────────────────────────────────────

test('[harness runtime router] loadHarnessReleaseMetadata returns required shape', () => {
  const meta = loadHarnessReleaseMetadata();
  assert.equal(typeof meta.prompt_version, 'string');
  assert.ok(meta.prompt_version.length > 0);
  assert.equal(typeof meta.rollout_stage, 'string');
  assert.equal(typeof meta.rollback_target, 'string');
  assert.equal(typeof meta.release_evidence_present, 'boolean');
  assert.equal(typeof meta.output_schema_ref, 'string');
});

test('[harness runtime router] resolveHarnessRuntimeRoute includes release metadata fields', () => {
  const route = resolveHarnessRuntimeRoute({ mode: 'Build', flagsProvider: null });
  assert.equal(typeof route.prompt_version, 'string');
  assert.equal(typeof route.rollout_stage, 'string');
  assert.equal(typeof route.release_evidence_present, 'boolean');
  assert.equal(route.recipe_id, 'harness-vnext-router');
});
