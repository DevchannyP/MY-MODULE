'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGE_ORDER = ['A', 'B', 'C', 'D', 'E'];
const STAGE_METADATA = {
  A: {
    doc: 'docs/how-to/run-stage-a.md',
    summary: 'Validate requirements and prepare bounded-context contracts.',
    prerequisites: [],
    commands: ['npm run validate:requirements'],
  },
  B: {
    doc: 'docs/how-to/run-stage-b.md',
    summary: 'Review stageA memory and contract-based composition inputs.',
    prerequisites: ['A'],
    commands: ['npm run validate:requirements'],
  },
  C: {
    doc: 'docs/how-to/run-stage-c.md',
    summary: 'Review plugin registry, navigation, feature flags, and observability inputs.',
    prerequisites: ['A', 'B'],
    commands: ['npm run validate:requirements', 'npm run validate:composition'],
  },
  D: {
    doc: 'docs/how-to/run-stage-d.md',
    summary: 'Run correctness, code-health, security, and supply-chain gates.',
    prerequisites: ['A', 'B', 'C'],
    commands: [
      'npm run validate:requirements',
      'npm run lint',
      'npm run test:contract',
      'npm test',
    ],
  },
  E: {
    doc: 'docs/how-to/run-stage-e.md',
    summary: 'Review repeated failures and run adversarial verification planning.',
    prerequisites: ['A', 'B', 'C', 'D'],
    commands: ['npm run validate:requirements', 'npm run test:e2e-smoke'],
  },
};

function readYaml(relativePath, runtimeRoot = ROOT) {
  const absolutePath = path.join(runtimeRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {};
  }

  try {
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
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const [, , stageArg, ...flags] = argv;
  const stage = String(stageArg || '').toUpperCase();
  if (!STAGE_ORDER.includes(stage)) {
    return { error: 'usage: node scripts/run_stage.js [A|B|C|D|E] [--module <id>] [--dry-run|--execute] [--root <path>] [--json]' };
  }

  // --module <id> selects which requirements file to use (e.g. billing, video)
  let moduleId = null;
  const modIdx = flags.indexOf('--module');
  if (modIdx !== -1 && modIdx + 1 < flags.length) {
    moduleId = flags[modIdx + 1];
  }

  let runtimeRoot = ROOT;
  const rootIdx = flags.indexOf('--root');
  if (rootIdx !== -1 && rootIdx + 1 < flags.length) {
    runtimeRoot = path.resolve(flags[rootIdx + 1]);
  }

  return {
    stage,
    moduleId,
    runtimeRoot,
    dryRun: flags.includes('--dry-run') || !flags.includes('--execute'),
    json: true,
  };
}

function resolveRequirementsPath(moduleId, runtimeRoot = ROOT) {
  if (!moduleId) return 'requirements/requirements.yaml';
  // Try requirements/<moduleId>.yaml first, then requirements/requirements.yaml
  const candidates = [
    `requirements/${moduleId}.yaml`,
    'requirements/requirements.yaml',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(runtimeRoot, candidate))) return candidate;
  }
  return 'requirements/requirements.yaml';
}

function getLegacyStageStates(runtimeRoot = ROOT) {
  const legacy = readYaml('memory/project/current-state.yaml', runtimeRoot);
  return legacy.stage_states && typeof legacy.stage_states === 'object' ? legacy.stage_states : {};
}

function evaluateStage(stage, requirements, rootState, currentWp, legacyStageStates) {
  const metadata = STAGE_METADATA[stage];
  const requirementsStage = typeof requirements.stage === 'string' ? requirements.stage : 'UNKNOWN';
  const legacyState = typeof legacyStageStates[stage] === 'string' ? legacyStageStates[stage] : 'UNKNOWN';
  const unmetPrerequisites = metadata.prerequisites.filter((prerequisite) => legacyStageStates[prerequisite] !== 'PASS');
  const routedStage = STAGE_ORDER.includes(requirementsStage) ? requirementsStage : 'UNKNOWN';

  let status = 'ready';
  if (unmetPrerequisites.length > 0) {
    status = 'blocked';
  } else if (routedStage !== 'UNKNOWN' && STAGE_ORDER.indexOf(stage) !== STAGE_ORDER.indexOf(routedStage)) {
    status = 'out-of-route';
  }

  return {
    requested_stage: stage,
    execution_mode: 'dry-run-only',
    status,
    run_now: false,
    requirements_stage: routedStage,
    legacy_stage_state: legacyState,
    prerequisites: metadata.prerequisites.map((prerequisite) => ({
      stage: prerequisite,
      state: legacyStageStates[prerequisite] || 'UNKNOWN',
    })),
    unmet_prerequisites: unmetPrerequisites,
    summary: metadata.summary,
    docs_ref: metadata.doc,
    recommended_commands: metadata.commands,
    root_memory_sources: {
      current_state: 'memory/current-state.yaml',
      next_actions: 'memory/next-actions.yaml',
    },
    legacy_memory_fallback: {
      current_state: 'memory/project/current-state.yaml',
    },
    notes: [
      'This command does not mutate repository state.',
      'Use the referenced how-to document and validators to perform the real stage work.',
      `requirements.yaml currently routes the repository to stage ${routedStage}.`,
      'Use --module <id> to target a specific domain (e.g. --module billing, --module video).',
    ],
    current_wp: typeof currentWp.id === 'string' ? currentWp.id : 'UNKNOWN',
  };
}

