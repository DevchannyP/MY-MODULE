'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildOperatorCockpitSummary } = require('../../../scripts/operator_cockpit');

test('[operator cockpit smoke] session, branch, and commit readiness collapse into one operator summary', async () => {
  const summary = buildOperatorCockpitSummary();

  assert.equal(summary.mode, 'operator-cockpit');
  assert.equal(typeof summary.current_wp.id, 'string');
  assert.equal(typeof summary.next_wp, 'string');
  assert.equal(typeof summary.current_lane.label, 'string');
  assert.equal(typeof summary.git.branch, 'string');
  assert.equal(typeof summary.intake_packet.goal, 'string');
  assert.ok(Array.isArray(summary.intake_packet.context));
  assert.ok(Array.isArray(summary.intake_packet.constraints));
  assert.ok(Array.isArray(summary.intake_packet.done_when));
  assert.ok(Array.isArray(summary.intake_packet.work_mode));
  assert.ok(Array.isArray(summary.intake_packet.verification));
  assert.ok(Array.isArray(summary.recommended_reads));
  assert.ok(summary.recommended_reads.includes('memory/current-wp.yaml'));
  assert.equal(typeof summary.branch.recommended_branch, 'string');
  assert.equal(typeof summary.branch.commit_template.subject, 'string');
  assert.equal(typeof summary.promotion_evidence.path, 'string');
  assert.equal(typeof summary.promotion_evidence.exists, 'boolean');
  assert.equal(typeof summary.commit_guard.next_action, 'string');
  assert.equal(typeof summary.commit_guard.status, 'string');
  assert.equal(typeof summary.next_validation_command, 'string');
  assert.equal(typeof summary.validation_bundle_size, 'number');
  assert.ok(Array.isArray(summary.operator_chain));
  assert.ok(summary.operator_chain.length >= 5);
  assert.equal(summary.operator_chain[0].id, 'bootstrap');
  assert.ok(Array.isArray(summary.commit_guard.guard.reasons));
  assert.ok(Array.isArray(summary.commit_guard.validation_profile.commands));
  assert.equal(typeof summary.handoff_summary.current_wp, 'string');
  assert.equal(typeof summary.handoff_summary.next_wp, 'string');
  assert.equal(typeof summary.handoff_summary.drift_status, 'string');
  assert.equal(typeof summary.handoff_summary.validation_state, 'string');
  assert.equal(typeof summary.handoff_summary.evidence_state, 'string');
  assert.equal(typeof summary.handoff_summary.next_command, 'string');
  assert.ok(Array.isArray(summary.operator_actions));
  assert.ok(summary.operator_actions.includes('npm run operator:cockpit') === false);
  assert.ok(summary.operator_actions.includes('npm run commit:guard'));
});
