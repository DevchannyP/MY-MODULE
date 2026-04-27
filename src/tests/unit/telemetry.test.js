'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getHarnessTelemetryContext,
  setHarnessTelemetryContext,
} = require('../../infrastructure/telemetry');

test('[telemetry] harness context can be set and read without losing unknown defaults', () => {
  const previous = getHarnessTelemetryContext();

  setHarnessTelemetryContext({
    prompt_version: 'phase4-test',
    mode: 'Operate',
    eval_run_id: 'eval-123',
  });

  const current = getHarnessTelemetryContext();
  assert.equal(current.prompt_version, 'phase4-test');
  assert.equal(current.mode, 'Operate');
  assert.equal(current.eval_run_id, 'eval-123');
  assert.equal(typeof current.model, 'string');

  setHarnessTelemetryContext(previous);
});
