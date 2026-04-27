'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const RELEASE_EVIDENCE_PATH = path.join(ROOT, 'artifacts/release-evidence/release-evidence.json');
const HARNESS_CONTRACT_PATH = path.join(ROOT, 'requirements/harness-engineering.yaml');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function readPromptVersionFallback() {
  if (!fs.existsSync(HARNESS_CONTRACT_PATH)) {
    return 'unknown';
  }

  const content = fs.readFileSync(HARNESS_CONTRACT_PATH, 'utf8');
  const matched = content.match(/^version:\s*"([^"]+)"/m);
  return matched ? matched[1] : 'unknown';
}

function loadHarnessReleaseMetadata() {
  const evidence = readJsonIfExists(RELEASE_EVIDENCE_PATH);
  const harnessRelease = evidence.harness_release && typeof evidence.harness_release === 'object'
    ? evidence.harness_release
    : {};

  return {
    prompt_version: String(harnessRelease.prompt_version || readPromptVersionFallback()),
    rollout_stage: String(harnessRelease.rollout_stage || 'unknown'),
    rollback_target: String(harnessRelease.rollback_target || 'unknown'),
    rollback_strategy: String(harnessRelease.rollback_strategy || 'unknown'),
    output_schema_ref: String(harnessRelease.output_schema_ref || 'contracts/harness/output.schema.json'),
    release_evidence_present: fs.existsSync(RELEASE_EVIDENCE_PATH),
  };
}

function evaluateFlag(flagsProvider, flagName) {
  if (!flagsProvider || typeof flagsProvider.isEnabled !== 'function') {
    return false;
  }

  return Boolean(flagsProvider.isEnabled(flagName, false, {
    route: '/harness-runtime',
    method: 'GET',
    userId: 'system',
    targetingKey: 'harness-runtime',
  }));
}

function bumpTier(tier) {
  if (tier === 'mini') return 'standard';
  if (tier === 'standard') return 'frontier';
  return 'frontier';
}

function resolveLegacyRouteShape(mode, toggles) {
  switch (mode) {
    case 'Research':
      return toggles.frontierResearch
        ? { route_id: 'frontier-research', selected_model_tier: 'frontier', reasoning_effort: 'high' }
        : { route_id: 'standard-research', selected_model_tier: 'standard', reasoning_effort: 'medium' };
    case 'Build':
      return toggles.miniBuild
        ? { route_id: 'mini-build', selected_model_tier: 'mini', reasoning_effort: 'medium' }
        : { route_id: 'standard-build', selected_model_tier: 'standard', reasoning_effort: 'medium' };
    case 'Debug':
      return toggles.frontierResearch
        ? { route_id: 'frontier-debug', selected_model_tier: 'frontier', reasoning_effort: 'high' }
        : { route_id: 'standard-debug', selected_model_tier: 'standard', reasoning_effort: 'high' };
    case 'Operate':
      return toggles.miniBuild
        ? { route_id: 'mini-operate', selected_model_tier: 'mini', reasoning_effort: 'medium' }
        : { route_id: 'standard-operate', selected_model_tier: 'standard', reasoning_effort: 'medium' };
    case 'Policy':
      return toggles.frontierResearch
        ? { route_id: 'frontier-policy', selected_model_tier: 'frontier', reasoning_effort: 'high' }
        : { route_id: 'standard-policy', selected_model_tier: 'standard', reasoning_effort: 'high' };
    default:
      return { route_id: 'standard-default', selected_model_tier: 'standard', reasoning_effort: 'medium' };
  }
}