function runStageCommand(command, runtimeRoot = ROOT) {
  const result = spawnSync('bash', ['-lc', command], {
    cwd: runtimeRoot,
    encoding: 'utf8',
  });
  return {
    command,
    ok: result.status === 0,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal || null,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function findFailingCommandResult(report) {
  if (!Array.isArray(report?.command_results)) {
    return null;
  }
  return report.command_results.find((item) => item && item.ok === false) || null;
}

function deriveStageRunNextAction(report, failingCommandResult = null) {
  if (!report) {
    return 'Stage를 고른 뒤 dry-run으로 현재 경로를 먼저 확인하세요.';
  }
  if (report.status === 'blocked' && Array.isArray(report.unmet_prerequisites) && report.unmet_prerequisites.length > 0) {
    return `선행 Stage ${report.unmet_prerequisites.join(', ')}를 먼저 PASS 상태로 만든 뒤 다시 실행하세요.`;
  }
  if (report.status === 'out-of-route') {
    return 'requirements stage 경로와 현재 packet 단계를 확인한 뒤 다시 dry-run 하세요.';
  }
  if (report.execution_mode === 'execute' && report.status === 'fail') {
    return failingCommandResult?.command
      ? '실패 명령을 수정한 뒤 마지막 stage 재실행을 누르세요.'
      : '실패 원인을 해소한 뒤 마지막 stage 재실행을 누르세요.';
  }
  if (report.execution_mode === 'execute' && report.status === 'pass') {
    return '품질 게이트 결과를 확인하고 다음 Stage 또는 운영 증거 생성으로 이동하세요.';
  }
  if (report.status === 'ready') {
    return 'dry-run 결과를 검토한 뒤 execute 실행 여부를 결정하세요.';
  }
  return '현재 결과를 검토하고 필요한 Stage를 다시 실행하세요.';
}

function buildStageOperatorGuidance(report) {
  const moduleId = String(report?.requested_module || '').trim();
  const moduleLabel = moduleId || '전체';
  const failingCommandResult = findFailingCommandResult(report);
  const failedCommand = String(report?.failed_command || failingCommandResult?.command || '').trim();
  const failedDetail = String(
    report?.failed_detail
    || failingCommandResult?.stderr
    || failingCommandResult?.stdout
    || ''
  ).trim();

  let currentState = 'stage 결과 대기';
  let failureLocation = '없음';
  let failureReason = '없음';
  const retryable = true;
  let retryableReason = '같은 Stage를 다시 실행할 수 있습니다.';
  let primaryAction = 'dry-run';
  let secondaryAction = 'review-docs';

  if (report?.status === 'blocked') {
    currentState = '선행 Stage 미충족으로 현재 Stage가 차단되었습니다.';
    failureLocation = `Stage ${report.requested_stage} / module ${moduleLabel} / prerequisites`;
    failureReason = Array.isArray(report.unmet_prerequisites) && report.unmet_prerequisites.length > 0
      ? `선행 조건 미충족: ${report.unmet_prerequisites.join(', ')}`
      : '선행 조건 미충족';
    retryableReason = '선행 Stage를 PASS로 만든 뒤 같은 Stage를 다시 실행하세요.';
    primaryAction = 'fix-prerequisites';
  } else if (report?.status === 'out-of-route') {
    currentState = '현재 요구사항 stage 경로 밖이라 execute를 진행할 수 없습니다.';
    failureLocation = `Stage ${report.requested_stage} / module ${moduleLabel} / requirements stage`;
    failureReason = `요청 Stage와 requirements stage(${report.requirements_stage || 'UNKNOWN'})가 일치하지 않습니다.`;
    retryableReason = 'requirements stage 경로를 맞춘 뒤 dry-run으로 다시 확인하세요.';
    primaryAction = 'fix-route';
  } else if (report?.execution_mode === 'execute' && report?.status === 'fail') {
    currentState = 'execute 중 첫 실패 명령에서 중단되었습니다.';
    failureLocation = failedCommand
      ? `Stage ${report.requested_stage} / module ${moduleLabel} / ${failedCommand}`
      : `Stage ${report.requested_stage} / module ${moduleLabel}`;
    failureReason = failedDetail || '실패 원인 기록 없음';
    retryableReason = failedCommand
      ? '실패 명령을 수정한 뒤 같은 Stage를 다시 실행하세요.'
      : '실패 원인을 정리한 뒤 같은 Stage를 다시 실행하세요.';
    primaryAction = 'fix-command';
  } else if (report?.execution_mode === 'execute' && report?.status === 'pass') {
    currentState = 'execute 완료 및 품질 게이트 PASS입니다.';
    retryableReason = '필요하면 같은 Stage를 다시 실행할 수 있습니다.';
    primaryAction = 'advance-stage';
    secondaryAction = 'generate-evidence';
  } else if (report?.status === 'ready') {
    currentState = 'dry-run 준비 완료 상태입니다.';
    retryableReason = 'dry-run 또는 execute를 선택해 이어서 진행할 수 있습니다.';
    primaryAction = 'execute';
  }

  return {
    current_state: currentState,
    failure_location: failureLocation,
    failure_reason: failureReason,
    next_action: deriveStageRunNextAction(report, failingCommandResult),
    retryable,
    retryable_reason: retryableReason,
    primary_action: primaryAction,
    secondary_action: secondaryAction,
  };
}

function decorateStageReport(report) {
  const failingCommandResult = findFailingCommandResult(report);
  const failedCommand = String(report?.failed_command || failingCommandResult?.command || '').trim();
  const failedDetail = String(
    report?.failed_detail
    || failingCommandResult?.stderr
    || failingCommandResult?.stdout
    || ''
  ).trim();

  return {
    ...report,
    failed_command: failedCommand,
    failed_detail: failedDetail,
    operator_guidance: buildStageOperatorGuidance({
      ...report,
      failed_command: failedCommand,
      failed_detail: failedDetail,
    }),
  };
}

function executeStage(report, metadata, runtimeRoot = ROOT, runner = runStageCommand) {
  const commandResults = [];
  for (const command of metadata.commands) {
    const commandResult = runner(command, runtimeRoot);
    commandResults.push(commandResult);
    if (!commandResult.ok) {
      break;
    }
  }

  const passed = commandResults.every((item) => item.ok);
  const failedCount = commandResults.filter((item) => !item.ok).length;

  return {
    ...report,
    execution_mode: 'execute',
    run_now: true,
    status: passed ? 'pass' : 'fail',
    quality_gate_result: passed ? 'PASS' : 'FAIL',
    command_results: commandResults,
    executed_command_count: commandResults.length,
    failed_command_count: failedCount,
    notes: [
      ...report.notes.filter((note) => note !== 'This command does not mutate repository state.'),
      passed
        ? 'Stage execution completed and all required commands passed.'
        : 'Stage execution stopped at the first failing command.',
    ],
  };
}

function runStage(stage, {
  moduleId = null,
  runtimeRoot = ROOT,
  dryRun = true,
  runner = runStageCommand,
} = {}) {
  const requirementsPath = resolveRequirementsPath(moduleId, runtimeRoot);
  const requirements = readYaml(requirementsPath, runtimeRoot);
  const rootState = readYaml('memory/current-state.yaml', runtimeRoot);
  const currentWp = readYaml('memory/current-wp.yaml', runtimeRoot);
  const legacyStageStates = getLegacyStageStates(runtimeRoot);
  const metadata = STAGE_METADATA[stage];
  const baseReport = evaluateStage(stage, requirements, rootState, currentWp, legacyStageStates);
  const report = {
    ...baseReport,
    requested_module: moduleId || '',
    requirements_file: requirementsPath,
    runtime_root: path.relative(ROOT, runtimeRoot) || '.',
  };

  if (dryRun || report.status !== 'ready') {
    return decorateStageReport(report);
  }

  return decorateStageReport(executeStage(report, metadata, runtimeRoot, runner));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    process.stderr.write(`${args.error}\n`);
    process.exit(2);
  }

  const report = runStage(args.stage, {
    moduleId: args.moduleId,
    runtimeRoot: args.runtimeRoot,
    dryRun: args.dryRun,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!args.dryRun && report.status === 'fail') {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

/**
 * Read multiple YAML files at once.
 * Returns a map of { relativePath → parsed data }.
 * Missing files return {} without error.
 *
 * @param {string[]} relativePaths
 * @returns {Record<string, Record<string, unknown>>}
 */
function readYamlMany(relativePaths, runtimeRoot = ROOT) {
  const output = {};
  for (const relativePath of relativePaths.filter(Boolean)) {
    output[relativePath] = readYaml(relativePath, runtimeRoot);
  }
  return output;
}

module.exports = {
  STAGE_ORDER,
  readYaml,
  readYamlMany,
  getLegacyStageStates,
  evaluateStage,
  executeStage,
  runStage,
  runStageCommand,
  resolveRequirementsPath,
};
