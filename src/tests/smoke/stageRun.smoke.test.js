'use strict';

const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');
const { runStage } = require('../../../scripts/run_stage');

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
        'x-user-id': 'smoke',
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

test('[stage run smoke] POST /api/planning-studio/stage-run returns dry-run report and replays idempotently', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  try {
    const idemKey = `stage-run-idem-${Date.now()}`;
    const requestBody = { stage: 'D', module: 'task-management' };

    const first = await jsonPost(handle.port, '/api/planning-studio/stage-run', requestBody, {
      'idempotency-key': idemKey,
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.ok, true);
    assert.equal(first.json.data.requested_stage, 'D');
    assert.equal(first.json.data.execution_mode, 'dry-run-only');
    assert.ok(
      ['ready', 'blocked', 'out-of-route'].includes(first.json.data.status),
      `unexpected status: ${first.json.data.status}`,
    );
    assert.ok(Array.isArray(first.json.data.prerequisites));
    assert.ok(Array.isArray(first.json.data.unmet_prerequisites));
    assert.equal(typeof first.json.data.summary, 'string');
    assert.ok(first.json.data.summary.length > 0);
    assert.ok(Array.isArray(first.json.data.recommended_commands));
    assert.ok(first.json.data.recommended_commands.length >= 4);
    assert.equal(typeof first.json.data.failed_command, 'string');
    assert.equal(typeof first.json.data.failed_detail, 'string');
    assert.ok(first.json.data.operator_guidance);
    assert.equal(typeof first.json.data.operator_guidance.current_state, 'string');
    assert.equal(typeof first.json.data.operator_guidance.failure_location, 'string');
    assert.equal(typeof first.json.data.operator_guidance.failure_reason, 'string');
    assert.equal(typeof first.json.data.operator_guidance.next_action, 'string');
    assert.equal(typeof first.json.data.operator_guidance.retryable, 'boolean');
    assert.equal(typeof first.json.data.operator_guidance.retryable_reason, 'string');
    assert.equal(first.headers['x-stage-run-report-saved'], 'true');
    assert.ok(first.json.data.runtime_observability);
    assert.equal(first.json.data.runtime_observability.report_saved, true);
    assert.equal(typeof first.json.data.runtime_observability.request_id, 'string');
    assert.equal(typeof first.json.data.runtime_observability.correlation_id, 'string');
    assert.equal(first.json.data.runtime_observability.save_error, null);
    assert.equal(first.json.data.runtime_observability.artifact_paths.last_report, 'memory/project/stage-run-latest.yaml');
    assert.equal(first.json.data.runtime_observability.artifact_paths.recent_reports, 'memory/project/stage-run-history.yaml');
    assert.equal(first.json.data.runtime_observability.artifact_target_count, 2);
    assert.equal(first.json.data.runtime_observability.save_command, 'python3 scripts/planning_studio_api.py save-stage-run');

    const second = await jsonPost(handle.port, '/api/planning-studio/stage-run', requestBody, {
      'idempotency-key': idemKey,
    });
    assert.equal(second.status, 200);
    assert.equal(second.headers['idempotency-replayed'], 'true');
    assert.equal(second.headers['x-stage-run-report-saved'], 'true');
    assert.deepEqual(second.json, first.json);

    const snapshotResponse = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: handle.port,
        method: 'GET',
        path: '/api/planning-studio/snapshot',
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotResponse.json.ok, true);
    assert.equal(snapshotResponse.json.data.stage_run_artifacts.last_report, 'memory/project/stage-run-latest.yaml');
    assert.equal(snapshotResponse.json.data.stage_run_artifacts.recent_reports, 'memory/project/stage-run-history.yaml');
    assert.equal(snapshotResponse.json.data.stage_run_artifacts.history_limit, 5);
    assert.equal(snapshotResponse.json.data.stage_run_artifacts.save_command, 'python3 scripts/planning_studio_api.py save-stage-run');
    assert.equal(snapshotResponse.json.data.stage_run_contract.drift_status, 'clean');
    assert.equal(snapshotResponse.json.data.stage_run_contract.latest_history_head_match, true);
    assert.equal(snapshotResponse.json.data.stage_run_contract.release_evidence_surface_complete, true);
    assert.equal(snapshotResponse.json.data.stage_run_contract.release_evidence_generated, false);
    assert.equal(snapshotResponse.json.data.stage_run_contract.release_evidence_trigger_reason, 'dry-run-only');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.requested_stage, 'D');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.requested_module, 'task-management');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.status, first.json.data.status);
    assert.equal(snapshotResponse.json.data.stage_run_last_report.execution_mode, 'dry-run-only');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.quality_gate_result, 'DRY_RUN_ONLY');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.quality_gate_result_reported, '');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.quality_gate_source, 'dry-run-only');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.quality_gate_ready_for_release_evidence, false);
    assert.equal(typeof snapshotResponse.json.data.stage_run_last_report.summary, 'string');
    assert.ok(snapshotResponse.json.data.stage_run_last_report.summary.length > 0, 'summary must be non-empty after save');
    assert.equal(typeof snapshotResponse.json.data.stage_run_last_report.recorded_at, 'string');
    assert.equal(typeof snapshotResponse.json.data.stage_run_last_report.operator_guidance.current_state, 'string');
    assert.equal(typeof snapshotResponse.json.data.stage_run_last_report.operator_guidance.next_action, 'string');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.runtime_observability.report_saved, true);
    assert.equal(snapshotResponse.json.data.stage_run_last_report.runtime_observability.artifact_paths.last_report, 'memory/project/stage-run-latest.yaml');
    assert.equal(snapshotResponse.json.data.stage_run_last_report.runtime_observability.release_evidence.triggered, false);
    assert.equal(snapshotResponse.json.data.stage_run_last_report.runtime_observability.release_evidence.generated, false);
    assert.equal(snapshotResponse.json.data.stage_run_last_report.runtime_observability.release_evidence.trigger_reason, 'dry-run-only');
    assert.ok(Array.isArray(snapshotResponse.json.data.stage_run_recent_reports));
    assert.ok(snapshotResponse.json.data.stage_run_recent_reports.length >= 1);
    assert.equal(snapshotResponse.json.data.stage_run_recent_reports[0].requested_stage, 'D');
    assert.equal(snapshotResponse.json.data.stage_run_recent_reports[0].requested_module, 'task-management');
    assert.equal(typeof snapshotResponse.json.data.stage_run_recent_reports[0].operator_guidance.failure_reason, 'string');
    assert.equal(snapshotResponse.json.data.stage_run_recent_reports[0].runtime_observability.report_saved, true);
    assert.equal(snapshotResponse.json.data.stage_run_recent_reports[0].runtime_observability.artifact_paths.recent_reports, 'memory/project/stage-run-history.yaml');
    assert.equal(snapshotResponse.json.data.stage_run_recent_reports[0].runtime_observability.release_evidence.trigger_reason, 'dry-run-only');
    assert.equal(
      snapshotResponse.json.data.stage_run_recent_reports[0].recorded_at,
      snapshotResponse.json.data.stage_run_last_report.recorded_at,
    );
    assert.equal(snapshotResponse.json.data.stage_run_quality_gate.result, 'DRY_RUN_ONLY');
    assert.equal(snapshotResponse.json.data.stage_run_quality_gate.reported_result, '');
    assert.equal(snapshotResponse.json.data.stage_run_quality_gate.source, 'dry-run-only');
    assert.equal(snapshotResponse.json.data.stage_run_quality_gate.execution_mode, 'dry-run-only');
    assert.equal(snapshotResponse.json.data.stage_run_quality_gate.ready_for_release_evidence, false);
    assert.equal(snapshotResponse.json.data.stage_run_quality_gate.blocker, 'dry-run-only');
  } finally {
    await handle.shutdown();
  }
});

