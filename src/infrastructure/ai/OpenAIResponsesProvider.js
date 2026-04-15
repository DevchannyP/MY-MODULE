'use strict';

const { estimateTokens } = require('./NullHarnessProvider');
const { AbortController } = globalThis;

function providerError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function normalizeModelTier(value) {
  const tier = String(value || 'standard').trim().toLowerCase();
  if (['frontier', 'standard', 'mini'].includes(tier)) {
    return tier;
  }
  return 'standard';
}

function resolveTimeoutMs(route = {}, explicitTimeoutMs = null) {
  if (Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }

  const tier = normalizeModelTier(route.selected_model_tier);
  if (tier === 'frontier') return 45_000;
  if (tier === 'mini') return 20_000;
  return 30_000;
}

function buildOpenAiInput({ route = {}, intakePacket = {}, basePrompt = '' } = {}) {
  const instruction = [
    'You optimize Workflow OS control-center prompts.',
    'Preserve operational intent, constraints, validation steps, and rollback awareness.',
    'Return only the optimized prompt text.',
  ].join(' ');

  const payload = {
    goal: String(intakePacket.goal || ''),
    context: Array.isArray(intakePacket.context) ? intakePacket.context : [],
    constraints: Array.isArray(intakePacket.constraints) ? intakePacket.constraints : [],
    done_when: Array.isArray(intakePacket.done_when) ? intakePacket.done_when : [],
    verification: Array.isArray(intakePacket.verification) ? intakePacket.verification : [],
    work_mode: Array.isArray(intakePacket.work_mode) ? intakePacket.work_mode : [],
    current_prompt: String(basePrompt || ''),
    route: {
      mode: String(route.mode || ''),
      route_id: String(route.route_id || ''),
      selected_model_tier: String(route.selected_model_tier || ''),
      reasoning_effort: String(route.reasoning_effort || ''),
      prompt_version: String(route.prompt_version || ''),
    },
  };

  return [
    { role: 'system', content: [{ type: 'input_text', text: instruction }] },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(payload, null, 2) }] },
  ];
}

function extractOutputText(response) {
  if (!response || typeof response !== 'object') {
    return '';
  }

  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (typeof response.prompt === 'string' && response.prompt.trim()) {
    return response.prompt.trim();
  }

  const outputs = Array.isArray(response.output) ? response.output : [];
  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      if (typeof chunk?.text === 'string' && chunk.text.trim()) {
        return chunk.text.trim();
      }
    }
  }

  return '';
}

function normalizeUsage(response, prompt, intakePacket) {
  const usage = response && typeof response.usage === 'object' ? response.usage : {};
  const inputTokens = Number(usage.input_tokens || estimateTokens(JSON.stringify(intakePacket || {})));
  const outputTokens = Number(usage.output_tokens || estimateTokens(prompt));
  const cacheReadInputTokens = Number(
    usage.input_tokens_details?.cached_tokens
    || usage.cached_input_tokens
    || 0,
  );

  return {
    input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    cache_read_input_tokens: Number.isFinite(cacheReadInputTokens) ? cacheReadInputTokens : 0,
  };
}

class OpenAIResponsesProvider {
  constructor({
    providerId = 'openai-responses',
    apiKey = process.env.OPENAI_API_KEY || '',
    baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    request = null,
    timeoutMs = null,
    modelByTier = null,
  } = {}) {
    this.providerId = providerId;
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
    this.request = typeof request === 'function' ? request : null;
    this.timeoutMs = timeoutMs;
    this.modelByTier = {
      frontier: process.env.OPENAI_MODEL_FRONTIER || 'gpt-5.4',
      standard: process.env.OPENAI_MODEL_STANDARD || 'gpt-5.2',
      mini: process.env.OPENAI_MODEL_MINI || 'gpt-5.4-mini',
      ...(modelByTier && typeof modelByTier === 'object' ? modelByTier : {}),
    };
  }

  isConfigured() {
    return Boolean(this.request) || Boolean(this.apiKey);
  }

  resolveModel(route = {}) {
    const tier = normalizeModelTier(route.selected_model_tier);
    return String(this.modelByTier[tier] || this.modelByTier.standard);
  }

  async performRequest({ payload, timeoutMs, correlationId = '', requestId = '' }) {
    if (this.request) {
      return this.request({
        payload,
        timeoutMs,
        correlationId,
        requestId,
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
      });
    }

    if (!this.apiKey) {
      throw providerError('PROVIDER_NOT_CONFIGURED', 'OPENAI_API_KEY is not configured');
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    timeoutHandle.unref?.();

    try {
      const response = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'x-correlation-id': correlationId,
          'x-request-id': requestId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw providerError('PROVIDER_AUTH_FAILED', `OpenAI provider auth failed with ${response.status}`);
      }
      if (response.status === 429) {
        throw providerError('PROVIDER_RATE_LIMITED', 'OpenAI provider rate limited the request');
      }
      if (!response.ok) {
        throw providerError('PROVIDER_UNAVAILABLE', `OpenAI provider returned ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw providerError('PROVIDER_TIMEOUT', `OpenAI provider timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async generatePromptRecommendation({
    route = {},
    intakePacket = {},
    basePrompt = '',
    correlationId = '',
    requestId = '',
  } = {}) {
    if (!this.isConfigured()) {
      throw providerError('PROVIDER_NOT_CONFIGURED', 'OpenAI provider requester or API key is not configured');
    }

    const model = this.resolveModel(route);
    const timeoutMs = resolveTimeoutMs(route, this.timeoutMs);
    const payload = {
      model,
      reasoning: {
        effort: String(route.reasoning_effort || 'medium'),
      },
      input: buildOpenAiInput({ route, intakePacket, basePrompt }),
      metadata: {
        route_id: String(route.route_id || ''),
        prompt_version: String(route.prompt_version || ''),
        mode: String(route.mode || ''),
        request_id: requestId,
        correlation_id: correlationId,
      },
    };

    const startedAt = Date.now();
    const response = await this.performRequest({
      payload,
      timeoutMs,
      correlationId,
      requestId,
    });
    const latencyMs = Date.now() - startedAt;
    const prompt = extractOutputText(response);

    if (!prompt) {
      throw providerError('PROVIDER_SCHEMA_MISMATCH', 'OpenAI provider response did not contain prompt text');
    }

    const usage = normalizeUsage(response, prompt, intakePacket);

    return {
      prompt,
      provider_id: this.providerId,
      model,
      route_id: String(route.route_id || ''),
      selected_model_tier: String(route.selected_model_tier || 'standard'),
      reasoning_effort: String(route.reasoning_effort || 'medium'),
      latency_ms: latencyMs,
      retry_count: 0,
      fallback_applied: false,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      stop_reason: typeof response.stop_reason === 'string' ? response.stop_reason : 'provider-response',
      response_id: String(response.id || ''),
    };
  }
}

module.exports = {
  OpenAIResponsesProvider,
  buildOpenAiInput,
  extractOutputText,
};
