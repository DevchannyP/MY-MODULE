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

function readYaml(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
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
    return { error: 'usage: node scripts/run_stage.js [A|B|C|D|E] [--dry-run] [--json]' };
  }

  return {
    stage,
    dryRun: flags.includes('--dry-run') || !flags.includes('--execute'),
    json: true,
  };
}

function getLegacyStageStates() {
  const legacy = readYaml('memory/project/current-state.yaml');
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
    ],
    current_wp: typeof currentWp.id === 'string' ? currentWp.id : 'UNKNOWN',
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    process.stderr.write(`${args.error}\n`);
    process.exit(2);
  }

  const requirements = readYaml('requirements/requirements.yaml');
  const rootState = readYaml('memory/current-state.yaml');
  const currentWp = readYaml('memory/current-wp.yaml');
  const legacyStageStates = getLegacyStageStates();
  const report = evaluateStage(args.stage, requirements, rootState, currentWp, legacyStageStates);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  STAGE_ORDER,
  readYaml,
  getLegacyStageStates,
  evaluateStage,
};
