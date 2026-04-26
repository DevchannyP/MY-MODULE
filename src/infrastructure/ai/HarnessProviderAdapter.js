'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractValidator } = require('../mpo/ContractValidator');

const {
  tracer,
  metrics,
  logger,
  getHarnessTelemetryContext,
  setHarnessTelemetryContext,
} = require('../telemetry');
const { NullHarnessProvider } = require('./NullHarnessProvider');
const { OpenAIResponsesProvider } = require('./OpenAIResponsesProvider');

const DEFAULT_EVAL_ARTIFACT_PATH = path.resolve(
  __dirname,
  '../../../artifacts/evals/harness/latest/harness-eval-report.json',
);
const MAX_CONTEXT_FILE_BYTES = 24_000;
const MAX_CONTEXT_FILES = 16;

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function normalizeProviderId(value, openAiProvider = null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'openai-responses') {
    return 'openai-responses';
  }
  if (!normalized && openAiProvider && typeof openAiProvider.isConfigured === 'function' && openAiProvider.isConfigured()) {
    return 'openai-responses';
  }
  return 'null-harness-provider';
}

function shouldFallback(error) {
  const code = String(error?.code || '').trim();
  return [
    'PROVIDER_NOT_CONFIGURED',
    'PROVIDER_TIMEOUT',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_AUTH_FAILED',
    'PROVIDER_BUDGET_EXCEEDED',
    'PROVIDER_UNAVAILABLE',
  ].includes(code);
}

function appendEvalArtifact(filePath, entry) {
  const target = path.resolve(filePath || DEFAULT_EVAL_ARTIFACT_PATH);
  ensureDir(path.dirname(target));

  let current = {};
  if (fs.existsSync(target)) {
    try {
      current = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (_) {
      current = {};
    }
  }

  const invocations = Array.isArray(current.provider_invocations) ? current.provider_invocations.slice(0, 19) : [];
  invocations.unshift(entry);
  current.provider_invocations = invocations;
  current.last_provider_invocation = entry;

  if (!current.generated_at_utc) {
    current.generated_at_utc = new Date().toISOString();
  }

  fs.writeFileSync(target, JSON.stringify(current, null, 2) + '\n', 'utf8');
}

function createRouteAttributes(route = {}) {
  return {
    'harness.route.id': String(route.route_id || ''),
    'harness.route.mode': String(route.mode || ''),
    'harness.route.tier': String(route.selected_model_tier || ''),
  };
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function matchesPathPattern(relativePath, pattern) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern);
  if (!normalizedPath || !normalizedPattern) {
    return false;
  }
  if (normalizedPattern.endsWith('/**')) {
    return normalizedPath.startsWith(normalizedPattern.slice(0, -3));
  }
  return normalizedPath === normalizedPattern;
}

function readTextSlice(filePath, { lineStart = null, lineEnd = null, line_start: lineStartSnake = null, line_end: lineEndSnake = null } = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  const startLine = Number.isInteger(lineStart) ? lineStart : lineStartSnake;
  const endLine = Number.isInteger(lineEnd) ? lineEnd : lineEndSnake;
  if (!Number.isInteger(endLine)) {
    return text.slice(0, MAX_CONTEXT_FILE_BYTES);
  }
  const lines = text.split('\n');
  const start = Math.max(1, Number(startLine || 1)) - 1;
  const end = Math.max(start + 1, Number(endLine || lines.length));
  return lines.slice(start, end).join('\n').slice(0, MAX_CONTEXT_FILE_BYTES);
}

