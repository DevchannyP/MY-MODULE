'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ContractValidator } = require('../../infrastructure/mpo/ContractValidator');
const {
  validateCompletionReport,
  validateCompletionReportInput,
} = require('../../../scripts/validate-completion-report');
const { completeWorkPacket } = require('../../../scripts/wp-complete');
const { createMpoPipeline } = require('../../../scripts/mpo-pipeline');
const { HarnessProviderAdapter } = require('../../infrastructure/ai/HarnessProviderAdapter');
const { NullHarnessProvider } = require('../../infrastructure/ai/NullHarnessProvider');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function copyRecursive(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

function createTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mpo-exec-'));
  fs.mkdirSync(path.join(root, 'memory/L0-hot'), { recursive: true });
  fs.mkdirSync(path.join(root, 'worklog/reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'memory/current-state.yaml'), 'branch: "test"\n', 'utf8');
  fs.writeFileSync(path.join(root, 'memory/current-wp.yaml'), 'id: "WP-CURRENT"\nstatus: "active"\n', 'utf8');
  fs.writeFileSync(path.join(root, 'memory/L0-hot/next-actions.yaml'), 'queue: []\n', 'utf8');
  fs.writeFileSync(path.join(root, 'memory/wp-queue.yaml'), 'mpo_sessions: []\n', 'utf8');
  return root;
}

function createRuntimeRoot() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpo-exec-runtime-'));
  [
    'contracts',
    'requirements',
    'memory',
    'docs',
    'scripts',
    'src',
    'artifacts',
    'domains',
    'evals',
    'package.json',
    'package-lock.json',
  ].forEach((entry) => {
    const source = path.join(REPO_ROOT, entry);
    const target = path.join(runtimeRoot, entry);
    if (fs.existsSync(source)) {
      copyRecursive(source, target);
    }
  });
  return runtimeRoot;
}

function createReport(root, overrides = {}) {
  const evidencePath = 'artifacts/mpo/test/wp-1/command-1.log';
  const absoluteEvidencePath = path.join(root, evidencePath);
  fs.mkdirSync(path.dirname(absoluteEvidencePath), { recursive: true });
  fs.writeFileSync(absoluteEvidencePath, '$ npm test\n\nok\n', 'utf8');

  return {
    session_id: 'mpo-session-test',
    wp_id: 'WP-TEST-001',
    prompt_version: '0.2.0',
    mode: 'Build',
    packet_type: 'feature',
    risk_level: 'LOW',
    verification_status: 'PASS',
    evidence_status: 'observed',
    tests_run: [
      {
        name: 'npm test',
        status: 'PASS',
        evidence: 'ok',
        count: 1,
      },
    ],
    tests_planned: [
      {
        name: 'npm test',
        expected_result: 'tests should pass',
      },
    ],
    rollback_plan: 'revert wp changes',
    summary: 'WP completed successfully',
    analysis: ['domain=mpo', 'layer=server'],
    change_points: [
      {
        target: 'src/server/routes/mpo.js',
        intent: 'validate MPO execution path',
        status: 'changed',
      },
    ],
    verification: [
      {
        name: 'npm test',
        status: 'PASS',
        note: 'ok',
      },
    ],
    risks: [
      {
        level: 'LOW',
        description: 'dry-run provider path',
        mitigation: 'validate evidence',
      },
    ],
    next_action: 'advance to next wp',
    changed_files: ['src/server/routes/mpo.js'],
    read_files: [],
    evidence: [
      {
        type: 'command',
        path: evidencePath,
        detail: 'PASS',
      },
    ],
    provider: {
      provider_id: 'null-harness-provider',
      route_id: 'mini-build',
      selected_model_tier: 'mini',
      reasoning_effort: 'low',
      fallback_applied: false,
      model: 'null-mini',
    },
    token_usage: {
      budget: 2000,
      used: 400,
      warning_threshold: 1600,
    },
    attempt: 1,
    artifacts: [evidencePath],
    boundary: {
      allowed_paths: ['src/server/routes/**'],
      read_only_paths: ['contracts/**'],
      forbidden_paths: ['node_modules/**'],
    },
    ...overrides,
  };
}

test('[mpo execution] truthfulness gate rejects PASS claims when command results fail', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = createReport(root);
  fs.mkdirSync(path.join(root, 'src/server/routes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/server/routes/mpo.js'), '// test\n', 'utf8');

  const result = validateCompletionReport(report, {
    root,
    validator,
    wp: {
      allowed_paths: ['src/server/routes/**'],
      forbidden_paths: ['node_modules/**'],
    },
    commandResults: [
      {
        command: 'npm test',
        status: 'FAIL',
      },
    ],
  });

  assert.equal(result.verified, false);
  assert.match(result.violations.join('\n'), /PASS claimed but command results contain failures/);
});

