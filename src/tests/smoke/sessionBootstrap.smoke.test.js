'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildBootstrapSummary } = require('../../../scripts/session_bootstrap');

test('[session bootstrap smoke] bootstrap summary narrows session reads, commands, and prompt seed', async () => {
  const summary = buildBootstrapSummary();

  assert.equal(summary.bootstrap_mode, 'harness-operator');
  assert.equal(summary.harness_contract_path, 'requirements/harness-engineering.yaml');
  assert.equal(summary.harness_plan_path, 'docs/explanation/ai-harness-upgrade-plan.md');
  assert.equal(summary.prompt_seed_path, 'docs/how-to/repeatable-cli-master-prompt.md');
  assert.equal(typeof summary.current_wp.id, 'string');
  assert.equal(typeof summary.current_wp.goal, 'string');
  assert.equal(typeof summary.current_wp.stage, 'string');
  assert.equal(typeof summary.next_wp, 'string');
  assert.ok(Array.isArray(summary.intake_packet_fields));
  assert.deepEqual(summary.intake_packet_fields, ['goal', 'context', 'constraints', 'done_when', 'work_mode', 'verification']);
  assert.ok(Array.isArray(summary.recommended_reads));
  assert.ok(summary.recommended_reads.includes('memory/current-state.yaml'));
  assert.ok(summary.recommended_reads.includes('memory/current-wp.yaml'));
  assert.ok(summary.recommended_reads.includes('memory/wp-queue.yaml'));
  assert.ok(summary.recommended_reads.includes('requirements/harness-engineering.yaml'));
  assert.ok(Array.isArray(summary.recommended_commands));
  assert.ok(summary.recommended_commands.includes('npm run session:bootstrap'));
  assert.ok(summary.recommended_commands.includes('npm run project:status'));
  assert.ok(summary.recommended_commands.includes('npm run wp:next'));
  assert.ok(summary.recommended_commands.includes('npm run wp:reconcile'));
  assert.equal(typeof summary.validation_profile.packet_type, 'string');
  assert.ok(Array.isArray(summary.validation_profile.commands));
  assert.ok(summary.validation_profile.commands.includes('npm run validate:requirements'));
  assert.ok(Array.isArray(summary.operator_focus));
  assert.ok(summary.operator_focus.length >= 3);
  assert.equal(typeof summary.git.branch, 'string');
  assert.equal(typeof summary.git.dirty, 'boolean');
});