function buildTrustedContextFromEnvelope(wp = {}, root = path.resolve(__dirname, '../../..')) {
  const envelope = wp.context_envelope && typeof wp.context_envelope === 'object'
    ? wp.context_envelope
    : {};
  const canonicalFiles = Array.isArray(envelope.canonical_files) ? envelope.canonical_files : [];
  const partialFiles = Array.isArray(envelope.partial_files) ? envelope.partial_files : [];
  const plannedEntries = canonicalFiles.map((entry) => ({
    path: normalizeRelativePath(entry),
    scope: 'full',
  })).concat(partialFiles.map((entry) => ({
    path: normalizeRelativePath(entry && entry.path),
    scope: 'partial',
    line_start: Number(entry && entry.line_start) || 1,
    line_end: Number(entry && entry.line_end) || null,
  }))).filter((entry) => entry.path).slice(0, MAX_CONTEXT_FILES);

  const trustedFiles = [];
  const omittedFiles = [];
  const forbiddenPatterns = [
    ...(Array.isArray(wp.forbidden_paths) ? wp.forbidden_paths : []),
    'node_modules/**',
    '.git/**',
  ];
  plannedEntries.forEach((entry) => {
    if (forbiddenPatterns.some((pattern) => matchesPathPattern(entry.path, pattern))) {
      omittedFiles.push({ path: entry.path, reason: 'forbidden_path' });
      return;
    }
    const absolutePath = path.resolve(root, entry.path);
    const relative = path.relative(root, absolutePath).replace(/\\/g, '/');
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      omittedFiles.push({ path: entry.path, reason: 'outside_runtime_root' });
      return;
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      omittedFiles.push({ path: entry.path, reason: 'missing_or_not_file' });
      return;
    }
    trustedFiles.push({
      path: entry.path,
      scope: entry.scope,
      line_start: entry.line_start,
      line_end: entry.line_end,
      content: readTextSlice(absolutePath, entry),
    });
  });

  return {
    trusted_context: trustedFiles,
    omitted_context: omittedFiles,
    expected_read_files: trustedFiles.map((entry) => entry.path),
  };
}

function buildProviderWorkPacket(wp = {}, root = path.resolve(__dirname, '../../..')) {
  const executionContext = buildTrustedContextFromEnvelope(wp, root);
  return {
    ...wp,
    execution_context: executionContext,
  };
}

function providerRequiresReadFiles(providerId, providerWp = {}) {
  if (String(providerId || '') === 'null-harness-provider') {
    return false;
  }
  return Array.isArray(providerWp.execution_context?.trusted_context)
    && providerWp.execution_context.trusted_context.length > 0;
}

function buildProviderResult({ result = {}, providerId = '', route = {}, fallbackApplied = false } = {}) {
  return {
    ...result,
    provider_id: String(result.provider_id || providerId),
    route_id: String(result.route_id || route.route_id || ''),
    selected_model_tier: String(result.selected_model_tier || route.selected_model_tier || ''),
    reasoning_effort: String(result.reasoning_effort || route.reasoning_effort || ''),
    fallback_applied: fallbackApplied || result.fallback_applied === true,
    prompt_version: String(route.prompt_version || ''),
    mode: String(route.mode || ''),
  };
}

function recordProviderMetrics(providerResult) {
  const attributes = {
    provider_id: providerResult.provider_id,
    route_id: providerResult.route_id,
    mode: providerResult.mode,
  };

  metrics.genAiClientOperationDurationMs.record(Number(providerResult.latency_ms || 0), attributes);
  metrics.genAiClientInputTokens.add(Number(providerResult.input_tokens || 0), attributes);
  metrics.genAiClientOutputTokens.add(Number(providerResult.output_tokens || 0), attributes);

  if (Number(providerResult.cache_read_input_tokens || 0) > 0) {
    metrics.genAiClientCacheReadInputTokens.add(Number(providerResult.cache_read_input_tokens || 0), attributes);
  }
}

function logProviderSuccess({ providerResult, correlationId = '', requestId = '' }) {
  logger.info('harness.provider.invoke', {
    correlation_id: correlationId,
    request_id: requestId,
    provider_id: providerResult.provider_id,
    model: providerResult.model,
    route_id: providerResult.route_id,
    reasoning_effort: providerResult.reasoning_effort,
    prompt_version: providerResult.prompt_version,
    retry_count: Number(providerResult.retry_count || 0),
    fallback_applied: providerResult.fallback_applied,
    latency_ms: Number(providerResult.latency_ms || 0),
    input_tokens: Number(providerResult.input_tokens || 0),
    output_tokens: Number(providerResult.output_tokens || 0),
  });
}

