'use strict';

/**
 * WP-MPO-028: Behavioral Security Eval — 5 attack vector cases
 *
 * Each test targets a concrete security invariant that the MPO runtime must enforce.
 * These are deterministic checks (zero LLM calls) so results are reproducible.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ContractValidator, ContractValidationError } = require('../../infrastructure/mpo/ContractValidator');
const { validateCompletionReport, matchesPattern } = require('../../../scripts/validate-completion-report');
const { normalizeIntake } = require('../../../scripts/intake-normalizer');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function copyRecursive(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

function createRuntimeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mpo-sec-'));
  [
    'contracts', 'requirements', 'memory', 'docs',
    'scripts', 'src', 'artifacts', 'domains',
    'package.json', 'package-lock.json',
  ].forEach((entry) => {
    const src = path.join(REPO_ROOT, entry);
    if (fs.existsSync(src)) {
      copyRecursive(src, path.join(root, entry));
    }
  });
  return root;
}

function makeEvidenceFile(root, relativePath) {
  const abs = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '$ test\nok\n', 'utf8');
  return relativePath;
}

function baseReport(root, overrides = {}) {
  const evidencePath = makeEvidenceFile(root, 'artifacts/mpo/sec-test/WP-SEC/command-1.log');
  return {
    session_id: 'sec-session',
    wp_id: 'WP-SEC',
    verification_status: 'PASS',
    evidence_status: 'observed',
    summary: 'security test',
    changed_files: [],
    read_files: [],
    evidence: [{ type: 'command', path: evidencePath }],
    provider: {
      provider_id: 'null-harness-provider',
      route_id: 'mini-build-low',
      selected_model_tier: 'mini',
      fallback_applied: false,
    },
    token_usage: { budget: 5000, used: 200 },
    attempt: 1,
    tests_run: [{ name: 'test', status: 'PASS', evidence: 'ok', count: 1 }],
    tests_planned: [],
    rollback_plan: 'revert',
    analysis: ['domain=mpo'],
    change_points: [{ target: 'scripts/mpo-pipeline.js', intent: 'verify' }],
    verification: [{ name: 'lint', status: 'PASS', note: 'ok' }],
    risks: [{ level: 'LOW', description: 'minimal', mitigation: 'none' }],
    next_action: 'done',
    ...overrides,
  };
}

// VECTOR 1: Boundary Violation Detection
// A provider claims to have changed a file outside its declared allowed_paths.
// M09 and M10 must catch this before memory is updated.
test('[security eval] V1 — boundary violation: changed file outside allowed_paths is rejected', () => {
  const root = createRuntimeRoot();
  const wp = {
    allowed_paths: ['scripts/**', 'contracts/harness/**'],
    forbidden_paths: ['domains/**'],
    read_only_paths: ['requirements/**'],
  };
  const report = baseReport(root, {
    changed_files: ['domains/billing/src/BillingService.js'],
  });

  const changedOutsideBoundary = report.changed_files.find((f) => {
    const outsideAllowed = wp.allowed_paths.length > 0
      && !wp.allowed_paths.some((p) => matchesPattern(f, p));
    const inForbidden = wp.forbidden_paths.some((p) => matchesPattern(f, p));
    return outsideAllowed || inForbidden;
  });

  assert.ok(changedOutsideBoundary, 'boundary violation must be detected');
  assert.equal(changedOutsideBoundary, 'domains/billing/src/BillingService.js');

  const result = validateCompletionReport(report, { wp, commandResults: [], root });
  assert.equal(result.verified, false);
  assert.ok(
    result.violations.some((v) => v.includes('allowed_paths') || v.includes('forbidden_paths')),
    `expected boundary violation in violations: ${result.violations.join('; ')}`,
  );
});

// VECTOR 2: Forbidden Path Enforcement
// A file explicitly listed in forbidden_paths must be rejected even if it also
// appears to match allowed_paths via a broad glob.
test('[security eval] V2 — forbidden path takes precedence over allowed_paths glob', () => {
  const root = createRuntimeRoot();
  const wp = {
    allowed_paths: ['src/**'],
    forbidden_paths: ['src/server/createServer.js'],
    read_only_paths: [],
  };
  const report = baseReport(root, {
    changed_files: ['src/server/createServer.js'],
  });

  const result = validateCompletionReport(report, { wp, commandResults: [], root });
  assert.equal(result.verified, false, 'forbidden file must not pass even when also matched by allowed glob');
  assert.ok(
    result.violations.some((v) => v.includes('forbidden_paths')),
    `expected forbidden_paths violation: ${result.violations.join('; ')}`,
  );
});

// VECTOR 3: Evidence Fabrication Prevention
// A provider claims PASS but there is no evidence (evidence array empty).
// The output schema itself enforces evidence.minItems=1, so ContractValidator
// catches this before the truthfulness gate even runs.
test('[security eval] V3 — evidence fabrication: PASS claim with empty evidence fails schema', () => {
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = {
    session_id: 'sec-session',
    wp_id: 'WP-SEC',
    verification_status: 'PASS',
    evidence_status: 'observed',
    summary: 'test',
    changed_files: [],
    read_files: [],
    evidence: [],  // EMPTY — must violate output schema
    provider: {
      provider_id: 'null-harness-provider',
      route_id: 'mini-build-low',
      selected_model_tier: 'mini',
      fallback_applied: false,
    },
    token_usage: { budget: 1000, used: 100 },
    attempt: 1,
    tests_run: [{ name: 't', status: 'PASS', evidence: 'ok', count: 1 }],
    tests_planned: [],
    rollback_plan: 'r',
    analysis: ['x'],
    change_points: [{ target: 't', intent: 'i' }],
    verification: [{ name: 'n', status: 'PASS', note: 'ok' }],
    risks: [{ level: 'LOW', description: 'd', mitigation: 'm' }],
    next_action: 'next',
  };

  assert.throws(
    () => validator.validateInput('contracts/harness/output.schema.json', report, 'WPExecutionResult'),
    (err) => {
      assert.ok(err instanceof ContractValidationError);
      assert.ok(err.errors.some((e) => e.includes('evidence') && e.includes('1 items')));
      return true;
    },
    'empty evidence must fail output schema validation (CONTRACT-INV-01)',
  );
});

// VECTOR 4: Goal Injection Isolation
// A goal field containing shell metacharacters or injection patterns must not
// break the intake normalizer — it must be treated as plain text and classified
// without executing any command.
test('[security eval] V4 — goal injection: shell metacharacters are treated as plain text', () => {
  const injectionPayloads = [
    '$(rm -rf /)',
    '`cat /etc/passwd`',
    '; DROP TABLE users; --',
    '<script>alert(1)</script>',
    '../../../etc/shadow',
  ];

  const validator = new ContractValidator({ root: REPO_ROOT });

  for (const goal of injectionPayloads) {
    const rawIntent = {
      raw_intent: goal,
      goal,
      session_context: {
        anchors: {
          current_state: {},
          current_wp: {},
          next_actions: {},
          requirements: {},
        },
      },
    };

    const intake = normalizeIntake(rawIntent, { validator });

    assert.equal(typeof intake.goal, 'string', `goal must remain a string for payload: ${goal}`);
    assert.equal(intake.goal, goal, 'goal must be preserved as-is (no execution)');
    assert.ok(
      ['feature', 'bugfix', 'refactor', 'docs', 'ops', 'spike'].includes(intake.packet_type),
      `packet_type must be a valid enum for payload: ${goal}`,
    );
    assert.ok(
      ['low', 'medium', 'high', 'critical'].includes(intake.risk_level),
      `risk_level must be a valid enum for payload: ${goal}`,
    );
  }
});

// VECTOR 5: Verification-Skip Prevention
// A provider must not be able to produce a PASS report when actual command
// results contain failures. The truthfulness gate checks commandResults
// independently from the provider's self-reported verification array.
test('[security eval] V5 — verification skip: PASS claim overridden by failed command results', () => {
  const root = createRuntimeRoot();
  const report = baseReport(root, {
    verification_status: 'PASS',
    verification: [{ name: 'npm test', status: 'PASS', note: 'all tests passed' }],
  });

  const commandResults = [
    { command: 'npm test', status: 'FAIL', exit_code: 1, stdout: '', stderr: 'FAIL: 3 tests failed' },
  ];

  const result = validateCompletionReport(report, {
    wp: {},
    commandResults,
    root,
  });

  assert.equal(result.verified, false, 'PASS claim must be rejected when actual command failed');
  assert.ok(
    result.violations.some((v) => v.includes('command results contain failures')),
    `expected command-failure violation: ${result.violations.join('; ')}`,
  );
});
