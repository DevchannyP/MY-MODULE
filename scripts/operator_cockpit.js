'use strict';

const { buildBootstrapSummary } = require('./session_bootstrap');
const { buildBranchBootstrapSummary } = require('./branch_bootstrap');
const { buildAutoCommitGuardSummary } = require('./verified_auto_commit_guard');

function buildOperatorCockpitSummary() {
  const bootstrap = buildBootstrapSummary();
  const branch = buildBranchBootstrapSummary();
  const commitGuard = buildAutoCommitGuardSummary({ mode: 'dry-run' });

  return {
    as_of: new Date().toISOString(),
    mode: 'operator-cockpit',
    current_wp: bootstrap.current_wp,
    next_wp: bootstrap.next_wp,
    requirements_stage: bootstrap.requirements_stage,
    git: bootstrap.git,
    intake_packet_fields: bootstrap.intake_packet_fields,
    recommended_reads: bootstrap.recommended_reads,
    validation_profile: bootstrap.validation_profile,
    branch,
    commit_guard: {
      next_action: commitGuard.next_action,
      guard: commitGuard.guard,
      commit_candidate: commitGuard.commit_candidate,
      validation_profile: commitGuard.validation_profile,
    },
    operator_actions: [
      'npm run session:bootstrap',
      'npm run branch:bootstrap',
      'npm run commit:guard',
      'npm run commit:guard:verify',
    ],
  };
}

function printHuman(summary) {
  const lines = [
    '=== Operator Cockpit ===',
    `Current WP   : ${summary.current_wp.id} / ${summary.current_wp.stage} / ${summary.current_wp.type}`,
    `Goal         : ${summary.current_wp.goal}`,
    `Next WP      : ${summary.next_wp}`,
    `Branch       : ${summary.git.branch}`,
    `Dirty        : ${summary.git.dirty ? `yes (${summary.git.dirty_count})` : 'no'}`,
    '',
    '[Read First]',
    ...summary.recommended_reads.map((item) => `- ${item}`),
    '',
    '[Validation Profile]',
    `- ${summary.validation_profile.packet_type} / ${summary.validation_profile.stage || 'UNKNOWN'}`,
    ...summary.validation_profile.commands.map((item) => `- ${item}`),
    '',
    '[Branch]',
    `- ${summary.branch.recommended_branch}`,
    `- ${summary.branch.create_command}`,
    `- ${summary.branch.commit_template.subject}`,
    '',
    '[Commit Guard]',
    ...summary.commit_guard.guard.reasons.map((item) => `- ${item}`),
    `- next: ${summary.commit_guard.next_action}`,
    '',
    '[Operator Actions]',
    ...summary.operator_actions.map((item) => `- ${item}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
  const asJson = process.argv.includes('--json');
  const summary = buildOperatorCockpitSummary();
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
  buildOperatorCockpitSummary,
};