function buildEvalArtifactEntry(providerResult) {
  return {
    generated_at_utc: new Date().toISOString(),
    provider_id: providerResult.provider_id,
    model: providerResult.model,
    selected_model_tier: providerResult.selected_model_tier,
    route_id: providerResult.route_id,
    prompt_version: providerResult.prompt_version,
    mode: providerResult.mode,
    schema_valid: true,
    fallback_applied: providerResult.fallback_applied,
    retry_count: Number(providerResult.retry_count || 0),
    latency_ms: Number(providerResult.latency_ms || 0),
  };
}

class HarnessProviderAdapter {
  constructor({
    preferredProvider = process.env.HARNESS_PROVIDER || '',
    nullProvider = new NullHarnessProvider(),
    openAiProvider = new OpenAIResponsesProvider(),
    evalArtifactPath = DEFAULT_EVAL_ARTIFACT_PATH,
    root = path.resolve(__dirname, '../../..'),
  } = {}) {
    this.preferredProvider = preferredProvider;
    this.nullProvider = nullProvider;
    this.openAiProvider = openAiProvider;
    this.evalArtifactPath = evalArtifactPath;
    this.root = root;
    this.contractValidator = new ContractValidator({ root });
  }

  resolveProviderChain() {
    const requested = normalizeProviderId(this.preferredProvider, this.openAiProvider);
    if (requested === 'openai-responses') {
      return [this.openAiProvider, this.nullProvider];
    }
    return [this.nullProvider];
  }

  resolveProviderResult(route = {}) {
    const chain = this.resolveProviderChain();
    const primary = chain[0] || this.nullProvider;
    return {
      provider_id: String(primary?.providerId || primary?.provider_id || 'null-harness-provider'),
      route_id: String(route.route_id || ''),
      selected_model_tier: String(route.selected_model_tier || 'standard'),
      reasoning_effort: String(route.reasoning_effort || 'medium'),
      fallback_applied: false,
      model: String(route.selected_model_tier || 'standard'),
    };
  }

  ensureOutputSchema(report) {
    this.contractValidator.validateOutput('contracts/harness/output.schema.json', report, 'WPExecutionResult');
    this.contractValidator.validateOutput('contracts/harness/completion-report.schema.json', report, 'CompletionReport');
    return report;
  }

  async generatePromptRecommendation({
    route = {},
    intakePacket = {},
    basePrompt = '',
    correlationId = '',
    requestId = '',
  } = {}) {
    const providerChain = this.resolveProviderChain();
    const routeSpan = tracer.startSpan('harness.provider.route', {
      attributes: createRouteAttributes(route),
    });
    routeSpan.setStatus('ok').end();

    let lastError = null;
    let fallbackApplied = false;

    for (let index = 0; index < providerChain.length; index += 1) {
      const provider = providerChain[index];
      const providerId = String(provider?.providerId || provider?.provider_id || `provider-${index}`);
      const invokeSpan = tracer.startSpan('harness.provider.invoke', {
        attributes: {
          'harness.provider.id': providerId,
          'harness.route.id': String(route.route_id || ''),
          'harness.route.mode': String(route.mode || ''),
        },
      });
      const previousContext = getHarnessTelemetryContext();

      try {
        const result = await provider.generatePromptRecommendation({
          route,
          intakePacket,
          basePrompt,
          correlationId,
          requestId,
        });
        const providerResult = buildProviderResult({
          result,
          providerId,
          route,
          fallbackApplied,
        });

        setHarnessTelemetryContext({
          prompt_version: providerResult.prompt_version,
          mode: providerResult.mode,
          model: providerResult.model,
          reasoning_effort: providerResult.reasoning_effort,
        });

        recordProviderMetrics(providerResult);

        invokeSpan
          .setAttribute('harness.provider.fallback_applied', providerResult.fallback_applied)
          .setAttribute('harness.provider.model', providerResult.model)
          .setStatus('ok')
          .end();

        logProviderSuccess({ providerResult, correlationId, requestId });
        appendEvalArtifact(this.evalArtifactPath, buildEvalArtifactEntry(providerResult));

        return {
          prompt: String(providerResult.prompt || basePrompt || '').trim(),
          provider: providerResult,
        };
      } catch (error) {
        invokeSpan.recordException(error).setStatus('error').end();
        lastError = error;

        logger.warn('harness.provider.invoke_failed', {
          correlation_id: correlationId,
          request_id: requestId,
          provider_id: providerId,
          route_id: String(route.route_id || ''),
          error_code: String(error?.code || 'INTERNAL_ERROR'),
          error_message: String(error?.message || 'unknown provider error'),
        });

        if (index < providerChain.length - 1 && shouldFallback(error)) {
          fallbackApplied = true;
          const fallbackSpan = tracer.startSpan('harness.provider.fallback', {
            attributes: {
              'harness.provider.from': providerId,
              'harness.provider.to': String(providerChain[index + 1]?.providerId || ''),
              'harness.provider.reason': String(error?.code || 'INTERNAL_ERROR'),
            },
          });
          fallbackSpan.setStatus('ok').end();
          continue;
        }

        throw error;
      } finally {
        setHarnessTelemetryContext(previousContext);
      }
    }

    throw lastError || Object.assign(new Error('No harness provider could satisfy the request'), {
      code: 'PROVIDER_UNAVAILABLE',
    });
  }

