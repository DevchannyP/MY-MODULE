'use strict';

const http = require('node:http');
const childProcess = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { metrics } = require('../../infrastructure/telemetry');
const { startServerOrSkip } = require('./support/networkTestRuntime');

function jsonPost(port, pathname, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'POST',
      path: pathname,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-user-id': 'smoke-release-evidence',
        'x-permissions': 'system.admin',
        ...extraHeaders,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          json: JSON.parse(raw),
        });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function jsonGet(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'GET',
      path: pathname,
      headers: {
        'x-user-id': 'smoke-release-evidence',
        'x-permissions': 'system.admin',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          json: JSON.parse(raw),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildExecutePassStageReport() {
  return {
    requested_stage: 'D',
    requested_module: 'task-management',
    execution_mode: 'execute',
    status: 'pass',
    quality_gate_result: 'PASS',
    prerequisites: [],
    unmet_prerequisites: [],
    summary: 'All execute commands passed.',
    docs_ref: 'docs/how-to/run-stage-d.md',
    recommended_commands: ['npm run validate:requirements', 'npm run lint', 'npm run test:contract', 'npm test'],
    failed_command: '',
    failed_detail: '',
    failed_command_count: 0,
    executed_command_count: 4,
    operator_guidance: {
      current_state: 'execute 완료 및 품질 게이트 PASS입니다.',
      failure_location: '없음',
      failure_reason: '없음',
      next_action: 'release evidence를 확인하세요.',
      retryable: false,
      retryable_reason: '품질 게이트 PASS 상태입니다.',
      primary_action: 'advance-stage',
    },
  };
}

function loadCreateServerWithReleaseEvidence({ releaseEvidenceExitCode = 0, releaseEvidenceStderr = '' } = {}) {
  const originalSpawnSync = childProcess.spawnSync;
  const modulePath = require.resolve('../../server/createServer');

  childProcess.spawnSync = function patchedSpawnSync(command, args, options) {
    if (
      command === 'node'
      && Array.isArray(args)
      && args.some((item) => String(item || '').endsWith('scripts/run_stage.js'))
    ) {
      return {
        pid: 0,
        output: ['', JSON.stringify(buildExecutePassStageReport()), ''],
        stdout: JSON.stringify(buildExecutePassStageReport()),
        stderr: '',
        status: 0,
        signal: null,
        error: null,
      };
    }

    if (
      command === 'python3'
      && Array.isArray(args)
      && args.includes('save-stage-run')
      && args.some((item) => String(item || '').endsWith('scripts/planning_studio_api.py'))
    ) {
      return {
        pid: 0,
        output: ['', '{}', ''],
        stdout: '{}',
        stderr: '',
        status: 0,
        signal: null,
        error: null,
      };
    }

    if (
      command === 'python3'
      && Array.isArray(args)
      && args.some((item) => String(item || '').endsWith('scripts/generate_release_evidence.py'))
    ) {
      return {
        pid: 0,
        output: ['', '', releaseEvidenceStderr],
        stdout: '',
        stderr: releaseEvidenceStderr,
        status: releaseEvidenceExitCode,
        signal: null,
        error: null,
      };
    }

    return originalSpawnSync.call(childProcess, command, args, options);
  };

  delete require.cache[modulePath];

  try {
    return {
      serverModule: require('../../server/createServer'),
      restore() {
        childProcess.spawnSync = originalSpawnSync;
        delete require.cache[modulePath];
      },
    };
  } catch (error) {
    childProcess.spawnSync = originalSpawnSync;
    delete require.cache[modulePath];
    throw error;
  }
}

test('[stage run release evidence smoke] execute PASS auto-generates release evidence once and replays idempotently', async (t) => {
  const baselineGenerated = metrics.stageRunReleaseEvidenceGeneratedTotal.value;
  const baselineFailures = metrics.stageRunReleaseEvidenceFailuresTotal.value;
  const harness = loadCreateServerWithReleaseEvidence({ releaseEvidenceExitCode: 0, releaseEvidenceStderr: '' });
  let handle = null;

  try {
    handle = await startServerOrSkip(t, harness.serverModule.startServer, {
      port: 0,
      flags: harness.serverModule.createAllEnabledFlags(),
    });
    if (!handle) {
      return;
    }

    const idemKey = `stage-run-release-evidence-${Date.now()}`;
    const response = await jsonPost(handle.port, '/api/planning-studio/stage-run', {
      stage: 'D',
      module: 'task-management',
      execute: true,
    }, {
      'idempotency-key': idemKey,
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers['x-stage-run-report-saved'], 'true');
    assert.equal(response.json.data.runtime_observability.report_saved, true);
    assert.equal(response.json.data.runtime_observability.release_evidence.triggered, true);
    assert.equal(response.json.data.runtime_observability.release_evidence.generated, true);
    assert.equal(response.json.data.runtime_observability.release_evidence.exit_code, 0);
    assert.equal(response.json.data.runtime_observability.release_evidence.error, null);
    assert.equal(response.json.data.runtime_observability.release_evidence.path, 'artifacts/release-evidence/release-evidence.json');
    assert.equal(response.json.data.runtime_observability.release_evidence.command, 'python3 scripts/generate_release_evidence.py');
    assert.equal(response.json.data.runtime_observability.release_evidence.trigger_reason, 'execute-pass');

    const snapshot = await jsonGet(handle.port, '/api/planning-studio/snapshot');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.json.ok, true);
    assert.equal(snapshot.json.data.stage_run_contract.drift_status, 'clean');
    assert.equal(snapshot.json.data.stage_run_contract.latest_history_head_match, true);
    assert.equal(snapshot.json.data.stage_run_contract.release_evidence_surface_complete, true);
    assert.equal(snapshot.json.data.stage_run_contract.release_evidence_generated, true);
    assert.equal(snapshot.json.data.stage_run_contract.release_evidence_trigger_reason, 'execute-pass');
    assert.equal(snapshot.json.data.stage_run_last_report.runtime_observability.release_evidence.generated, true);
    assert.equal(snapshot.json.data.stage_run_recent_reports[0].runtime_observability.release_evidence.generated, true);
    assert.equal(snapshot.json.data.stage_run_recent_reports[0].runtime_observability.release_evidence.command, 'python3 scripts/generate_release_evidence.py');

    const replayed = await jsonPost(handle.port, '/api/planning-studio/stage-run', {
      stage: 'D',
      module: 'task-management',
      execute: true,
    }, {
      'idempotency-key': idemKey,
    });

    assert.equal(replayed.status, 200);
    assert.equal(replayed.headers['idempotency-replayed'], 'true');
    assert.deepEqual(replayed.json, response.json);
    assert.equal(metrics.stageRunReleaseEvidenceGeneratedTotal.value - baselineGenerated, 1);
    assert.equal(metrics.stageRunReleaseEvidenceFailuresTotal.value - baselineFailures, 0);
  } finally {
    if (handle) {
      await handle.shutdown();
    }
    harness.restore();
  }
});

test('[stage run release evidence smoke] execute PASS keeps stage-run success even when release evidence generation fails', async (t) => {
  const baselineGenerated = metrics.stageRunReleaseEvidenceGeneratedTotal.value;
  const baselineFailures = metrics.stageRunReleaseEvidenceFailuresTotal.value;
  const harness = loadCreateServerWithReleaseEvidence({
    releaseEvidenceExitCode: 17,
    releaseEvidenceStderr: 'simulated release evidence failure',
  });
  let handle = null;

  try {
    handle = await startServerOrSkip(t, harness.serverModule.startServer, {
      port: 0,
      flags: harness.serverModule.createAllEnabledFlags(),
    });
    if (!handle) {
      return;
    }

    const response = await jsonPost(handle.port, '/api/planning-studio/stage-run', {
      stage: 'D',
      module: 'task-management',
      execute: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers['x-stage-run-report-saved'], 'true');
    assert.equal(response.json.data.runtime_observability.report_saved, true);
    assert.equal(response.json.data.runtime_observability.release_evidence.triggered, true);
    assert.equal(response.json.data.runtime_observability.release_evidence.generated, false);
    assert.equal(response.json.data.runtime_observability.release_evidence.exit_code, 17);
    assert.equal(response.json.data.runtime_observability.release_evidence.error, 'simulated release evidence failure');
    assert.equal(response.json.data.runtime_observability.release_evidence.trigger_reason, 'execute-pass');
    const snapshot = await jsonGet(handle.port, '/api/planning-studio/snapshot');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.json.data.stage_run_contract.drift_status, 'clean');
    assert.equal(snapshot.json.data.stage_run_contract.release_evidence_surface_complete, true);
    assert.equal(snapshot.json.data.stage_run_contract.release_evidence_generated, false);
    assert.equal(snapshot.json.data.stage_run_last_report.runtime_observability.release_evidence.error, 'simulated release evidence failure');
    assert.equal(metrics.stageRunReleaseEvidenceGeneratedTotal.value - baselineGenerated, 0);
    assert.equal(metrics.stageRunReleaseEvidenceFailuresTotal.value - baselineFailures, 1);
  } finally {
    if (handle) {
      await handle.shutdown();
    }
    harness.restore();
  }
});