test('[mpo execution] truthfulness gate rejects changed files outside allowed boundary', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = createReport(root, {
    changed_files: ['memory/current-state.yaml'],
  });
  fs.writeFileSync(path.join(root, 'memory/current-state.yaml'), 'branch: "test"\n', 'utf8');

  const result = validateCompletionReport(report, {
    root,
    validator,
    wp: {
      allowed_paths: ['src/server/routes/**'],
      forbidden_paths: ['memory/**'],
    },
    commandResults: [
      {
        command: 'npm test',
        status: 'PASS',
      },
    ],
  });

  assert.equal(result.verified, false);
  assert.match(result.violations.join('\n'), /outside allowed_paths/);
  assert.match(result.violations.join('\n'), /forbidden_paths/);
});

test('[mpo execution] truthfulness gate rejects read files outside context envelope', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  fs.mkdirSync(path.join(root, 'contracts/harness'), { recursive: true });
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'contracts/harness/output.schema.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'memory/secret.yaml'), 'secret: true\n', 'utf8');
  const report = createReport(root, {
    changed_files: [],
    read_files: [
      'contracts/harness/output.schema.json',
      'memory/secret.yaml',
    ],
  });

  const result = validateCompletionReport(report, {
    root,
    validator,
    wp: {
      context_envelope: {
        canonical_files: ['contracts/harness/output.schema.json'],
        partial_files: [],
      },
      forbidden_paths: ['memory/**'],
    },
    commandResults: [
      {
        command: 'npm test',
        status: 'PASS',
      },
    ],
  });

  assert.equal(result.verified, false);
  assert.match(result.violations.join('\n'), /read file outside context_envelope/);
  assert.match(result.violations.join('\n'), /read file in forbidden_paths/);
});

test('[mpo execution] truthfulness gate rejects invalid read file path shapes', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  fs.mkdirSync(path.join(root, 'contracts/harness'), { recursive: true });
  fs.writeFileSync(path.join(root, 'contracts/harness/output.schema.json'), '{}\n', 'utf8');
  const report = createReport(root, {
    changed_files: [],
    read_files: [
      'contracts/harness/output.schema.json',
      'contracts/harness/output.schema.json',
      '/etc/passwd',
      '../outside.yaml',
    ],
  });

  const result = validateCompletionReport(report, {
    root,
    validator,
    wp: {
      context_envelope: {
        canonical_files: ['contracts/harness/output.schema.json'],
        partial_files: [],
      },
    },
    commandResults: [
      {
        command: 'npm test',
        status: 'PASS',
      },
    ],
  });

  assert.equal(result.verified, false);
  assert.match(result.violations.join('\n'), /duplicate read file path/);
  assert.match(result.violations.join('\n'), /absolute or contains traversal/);
});

test('[mpo execution] validate-completion-report CLI input rejects invalid read_files', () => {
  const root = createTempRoot();
  fs.mkdirSync(path.join(root, 'contracts/harness'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, 'contracts/harness/output.schema.json'),
    path.join(root, 'contracts/harness/output.schema.json'),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, 'contracts/harness/completion-report.schema.json'),
    path.join(root, 'contracts/harness/completion-report.schema.json'),
  );
  const report = createReport(root, {
    changed_files: [],
    read_files: [
      'contracts/harness/output.schema.json',
      '/etc/passwd',
    ],
  });
  const input = {
    report,
    root,
    wp: {
      context_envelope: {
        canonical_files: ['contracts/harness/output.schema.json'],
        partial_files: [],
      },
    },
    commandResults: [
      {
        command: 'npm test',
        status: 'PASS',
      },
    ],
  };

  const result = validateCompletionReportInput(input);

  assert.equal(result.verified, false);
  assert.ok(result.violations.some((entry) => /absolute or contains traversal/.test(entry)));
});