  async executeWorkPacket({
    route = {},
    sessionId = '',
    wp = {},
    correlationId = '',
    requestId = '',
  } = {}) {
    const providerChain = this.resolveProviderChain();
    let lastError = null;
    let fallbackApplied = false;

    for (let index = 0; index < providerChain.length; index += 1) {
      const provider = providerChain[index];
      const providerId = String(provider?.providerId || provider?.provider_id || `provider-${index}`);
      try {
        if (typeof provider.generateWorkPacketResult !== 'function') {
          throw Object.assign(new Error(`Provider ${providerId} does not support work packet execution`), {
            code: 'PROVIDER_UNAVAILABLE',
          });
        }
        const providerWp = buildProviderWorkPacket(wp, this.root);
        const result = await provider.generateWorkPacketResult({
          route,
          sessionId,
          wp: providerWp,
          correlationId,
          requestId,
        });
        if (providerRequiresReadFiles(providerId, providerWp) && !Array.isArray(result.read_files)) {
          throw Object.assign(new Error(`Provider ${providerId} omitted required read_files array`), {
            code: 'PROVIDER_SCHEMA_MISMATCH',
          });
        }
        const providerMeta = result.provider || this.resolveProviderResult(route);
        const normalized = {
          ...result,
          session_id: String(result.session_id || sessionId),
          wp_id: String(result.wp_id || wp.id || ''),
          changed_files: Array.isArray(result.changed_files) ? result.changed_files : [],
          read_files: Array.isArray(result.read_files) ? result.read_files : [],
          provider: {
            ...providerMeta,
            provider_id: String(providerMeta.provider_id || providerId),
            route_id: String(providerMeta.route_id || route.route_id || ''),
            selected_model_tier: String(providerMeta.selected_model_tier || route.selected_model_tier || 'standard'),
            fallback_applied: fallbackApplied || providerMeta.fallback_applied === true,
          },
        };
        appendEvalArtifact(this.evalArtifactPath, {
          generated_at_utc: new Date().toISOString(),
          provider_id: normalized.provider.provider_id,
          route_id: normalized.provider.route_id,
          selected_model_tier: normalized.provider.selected_model_tier,
          session_id: normalized.session_id,
          wp_id: normalized.wp_id,
          schema_valid: true,
          fallback_applied: normalized.provider.fallback_applied,
          latency_ms: Number(result.latency_ms || 0),
        });
        return normalized;
      } catch (error) {
        lastError = error;
        if (index < providerChain.length - 1 && shouldFallback(error)) {
          fallbackApplied = true;
          continue;
        }
        throw error;
      }
    }

    throw lastError || Object.assign(new Error('No harness provider could execute the work packet'), {
      code: 'PROVIDER_UNAVAILABLE',
    });
  }
}

module.exports = {
  HarnessProviderAdapter,
  appendEvalArtifact,
  buildProviderResult,
  buildEvalArtifactEntry,
  buildProviderWorkPacket,
  buildTrustedContextFromEnvelope,
  matchesPathPattern,
  providerRequiresReadFiles,
  createRouteAttributes,
  logProviderSuccess,
  recordProviderMetrics,
  shouldFallback,
};
