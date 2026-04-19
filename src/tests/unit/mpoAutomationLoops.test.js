'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { recordFailurePattern } = require('../../../scripts/check-failure-patterns');
const { updateRoutingLearningSnapshot, createMpoPipeline } = require('../../../scripts/mpo-pipeline');
const { ContractValidator } = require('../../infrastructure/mpo/ContractValidator');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function copyRecursive(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

function createTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mpo-auto-'));
  fs.mkdirSync(path.join(root, 'memory/L0-hot'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/adr'), { recursive: true });
  fs.mkdirSync(path.join(root, 'artifacts/evals/harness/latest'), { recursive: true });
  fs.writeFileSync(path.join(root, 'memory/wp-queue.yaml'), [
    'schema_version: "2"',
    'queue_date: "2026-04-19"',
    'epic: "test"',
    'capabilities: []',
    '',
  ].join('\n'), 'utf8');
  return root;
}

function createRuntimeRoot() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpo-auto-runtime-'));
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

test('[mpo automation] failure escalation inserts remediation wp into queue on third failure', () => {
  const root = createTempRoot();
  const validator = new ContractValidator({ root });

  recordFailurePattern({ rootCauseCategory: 'truthfulness-gate', message: 'first', wpId: 'WP-1', sessionId: 'S-1' }, { root, validator });
  recordFailurePattern({ rootCauseCategory: 'truthfulness-gate', message: 'second', wpId: 'WP-2', sessionId: 'S-2' }, { root, validator });
  const third = recordFailurePattern({ rootCauseCategory: 'truthfulness-gate', message: 'third', wpId: 'WP-3', sessionId: 'S-3' }, { root, validator });

  assert.ok(third.remediation, 'third failure should generate remediation');
  assert.equal(third.remediation.queue_update.inserted, true);
  const queueText = fs.readFileSync(path.join(root, 'memory/wp-queue.yaml'), 'utf8');
  assert.match(queueText, /CAP-MPO-AUTO/);
  assert.match(queueText, /WP-REM-TRUTHFULNESS/);
  assert.ok(fs.existsSync(path.join(root, third.remediation.adr_draft)));
});

test('[mpo automation] routing learning snapshot summarizes invocation log', () => {
  const root = createTempRoot();
  const logPath = path.join(root, 'artifacts/evals/harness/invocation-log.jsonl');
  fs.writeFileSync(logPath, [
    JSON.stringify({ mode: 'Build', selected_model_tier: 'mini' }),
    JSON.stringify({ mode: 'Build', selected_model_tier: 'mini' }),
    JSON.stringify({ mode: 'Debug', selected_model_tier: 'standard' }),
  ].join('\n') + '\n', 'utf8');

  const snapshot = updateRoutingLearningSnapshot(root, 'mpo-session-test', {
    packet_type: 'feature',
    risk_level: 'medium',
  });

  assert.equal(snapshot.latest_session_id, 'mpo-session-test');
  assert.equal(snapshot.routing_learning[0].mode, 'Build');
  assert.equal(snapshot.routing_learning[0].tier, 'mini');
  assert.equal(snapshot.routing_learning[0].count, 2);
  assert.ok(fs.existsSync(path.join(root, 'artifacts/evals/harness/latest/mpo-routing-learning.json')));
});

test('[mpo automation] pipeline auto-replans after boundary violation and completes replanned packet', async () => {
  const root = createRuntimeRoot();
  const validator = new ContractValidator({ root });
  const events = [];
  let injectedFailure = false;
  const adapter = {
    async executeWorkPacket({ route = {}, sessionId = '', wp = {} } = {}) {
      if (!wp.execution_result || wp.execution_result.auto_replan !== true) {
        if (!injectedFailure) {
          injectedFailure = true;
          return {
            session_id: sessionId,
            wp_id: wp.id,
            changed_files: ['node_modules/blocked.js'],
            provider: {
              provider_id: 'test-provider',
              route_id: String(route.route_id || 'test-route'),
              selected_model_tier: String(route.selected_model_tier || 'mini'),
              reasoning_effort: String(route.reasoning_effort || 'medium'),
              fallback_applied: false,
              model: 'test-mini',
            },
          };
        }
        return {
          session_id: sessionId,
          wp_id: wp.id,
          changed_files: [],
          provider: {
            provider_id: 'test-provider',
            route_id: String(route.route_id || 'test-route'),
            selected_model_tier: String(route.selected_model_tier || 'mini'),
            reasoning_effort: String(route.reasoning_effort || 'medium'),
            fallback_applied: false,
            model: 'test-mini',
          },
        };
      }
      return {
        session_id: sessionId,
        wp_id: wp.id,
        changed_files: [],
        provider: {
          provider_id: 'test-provider',
          route_id: String(route.route_id || 'test-route'),
          selected_model_tier: String(route.selected_model_tier || 'standard'),
          reasoning_effort: String(route.reasoning_effort || 'medium'),
          fallback_applied: false,
          model: 'test-standard',
        },
      };
    },
  };

  const pipeline = createMpoPipeline({
    root,
    validator,
    harnessProviderAdapter: adapter,
    emitEvent(type, payload) {
      events.push({ type, payload });
    },
  });

  const session = await pipeline.createPlan({
    goal: '문서 정리와 MPO dry-run 검증 경로를 확인해줘',
    approvalRequested: false,
  });
  const execution = await pipeline.execute(session);

  assert.equal(execution.replanned, true);
  assert.equal(execution.replanned_wp_ids.length, 1);
  assert.equal(execution.results.length, 5);
  assert.equal(execution.results[0].report.verification_status, 'FAIL');
  assert.deepEqual(execution.results[0].report.changed_files, ['node_modules/blocked.js']);
  assert.ok(execution.results.some((entry) => /-REPLAN$/.test(entry.wp.id)));
  assert.ok(session.dag.wp_list.some((wp) => /-REPLAN$/.test(wp.id)));
  assert.ok(session.dag.wp_list.find((wp) => wp.id === 'WP-AUTO-002').depends_on.includes(execution.replanned_wp_ids[0]));
  assert.ok(execution.results.some((entry) => entry.wp.id === 'WP-AUTO-004'));
  assert.equal(execution.results[execution.results.length - 1].wp.id, 'WP-AUTO-004');
  assert.ok(events.some((entry) => entry.type === 'mpo.plan.replanned'));
  assert.ok(fs.existsSync(path.join(root, execution.reconcile.report_path)));
});
