#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractValidator } = require('../src/infrastructure/mpo/ContractValidator');

const BASE_RESERVE = {
  feature: 4000,
  bugfix: 2000,
  refactor: 3000,
  docs: 1000,
  ops: 2000,
  spike: 6000,
};

const CAPS = {
  critical: 30000,
  high: 20000,
  medium: 15000,
  low: 10000,
};

function allocateTokenBudget(dag, { root = path.resolve(__dirname, '..'), validator = new ContractValidator({ root }) } = {}) {
  validator.validateInput('contracts/harness/wp-dag.schema.json', dag, 'WPDagWithEnvelopes');
  const nextDag = {
    ...dag,
    wp_list: dag.wp_list.map((wp) => {
      const contextTokens = Number(wp.context_envelope?.estimated_context_tokens || 0);
      const reserve = BASE_RESERVE[dag.intake_packet.packet_type] || 2000;
      const cap = CAPS[dag.intake_packet.risk_level] || 15000;
      const budget = Math.min(Math.round((contextTokens * 1.5) + reserve), cap);
      return {
        ...wp,
        token_budget: {
          budget,
          cap,
          warning_threshold: Math.floor(budget * 0.8),
        },
      };
    }),
  };
  return validator.validateOutput('contracts/harness/wp-dag.schema.json', nextDag, 'WPDagWithBudgets');
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const output = allocateTokenBudget(input);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  allocateTokenBudget,
};