test('[stage run smoke] runStage execute mode returns PASS and FAIL reports from command outcomes', () => {
  const passReport = runStage('D', {
    moduleId: 'task-management',
    dryRun: false,
    runner(command) {
      return {
        command,
        ok: true,
        exit_code: 0,
        signal: null,
        stdout: 'ok',
        stderr: '',
      };
    },
  });

  assert.equal(passReport.execution_mode, 'execute');
  assert.equal(passReport.quality_gate_result, 'PASS');
  assert.equal(passReport.status, 'pass');
  assert.equal(passReport.failed_command_count, 0);
  assert.equal(passReport.executed_command_count, passReport.recommended_commands.length);
  assert.equal(passReport.failed_command, '');
  assert.equal(passReport.failed_detail, '');
  assert.equal(passReport.operator_guidance.current_state, 'execute 완료 및 품질 게이트 PASS입니다.');
  assert.equal(passReport.operator_guidance.failure_reason, '없음');
  assert.equal(passReport.operator_guidance.primary_action, 'advance-stage');

  let seenCount = 0;
  const failReport = runStage('D', {
    moduleId: 'task-management',
    dryRun: false,
    runner(command) {
      seenCount += 1;
      if (seenCount === 2) {
        return {
          command,
          ok: false,
          exit_code: 1,
          signal: null,
          stdout: '',
          stderr: 'lint failed',
        };
      }
      return {
        command,
        ok: true,
        exit_code: 0,
        signal: null,
        stdout: 'ok',
        stderr: '',
      };
    },
  });

  assert.equal(failReport.execution_mode, 'execute');
  assert.equal(failReport.quality_gate_result, 'FAIL');
  assert.equal(failReport.status, 'fail');
  assert.equal(failReport.failed_command_count, 1);
  assert.equal(failReport.executed_command_count, 2);
  assert.equal(failReport.command_results[1].stderr, 'lint failed');
  assert.equal(failReport.failed_command, 'npm run lint');
  assert.equal(failReport.failed_detail, 'lint failed');
  assert.match(failReport.operator_guidance.failure_location, /npm run lint/);
  assert.equal(failReport.operator_guidance.failure_reason, 'lint failed');
  assert.equal(failReport.operator_guidance.primary_action, 'fix-command');
  assert.equal(failReport.operator_guidance.retryable, true);
});

