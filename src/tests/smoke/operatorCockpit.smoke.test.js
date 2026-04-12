'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildOperatorCockpitSummary } = require('../../../scripts/operator_cockpit');

test('[operator cockpit smoke] session, branch, and commit readiness collapse into one operator summary', async () => {
  const summary = buildOperatorCockpitSummary();

  assert.equal(summary.mode, 'operator-cockpit');
  assert.equal(typeof summary.current_wp.id, 'string');
  assert.equal(typeof summary.next_wp, 'string');
  assert.equal(typeof summary.git.branch, 'string');
  assert.ok(Array.isArray(summary.recommended_reads));
  assert.ok(summary.recommended_reads.includes('memory/current-wp.yaml'));
  assert.equal(typeof summary.branch.recommended_branch, 'string');
  assert.equal(typeof summary.branch.commit_template.subject, 'string');
  assert.equal(typeof summary.commit_guard.next_action, 'string');
  assert.ok(Array.isArray(summary.commit_guard.guard.reasons));
  assert.ok(Array.isArray(summary.commit_guard.validation_profile.commands));
  assert.ok(Array.isArray(summary.operator_actions));
  assert.ok(summary.operator_actions.includes('npm run operator:cockpit') === false);
  assert.ok(summary.operator_actions.includes('npm run commit:guard'));
});
