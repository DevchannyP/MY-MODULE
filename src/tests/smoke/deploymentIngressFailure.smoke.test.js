'use strict';

/**
 * WP-RUN-006 — Stage E adversarial: deployment ingress failure-path smoke
 *
 * Validates that the deployment smoke runner produces structured FAIL artifacts
 * with rollback linkage when ingress conditions are violated:
 *   1. Connection refused (unreachable target) → FAIL artifact written
 *   2. --require-https with HTTP target → ingress-https FAIL step + rollback_trigger
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const RUNNER = 'scripts/run_deployment_smoke.js';
const REPO_ROOT = path.resolve(__dirname, '../../..');

async function runDeploymentSmoke(args, { expectExitCode = 0 } = {}) {
  const outputPath = path.join(os.tmpdir(), `ingress-failure-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const result = spawnSync(process.execPath, [
    RUNNER,
    '--output', outputPath,
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const exitCode = result.status ?? 1;

  const report = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    : null;

  fs.rmSync(outputPath, { force: true });

  if (exitCode !== expectExitCode) {
    throw new assert.AssertionError({
      message: `Expected exit code ${expectExitCode} but got ${exitCode}. stderr: ${stderr}`,
      actual: exitCode,
      expected: expectExitCode,
    });
  }

  return { stdout, stderr, exitCode, report };
}

test('[deployment ingress failure] unreachable target produces FAIL artifact with failure recorded', async () => {
  // Port 1 is reserved and connection refused on all platforms
  const { stdout, report } = await runDeploymentSmoke([
    '--base-url', 'http://127.0.0.1:1',
    '--timeout-ms', '2000',
  ], { expectExitCode: 1 });

  assert.match(stdout || report?.overall_status || '', /FAIL/);
  assert.ok(report, 'artifact must be written even on failure');
  assert.equal(report.overall_status, 'FAIL');
  assert.ok(report.failure, 'failure field must be present');
  assert.equal(typeof report.failure.message, 'string');
  assert.ok(report.failure.message.length > 0, 'failure message must not be empty');
  // artifact path must be recorded
  assert.equal(typeof report.output_path, 'string');
});

test('[deployment ingress failure] --require-https with HTTP target fails with ingress-https step and rollback_trigger', async () => {
  const { stdout, report } = await runDeploymentSmoke([
    '--base-url', 'http://127.0.0.1:9',   // HTTP, unreachable — TLS check fires first
    '--require-https',
    '--timeout-ms', '2000',
  ], { expectExitCode: 1 });

  assert.match(stdout || report?.overall_status || '', /FAIL/);
  assert.ok(report, 'artifact must be written');
  assert.equal(report.overall_status, 'FAIL');

  const ingressStep = report.steps.find((step) => step.id === 'ingress-https');
  assert.ok(ingressStep, 'ingress-https step must be present');
  assert.equal(ingressStep.status, 'FAIL');
  assert.match(ingressStep.error, /HTTPS/i);

  // rollback_trigger must appear in the step detail
  assert.ok(ingressStep.detail, 'step detail must be present');
  assert.equal(ingressStep.detail.rollback_trigger, true, 'rollback_trigger must be true for TLS gate failure');
});

test('[deployment ingress failure] --require-https with HTTPS base-url passes the ingress gate (regression check)', async () => {
  // The ingress gate itself passes when HTTPS — the run will still fail on connection,
  // but ingress-https step status must be PASS before the network failure.
  const { report } = await runDeploymentSmoke([
    '--base-url', 'https://127.0.0.1:1',
    '--require-https',
    '--timeout-ms', '2000',
  ], { expectExitCode: 1 });

  assert.ok(report, 'artifact must be written');
  const ingressStep = report.steps.find((step) => step.id === 'ingress-https');
  assert.ok(ingressStep, 'ingress-https step must be present');
  assert.equal(ingressStep.status, 'PASS', 'HTTPS target must pass the TLS gate');
});