function resolveMpoRouteShape({ mode, riskLevel, evidenceRequired, interactiveClass }) {
  const risk = String(riskLevel || 'medium').toLowerCase();
  let selectedModelTier = 'standard';

  if (mode === 'Research') {
    selectedModelTier = ['critical', 'high'].includes(risk) ? 'frontier' : 'standard';
  } else if (mode === 'Build') {
    if (risk === 'critical') selectedModelTier = 'standard';
    else if (risk === 'high') selectedModelTier = 'standard';
    else selectedModelTier = 'mini';
  } else if (mode === 'Debug') {
    selectedModelTier = 'standard';
  } else if (mode === 'Operate') {
    selectedModelTier = 'mini';
  } else if (mode === 'Policy') {
    selectedModelTier = 'frontier';
  }

  if (String(evidenceRequired || '').toLowerCase() === 'strict') {
    selectedModelTier = bumpTier(selectedModelTier);
  }
  if (String(interactiveClass || '').toLowerCase() === 'realtime' && selectedModelTier === 'mini') {
    selectedModelTier = 'standard';
  }

  const reasoningEffort = selectedModelTier === 'frontier'
    ? 'high'
    : mode === 'Debug'
      ? 'high'
      : 'medium';

  return {
    route_id: `${selectedModelTier}-${String(mode || 'Build').toLowerCase()}-${risk}`,
    selected_model_tier: selectedModelTier,
    reasoning_effort: reasoningEffort,
  };
}

function resolveFallbackChain(selectedModelTier) {
  if (selectedModelTier === 'frontier') {
    return ['openai-responses', 'openai-responses:standard', 'null-harness-provider'];
  }
  if (selectedModelTier === 'standard') {
    return ['openai-responses', 'null-harness-provider'];
  }
  return ['openai-responses', 'null-harness-provider'];
}

function resolveHarnessRuntimeRoute({
  mode = 'Build',
  flagsProvider = null,
  riskLevel = '',
  trustLevel = '',
  evidenceRequired = '',
  interactiveClass = '',
  budget = 0,
} = {}) {
  const release = loadHarnessReleaseMetadata();
  const toggles = {
    frontierResearch: evaluateFlag(flagsProvider, 'harness_routing_frontier_research'),
    miniBuild: evaluateFlag(flagsProvider, 'harness_routing_mini_build'),
    promptCaching: evaluateFlag(flagsProvider, 'harness_prompt_caching_enabled'),
    batchEval: evaluateFlag(flagsProvider, 'harness_batch_eval_enabled'),
  };
  const normalizedMode = String(mode || 'Build');
  const useMpoSignals = Boolean(String(riskLevel || '') || String(evidenceRequired || '') || String(interactiveClass || '') || Number(budget || 0) > 0);
  const routeShape = useMpoSignals
    ? resolveMpoRouteShape({ mode: normalizedMode, riskLevel, evidenceRequired, interactiveClass })
    : resolveLegacyRouteShape(normalizedMode, toggles);

  return {
    mode: normalizedMode,
    recipe_id: 'harness-vnext-router',
    prompt_version: release.prompt_version,
    rollout_stage: release.rollout_stage,
    rollback_target: release.rollback_target,
    rollback_strategy: release.rollback_strategy,
    output_schema_ref: release.output_schema_ref,
    release_evidence_present: release.release_evidence_present,
    route_id: routeShape.route_id,
    selected_model_tier: routeShape.selected_model_tier,
    reasoning_effort: routeShape.reasoning_effort,
    prompt_caching_enabled: toggles.promptCaching,
    batch_eval_enabled: toggles.batchEval,
    batch_recommended: toggles.batchEval && ['Research', 'Policy'].includes(normalizedMode),
    flags_consumed: [
      'harness_routing_frontier_research',
      'harness_routing_mini_build',
      'harness_prompt_caching_enabled',
      'harness_batch_eval_enabled',
    ],
    risk_level: String(riskLevel || 'medium'),
    trust_level: String(trustLevel || 'trusted'),
    evidence_required: String(evidenceRequired || 'standard'),
    interactive_class: String(interactiveClass || 'batch'),
    budget: Number(budget || 0),
    fallback_chain: resolveFallbackChain(routeShape.selected_model_tier),
    learning_record: {
      mode: normalizedMode,
      selected_model_tier: routeShape.selected_model_tier,
      risk_level: String(riskLevel || 'medium'),
      trust_level: String(trustLevel || 'trusted'),
      evidence_required: String(evidenceRequired || 'standard'),
      budget: Number(budget || 0),
    },
  };
}

module.exports = {
  resolveHarnessRuntimeRoute,
  loadHarnessReleaseMetadata,
};
