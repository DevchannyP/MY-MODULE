#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { ContractValidator } = require('../src/infrastructure/mpo/ContractValidator');

function detectDomains(goal) {
  const text = String(goal || '').toLowerCase();
  const domains = [];
  if (text.includes('mpo') || text.includes('harness')) {
    domains.push('mpo');
  }
  if (text.includes('video')) {
    domains.push('video');
  }
  if (text.includes('billing')) {
    domains.push('billing');
  }
  if (text.includes('task') || text.includes('productivity')) {
    domains.push('productivity');
  }
  if (text.includes('server') || text.includes('route') || text.includes('api')) {
    domains.push('server');
  }
  if (text.includes('ui') || text.includes('frontend') || text.includes('sse')) {
    domains.push('docs');
  }
  return Array.from(new Set(domains.length ? domains : ['mpo']));
}

function createWp(id, title, domain, layer, intakePacket, dependsOn = [], options = {}) {
  return {
    id,
    title,
    objective: title,
    domain,
    layer,
    work_mode: intakePacket.work_mode,
    packet_type: intakePacket.packet_type,
    status: 'planned',
    depends_on: dependsOn,
    parallelizable: dependsOn.length === 0,
    estimated_duration_min: Number(options.estimated_duration_min || 2),
    estimated_token_cost: Number(options.estimated_token_cost || 2000),
  };
}

function decomposeMpo(sessionId, intakePacket) {
  const wpList = [
    createWp('WP-AUTO-001', 'MPO contracts and schema surfaces', 'mpo', 'contracts', intakePacket, [], {
      estimated_duration_min: 3,
      estimated_token_cost: 4000,
    }),
    createWp('WP-AUTO-002', 'MPO planning modules and routing', 'mpo', 'planning', intakePacket, ['WP-AUTO-001'], {
      estimated_duration_min: 4,
      estimated_token_cost: 7000,
    }),
    createWp('WP-AUTO-003', 'MPO execution, truthfulness, and memory reconcile', 'mpo', 'execution', intakePacket, ['WP-AUTO-002'], {
      estimated_duration_min: 5,
      estimated_token_cost: 8000,
    }),
    createWp('WP-AUTO-004', 'MPO UI, SSE, and E2E verification', 'mpo', 'ui', intakePacket, ['WP-AUTO-003'], {
      estimated_duration_min: 4,
      estimated_token_cost: 6000,
    }),
  ];

  return {
    schema_version: '1.0',
    session_id: sessionId,
    intake_packet: intakePacket,
    wp_list: wpList,
    edges: [
      { from: 'WP-AUTO-001', to: 'WP-AUTO-002', type: 'contracts_ready' },
      { from: 'WP-AUTO-002', to: 'WP-AUTO-003', type: 'planning_ready' },
      { from: 'WP-AUTO-003', to: 'WP-AUTO-004', type: 'execution_ready' },
    ],
    plan_summary: {
      total_wps: wpList.length,
      total_estimated_tokens: wpList.reduce((total, wp) => total + Number(wp.estimated_token_cost || 0), 0),
      approval_state: 'pending',
    },
  };
}

function decomposeGeneric(sessionId, intakePacket) {
  const domains = detectDomains(intakePacket.goal);
  const wpList = [];
  const edges = [];
  let previousId = '';

  domains.forEach((domain, index) => {
    const wpId = `WP-AUTO-${String(index + 1).padStart(3, '0')}`;
    const layer = domain === 'docs' ? 'docs' : domain === 'server' ? 'server' : 'implementation';
    const wp = createWp(
      wpId,
      `${domain} ${layer} work packet`,
      domain,
      layer,
      intakePacket,
      previousId ? [previousId] : [],
      {
        estimated_duration_min: 3,
        estimated_token_cost: 2500 + (index * 500),
      },
    );
    wp.parallelizable = previousId === '';
    wpList.push(wp);
    if (previousId) {
      edges.push({ from: previousId, to: wpId, type: 'depends_on' });
    }
    previousId = wpId;
  });

  return {
    schema_version: '1.0',
    session_id: sessionId,
    intake_packet: intakePacket,
    wp_list: wpList,
    edges,
    plan_summary: {
      total_wps: wpList.length,
      total_estimated_tokens: wpList.reduce((total, wp) => total + Number(wp.estimated_token_cost || 0), 0),
      approval_state: 'pending',
    },
  };
}

function decomposeGoal({ sessionId, intakePacket, validator = new ContractValidator() } = {}) {
  validator.validateInput('contracts/harness/intake.schema.json', intakePacket, 'IntakePacket');
  const goal = String(intakePacket.goal || '').toLowerCase();
  const dag = goal.includes('mpo') || goal.includes('harness')
    ? decomposeMpo(sessionId, intakePacket)
    : decomposeGeneric(sessionId, intakePacket);
  return validator.validateOutput('contracts/harness/wp-dag.schema.json', dag, 'WPDagDraft');
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const output = decomposeGoal(input);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  decomposeGoal,
  detectDomains,
};
