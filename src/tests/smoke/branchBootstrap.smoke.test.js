'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildBranchBootstrapSummary } = require('../../../scripts/branch_bootstrap');

test('[branch bootstrap smoke] current packet maps to a branch recommendation and commit template', async () => {
  const summary = buildBranchBootstrapSummary();

  assert.equal(typeof summary.current_branch, 'string');
  assert.equal(typeof summary.current_wp.id, 'string');
  assert.equal(typeof summary.current_wp.goal, 'string');
  assert.equal(typeof summary.recommended_branch, 'string');
  assert.match(summary.recommended_branch, /^(feature|fix|docs|chore)\/core-/);
  assert.equal(typeof summary.create_command, 'string');
  assert.match(summary.create_command, /^git checkout -b /);
  assert.equal(typeof summary.commit_template.subject, 'string');
  assert.ok(summary.commit_template.subject.length > 10);
  assert.ok(Array.isArray(summary.commit_template.body_required_fields));
  assert.ok(Array.isArray(summary.commit_template.footer_required_fields));
});
