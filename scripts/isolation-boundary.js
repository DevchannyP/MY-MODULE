#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractValidator, readYaml } = require('../src/infrastructure/mpo/ContractValidator');

function unique(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function resolveRuleKey(wp = {}) {
  if (wp.domain === 'mpo') {
    return 'mpo';
  }
  if (wp.packet_type === 'docs' || wp.domain === 'docs') {
    return 'docs';
  }
  if (wp.domain === 'server' || wp.layer === 'server') {
    return 'server';
  }
  if (['video', 'billing', 'productivity'].includes(wp.domain)) {
    return wp.domain;
  }
  return 'default';
}

function normalizePaths(values = []) {
  return unique(values.map((entry) => String(entry || '').replace(/\\/g, '/').trim()).filter(Boolean));
}

function applyIsolationBoundaries(dag, { root = path.resolve(__dirname, '..'), validator = new ContractValidator({ root }) } = {}) {
  validator.validateInput('contracts/harness/wp-dag.schema.json', dag, 'WPDagDraft');
  const rules = readYaml(path.join(root, 'contracts/harness/isolation-rules.yaml')).isolation_rules || {};

  const nextDag = {
    ...dag,
    wp_list: dag.wp_list.map((wp) => {
      const ruleKey = resolveRuleKey(wp);
      const rule = rules[ruleKey] || rules.default || {};
      return {
        ...wp,
        allowed_paths: normalizePaths(rule.allowed_write),
        read_only_paths: normalizePaths(rule.read_only),
        forbidden_paths: normalizePaths(rule.forbidden),
      };
    }),
  };

  return validator.validateOutput('contracts/harness/wp-dag.schema.json', nextDag, 'WPDagWithBoundaries');
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const output = applyIsolationBoundaries(input);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  applyIsolationBoundaries,
  resolveRuleKey,
};
