'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAutoCommitGuardSummary,
  buildGuardConditions,
  splitCommitSubject,
  isProtectedBranch,
} = require('../../../scripts/verified_auto_commit_guard');

test('[verified auto commit guard smoke] dry-run summary exposes commit candidate and validation bundle', async () => {
  const summary = buildAutoCommitGuardSummary({ mode: 'dry-run' });

  assert.equal(summary.mode, 'dry-run');
  assert.equal(typeof summary.current_branch, 'string');
  assert.equal(typeof summary.commit_candidate.subject, 'string');
  assert.equal(typeof summary.commit_candidate.type, 'string');
  assert.equal(typeof summary.commit_candidate.scope, 'string');
  assert.ok(Array.isArray(summary.validation_profile.commands));
  assert.ok(summary.validation_profile.commands.includes('npm run validate:requirements'));
  assert.ok(Array.isArray(summary.guard.reasons));
  assert.equal(summary.next_action, 'verify 모드로 검증 실행');
});

test('[verified auto commit guard smoke] guard blocks protected branches and failed validation', async () => {
  const blocked = buildGuardConditions(
    { current_branch: 'main' },
    { dirty: true },
    [{ ok: false }],
    'apply',
  );

  assert.equal(blocked.protected_branch, true);
  assert.equal(blocked.has_dirty_changes, true);
  assert.equal(blocked.validations_passed, false);
  assert.equal(blocked.can_apply, false);
  assert.equal(isProtectedBranch('develop'), true);
  assert.equal(isProtectedBranch('feature/core-sample'), false);

  const parts = splitCommitSubject('fix(core): align harness guard');
  assert.equal(parts.type, 'fix');
  assert.equal(parts.scope, 'core');
  assert.equal(parts.message, 'align harness guard');
});
