#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { ContractValidator } = require('../src/infrastructure/mpo/ContractValidator');

const MODE_KEYWORDS = [
  { mode: 'Policy', matches: ['policy', 'governance', 'security', 'compliance', 'adr', 'contract', 'schema'] },
  { mode: 'Debug', matches: ['bug', 'fix', 'debug', 'error', 'fail', 'regression'] },
  { mode: 'Operate', matches: ['deploy', 'release', 'ops', 'runbook', 'smoke', 'monitor', 'status'] },
  { mode: 'Research', matches: ['research', 'investigate', 'explore', 'analysis', 'benchmark', 'spike'] },
];

const PACKET_TYPE_KEYWORDS = [
  { packet_type: 'docs', matches: ['docs', 'document', 'readme', 'guide', '문서'] },
  { packet_type: 'bugfix', matches: ['bug', 'fix', 'debug', 'regression', '오류', '수정'] },
  { packet_type: 'refactor', matches: ['refactor', 'cleanup', 'rename', 'reorganize', '리팩터'] },
  { packet_type: 'ops', matches: ['deploy', 'ops', 'infra', 'runtime', 'release'] },
  { packet_type: 'spike', matches: ['spike', 'investigate', 'research', 'benchmark'] },
];

function lower(value) {
  return String(value || '').toLowerCase();
}

function containsAny(text, matches = []) {
  return matches.some((entry) => text.includes(String(entry).toLowerCase()));
}

function inferMode(goal) {
  const normalized = lower(goal);
  const matched = MODE_KEYWORDS.find((entry) => containsAny(normalized, entry.matches));
  return matched ? matched.mode : 'Build';
}

function inferPacketType(goal) {
  const normalized = lower(goal);
  const matched = PACKET_TYPE_KEYWORDS.find((entry) => containsAny(normalized, entry.matches));
  return matched ? matched.packet_type : 'feature';
}

function inferRiskLevel(goal, packetType, mode) {
  const normalized = lower(goal);
  if (containsAny(normalized, ['critical', 'production', 'branch protection', 'secret', 'auth', 'payment', 'delete'])) {
    return 'critical';
  }
  if (mode === 'Policy' || containsAny(normalized, ['migration', 'database', 'rollback', 'security'])) {
    return 'high';
  }
  if (packetType === 'docs' || packetType === 'refactor') {
    return 'low';
  }
  return 'medium';
}

function inferTrustLevel(goal) {
  const normalized = lower(goal);
  if (containsAny(normalized, ['external', 'user input', 'url', 'webhook', 'upload', 'untrusted'])) {
    return 'untrusted';
  }
  if (containsAny(normalized, ['mixed', 'third party', 'provider'])) {
    return 'mixed';
  }
  return 'trusted';
}

function inferEvidenceRequired(riskLevel, mode) {
  if (riskLevel === 'critical' || mode === 'Policy' || mode === 'Debug') {
    return 'strict';
  }
  if (riskLevel === 'high') {
    return 'standard';
  }
  return 'minimal';
}

function inferInteractiveClass(goal) {
  const normalized = lower(goal);
  if (containsAny(normalized, ['realtime', 'stream', 'sse', 'live'])) {
    return 'realtime';
  }
  if (containsAny(normalized, ['ui', 'review', 'approve', 'interactive'])) {
    return 'interactive';
  }
  return 'batch';
}

function buildContext(rawIntent = {}) {
  const anchors = rawIntent.session_context?.anchors || {};
  const context = [];
  if (anchors.current_state?.branch) {
    context.push(`current branch: ${anchors.current_state.branch}`);
  }
  if (anchors.current_wp?.id) {
    context.push(`current wp: ${anchors.current_wp.id}`);
  }
  if (anchors.requirements?.module?.id) {
    context.push(`active module: ${anchors.requirements.module.id}`);
  }
  if (context.length === 0) {
    context.push('session anchors loaded');
  }
  return context;
}

function buildConstraints(rawIntent = {}) {
  const constraints = [
    '문서화된 계약과 경계를 우선한다.',
    '관련 없는 기존 기능은 변경하지 않는다.',
    '증거 없이 PASS를 선언하지 않는다.',
  ];
  if (rawIntent.session_context?.anchors?.current_state?.branch) {
    constraints.push(`branch: ${rawIntent.session_context.anchors.current_state.branch}`);
  }
  return constraints;
}

function buildDoneWhen(goal, packetType) {
  const items = [
    `goal satisfied: ${String(goal || '').trim()}`,
    'contract validation passes',
    'verification bundle has observable evidence',
  ];
  if (packetType === 'docs') {
    items.unshift('documented surface and runtime state stay aligned');
  }
  return items;
}

function buildVerification(mode, packetType) {
  const steps = ['schema validation', 'truthfulness gate'];
  if (mode === 'Build' || packetType === 'feature' || packetType === 'bugfix') {
    steps.push('targeted tests');
  }
  if (packetType === 'docs') {
    steps.push('project status');
  }
  return steps;
}

function normalizeIntake(rawIntent, { validator = new ContractValidator() } = {}) {
  validator.validateInput('contracts/harness/raw-intent.schema.json', rawIntent, 'RawIntent');

  const goal = String(rawIntent.goal || rawIntent.raw_intent || '').trim();
  const workMode = inferMode(goal);
  const packetType = inferPacketType(goal);
  const riskLevel = inferRiskLevel(goal, packetType, workMode);
  const intakePacket = {
    goal,
    context: buildContext(rawIntent),
    constraints: buildConstraints(rawIntent),
    done_when: buildDoneWhen(goal, packetType),
    work_mode: workMode,
    verification: buildVerification(workMode, packetType),
    packet_type: packetType,
    risk_level: riskLevel,
    trust_level: inferTrustLevel(goal),
    evidence_required: inferEvidenceRequired(riskLevel, workMode),
    interactive_class: inferInteractiveClass(goal),
    assumptions: [],
    open_questions: [],
    mode: workMode,
  };

  return validator.validateOutput('contracts/harness/intake.schema.json', intakePacket, 'IntakePacket');
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const output = normalizeIntake(input);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeIntake,
  inferMode,
  inferPacketType,
  inferRiskLevel,
};
