#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractValidator, readYaml, toYaml } = require('../src/infrastructure/mpo/ContractValidator');
const { buildAutoCommitGuardSummary } = require('./verified_auto_commit_guard');

function readYamlIfExists(root, relativePath) {
  const absolute = path.join(root, relativePath);
  return fs.existsSync(absolute) ? readYaml(absolute) : {};
}

function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function writeYamlAtomic(root, relativePath, value, validator) {
  const absolute = path.join(root, relativePath);
  writeAtomic(absolute, `${toYaml(value)}\n`);
  return validator;
}

function updateWpQueue(queueDoc = {}, sessionId, wpId, reportPath) {
  const nextDoc = { ...queueDoc };
  const mpoSessions = Array.isArray(nextDoc.mpo_sessions) ? nextDoc.mpo_sessions.slice() : [];
  const sessionIndex = mpoSessions.findIndex((entry) => entry.session_id === sessionId);
  const wpRecord = {
    wp_id: wpId,
    status: 'done',
    report: reportPath,
    completed_at: new Date().toISOString(),
  };

  if (sessionIndex >= 0) {
    const session = { ...mpoSessions[sessionIndex] };
    const reports = Array.isArray(session.reports) ? session.reports.slice() : [];
    reports.push(wpRecord);
    session.reports = reports;
    mpoSessions[sessionIndex] = session;
  } else {
    mpoSessions.push({
      session_id: sessionId,
      reports: [wpRecord],
    });
  }
  nextDoc.mpo_sessions = mpoSessions;
  return nextDoc;
}

function completeWorkPacket(
  {
    sessionId,
    wp,
    report,
    nextWpId = 'NONE',
  } = {},
  {
    root = path.resolve(__dirname, '..'),
    validator = new ContractValidator({ root }),
  } = {},
) {
  validator.validateInput('contracts/harness/output.schema.json', report, 'VerifiedWPResult');

  const today = new Date().toISOString().slice(0, 10);
  const reportRelativePath = `worklog/reports/${today}_${wp.id}.yaml`;
  const currentState = readYamlIfExists(root, 'memory/current-state.yaml');
  const currentWp = readYamlIfExists(root, 'memory/current-wp.yaml');
  const nextActions = readYamlIfExists(root, 'memory/L0-hot/next-actions.yaml');
  const wpQueue = readYamlIfExists(root, 'memory/wp-queue.yaml');

  const updatedState = {
    ...currentState,
    as_of: today,
    last_completed_mpo_session: {
      session_id: sessionId,
      wp_id: wp.id,
      completed_at: new Date().toISOString(),
      verification_status: report.verification_status,
    },
  };

  const updatedCurrentWp = {
    ...currentWp,
    id: nextWpId === 'NONE' ? 'MPO-COMPLETE' : nextWpId,
    goal: nextWpId === 'NONE' ? `MPO session ${sessionId} completed` : currentWp.goal,
    stage: nextWpId === 'NONE' ? 'complete' : currentWp.stage,
    status: nextWpId === 'NONE' ? 'completed' : currentWp.status,
    completed_at: nextWpId === 'NONE' ? new Date().toISOString() : currentWp.completed_at,
    last_completed_wp: wp.id,
    last_completed_at: new Date().toISOString(),
  };

  const updatedNextActions = {
    ...nextActions,
    as_of: today,
    next_wp: nextWpId === 'NONE' ? null : nextWpId,
    queue: [
      {
        id: nextWpId === 'NONE' ? 'MPO-NONE' : nextWpId,
        reason: nextWpId === 'NONE' ? 'session completed' : 'next executable MPO packet',
      },
    ],
  };

  const updatedQueue = updateWpQueue(wpQueue, sessionId, wp.id, reportRelativePath);

  writeYamlAtomic(root, reportRelativePath, report, validator);
  writeYamlAtomic(root, 'memory/current-state.yaml', updatedState, validator);
  writeYamlAtomic(root, 'memory/current-wp.yaml', updatedCurrentWp, validator);
  writeYamlAtomic(root, 'memory/L0-hot/next-actions.yaml', updatedNextActions, validator);
  writeYamlAtomic(root, 'memory/wp-queue.yaml', updatedQueue, validator);

  const guardSummary = buildAutoCommitGuardSummary({ mode: 'dry-run' });

  return {
    report_path: reportRelativePath,
    next_wp_id: nextWpId,
    commit_guard: guardSummary.guard,
  };
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const result = completeWorkPacket(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  completeWorkPacket,
};
