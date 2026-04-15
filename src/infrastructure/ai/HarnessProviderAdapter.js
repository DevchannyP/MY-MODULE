'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

class HarnessProviderAdapter {
  constructor({
    preferredProvider = process.env.HARNESS_PROVIDER || '',
    nullProvider = new NullHarnessProvider(),
    openAiProvider = new OpenAIResponsesProvider(),
    evalArtifactPath = DEFAULT_EVAL_ARTIFACT_PATH,
  } = {}) {
    this.preferredProvider = preferredProvider;
    this.nullProvider = nullProvider;
    this.openAiProvider = openAiProvider;
    this.evalArtifactPath = evalArtifactPath;
  }

  resolveProviderChain() {
    const requested = normalizeProviderId(this.preferredProvider, this.openAiProvider);
    if (requested === 'openai-responses') {
      return [this.openAiProvider, this.nullProvider];
    }
    return [this.nullProvider];
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
      attributes: {
        'harness.route.id': String(route.route_id || ''),
        'harness.route.mode': String(route.mode || ''),
        'harness.route.tier': String(route.selected_model_tier || ''),
      },
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
        const providerResult = {
          ...result,
          provider_id: String(result.provider_id || providerId),
          route_id: String(result.route_id || route.route_id || ''),
          selected_model_tier: String(result.selected_model_tier || route.selected_model_tier || ''),
          reasoning_effort: String(result.reasoning_effort || route.reasoning_effort || ''),
          fallback_applied: fallbackApplied || result.fallback_applied === true,
          prompt_version: String(route.prompt_version || ''),
          mode: String(route.mode || ''),
        };

        setHarnessTelemetryContext({
          prompt_version: providerResult.prompt_version,
          mode: providerResult.mode,
          model: providerResult.model,
          reasoning_effort: providerResult.reasoning_effort,
        });

        metrics.genAiClientOperationDurationMs.record(Number(providerResult.latency_ms || 0), {
          provider_id: providerResult.provider_id,
          route_id: providerResult.route_id,
          mode: providerResult.mode,
        });
        metrics.genAiClientInputTokens.add(Number(providerResult.input_tokens || 0), {
          provider_id: providerResult.provider_id,
          route_id: providerResult.route_id,
          mode: providerResult.mode,
        });
        metrics.genAiClientOutputTokens.add(Number(providerResult.output_tokens || 0), {
          provider_id: providerResult.provider_id,
          route_id: providerResult.route_id,
          mode: providerResult.mode,
        });
        if (Number(providerResult.cache_read_input_tokens || 0) > 0) {
          metrics.genAiClientCacheReadInputTokens.add(Number(providerResult.cache_read_input_tokens || 0), {
            provider_id: providerResult.provider_id,
            route_id: providerResult.route_id,
            mode: providerResult.mode,
          });
        }

        invokeSpan
          .setAttribute('harness.provider.fallback_applied', providerResult.fallback_applied)
          .setAttribute('harness.provider.model', providerResult.model)
          .setStatus('ok')
          .end();

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

        appendEvalArtifact(this.evalArtifactPath, {
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
        });

        setHarnessTelemetryContext(previousContext);

        return {
          prompt: String(providerResult.prompt || basePrompt || '').trim(),
          provider: providerResult,
        };
      } catch (error) {
        setHarnessTelemetryContext(previousContext);
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
      }
    }

    throw lastError || Object.assign(new Error('No harness provider could satisfy the request'), {
      code: 'PROVIDER_UNAVAILABLE',
    });
  }
}

module.exports = {
  HarnessProviderAdapter,
  appendEvalArtifact,
  shouldFallback,
};
