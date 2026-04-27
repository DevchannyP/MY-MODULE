'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40) || 'update';
}

function inferBranchPrefix(currentWp = {}) {
  const type = String(currentWp.type || '').trim().toLowerCase();
  const goal = String(currentWp.goal || '').trim().toLowerCase();

  if (type === 'governance' || type === 'policy') return 'chore';
  if (type === 'meta') return 'docs';
  if (type === 'infra' || type === 'arch' || type === 'executor') return 'chore';
  if (type === 'shell') return goal.includes('bug') || goal.includes('fix') ? 'fix' : 'feature';
  if (type === 'domain') return goal.includes('bug') || goal.includes('fix') || goal.includes('오류') || goal.includes('수정') ? 'fix' : 'feature';
  return 'feature';
}

function inferScope(currentWp = {}, convention = {}) {
  const stage = String(currentWp.stage || '').trim().toUpperCase();
  const mapping = convention.type_mapping || {};
  const stageKey = `stage${stage}`;
  const scopeTemplate = mapping[stageKey]?.scope || '';
  if (scopeTemplate.includes('{domain}')) {
    const goalSlug = slugify(currentWp.goal || 'core');
    const firstToken = goalSlug.split('-')[0] || 'core';
    return scopeTemplate.replace('{domain}', firstToken);
  }
  return scopeTemplate || 'core';
}

function inferCommitType(currentWp = {}, convention = {}) {
  const type = String(currentWp.type || '').trim().toLowerCase();
  const stage = String(currentWp.stage || '').trim().toUpperCase();
  const mapping = convention.type_mapping || {};
  const stageKey = `stage${stage}`;

  if (type === 'domain' && (String(currentWp.goal || '').includes('수정') || String(currentWp.goal || '').toLowerCase().includes('fix'))) {
    return mapping.gate_fix?.type || 'fix';
  }

  return mapping[stageKey]?.type || (type === 'meta' ? 'docs' : 'chore');
}

function inferShortTopic(currentWp = {}) {
  const goal = String(currentWp.goal || '').trim();
  const type = String(currentWp.type || '').trim().toLowerCase();
  const id = String(currentWp.id || '').trim().toLowerCase();
  const base = slugify(goal);
  if (base && base !== 'update') {
    return base;
  }
  return slugify(`${type}-${id || 'packet'}`);
}

function currentGitBranch() {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 ? String(result.stdout || '').trim() : 'unknown';
}

function buildBranchBootstrapSummary() {
  const currentWp = readYaml('memory/current-wp.yaml');
  const convention = readYaml('requirements/commit-convention.yaml');
  const branchPrefix = inferBranchPrefix(currentWp);
  const topic = inferShortTopic(currentWp);
  const recommendedBranch = `${branchPrefix}/core-${topic}`;
  const commitType = inferCommitType(currentWp, convention);
  const commitScope = inferScope(currentWp, convention);
  const commitSubject = `${commitType}(${commitScope}): ${String(currentWp.goal || 'update current packet').trim()}`;

  return {
    as_of: new Date().toISOString(),
    current_branch: currentGitBranch(),
    current_wp: {
      id: String(currentWp.id || 'UNKNOWN'),
      type: String(currentWp.type || 'UNKNOWN'),
      stage: String(currentWp.stage || 'UNKNOWN'),
      goal: String(currentWp.goal || 'UNKNOWN'),
    },
    recommended_branch: recommendedBranch,
    create_command: `git checkout -b ${recommendedBranch}`,
    commit_template: {
      type: commitType,
      scope: commitScope,
      subject: commitSubject,
      body_required_fields: Array.isArray(convention.body_required_fields) ? convention.body_required_fields : [],
      footer_required_fields: Array.isArray(convention.footer_required_fields) ? convention.footer_required_fields : [],
    },
  };
}

function main() {
  const asJson = process.argv.includes('--json');
  const summary = buildBranchBootstrapSummary();
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const lines = [
    '=== Branch Bootstrap ===',
    `Current Branch     : ${summary.current_branch}`,
    `Current WP         : ${summary.current_wp.id} / ${summary.current_wp.type} / ${summary.current_wp.stage}`,
    `Goal               : ${summary.current_wp.goal}`,
    `Recommended Branch : ${summary.recommended_branch}`,
    `Create Command     : ${summary.create_command}`,
    '',
    '[Commit Template]',
    `- ${summary.commit_template.subject}`,
    ...summary.commit_template.body_required_fields.map((item) => `- ${item}`),
    ...summary.commit_template.footer_required_fields.map((item) => `- ${item}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBranchBootstrapSummary,
};
