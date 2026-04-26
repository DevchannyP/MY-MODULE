#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ContractValidator, readYaml } = require('../src/infrastructure/mpo/ContractValidator');
const { createModuleRegistry } = require('../src/infrastructure/mpo/ModuleRegistry');
const { resolveHarnessRuntimeRoute } = require('../src/infrastructure/HarnessRuntimeRouter');
const {
  validateCompletionReport,
  matchesPattern,
  isReadAllowedByEnvelope,
  normalizePath,
  isAbsoluteOrTraversalPath,
} = require('./validate-completion-report');
const { completeWorkPacket } = require('./wp-complete');
const { recordFailurePattern } = require('./check-failure-patterns');

function runShellCommand(command, root) {
  const result = spawnSync('bash', ['-lc', command], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    command,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exit_code: Number.isInteger(result.status) ? result.status : 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function appendJsonl(filePath, entry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function isAutoReplanWorkPacket(wp = {}) {
  return Boolean(wp?.execution_result && wp.execution_result.auto_replan === true);
}

function escalateProviderTier(tier = '') {
  const normalized = String(tier || '').trim().toLowerCase();
  if (normalized === 'mini') {
    return 'standard';
  }
  if (normalized === 'standard') {
    return 'frontier';
  }
  return 'frontier';
}

function createFailureArtifact({ sessionId, wpId, root, reason, detail, changedFiles = [] }) {
  const artifactPath = `artifacts/mpo/${sessionId}/${wpId}/failure.json`;
  const absoluteArtifactPath = path.join(root, artifactPath);
  fs.mkdirSync(path.dirname(absoluteArtifactPath), { recursive: true });
  fs.writeFileSync(absoluteArtifactPath, `${JSON.stringify({
    reason,
    detail,
    changed_files: changedFiles,
    captured_at: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return {
    type: 'failure',
    path: artifactPath,
    detail: String(reason || 'failure'),
  };
}

function normalizeProviderEvidence(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const type = String(entry.type || '').trim();
  const evidencePath = String(entry.path || '').trim();
  if (!type || !evidencePath) {
    return null;
  }
  const normalizedType = ['file', 'command', 'report', 'log', 'memory'].includes(type)
    ? type
    : 'log';
  return {
    type: normalizedType,
    path: evidencePath,
    detail: entry.detail ? String(entry.detail) : undefined,
  };
}

function hasTrustedContext(wp = {}) {
  const canonical = ensureArray(wp.context_envelope?.canonical_files);
  const partial = ensureArray(wp.context_envelope?.partial_files);
  return canonical.length + partial.length > 0;
}

function providerRequiresReadFiles(providerExecution = {}, wp = {}) {
  const providerId = String(providerExecution.provider?.provider_id || '').trim();
  return providerId !== 'null-harness-provider' && hasTrustedContext(wp);
}

function normalizeReportedReadFiles(readFiles = []) {
  const seen = new Set();
  const normalized = [];
  const violations = [];
  ensureArray(readFiles).forEach((entry) => {
    const raw = String(entry || '');
    const relativePath = normalizePath(raw);
    if (!relativePath) {
      violations.push('read file path is empty');
      return;
    }
    if (isAbsoluteOrTraversalPath(raw)) {
      violations.push(`read file path is absolute or contains traversal: ${raw}`);
      return;
    }
    if (seen.has(relativePath)) {
      violations.push(`duplicate read file path: ${relativePath}`);
      return;
    }
    seen.add(relativePath);
    normalized.push(relativePath);
  });
  return {
    read_files: normalized,
    violations,
  };
}

function updateRoutingLearningSnapshot(root, sessionId, intakePacket) {
  const logPath = path.join(root, 'artifacts/evals/harness/invocation-log.jsonl');
  const targetPath = path.join(root, 'artifacts/evals/harness/latest/mpo-routing-learning.json');
  const entries = readJsonl(logPath);
  const summary = {};

  entries.forEach((entry) => {
    const key = `${entry.mode}:${entry.selected_model_tier}`;
    if (!summary[key]) {
      summary[key] = {
        mode: entry.mode,
        tier: entry.selected_model_tier,
        count: 0,
      };
    }
    summary[key].count += 1;
  });

  const payload = {
    schema_version: '1',
    generated_at: new Date().toISOString(),
    latest_session_id: sessionId,
    latest_packet_type: intakePacket.packet_type,
    latest_risk_level: intakePacket.risk_level,
    routing_learning: Object.values(summary).sort((a, b) => b.count - a.count),
    notes: [
      'MPO invocation-log 기반의 초기 learning snapshot',
      '현재는 데이터 수집과 요약만 수행하며, 후속 tier weighting 반영의 근거로 사용한다.',
    ],
  };

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function buildMpoWorkPacketResult({
  sessionId,
  wp,
  route,
  commandResults,
  tokenBudget,
  root,
  provider,
  changedFiles = [],
  providerExecution = {},
}) {
  const verificationStatus = commandResults.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL';
  const evidence = [];
  const readFiles = ensureArray(providerExecution.read_files).map((entry) => String(entry || '').trim()).filter(Boolean);
  const providerEvidence = ensureArray(providerExecution.evidence)
    .map(normalizeProviderEvidence)
    .filter(Boolean);
  commandResults.forEach((entry, index) => {
    const artifactPath = `artifacts/mpo/${sessionId}/${wp.id}/command-${index + 1}.log`;
    const absoluteArtifactPath = path.join(root, artifactPath);
    fs.mkdirSync(path.dirname(absoluteArtifactPath), { recursive: true });
    fs.writeFileSync(
      absoluteArtifactPath,
      [`$ ${entry.command}`, entry.stdout, entry.stderr].filter(Boolean).join('\n\n'),
      'utf8',
    );
    evidence.push({
      type: 'command',
      path: artifactPath,
      detail: entry.status,
    });
  });
  const mergedEvidence = providerEvidence.concat(evidence);
  const providerAnalysis = ensureArray(providerExecution.analysis).map((entry) => String(entry || '').trim()).filter(Boolean);
  const providerChangePoints = ensureArray(providerExecution.change_points)
    .filter((entry) => entry && typeof entry === 'object' && entry.target && entry.intent)
    .map((entry) => ({
      target: String(entry.target),
      intent: String(entry.intent),
      status: entry.status ? String(entry.status) : undefined,
    }));
  const providerArtifacts = ensureArray(providerExecution.artifacts).map((entry) => String(entry || '').trim()).filter(Boolean);
  const mergedArtifacts = providerArtifacts.concat(mergedEvidence.map((entry) => entry.path))
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);
  const summary = String(providerExecution.summary || '').trim()
    || (verificationStatus === 'PASS'
      ? `${wp.id} completed within declared boundary.`
      : `${wp.id} failed verification and requires remediation.`);

  return {
    session_id: sessionId,
    wp_id: wp.id,
    prompt_version: String(route.prompt_version || '0.2.0'),
    mode: wp.work_mode,
    packet_type: wp.packet_type,
    risk_level: String(route.risk_level || 'MEDIUM').toUpperCase(),
    verification_status: verificationStatus,
    evidence_status: mergedEvidence.length > 0 ? 'observed' : 'not_observed',
    tests_run: commandResults.map((entry) => ({
      name: entry.command,
      status: entry.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: entry.stdout || entry.stderr || 'command executed',
      count: entry.status === 'PASS' ? 1 : 0,
    })),
    tests_planned: ensureArray(wp.verification_bundle?.required).map((entry) => ({
      name: entry.command,
      expected_result: entry.pass_criteria,
    })),
    rollback_plan: `Revert changes limited to ${wp.id} scope and restore memory snapshot if verification fails.`,
    summary,
    analysis: [
      `domain=${wp.domain}`,
      `layer=${wp.layer}`,
      `provider=${provider.provider_id}`,
    ].concat(providerAnalysis),
    change_points: providerChangePoints.length > 0 ? providerChangePoints : [
      {
        target: wp.layer,
        intent: `Execute ${wp.title}`,
        status: 'unchanged',
      },
    ],
    verification: commandResults.map((entry) => ({
      name: entry.command,
      status: entry.status,
      note: entry.status === 'PASS' ? entry.stdout || 'command passed' : entry.stderr || 'command failed',
    })),
    risks: [
      {
        level: verificationStatus === 'PASS' ? 'LOW' : 'HIGH',
        description: verificationStatus === 'PASS'
          ? 'Dry-run/null provider path produced no code edits.'
          : 'Verification bundle failed.',
        mitigation: 'Review command evidence and rerun after adjusting packet or boundary.',
      },
    ],
    next_action: verificationStatus === 'PASS'
      ? 'Advance to next work packet.'
      : 'Stop and inspect failure evidence.',
    changed_files: ensureArray(changedFiles),
    read_files: readFiles,
    evidence: mergedEvidence,
    provider,
    token_usage: {
      budget: Number(tokenBudget.budget || 0),
      used: Math.min(Number(tokenBudget.budget || 0), Math.max(256, Math.round(Number(tokenBudget.budget || 0) * 0.2))),
      warning_threshold: Number(tokenBudget.warning_threshold || 0),
    },
    attempt: 1,
    artifacts: mergedArtifacts,
    boundary: {
      allowed_paths: wp.allowed_paths || [],
      read_only_paths: wp.read_only_paths || [],
      forbidden_paths: wp.forbidden_paths || [],
    },
  };
}

function buildFailureWorkPacketResult({
  sessionId,
  wp,
  route,
  root,
  provider,
  reason,
  detail,
  changedFiles = [],
  commandResults = [],
  baseReport = null,
}) {
  if (baseReport) {
    return {
      ...baseReport,
      verification_status: 'FAIL',
      evidence_status: ensureArray(baseReport.evidence).length > 0 ? 'observed' : 'not_observed',
      summary: `${wp.id} failed ${String(reason || 'execution')} and requires auto-replan.`,
      next_action: 'Execute auto-replanned packet within the same boundary.',
      changed_files: ensureArray(changedFiles).length > 0 ? ensureArray(changedFiles) : ensureArray(baseReport.changed_files),
      read_files: ensureArray(baseReport.read_files),
      verification: ensureArray(baseReport.verification).concat({
        name: String(reason || 'failure'),
        status: 'FAIL',
        note: String(detail || 'failure detected'),
      }),
      risks: ensureArray(baseReport.risks).concat({
        level: 'HIGH',
        description: `Auto-replan required due to ${String(reason || 'execution failure')}.`,
        mitigation: 'Escalate provider tier and keep execution inside declared boundary.',
      }),
    };
  }

  const evidenceEntry = createFailureArtifact({
    sessionId,
    wpId: wp.id,
    root,
    reason,
    detail,
    changedFiles,
  });

  return {
    session_id: sessionId,
    wp_id: wp.id,
    prompt_version: String(route.prompt_version || '0.2.0'),
    mode: wp.work_mode,
    packet_type: wp.packet_type,
    risk_level: String(route.risk_level || 'MEDIUM').toUpperCase(),
    verification_status: 'FAIL',
    evidence_status: 'observed',
    tests_run: commandResults.map((entry) => ({
      name: entry.command,
      status: entry.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: entry.stdout || entry.stderr || 'command executed',
      count: entry.status === 'PASS' ? 1 : 0,
    })),
    tests_planned: ensureArray(wp.verification_bundle?.required).map((entry) => ({
      name: entry.command,
      expected_result: entry.pass_criteria,
    })),
    rollback_plan: `Revert changes limited to ${wp.id} scope and review failure evidence before retrying.`,
    summary: `${wp.id} failed ${String(reason || 'execution')} and requires auto-replan.`,
    analysis: [
      `domain=${wp.domain}`,
      `layer=${wp.layer}`,
      `provider=${provider.provider_id}`,
    ],
    change_points: [
      {
        target: wp.layer,
        intent: `Investigate failure for ${wp.title}`,
        status: 'planned',
      },
    ],
    verification: [
      {
        name: String(reason || 'failure'),
        status: 'FAIL',
        note: String(detail || 'failure detected'),
      },
    ],
    risks: [
      {
        level: 'HIGH',
        description: `Auto-replan required due to ${String(reason || 'execution failure')}.`,
        mitigation: 'Escalate provider tier and keep execution inside declared boundary.',
      },
    ],
    next_action: 'Execute auto-replanned packet within the same boundary.',
    changed_files: ensureArray(changedFiles),
    read_files: [],
    evidence: [evidenceEntry],
    provider,
    token_usage: {
      budget: Number(wp.token_budget?.budget || 0),
      used: 0,
      warning_threshold: Number(wp.token_budget?.warning_threshold || 0),
    },
    attempt: 1,
    artifacts: [evidenceEntry.path],
    boundary: {
      allowed_paths: wp.allowed_paths || [],
      read_only_paths: wp.read_only_paths || [],
      forbidden_paths: wp.forbidden_paths || [],
    },
  };
}

function createAutoReplannedPacket({ session, failedWp, detail }) {
  const baseRoute = failedWp.route || resolveHarnessRuntimeRoute({
    mode: failedWp.work_mode,
    riskLevel: session.intake_packet.risk_level,
    trustLevel: session.intake_packet.trust_level,
    evidenceRequired: session.intake_packet.evidence_required,
    interactiveClass: session.intake_packet.interactive_class,
    budget: failedWp.token_budget?.budget,
  });
  const nextTier = escalateProviderTier(baseRoute.selected_model_tier || failedWp.provider_tier);
  const replannedId = `${failedWp.id}-REPLAN`;
  return {
    ...failedWp,
    id: replannedId,
    title: `${failedWp.title} (Auto Replan)`,
    objective: `Remediate ${failedWp.id} after runtime failure while preserving declared boundaries.`,
    depends_on: ensureArray(failedWp.depends_on),
    parallelizable: false,
    provider_tier: nextTier,
    route: {
      ...baseRoute,
      route_id: `${String(baseRoute.route_id || 'mpo-route')}-replan`,
      selected_model_tier: nextTier,
    },
    execution_result: {
      auto_replan: true,
      replan_of: failedWp.id,
      replan_reason: String(detail || '').slice(0, 400),
      generated_at: new Date().toISOString(),
    },
  };
}

function wireAutoReplannedPacket(session, failedWp, replannedWp) {
  const failedId = String(failedWp.id || '');
  const replannedId = String(replannedWp.id || '');
  session.dag.wp_list = session.dag.wp_list.map((candidate) => {
    if (String(candidate.id || '') === replannedId) {
      return candidate;
    }
    const dependsOn = ensureArray(candidate.depends_on);
    if (!dependsOn.includes(failedId)) {
      return candidate;
    }
    return {
      ...candidate,
      depends_on: dependsOn.map((dependency) => (dependency === failedId ? replannedId : dependency)),
    };
  });
  session.dag.edges = ensureArray(session.dag.edges)
    .filter((edge) => !(edge && edge.from === failedId && edge.to === replannedId && edge.type === 'auto-replan'))
    .map((edge) => {
      if (!edge || edge.from !== failedId) {
        return edge;
      }
      return {
        ...edge,
        from: replannedId,
      };
    });
  session.dag.edges.push({
    from: failedId,
    to: replannedId,
    type: 'auto-replan',
  });
}

function buildRawIntent({
  goal,
  approvalRequested = true,
  root,
}) {
  const currentState = readYaml(path.join(root, 'memory/current-state.yaml'));
  const currentWp = readYaml(path.join(root, 'memory/current-wp.yaml'));
  const nextActionsPath = fs.existsSync(path.join(root, 'memory/L0-hot/next-actions.yaml'))
    ? path.join(root, 'memory/L0-hot/next-actions.yaml')
    : path.join(root, 'memory/next-actions.yaml');
  const nextActions = readYaml(nextActionsPath);
  const requirements = readYaml(path.join(root, 'requirements/requirements.yaml'));

  return {
    raw_intent: String(goal || '').trim(),
    goal: String(goal || '').trim(),
    approval_requested: Boolean(approvalRequested),
    session_context: {
      anchors: {
        current_state: currentState,
        current_wp: currentWp,
        next_actions: nextActions,
        requirements,
      },
      branch: String(currentState.branch || ''),
      captured_at: new Date().toISOString(),
    },
  };
}

function applyRoutingAndVerification(dag, { flagsProvider = null, root = path.resolve(__dirname, '..') } = {}) {
  const enriched = {
    ...dag,
    wp_list: dag.wp_list.map((wp) => {
      const route = resolveHarnessRuntimeRoute({
        mode: wp.work_mode,
        riskLevel: dag.intake_packet.risk_level,
        trustLevel: dag.intake_packet.trust_level,
        evidenceRequired: dag.intake_packet.evidence_required,
        interactiveClass: dag.intake_packet.interactive_class,
        budget: wp.token_budget?.budget,
        flagsProvider,
      });
      const verificationProfile = require('./resolve_validation_profile').resolveValidationProfile(wp, {
        packetType: wp.packet_type,
        stage: 'MPO',
        domain: wp.domain,
        layer: wp.layer,
        mpo: true,
      });
      return {
        ...wp,
        provider_tier: route.selected_model_tier,
        fallback_chain: route.fallback_chain,
        verification_bundle: {
          required: verificationProfile.required || [],
          optional: verificationProfile.optional || [],
        },
        route,
      };
    }),
  };
  const validator = new ContractValidator({ root });
  return validator.validateOutput('contracts/harness/wp-dag.schema.json', enriched, 'ExecutableWPDag');
}

async function executeDag(
  session,
  {
    root,
    validator,
    harnessProviderAdapter,
    flagsProvider,
    emitEvent,
  },
) {
  const commandLogPath = path.join(root, 'artifacts/evals/harness/invocation-log.jsonl');
  const completed = new Set();
  const results = [];
  const wpList = session.dag.wp_list;
  const replannedWpIds = [];
  let replanned = false;

  while (true) {
    const pending = wpList.filter((wp) => !completed.has(wp.id));
    if (pending.length === 0) {
      break;
    }

    const ready = pending.filter((wp) =>
      !completed.has(wp.id)
      && ensureArray(wp.depends_on).every((dep) => completed.has(dep))
    );
    if (ready.length === 0) {
      throw new Error('No executable work packets remain; DAG may contain a cycle.');
    }

    for (const wp of ready.slice(0, 2)) {
      emitEvent('mpo.wp.started', { session_id: session.session_id, wp_id: wp.id, title: wp.title });
      const route = wp.route || resolveHarnessRuntimeRoute({
        mode: wp.work_mode,
        riskLevel: session.intake_packet.risk_level,
        trustLevel: session.intake_packet.trust_level,
        evidenceRequired: session.intake_packet.evidence_required,
        interactiveClass: session.intake_packet.interactive_class,
        budget: wp.token_budget?.budget,
        flagsProvider,
      });

      appendJsonl(commandLogPath, {
        ts: new Date().toISOString(),
        session_id: session.session_id,
        wp_id: wp.id,
        mode: wp.work_mode,
        route_id: route.route_id,
        selected_model_tier: route.selected_model_tier,
        risk_level: session.intake_packet.risk_level,
        trust_level: session.intake_packet.trust_level,
      });

      const providerExecution = await harnessProviderAdapter.executeWorkPacket({
        route,
        sessionId: session.session_id,
        wp,
      });

      const changedFiles = ensureArray(providerExecution.changed_files || []);
      if (providerRequiresReadFiles(providerExecution, wp) && !Array.isArray(providerExecution.read_files)) {
        const failureDetail = 'provider omitted required read_files array';
        const failureReport = buildFailureWorkPacketResult({
          sessionId: session.session_id,
          wp,
          route,
          root,
          provider: providerExecution.provider,
          reason: 'read_files_missing',
          detail: failureDetail,
          changedFiles,
        });
        emitEvent('mpo.wp.failed', {
          session_id: session.session_id,
          wp_id: wp.id,
          reason: 'read_files_missing',
          detail: failureDetail,
        });
        recordFailurePattern({
          rootCauseCategory: 'read-files-missing',
          message: failureDetail,
          wpId: wp.id,
          sessionId: session.session_id,
        }, { root, validator });
        results.push({ wp, report: failureReport });
        completed.add(wp.id);
        if (replanned || isAutoReplanWorkPacket(wp)) {
          throw new Error(`Provider omitted read_files for ${wp.id}`);
        }
        const replannedWp = createAutoReplannedPacket({
          session,
          failedWp: wp,
          detail: failureDetail,
        });
        wpList.push(replannedWp);
        wireAutoReplannedPacket(session, wp, replannedWp);
        replannedWpIds.push(replannedWp.id);
        replanned = true;
        emitEvent('mpo.plan.replanned', {
          session_id: session.session_id,
          failed_wp_id: wp.id,
          replanned_wp_id: replannedWp.id,
          reason: 'read_files_missing',
        });
        break;
      }
      const normalizedReadFiles = normalizeReportedReadFiles(providerExecution.read_files || []);
      if (normalizedReadFiles.violations.length > 0) {
        const failureDetail = normalizedReadFiles.violations.join('; ');
        const failureReport = buildFailureWorkPacketResult({
          sessionId: session.session_id,
          wp,
          route,
          root,
          provider: providerExecution.provider,
          reason: 'read_files_invalid',
          detail: failureDetail,
          changedFiles,
        });
        failureReport.read_files = normalizedReadFiles.read_files;
        emitEvent('mpo.wp.failed', {
          session_id: session.session_id,
          wp_id: wp.id,
          reason: 'read_files_invalid',
          violations: normalizedReadFiles.violations,
        });
        recordFailurePattern({
          rootCauseCategory: 'read-files-invalid',
          message: failureDetail,
          wpId: wp.id,
          sessionId: session.session_id,
        }, { root, validator });
        results.push({ wp, report: failureReport });
        completed.add(wp.id);
        if (replanned || isAutoReplanWorkPacket(wp)) {
          throw new Error(`Provider reported invalid read_files for ${wp.id}`);
        }
        const replannedWp = createAutoReplannedPacket({
          session,
          failedWp: wp,
          detail: failureDetail,
        });
        wpList.push(replannedWp);
        wireAutoReplannedPacket(session, wp, replannedWp);
        replannedWpIds.push(replannedWp.id);
        replanned = true;
        emitEvent('mpo.plan.replanned', {
          session_id: session.session_id,
          failed_wp_id: wp.id,
          replanned_wp_id: replannedWp.id,
          reason: 'read_files_invalid',
        });
        break;
      }
      const readFiles = normalizedReadFiles.read_files;
      const readOutsideEnvelope = readFiles.find((relativePath) => {
        const outsideEnvelope = !isReadAllowedByEnvelope(relativePath, wp);
        const forbidden = ensureArray(wp.forbidden_paths).some((pattern) => matchesPattern(relativePath, pattern));
        return outsideEnvelope || forbidden;
      });
      if (readOutsideEnvelope) {
        const failureDetail = `read file outside declared context envelope: ${readOutsideEnvelope}`;
        const failureReport = buildFailureWorkPacketResult({
          sessionId: session.session_id,
          wp,
          route,
          root,
          provider: providerExecution.provider,
          reason: 'context_envelope_violation',
          detail: failureDetail,
          changedFiles,
        });
        failureReport.read_files = readFiles;
        emitEvent('mpo.wp.failed', {
          session_id: session.session_id,
          wp_id: wp.id,
          reason: 'context_envelope_violation',
          detail: readOutsideEnvelope,
        });
        recordFailurePattern({
          rootCauseCategory: 'context-envelope-violation',
          message: failureDetail,
          wpId: wp.id,
          sessionId: session.session_id,
        }, { root, validator });
        results.push({ wp, report: failureReport });
        completed.add(wp.id);
        if (replanned || isAutoReplanWorkPacket(wp)) {
          throw new Error(`Context envelope violation detected for ${wp.id}: ${readOutsideEnvelope}`);
        }
        const replannedWp = createAutoReplannedPacket({
          session,
          failedWp: wp,
          detail: failureDetail,
        });
        wpList.push(replannedWp);
        wireAutoReplannedPacket(session, wp, replannedWp);
        replannedWpIds.push(replannedWp.id);
        replanned = true;
        emitEvent('mpo.plan.replanned', {
          session_id: session.session_id,
          failed_wp_id: wp.id,
          replanned_wp_id: replannedWp.id,
          reason: 'context_envelope_violation',
        });
        break;
      }
      const changedOutsideBoundary = changedFiles.find((relativePath) => {
        const outsideAllowed = ensureArray(wp.allowed_paths).length > 0
          && !ensureArray(wp.allowed_paths).some((pattern) => matchesPattern(relativePath, pattern));
        const forbidden = ensureArray(wp.forbidden_paths).some((pattern) => matchesPattern(relativePath, pattern));
        return outsideAllowed || forbidden;
      });
      if (changedOutsideBoundary) {
        const failureDetail = `changed file outside declared boundary: ${changedOutsideBoundary}`;
        const failureReport = buildFailureWorkPacketResult({
          sessionId: session.session_id,
          wp,
          route,
          root,
          provider: providerExecution.provider,
          reason: 'boundary_violation',
          detail: failureDetail,
          changedFiles,
        });
        emitEvent('mpo.wp.failed', {
          session_id: session.session_id,
          wp_id: wp.id,
          reason: 'boundary_violation',
          detail: changedOutsideBoundary,
        });
        recordFailurePattern({
          rootCauseCategory: 'boundary-violation',
          message: failureDetail,
          wpId: wp.id,
          sessionId: session.session_id,
        }, { root, validator });
        results.push({ wp, report: failureReport });
        completed.add(wp.id);
        if (replanned || isAutoReplanWorkPacket(wp)) {
          throw new Error(`Boundary violation detected for ${wp.id}: ${changedOutsideBoundary}`);
        }
        const replannedWp = createAutoReplannedPacket({
          session,
          failedWp: wp,
          detail: failureDetail,
        });
        wpList.push(replannedWp);
        wireAutoReplannedPacket(session, wp, replannedWp);
        replannedWpIds.push(replannedWp.id);
        replanned = true;
        emitEvent('mpo.plan.replanned', {
          session_id: session.session_id,
          failed_wp_id: wp.id,
          replanned_wp_id: replannedWp.id,
          reason: 'boundary_violation',
        });
        break;
      }

      const commandResults = ensureArray(wp.verification_bundle?.required).map((entry) => runShellCommand(entry.command, root));
      const report = buildMpoWorkPacketResult({
        sessionId: session.session_id,
        wp,
        route,
        commandResults,
        tokenBudget: wp.token_budget || {},
        root,
        provider: providerExecution.provider,
        changedFiles,
        providerExecution,
      });

      const validation = validateCompletionReport(report, {
        wp,
        commandResults,
        root,
        validator,
      });

      if (!validation.verified) {
        const failureDetail = validation.violations.join('; ');
        const failureReport = buildFailureWorkPacketResult({
          sessionId: session.session_id,
          wp,
          route,
          root,
          provider: providerExecution.provider,
          reason: 'truthfulness_gate',
          detail: failureDetail,
          changedFiles,
          commandResults,
          baseReport: report,
        });
        emitEvent('mpo.wp.failed', {
          session_id: session.session_id,
          wp_id: wp.id,
          reason: 'truthfulness_gate',
          violations: validation.violations,
        });
        const escalation = recordFailurePattern({
          rootCauseCategory: 'truthfulness-gate',
          message: failureDetail,
          wpId: wp.id,
          sessionId: session.session_id,
        }, { root, validator });
        if (escalation.remediation) {
          emitEvent('mpo.wp.failed', {
            session_id: session.session_id,
            wp_id: wp.id,
            remediation_wp: escalation.remediation.id,
            adr_draft: escalation.remediation.adr_draft,
          });
        }
        results.push({ wp, report: failureReport });
        completed.add(wp.id);
        if (replanned || isAutoReplanWorkPacket(wp)) {
          throw new Error(`Truthfulness gate failed for ${wp.id}`);
        }
        const replannedWp = createAutoReplannedPacket({
          session,
          failedWp: wp,
          detail: failureDetail,
        });
        wpList.push(replannedWp);
        wireAutoReplannedPacket(session, wp, replannedWp);
        replannedWpIds.push(replannedWp.id);
        replanned = true;
        emitEvent('mpo.plan.replanned', {
          session_id: session.session_id,
          failed_wp_id: wp.id,
          replanned_wp_id: replannedWp.id,
          reason: 'truthfulness_gate',
        });
        break;
      }

      emitEvent('mpo.wp.completed', {
        session_id: session.session_id,
        wp_id: wp.id,
        verification_status: report.verification_status,
      });
      results.push({ wp, report });
      completed.add(wp.id);
    }
  }

  const last = results[results.length - 1];
  const reconcile = completeWorkPacket({
    sessionId: session.session_id,
    wp: last.wp,
    report: last.report,
    nextWpId: 'NONE',
  }, { root, validator });

  emitEvent('mpo.memory.reconciled', {
    session_id: session.session_id,
    report_path: reconcile.report_path,
    next_wp_id: reconcile.next_wp_id,
  });
  const routingLearning = updateRoutingLearningSnapshot(root, session.session_id, session.intake_packet);
  emitEvent('mpo.plan.completed', {
    session_id: session.session_id,
    completed_wps: results.length,
    report_path: reconcile.report_path,
    routing_learning_path: 'artifacts/evals/harness/latest/mpo-routing-learning.json',
  });

  return {
    results,
    reconcile,
    routing_learning: routingLearning,
    replanned,
    replanned_wp_ids: replannedWpIds,
  };
}

function createMpoPipeline({
  root = path.resolve(__dirname, '..'),
  validator = new ContractValidator({ root }),
  harnessProviderAdapter,
  flagsProvider = null,
  emitEvent = () => {},
} = {}) {
  const registry = createModuleRegistry({ root, validator });

  return {
    buildRawIntent(args) {
      return buildRawIntent({ ...args, root });
    },
    async createPlan({ goal, approvalRequested = true } = {}) {
      const sessionId = `mpo-${crypto.randomUUID()}`;
      const rawIntent = buildRawIntent({ goal, approvalRequested, root });
      emitEvent('mpo.intake.received', { session_id: sessionId, goal });
      const intakePacket = registry.get('M02')(rawIntent);
      emitEvent('mpo.intake.normalized', { session_id: sessionId, intake_packet: intakePacket });
      let dag = registry.get('M03')({ sessionId, intakePacket });
      emitEvent('mpo.decomposition.ready', { session_id: sessionId, wp_count: dag.wp_list.length });
      dag = registry.get('M04')(dag);
      dag = registry.get('M05')(dag);
      emitEvent('mpo.envelope.built', { session_id: sessionId, wp_count: dag.wp_list.length });
      dag = registry.get('M06')(dag);
      dag = applyRoutingAndVerification(dag, { flagsProvider, root });

      const approvalState = intakePacket.packet_type === 'docs' || intakePacket.packet_type === 'refactor'
        ? 'auto-approved'
        : approvalRequested === false
          ? 'auto-approved'
          : 'pending-approval';
      dag.plan_summary.approval_state = approvalState;

      return {
        session_id: sessionId,
        raw_intent: rawIntent,
        intake_packet: intakePacket,
        dag,
        approval_state: approvalState,
      };
    },
    async execute(session) {
      return executeDag(session, {
        root,
        validator,
        harnessProviderAdapter,
        flagsProvider,
        emitEvent,
      });
    },
  };
}

async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const { HarnessProviderAdapter } = require('../src/infrastructure/ai/HarnessProviderAdapter');
  const pipeline = createMpoPipeline({
    root: path.resolve(__dirname, '..'),
    harnessProviderAdapter: new HarnessProviderAdapter(),
    emitEvent: () => {},
  });
  const session = await pipeline.createPlan(input);
  if (session.approval_state === 'auto-approved') {
    const execution = await pipeline.execute(session);
    process.stdout.write(`${JSON.stringify({ session, execution }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ session }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createMpoPipeline,
  buildRawIntent,
  updateRoutingLearningSnapshot,
  normalizeReportedReadFiles,
};