test('[stage run smoke] POST /api/planning-studio/stage-run returns RFC 7807 400 on invalid stage name', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  try {
    const res = await jsonPost(handle.port, '/api/planning-studio/stage-run', { stage: 'Z' });
    assert.equal(res.status, 400);
    assert.equal(res.json.status, 400);
    assert.ok(
      typeof res.json.type === 'string' && res.json.type.includes('validation-error'),
      `type should include validation-error, got: ${res.json.type}`,
    );
    assert.equal(typeof res.json.title, 'string');
    assert.equal(typeof res.json.detail, 'string');
    assert.match(res.json.detail, /A.*B.*C.*D.*E|stage/i);
  } finally {
    await handle.shutdown();
  }
});

test('[stage run smoke] POST /api/planning-studio/stage-run returns RFC 7807 400 on invalid module pattern', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  try {
    const res = await jsonPost(handle.port, '/api/planning-studio/stage-run', {
      stage: 'A',
      module: 'INVALID MODULE!',
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.status, 400);
    assert.ok(
      typeof res.json.type === 'string' && res.json.type.includes('validation-error'),
      `type should include validation-error, got: ${res.json.type}`,
    );
    assert.equal(typeof res.json.title, 'string');
    assert.equal(typeof res.json.detail, 'string');
    assert.match(res.json.detail, /module/i);
  } finally {
    await handle.shutdown();
  }
});

test('[stage run smoke] POST /api/planning-studio/stage-run execute mode returns RFC 7807 403 without system.admin', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  try {
    // execute: true 요청을 system.admin 없이 보내면 403
    const res = await jsonPost(handle.port, '/api/planning-studio/stage-run', { stage: 'D', execute: true }, {
      'x-user-id': 'non-admin',
      'x-permissions': 'read',
    });
    assert.equal(res.status, 403, `expected 403 but got ${res.status}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.status, 403);
    assert.ok(
      typeof res.json.type === 'string' && res.json.type.includes('forbidden'),
      `type should include forbidden, got: ${res.json.type}`,
    );
    assert.equal(typeof res.json.detail, 'string');
    assert.match(res.json.detail, /system\.admin/i);

    // dry-run 은 system.admin 없이도 허용
    const dryRun = await jsonPost(handle.port, '/api/planning-studio/stage-run', { stage: 'D' }, {
      'x-user-id': 'non-admin',
      'x-permissions': 'read',
    });
    assert.equal(dryRun.status, 200, `dry-run should succeed without system.admin, got ${dryRun.status}`);
    assert.equal(dryRun.json.ok, true);
    assert.equal(dryRun.json.data.execution_mode, 'dry-run-only');
  } finally {
    await handle.shutdown();
  }
});