test('[mpo execution] completeWorkPacket updates memory and report atomically-shaped outputs', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = createReport(root, {
    changed_files: [],
  });
  const wp = {
    id: 'WP-TEST-001',
  };

  const result = completeWorkPacket(
    {
      sessionId: 'mpo-session-test',
      wp,
      report,
      nextWpId: 'WP-TEST-002',
    },
    {
      root,
      validator,
    },
  );

  assert.match(result.report_path, /worklog\/reports\/\d{4}-\d{2}-\d{2}_WP-TEST-001\.yaml/);
  assert.equal(result.next_wp_id, 'WP-TEST-002');

  const reportText = fs.readFileSync(path.join(root, result.report_path), 'utf8');
  const stateText = fs.readFileSync(path.join(root, 'memory/current-state.yaml'), 'utf8');
  const currentWpText = fs.readFileSync(path.join(root, 'memory/current-wp.yaml'), 'utf8');
  const nextActionsText = fs.readFileSync(path.join(root, 'memory/L0-hot/next-actions.yaml'), 'utf8');
  const queueText = fs.readFileSync(path.join(root, 'memory/wp-queue.yaml'), 'utf8');

  assert.match(reportText, /verification_status: "PASS"/);
  assert.match(stateText, /last_completed_mpo_session:/);
  assert.match(currentWpText, /last_completed_wp: "WP-TEST-001"/);
  assert.match(nextActionsText, /next_wp: "WP-TEST-002"/);
  assert.match(queueText, /session_id: "mpo-session-test"/);
  assert.match(queueText, /wp_id: "WP-TEST-001"/);
});

test('[mpo execution] completeWorkPacket rolls back memory transaction on write failure', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = createReport(root, {
    changed_files: [],
  });
  const wp = {
    id: 'WP-TEST-001',
  };
  const originalState = fs.readFileSync(path.join(root, 'memory/current-state.yaml'), 'utf8');
  const originalCurrentWp = fs.readFileSync(path.join(root, 'memory/current-wp.yaml'), 'utf8');
  const originalRenameSync = fs.renameSync;
  let renameCount = 0;

  fs.renameSync = function patchedRenameSync(source, target) {
    renameCount += 1;
    if (renameCount === 3 && String(target).endsWith('memory/current-wp.yaml')) {
      throw Object.assign(new Error('injected write failure'), { code: 'EINJECTED' });
    }
    return originalRenameSync.call(fs, source, target);
  };

  try {
    assert.throws(
      () => completeWorkPacket(
        {
          sessionId: 'mpo-session-test',
          wp,
          report,
          nextWpId: 'WP-TEST-002',
        },
        {
          root,
          validator,
        },
      ),
      /injected write failure/,
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  const today = new Date().toISOString().slice(0, 10);
  assert.equal(fs.existsSync(path.join(root, `worklog/reports/${today}_WP-TEST-001.yaml`)), false);
  assert.equal(fs.readFileSync(path.join(root, 'memory/current-state.yaml'), 'utf8'), originalState);
  assert.equal(fs.readFileSync(path.join(root, 'memory/current-wp.yaml'), 'utf8'), originalCurrentWp);
});

test('[mpo execution] completeWorkPacket rejects unverified non-PASS reports', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = createReport(root, {
    verification_status: 'FAIL',
    verification: [{ name: 'npm test', status: 'FAIL', note: 'failed' }],
  });

  assert.throws(
    () => completeWorkPacket(
      {
        sessionId: 'mpo-session-test',
        wp: { id: 'WP-TEST-001' },
        report,
        nextWpId: 'WP-TEST-002',
      },
      {
        root,
        validator,
      },
    ),
    /M11 requires a PASS verified report/,
  );
});

