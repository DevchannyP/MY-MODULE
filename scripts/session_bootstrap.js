'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildReport } = require('./project_status');
const { resolveValidationProfile } = require('./resolve_validation_profile');
const { buildFocusPacket, inferLaneId } = require('./packet_flow');

const ROOT = path.resolve(__dirname, '..');
const HARNESS_CONTRACT = 'requirements/harness-engineering.yaml';
const HARNESS_PLAN = 'docs/explanation/ai-harness-upgrade-plan.md';
const PROMPT_SEED = 'docs/how-to/repeatable-cli-master-prompt.md';

function readYaml(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {};
  }

  const script = [
    'import json, pathlib, sys, yaml',
    'path = pathlib.Path(sys.argv[1])',
    'data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}',
    'print(json.dumps(data, ensure_ascii=False))',
  ].join('; ');

  const result = spawnSync('python3', ['-c', script, absolutePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return {};
  }
  return JSON.parse(result.stdout || '{}');
}

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

function collectGitStatus() {
  const branchLine = runGit(['status', '--short', '--branch']).split('\n')[0] || '';
  const branch = branchLine.replace(/^##\s*/, '').trim() || 'unknown';
  const dirtyFiles = runGit(['status', '--short'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    branch,
    dirty: dirtyFiles.length > 0,
    dirty_count: dirtyFiles.length,
    dirty_files: dirtyFiles.slice(0, 12),
  };
}

function buildRecommendedReads(report) {
  const reads = [
    HARNESS_CONTRACT,
    HARNESS_PLAN,
    'memory/checkpoint.yaml',
    'memory/current-state.yaml',
    'memory/current-wp.yaml',
    'memory/wp-queue.yaml',
  ];

  if (report.current_wp !== 'UNKNOWN' && report.current_wp !== 'NONE') {
    reads.push('memory/next-actions.yaml');
  }

  return Array.from(new Set(reads));
}

function buildRecommendedCommands(report, gitStatus) {
  const currentWp = readYaml('memory/current-wp.yaml');
  const validationProfile = resolveValidationProfile(currentWp, {
    packetType: report.current_wp_type,
    stage: report.current_wp_stage,
  });
  const commands = ['npm run session:bootstrap', 'npm run project:status'];

  if (gitStatus.dirty) {
    commands.push('git status --short --branch');
  }

  commands.push('npm run wp:next');
  commands.push('npm run wp:reconcile');
  commands.push('npm run commit:guard');
  validationProfile.commands.forEach((command) => {
    if (!commands.includes(command)) {
      commands.push(command);
    }
  });

  const stageCommands = Array.isArray(report.stage_summary)
    ? report.stage_summary
        .find((item) => item.stage === report.requirements_stage)?.recommended_commands || []
    : [];

  stageCommands.forEach((command) => {
    if (!commands.includes(command)) {
      commands.push(command);
    }
  });

  return commands;
}

function buildBootstrapSummary() {
  const report = buildReport();
  const currentWp = readYaml('memory/current-wp.yaml');
  const nextActions = readYaml('memory/next-actions.yaml');
  const harnessContract = readYaml(HARNESS_CONTRACT);
  const gitStatus = collectGitStatus();
  const validationProfile = resolveValidationProfile(currentWp, {
    packetType: report.current_wp_type,
    stage: report.current_wp_stage,
  });
  const focusPacket = buildFocusPacket({ report, nextActions, currentWp });

  return {
    as_of: new Date().toISOString(),
    bootstrap_mode: 'harness-operator',
    prompt_seed_path: PROMPT_SEED,
    harness_contract_path: HARNESS_CONTRACT,
    harness_plan_path: HARNESS_PLAN,
    current_wp: {
      id: String(report.current_wp || currentWp.id || 'UNKNOWN'),
      goal: String(report.current_wp_goal || currentWp.goal || 'UNKNOWN'),
      stage: String(report.current_wp_stage || currentWp.stage || 'UNKNOWN'),
      type: String(report.current_wp_type || currentWp.type || 'UNKNOWN'),
    },
    next_wp: String(report.next_wp || nextActions.next_wp || 'NONE'),
    requirements_stage: String(report.requirements_stage || 'UNKNOWN'),
    current_lane_hint: inferLaneId({
      status: focusPacket.status,
      stage: focusPacket.stage,
      completed: focusPacket.active !== true && ['completed', 'pass', 'done', 'closed'].includes(String(focusPacket.status || '').toLowerCase()),
    }),
    git: gitStatus,
    validation_profile: validationProfile,
    intake_packet_fields: Array.isArray(harnessContract.intake_packet?.required_fields)
      ? harnessContract.intake_packet.required_fields
      : ['goal', 'context', 'constraints', 'done_when', 'work_mode', 'verification'],
    recommended_reads: buildRecommendedReads(report),
    recommended_commands: buildRecommendedCommands(report, gitStatus),
    operator_focus: [
      `현재 packet: ${String(report.current_wp || 'UNKNOWN')}`,
      `현재 목표: ${String(report.current_wp_goal || 'UNKNOWN')}`,
      `다음 packet: ${String(report.next_wp || 'NONE')}`,
      gitStatus.dirty
        ? `더티 워크트리 ${gitStatus.dirty_count}건 먼저 확인`
        : '더티 워크트리 없음',
    ],
  };
}

function printHuman(summary) {
  const lines = [
    '=== Session Bootstrap ===',
    `Current WP : ${summary.current_wp.id} / ${summary.current_wp.stage} / ${summary.current_wp.type}`,
    `Goal       : ${summary.current_wp.goal}`,
    `Next WP    : ${summary.next_wp}`,
    `Branch     : ${summary.git.branch}`,
    `Dirty      : ${summary.git.dirty ? `yes (${summary.git.dirty_count})` : 'no'}`,
    '',
    '[Read First]',
    ...summary.recommended_reads.map((item) => `- ${item}`),
    '',
    '[Run Next]',
    ...summary.recommended_commands.map((item) => `- ${item}`),
    '',
    '[Validation Profile]',
    `- ${summary.validation_profile.packet_type} / ${summary.validation_profile.stage || 'UNKNOWN'}`,
    ...summary.validation_profile.commands.map((item) => `- ${item}`),
    '',
    '[Prompt Seed]',
    `- ${summary.prompt_seed_path}`,
    '',
    '[Intake Packet]',
    ...summary.intake_packet_fields.map((item) => `- ${item}`),
  ];

  process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
  const asJson = process.argv.includes('--json');
  const summary = buildBootstrapSummary();
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
  buildBootstrapSummary,
};
