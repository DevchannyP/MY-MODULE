'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { resolveValidationProfile } = require('./resolve_validation_profile');
const { buildBranchBootstrapSummary } = require('./branch_bootstrap');

const ROOT = path.resolve(__dirname, '..');
const PROTECTED_BRANCHES = new Set(['main', 'develop']);

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return '';
  }
  return String(result.stdout || '').trim();
}

function collectGitState() {
  const lines = runGit(['status', '--short'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    dirty: lines.length > 0,
    dirty_count: lines.length,
    dirty_files: lines.slice(0, 12),
  };
}

function runShellCommand(command) {
  const result = spawnSync('bash', ['-lc', command], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    command,
    ok: result.status === 0,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function isProtectedBranch(branchName) {
  const normalized = String(branchName || '').trim();
  if (!normalized) {
    return false;
  }
  const head = normalized.split('...')[0];
  return PROTECTED_BRANCHES.has(head);
}

function splitCommitSubject(subject) {
  const raw = String(subject || '').trim();
  const matched = raw.match(/^([a-z]+)\(([^)]+)\):\s+(.+)$/i);
  if (matched) {
    return {
      type: matched[1],
      scope: matched[2],
      message: matched[3],
    };
  }
  return {
    type: 'chore',
    scope: 'core',
    message: raw || 'update current packet',
  };
}

function buildGuardConditions(branchSummary, gitState, verificationResults, mode) {
  const validationsPassed = verificationResults.every((item) => item.ok);
  const hasDirtyChanges = gitState.dirty === true;
  const protectedBranch = isProtectedBranch(branchSummary.current_branch);
  const canApply = (
    mode === 'apply'
    && validationsPassed
    && hasDirtyChanges
    && !protectedBranch
  );

  return {
    protected_branch: protectedBranch,
    has_dirty_changes: hasDirtyChanges,
    validations_passed: validationsPassed,
    can_apply: canApply,
    reasons: [
      protectedBranch ? 'protected branch에서는 apply 금지' : 'protected branch 아님',
      hasDirtyChanges ? '커밋할 변경 존재' : '커밋할 변경 없음',
      validationsPassed ? '검증 프로파일 PASS' : '검증 프로파일 FAIL',
    ],
  };
}

function buildAutoCommitGuardSummary({
  mode = 'dry-run',
  runner = runShellCommand,
} = {}) {
  const branchSummary = buildBranchBootstrapSummary();
  const gitState = collectGitState();
  const validationProfile = resolveValidationProfile(branchSummary.current_wp, {
    packetType: branchSummary.current_wp.type,
    stage: branchSummary.current_wp.stage,
  });
  const verificationResults = mode === 'dry-run'
    ? validationProfile.commands.map((command) => ({
      command,
      ok: null,
      exit_code: null,
      stdout: '',
      stderr: '',
    }))
    : validationProfile.commands.map((command) => runner(command));

  const guard = buildGuardConditions(branchSummary, gitState, verificationResults, mode);

  const commitParts = splitCommitSubject(branchSummary.commit_template.subject);

  return {
    as_of: new Date().toISOString(),
    mode,
    current_branch: branchSummary.current_branch,
    git: gitState,
    current_wp: branchSummary.current_wp,
    validation_profile: validationProfile,
    verification_results: verificationResults,
    commit_candidate: {
      branch: branchSummary.recommended_branch,
      subject: branchSummary.commit_template.subject,
      type: commitParts.type,
      scope: commitParts.scope,
      message: commitParts.message,
      body_required_fields: branchSummary.commit_template.body_required_fields,
      footer_required_fields: branchSummary.commit_template.footer_required_fields,
    },
    guard,
    next_action: guard.can_apply
      ? 'apply 가능'
      : mode === 'dry-run'
        ? 'verify 모드로 검증 실행'
        : '실패 원인 해소 후 재검증',
  };
}

function applyVerifiedCommit(summary, shellRunner = runShellCommand) {
  if (!summary.guard.can_apply) {
    return {
      ok: false,
      reason: 'guard blocked apply',
    };
  }

  const command = [
    'bash scripts/auto-commit.sh',
    summary.commit_candidate.type,
    summary.commit_candidate.scope,
    JSON.stringify(summary.commit_candidate.message),
  ].join(' ');

  const result = shellRunner(command);
  return {
    ok: result.ok,
    command,
    result,
  };
}

function printHuman(summary) {
  const lines = [
    '=== Verified Auto Commit Guard ===',
    `Mode         : ${summary.mode}`,
    `Branch       : ${summary.current_branch}`,
    `Current WP   : ${summary.current_wp.id} / ${summary.current_wp.type} / ${summary.current_wp.stage}`,
    `Commit       : ${summary.commit_candidate.subject}`,
    `Next Action  : ${summary.next_action}`,
    '',
    '[Guard]',
    ...summary.guard.reasons.map((item) => `- ${item}`),
    '',
    '[Validation Commands]',
    ...summary.validation_profile.commands.map((item) => `- ${item}`),
  ];

  if (summary.mode !== 'dry-run') {
    lines.push('', '[Verification Results]');
    summary.verification_results.forEach((item) => {
      lines.push(`- ${item.ok ? 'PASS' : 'FAIL'} ${item.command}`);
    });
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
  const asJson = process.argv.includes('--json');
  const verify = process.argv.includes('--verify');
  const apply = process.argv.includes('--apply');
  const mode = apply ? 'apply' : verify ? 'verify' : 'dry-run';
  const summary = buildAutoCommitGuardSummary({ mode });

  if (apply && summary.guard.can_apply) {
    const applyResult = applyVerifiedCommit(summary);
    summary.apply_result = applyResult;
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  printHuman(summary);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildAutoCommitGuardSummary,
  buildGuardConditions,
  applyVerifiedCommit,
  splitCommitSubject,
  isProtectedBranch,
};
