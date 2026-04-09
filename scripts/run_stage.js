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
    requirements_file: requirementsPath,
    runtime_root: path.relative(ROOT, runtimeRoot) || '.',
  };

  if (dryRun || report.status !== 'ready') {
    return report;
  }

  return executeStage(report, metadata, runtimeRoot, runner);
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
