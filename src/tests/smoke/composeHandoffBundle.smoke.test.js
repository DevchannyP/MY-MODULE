'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[handoff bundle] context, fit, and replay are composed into one artifact', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/compose_handoff_bundle.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.goal, 'plan-and-learn');
  assert.equal(typeof report.intake_packet.goal, 'string');
  assert.ok(Array.isArray(report.intake_packet.context));
  assert.ok(Array.isArray(report.intake_packet.constraints));
  assert.ok(Array.isArray(report.intake_packet.done_when));
  assert.ok(Array.isArray(report.intake_packet.work_mode));
  assert.ok(Array.isArray(report.intake_packet.verification));
  assert.equal(typeof report.current_packet.id, 'string');
  assert.ok(Array.isArray(report.scope.scope_in));
  assert.ok(Array.isArray(report.scope.scope_out));
  assert.equal(typeof report.context_bundle.profile_id, 'string');
  assert.equal(report.context_bundle.read_later_policy.default, 'excluded_from_active_context');
  assert.equal(typeof report.context_bundle.budget_risk.status, 'string');
  assert.equal(typeof report.fit_report.counts.pass, 'number');
  assert.equal(report.fit_report.read_later_policy.default, 'excluded_from_active_context');
  assert.equal(typeof report.validation_profile.packet_type, 'string');
  assert.ok(Array.isArray(report.validation_profile.required));
  assert.ok(report.validation_profile.required.length >= 1);
  assert.deepEqual(
    report.validation_profile.required.map((entry) => entry.command),
    report.validation_profile.commands,
  );
  assert.ok(report.validation_profile.required.every((entry) => entry.pass_criteria === 'exit code 0'));
  assert.equal(report.validation_profile.handoff_contract.schema_version, '1');
  assert.ok(report.validation_profile.handoff_contract.required_fields.includes('source_breakdown'));
  assert.equal(typeof report.rollback_plan, 'string');
  assert.equal(typeof report.next_action.replay_goal, 'string');
  assert.doesNotMatch(report.next_action.replay_goal, /actor\?/);
  assert.equal(typeof report.replay_next_packet.goal, 'string');
  assert.doesNotMatch(report.replay_next_packet.goal, /actor\?/);
  assert.ok(Array.isArray(report.sequence));
});
