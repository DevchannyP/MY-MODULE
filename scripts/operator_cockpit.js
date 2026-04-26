'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildBootstrapSummary, buildHandoffSummary } = require('./session_bootstrap');
const { buildBranchBootstrapSummary } = require('./branch_bootstrap');
const { buildAutoCommitGuardSummary } = require('./verified_auto_commit_guard');
const { laneMeta } = require('./packet_flow');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_EVIDENCE_PATH = path.join(ROOT, 'artifacts', 'release-evidence', 'release-evidence.json');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function buildPromotionEvidenceSummary() {
  const evidence = readJsonIfExists(RELEASE_EVIDENCE_PATH);
  const artifactPaths = evidence.release_artifacts && typeof evidence.release_artifacts === 'object'
    ? evidence.release_artifacts
    : {};
  const artifactKeys = Object.keys(artifactPaths);

  return {
    path: 'artifacts/release-evidence/release-evidence.json',
    exists: fs.existsSync(RELEASE_EVIDENCE_PATH),
    quality_gate_result: String(evidence.quality_gate_result || 'UNKNOWN'),
    next_action: evidence.next_action && typeof evidence.next_action === 'object'
      ? {
        id: String(evidence.next_action.id || 'NONE'),
        action: String(evidence.next_action.action || 'NONE'),
      }
      : { id: 'NONE', action: 'NONE' },
    artifact_count: artifactKeys.length,
    generated_at_utc: String(evidence.generated_at_utc || ''),
  };
}

function buildOperatorActionChain({ bootstrap, branch, commitGuard, promotionEvidence }) {
  const chain = [];
  const currentBranch = String(branch.current_branch || '').trim();
  const recommendedBranch = String(branch.recommended_branch || '').trim();
  const sameBranch = Boolean(currentBranch && recommendedBranch && currentBranch === recommendedBranch);
  const validationCommands = Array.isArray(bootstrap.validation_profile?.commands)
    ? bootstrap.validation_profile.commands
    : [];

  chain.push({
    id: 'bootstrap',
    label: 'Session Bootstrap',
    status: 'ready',
    command: 'npm run session:bootstrap',
    reason: `${bootstrap.current_wp.id} / lane ${bootstrap.current_lane_hint}`,
  });

  chain.push({
    id: 'branch',
    label: 'Branch Bootstrap',
    status: sameBranch ? 'completed' : 'ready',
    command: branch.create_command,
    reason: sameBranch ? '권장 브랜치에 이미 위치함' : `권장 브랜치 ${recommendedBranch}`,
  });

  chain.push({
    id: 'verify',
    label: 'Validation Profile',
    status: commitGuard.guard.validations_passed ? 'completed' : 'pending',
    command: bootstrap.validation_profile.primary_command || validationCommands[0] || '',
    reason: `${validationCommands.length}개 검증 명령 / ${bootstrap.validation_profile.packet_type}`,
  });

  chain.push({
    id: 'commit-guard',
    label: 'Commit Guard',
    status: commitGuard.guard.can_apply ? 'ready' : 'blocked',
    command: commitGuard.guard.can_apply ? 'npm run commit:guard -- --apply' : 'npm run commit:guard:verify',
    reason: String(commitGuard.next_action || 'guard 상태 확인').trim(),
  });

  chain.push({
    id: 'release-evidence',
    label: 'Release Evidence',
    status: promotionEvidence.exists && promotionEvidence.quality_gate_result === 'PASS' ? 'ready' : 'pending',
    command: 'python3 scripts/generate_release_evidence.py',
    reason: promotionEvidence.exists
      ? `quality gate ${promotionEvidence.quality_gate_result}`
      : 'evidence artifact 없음',
  });

  return chain;
}

function buildOperatorCockpitSummary() {
  const bootstrap = buildBootstrapSummary();
  const branch = buildBranchBootstrapSummary();
  const commitGuard = buildAutoCommitGuardSummary({ mode: 'dry-run' });
  const promotionEvidence = buildPromotionEvidenceSummary();
  const lane = laneMeta(bootstrap.current_lane_hint);
  const operatorChain = buildOperatorActionChain({
    bootstrap,
    branch,
    commitGuard,
    promotionEvidence,
  });

  return {
    as_of: new Date().toISOString(),
    mode: 'operator-cockpit',
    current_wp: bootstrap.current_wp,
    next_wp: bootstrap.next_wp,
    requirements_stage: bootstrap.requirements_stage,
    current_lane: {
      id: lane.id,
      label: lane.label,
    },
    git: bootstrap.git,
    intake_packet: bootstrap.intake_packet,
    intake_packet_fields: bootstrap.intake_packet_fields,
    recommended_reads: bootstrap.recommended_reads,
    validation_profile: bootstrap.validation_profile,
    handoff_summary: buildHandoffSummary({
      bootstrap,
      git: bootstrap.git,
      commitGuard,
      promotionEvidence,
    }),
    branch,
    promotion_evidence: promotionEvidence,
    commit_guard: {
      next_action: commitGuard.next_action,
      status: commitGuard.guard.can_apply ? 'ready' : 'blocked',
      guard: commitGuard.guard,
      commit_candidate: commitGuard.commit_candidate,
      validation_profile: commitGuard.validation_profile,
    },
    operator_chain: operatorChain,
    next_validation_command: bootstrap.validation_profile.primary_command || '',
    validation_bundle_size: Array.isArray(bootstrap.validation_profile.commands)
      ? bootstrap.validation_profile.commands.length
      : 0,
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
    `Lane         : ${summary.current_lane.label}`,
    `Branch       : ${summary.git.branch}`,
    `Dirty        : ${summary.git.dirty ? `yes (${summary.git.dirty_count})` : 'no'}`,
    `Evidence     : ${summary.promotion_evidence.exists ? summary.promotion_evidence.quality_gate_result : 'missing'}`,
    '',
    '[Read First]',
    ...summary.recommended_reads.map((item) => `- ${item}`),
    '',
    '[Intake Packet]',
    ...summary.intake_packet_fields.map((item) => {
      const value = summary.intake_packet?.[item];
      const count = Array.isArray(value) ? value.length : (value ? 1 : 0);
      return `- ${item}: ${count}`;
    }),
    '',
    '[Validation Profile]',
    `- ${summary.validation_profile.packet_type} / ${summary.validation_profile.stage || 'UNKNOWN'}`,
    `- next command: ${summary.next_validation_command || 'n/a'}`,
    ...summary.validation_profile.commands.map((item) => `- ${item}`),
    '',
    '[Handoff Summary]',
    `- current: ${summary.handoff_summary.current_wp}`,
    `- next: ${summary.handoff_summary.next_wp}`,
    `- drift: ${summary.handoff_summary.drift_status}`,
    `- validation: ${summary.handoff_summary.validation_state}`,
    `- evidence: ${summary.handoff_summary.evidence_state}`,
    `- next command: ${summary.handoff_summary.next_command}`,
    '',
    '[Branch]',
    `- ${summary.branch.recommended_branch}`,
    `- ${summary.branch.create_command}`,
    `- ${summary.branch.commit_template.subject}`,
    '',
    '[Commit Guard]',
    `- status: ${summary.commit_guard.status}`,
    ...summary.commit_guard.guard.reasons.map((item) => `- ${item}`),
    `- next: ${summary.commit_guard.next_action}`,
    '',
    '[Operator Chain]',
    ...summary.operator_chain.map((item) => `- ${item.status} ${item.label}: ${item.command}`),
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
