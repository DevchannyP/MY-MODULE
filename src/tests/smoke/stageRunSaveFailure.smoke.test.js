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
        'x-user-id': 'smoke-save-failure',
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

function loadCreateServerWithSaveFailure(stderrText = 'simulated save-stage-run failure', exitCode = 23) {
  const originalSpawnSync = childProcess.spawnSync;
  const modulePath = require.resolve('../../server/createServer');

  childProcess.spawnSync = function patchedSpawnSync(command, args, options) {
    if (
      command === 'python3'
      && Array.isArray(args)
      && args.includes('save-stage-run')
      && args.some((item) => String(item || '').endsWith('scripts/planning_studio_api.py'))
    ) {
      return {
        pid: 0,
        output: ['', '', stderrText],
        stdout: '',
        stderr: stderrText,
        status: exitCode,
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

test('[stage run save failure smoke] stage-run responds with runtime observability when report persistence fails', async (t) => {
  const baselineSaved = metrics.stageRunReportSavedTotal.value;
  const baselineFailures = metrics.stageRunReportSaveFailuresTotal.value;
  const harness = loadCreateServerWithSaveFailure();
  let handle = null;

  try {
    handle = await startServerOrSkip(t, harness.serverModule.startServer, {
      port: 0,
      flags: harness.serverModule.createAllEnabledFlags(),
    });
    if (!handle) {
      return;
    }

    const idemKey = `stage-run-save-failure-${Date.now()}`;
    const requestBody = {
      stage: 'D',
      module: 'task-management',
    };
    const response = await jsonPost(handle.port, '/api/planning-studio/stage-run', requestBody, {
      'idempotency-key': idemKey,
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.data.requested_stage, 'D');
    assert.equal(response.headers['x-stage-run-report-saved'], 'false');
    assert.ok(response.json.data.operator_guidance);
    assert.ok(response.json.data.runtime_observability);
    assert.equal(response.json.data.runtime_observability.report_saved, false);
    assert.equal(response.json.data.runtime_observability.save_exit_code, 23);
    assert.equal(response.json.data.runtime_observability.save_error, 'simulated save-stage-run failure');
    assert.equal(typeof response.json.data.runtime_observability.request_id, 'string');
    assert.equal(typeof response.json.data.runtime_observability.correlation_id, 'string');
    assert.equal(response.json.data.runtime_observability.artifact_paths.last_report, 'memory/project/stage-run-latest.yaml');
    assert.equal(response.json.data.runtime_observability.artifact_paths.recent_reports, 'memory/project/stage-run-history.yaml');
    assert.equal(response.json.data.runtime_observability.artifact_target_count, 2);
    assert.equal(response.json.data.runtime_observability.save_command, 'python3 scripts/planning_studio_api.py save-stage-run');

    const replayed = await jsonPost(handle.port, '/api/planning-studio/stage-run', requestBody, {
      'idempotency-key': idemKey,
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.headers['idempotency-replayed'], 'true');
    assert.equal(replayed.headers['x-stage-run-report-saved'], 'false');
    assert.deepEqual(replayed.json, response.json);

    assert.equal(metrics.stageRunReportSavedTotal.value - baselineSaved, 0);
    assert.equal(metrics.stageRunReportSaveFailuresTotal.value - baselineFailures, 1);
  } finally {
    if (handle) {
      await handle.shutdown();
    }
    harness.restore();
  }
});
