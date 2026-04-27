#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractValidator, readYaml, toYaml } = require('../src/infrastructure/mpo/ContractValidator');

function readFailureState(root) {
  const failurePath = path.join(root, 'memory/L0-hot/failure-patterns.yaml');
  if (!fs.existsSync(failurePath)) {
    return { patterns: [] };
  }
  return readYaml(failurePath);
}

function readWpQueue(root) {
  const queuePath = path.join(root, 'memory/wp-queue.yaml');
  if (!fs.existsSync(queuePath)) {
    return {};
  }
  return readYaml(queuePath);
}

function queueHasWp(queueDoc = {}, wpId = '') {
  return Array.isArray(queueDoc.capabilities) && queueDoc.capabilities.some((capability) =>
    Array.isArray(capability.work_packets) && capability.work_packets.some((wp) => String(wp.id || '') === String(wpId || ''))
  );
}

function ensureRemediationCapability(queueDoc = {}) {
  const nextQueue = { ...queueDoc };
  const capabilities = Array.isArray(nextQueue.capabilities) ? nextQueue.capabilities.slice() : [];
  const existingIndex = capabilities.findIndex((capability) => String(capability.id || '') === 'CAP-MPO-AUTO');
  if (existingIndex >= 0) {
    return { queue: nextQueue, index: existingIndex };
  }
  capabilities.push({
    id: 'CAP-MPO-AUTO',
    label: 'MPO auto-generated remediation',
    status: 'pending',
    priority: 999,
    work_packets: [],
  });
  nextQueue.capabilities = capabilities;
  return { queue: nextQueue, index: capabilities.length - 1 };
}

function writeQueue(root, queueDoc) {
  const queuePath = path.join(root, 'memory/wp-queue.yaml');
  fs.writeFileSync(queuePath, `${toYaml(queueDoc)}\n`, 'utf8');
}

function insertRemediationWp(root, remediation) {
  const queueDoc = readWpQueue(root);
  if (!remediation || !remediation.id) {
    return { inserted: false, wp_id: '' };
  }
  if (queueHasWp(queueDoc, remediation.id)) {
    return { inserted: false, wp_id: remediation.id };
  }
  const ensured = ensureRemediationCapability(queueDoc);
  const capabilities = ensured.queue.capabilities.slice();
  const capability = { ...capabilities[ensured.index] };
  const workPackets = Array.isArray(capability.work_packets) ? capability.work_packets.slice() : [];
  workPackets.unshift(remediation);
  capability.work_packets = workPackets;
  capabilities[ensured.index] = capability;
  ensured.queue.capabilities = capabilities;
  writeQueue(root, ensured.queue);
  return { inserted: true, wp_id: remediation.id };
}

function recordFailurePattern(
  {
    rootCauseCategory = 'unknown',
    message = '',
    wpId = '',
    sessionId = '',
  } = {},
  {
    root = path.resolve(__dirname, '..'),
    validator = new ContractValidator({ root }),
  } = {},
) {
  const state = readFailureState(root);
  const patterns = Array.isArray(state.patterns) ? state.patterns.slice() : [];
  const existingIndex = patterns.findIndex((entry) => String(entry.category || '') === String(rootCauseCategory || ''));
  const nextEntry = existingIndex >= 0
    ? { ...patterns[existingIndex] }
    : { category: rootCauseCategory, count: 0, history: [] };

  nextEntry.count = Number(nextEntry.count || 0) + 1;
  nextEntry.last_failure_at = new Date().toISOString();
  nextEntry.last_session_id = sessionId;
  nextEntry.last_wp_id = wpId;
  nextEntry.history = Array.isArray(nextEntry.history) ? nextEntry.history.slice(-4) : [];
  nextEntry.history.push({
    at: nextEntry.last_failure_at,
    session_id: sessionId,
    wp_id: wpId,
    message: String(message || '').trim(),
  });

  if (existingIndex >= 0) {
    patterns[existingIndex] = nextEntry;
  } else {
    patterns.push(nextEntry);
  }

  validator.writeYaml('memory/L0-hot/failure-patterns.yaml', {
    patterns,
  });

  let remediation = null;
  if (nextEntry.count >= 3) {
    const adrName = `draft-${String(rootCauseCategory || 'unknown').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.md`;
    const adrPath = path.join(root, 'docs/adr', adrName);
    if (!fs.existsSync(adrPath)) {
      fs.mkdirSync(path.dirname(adrPath), { recursive: true });
      fs.writeFileSync(adrPath, [
        '# ADR Draft',
        '',
        `- Category: ${rootCauseCategory}`,
        `- Session: ${sessionId}`,
        `- WP: ${wpId}`,
        '',
        '## Problem',
        String(message || '').trim() || 'Repeated failure detected.',
        '',
        '## Decision',
        'Define remediation work packet and tighten verification or boundary rules.',
        '',
      ].join('\n'), 'utf8');
    }
    remediation = {
      id: `WP-REM-${String(rootCauseCategory || 'unknown').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 12)}`,
      goal: `Remediate repeated MPO failure category ${rootCauseCategory}`,
      status: 'pending',
      tier: 'arch',
      depends_on: [],
      result: 'AUTO-GENERATED remediation work packet',
      adr_draft: `docs/adr/${adrName}`,
      deliverables: [
        `docs/adr/${adrName}`,
        'memory/L0-hot/failure-patterns.yaml',
      ],
      success_criteria: [
        'root cause is documented and reproducible',
        'boundary, verification, or routing policy is tightened',
      ],
    };
    remediation.queue_update = insertRemediationWp(root, remediation);
  }

  return {
    state: nextEntry,
    remediation,
  };
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const result = recordFailurePattern(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  recordFailurePattern,
};