test('[mpo execution] HarnessProviderAdapter executeWorkPacket falls back to null provider', async () => {
  const evalArtifactPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mpo-provider-')), 'eval.json');
  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: {
      providerId: 'openai-responses',
      isConfigured() {
        return true;
      },
      async generateWorkPacketResult() {
        throw Object.assign(new Error('provider timed out'), { code: 'PROVIDER_TIMEOUT' });
      },
    },
    nullProvider: new NullHarnessProvider(),
    evalArtifactPath,
    root: REPO_ROOT,
  });

  const result = await adapter.executeWorkPacket({
    route: {
      route_id: 'mini-build',
      selected_model_tier: 'mini',
      reasoning_effort: 'low',
    },
    sessionId: 'mpo-session-test',
    wp: {
      id: 'WP-TEST-001',
    },
  });

  assert.equal(result.session_id, 'mpo-session-test');
  assert.equal(result.wp_id, 'WP-TEST-001');
  assert.equal(result.provider.provider_id, 'null-harness-provider');
  assert.equal(result.provider.fallback_applied, true);

  const artifact = JSON.parse(fs.readFileSync(evalArtifactPath, 'utf8'));
  assert.equal(artifact.last_provider_invocation.provider_id, 'null-harness-provider');
  assert.equal(artifact.last_provider_invocation.fallback_applied, true);
});

test('[mpo execution] pipeline merges provider summary and evidence into completion report', async () => {
  const root = createRuntimeRoot();
  const validator = new ContractValidator({ root });
  const providerEvidencePath = path.join(root, 'artifacts/provider/live-evidence.txt');
  fs.mkdirSync(path.dirname(providerEvidencePath), { recursive: true });
  fs.writeFileSync(providerEvidencePath, 'provider execution evidence\n', 'utf8');

  const adapter = {
    async executeWorkPacket({ route = {}, sessionId = '', wp = {} } = {}) {
      return {
        session_id: sessionId,
        wp_id: wp.id,
        changed_files: [],
        read_files: [],
        summary: 'provider merged summary',
        analysis: ['provider-analysis=observed'],
        change_points: [
          {
            target: 'src/server/routes/mpo.js',
            intent: 'provider evidence merge',
            status: 'changed',
          },
        ],
        evidence: [
          {
            type: 'provider',
            path: 'artifacts/provider/live-evidence.txt',
            detail: 'observed',
          },
        ],
        artifacts: ['artifacts/provider/live-evidence.txt'],
        provider: {
          provider_id: 'openai-responses',
          route_id: String(route.route_id || 'standard-build'),
          selected_model_tier: String(route.selected_model_tier || 'standard'),
          reasoning_effort: String(route.reasoning_effort || 'medium'),
          fallback_applied: false,
          model: 'gpt-5.2',
        },
      };
    },
  };

  const pipeline = createMpoPipeline({
    root,
    validator,
    harnessProviderAdapter: adapter,
    emitEvent() {},
  });

  const session = await pipeline.createPlan({
    goal: '문서 정리와 MPO dry-run 검증 경로를 확인해줘',
    approvalRequested: false,
  });
  const execution = await pipeline.execute(session);
  const report = execution.results[0].report;

  assert.equal(report.summary, 'provider merged summary');
  assert.ok(report.analysis.includes('provider-analysis=observed'));
  assert.ok(report.evidence.some((entry) => entry.type === 'log' && entry.path === 'artifacts/provider/live-evidence.txt'));
  assert.ok(report.artifacts.includes('artifacts/provider/live-evidence.txt'));
  assert.equal(report.change_points[0].target, 'src/server/routes/mpo.js');
});

test('[mpo execution] truthfulness gate rejects PASS with empty tests_run', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = createReport(root, {
    tests_run: [],
  });

  const result = validateCompletionReport(report, {
    root,
    validator,
    wp: {},
    commandResults: [],
  });

  assert.equal(result.verified, false);
  assert.ok(
    result.violations.some((v) => /tests_run is empty or missing/.test(v)),
    `Expected violation about empty tests_run, got: ${result.violations.join(', ')}`,
  );
});

test('[mpo execution] truthfulness gate rejects NOT_RUN in tests_run', () => {
  // output.schema.json rejects NOT_RUN before the runtime truthfulness check is reached.
  const root = createTempRoot();
  const validator = new ContractValidator({ root: REPO_ROOT });
  const report = createReport(root, {
    tests_run: [
      { name: 'unit tests', status: 'PASS' },
      { name: 'integration check', status: 'NOT_RUN' },
    ],
  });

  assert.throws(
    () => validateCompletionReport(report, {
      root,
      validator,
      wp: {},
      commandResults: [],
    }),
    (err) => {
      const msg = String(err.message || err);
      return /CONTRACT_VALIDATION_FAILED|CONTRACT-INV|NOT_RUN|tests_run/.test(msg);
    },
    'Expected contract or truthfulness error rejecting NOT_RUN in tests_run',
  );
});
