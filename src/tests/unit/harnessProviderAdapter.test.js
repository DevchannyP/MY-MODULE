'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  HarnessProviderAdapter,
  appendEvalArtifact,
  buildProviderResult,
  buildEvalArtifactEntry,
  createRouteAttributes,
  shouldFallback,
} = require('../../infrastructure/ai/HarnessProviderAdapter');
const { NullHarnessProvider } = require('../../infrastructure/ai/NullHarnessProvider');
const { OpenAIResponsesProvider } = require('../../infrastructure/ai/OpenAIResponsesProvider');

function createRoute() {
  return {
    mode: 'Build',
    route_id: 'standard-build',
    selected_model_tier: 'standard',
    reasoning_effort: 'medium',
    prompt_version: '0.2.0',
  };
}

function createIntakePacket() {
  return {
    goal: 'provider wiring을 검증한다',
    context: ['current_wp=WP-HARNESS-VNEXT-014'],
    constraints: ['기존 prompt 필드는 유지'],
    done_when: ['provider metadata가 응답에 포함된다'],
    work_mode: ['mode=Build'],
    verification: ['null fallback이 구조화 결과를 반환한다'],
  };
}

function createEvalArtifactPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-provider-')), 'eval.json');
}

// ── shouldFallback — 6 fallback codes ────────────────────────────────────────

test('[harness provider adapter] shouldFallback: PROVIDER_NOT_CONFIGURED → true', () => {
  assert.equal(shouldFallback({ code: 'PROVIDER_NOT_CONFIGURED' }), true);
});

test('[harness provider adapter] shouldFallback: PROVIDER_TIMEOUT → true', () => {
  assert.equal(shouldFallback({ code: 'PROVIDER_TIMEOUT' }), true);
});

test('[harness provider adapter] shouldFallback: PROVIDER_RATE_LIMITED → true', () => {
  assert.equal(shouldFallback({ code: 'PROVIDER_RATE_LIMITED' }), true);
});

test('[harness provider adapter] shouldFallback: PROVIDER_AUTH_FAILED → true', () => {
  assert.equal(shouldFallback({ code: 'PROVIDER_AUTH_FAILED' }), true);
});

test('[harness provider adapter] shouldFallback: PROVIDER_BUDGET_EXCEEDED → true', () => {
  assert.equal(shouldFallback({ code: 'PROVIDER_BUDGET_EXCEEDED' }), true);
});

test('[harness provider adapter] shouldFallback: PROVIDER_UNAVAILABLE → true', () => {
  assert.equal(shouldFallback({ code: 'PROVIDER_UNAVAILABLE' }), true);
});

test('[harness provider adapter] shouldFallback: PROVIDER_SCHEMA_MISMATCH → false (non-retriable)', () => {
  assert.equal(shouldFallback({ code: 'PROVIDER_SCHEMA_MISMATCH' }), false);
});

test('[harness provider adapter] shouldFallback: unknown code → false', () => {
  assert.equal(shouldFallback({ code: 'UNKNOWN_ERROR' }), false);
  assert.equal(shouldFallback({ code: '' }), false);
});

test('[harness provider adapter] shouldFallback: null or undefined error → false', () => {
  assert.equal(shouldFallback(null), false);
  assert.equal(shouldFallback(undefined), false);
  assert.equal(shouldFallback({}), false);
});

// ── buildProviderResult ───────────────────────────────────────────────────────

test('[harness provider adapter] buildProviderResult merges route fields and propagates fallbackApplied', () => {
  const result = buildProviderResult({
    result: { prompt: 'ok', provider_id: 'openai-responses', latency_ms: 300 },
    providerId: 'openai-responses',
    route: createRoute(),
    fallbackApplied: true,
  });

  assert.equal(result.provider_id, 'openai-responses');
  assert.equal(result.fallback_applied, true);
  assert.equal(result.route_id, 'standard-build');
  assert.equal(result.selected_model_tier, 'standard');
  assert.equal(result.reasoning_effort, 'medium');
  assert.equal(result.prompt_version, '0.2.0');
  assert.equal(result.mode, 'Build');
});

test('[harness provider adapter] buildProviderResult prefers result fields over route fields', () => {
  const result = buildProviderResult({
    result: {
      provider_id: 'null-harness-provider',
      route_id: 'result-route',
      selected_model_tier: 'mini',
      reasoning_effort: 'low',
    },
    providerId: 'ignored-fallback-id',
    route: { route_id: 'route-route', selected_model_tier: 'frontier', reasoning_effort: 'high', mode: 'Debug' },
    fallbackApplied: false,
  });

  assert.equal(result.provider_id, 'null-harness-provider');
  assert.equal(result.route_id, 'result-route');
  assert.equal(result.selected_model_tier, 'mini');
  assert.equal(result.reasoning_effort, 'low');
});

// ── buildEvalArtifactEntry ────────────────────────────────────────────────────

test('[harness provider adapter] buildEvalArtifactEntry produces required schema fields', () => {
  const entry = buildEvalArtifactEntry({
    provider_id: 'openai-responses',
    model: 'gpt-5.2',
    selected_model_tier: 'standard',
    route_id: 'standard-build',
    prompt_version: '0.2.0',
    mode: 'Build',
    fallback_applied: false,
    retry_count: 0,
    latency_ms: 250,
  });

  assert.ok(typeof entry.generated_at_utc === 'string');
  assert.equal(entry.provider_id, 'openai-responses');
  assert.equal(entry.model, 'gpt-5.2');
  assert.equal(entry.schema_valid, true);
  assert.equal(entry.fallback_applied, false);
  assert.equal(entry.latency_ms, 250);
});

// ── createRouteAttributes ─────────────────────────────────────────────────────

test('[harness provider adapter] createRouteAttributes maps route to OTEL attribute keys', () => {
  const attrs = createRouteAttributes({ route_id: 'mini-build', mode: 'Build', selected_model_tier: 'mini' });
  assert.equal(attrs['harness.route.id'], 'mini-build');
  assert.equal(attrs['harness.route.mode'], 'Build');
  assert.equal(attrs['harness.route.tier'], 'mini');
});

test('[harness provider adapter] createRouteAttributes returns empty strings for missing fields', () => {
  const attrs = createRouteAttributes({});
  assert.equal(attrs['harness.route.id'], '');
  assert.equal(attrs['harness.route.mode'], '');
  assert.equal(attrs['harness.route.tier'], '');
});

// ── appendEvalArtifact ────────────────────────────────────────────────────────

test('[harness provider adapter] appendEvalArtifact creates file and sets last_provider_invocation', () => {
  const filePath = createEvalArtifactPath();
  const entry = { provider_id: 'null-harness-provider', latency_ms: 0, schema_valid: true };

  appendEvalArtifact(filePath, entry);

  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(artifact.last_provider_invocation, entry);
  assert.equal(artifact.provider_invocations.length, 1);
  assert.deepEqual(artifact.provider_invocations[0], entry);
});

test('[harness provider adapter] appendEvalArtifact rotates provider_invocations to max 20 entries', () => {
  const filePath = createEvalArtifactPath();
  const existing = { provider_invocations: Array.from({ length: 20 }, (_, i) => ({ seq: i })) };
  fs.writeFileSync(filePath, JSON.stringify(existing), 'utf8');

  appendEvalArtifact(filePath, { provider_id: 'new-entry' });

  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(artifact.provider_invocations.length, 20);
  assert.equal(artifact.provider_invocations[0].provider_id, 'new-entry');
});

test('[harness provider adapter] appendEvalArtifact recovers from corrupt JSON and overwrites', () => {
  const filePath = createEvalArtifactPath();
  fs.writeFileSync(filePath, '{ invalid json', 'utf8');

  appendEvalArtifact(filePath, { provider_id: 'recovered' });

  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(artifact.last_provider_invocation.provider_id, 'recovered');
});

// ── resolveProviderChain ──────────────────────────────────────────────────────

test('[harness provider adapter] resolveProviderChain: no preferred provider → null-only chain', () => {
  const adapter = new HarnessProviderAdapter({
    preferredProvider: '',
    nullProvider: new NullHarnessProvider(),
    openAiProvider: new OpenAIResponsesProvider({ apiKey: '', request: null }),
    evalArtifactPath: createEvalArtifactPath(),
  });

  const chain = adapter.resolveProviderChain();
  assert.equal(chain.length, 1);
  assert.equal(chain[0].providerId, 'null-harness-provider');
});

test('[harness provider adapter] resolveProviderChain: openai preferred + configured → [openai, null]', () => {
  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: {
      providerId: 'openai-responses',
      isConfigured() { return true; },
    },
    nullProvider: new NullHarnessProvider(),
    evalArtifactPath: createEvalArtifactPath(),
  });

  const chain = adapter.resolveProviderChain();
  assert.equal(chain.length, 2);
  assert.equal(chain[0].providerId, 'openai-responses');
  assert.equal(chain[1].providerId, 'null-harness-provider');
});

// ── generatePromptRecommendation — additional fallback scenarios ───────────

test('[harness provider adapter] timeout fallback uses null provider and appends eval artifact', async () => {
  const evalArtifactPath = createEvalArtifactPath();
  let primaryCalls = 0;

  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: {
      providerId: 'openai-responses',
      isConfigured() {
        return true;
      },
      async generatePromptRecommendation() {
        primaryCalls += 1;
        throw Object.assign(new Error('provider timed out'), { code: 'PROVIDER_TIMEOUT' });
      },
    },
    nullProvider: new NullHarnessProvider(),
    evalArtifactPath,
  });

  const result = await adapter.generatePromptRecommendation({
    route: createRoute(),
    intakePacket: createIntakePacket(),
    basePrompt: '기본 프롬프트',
    correlationId: 'corr-1',
    requestId: 'req-1',
  });

  assert.equal(primaryCalls, 1);
  assert.equal(result.prompt, '기본 프롬프트');
  assert.equal(result.provider.provider_id, 'null-harness-provider');
  assert.equal(result.provider.fallback_applied, true);

  const artifact = JSON.parse(fs.readFileSync(evalArtifactPath, 'utf8'));
  assert.equal(artifact.last_provider_invocation.provider_id, 'null-harness-provider');
  assert.equal(artifact.last_provider_invocation.fallback_applied, true);
});

test('[harness provider adapter] schema mismatch does not fall back to null provider', async () => {
  const evalArtifactPath = createEvalArtifactPath();
  let nullCalls = 0;

  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: {
      providerId: 'openai-responses',
      isConfigured() {
        return true;
      },
      async generatePromptRecommendation() {
        throw Object.assign(new Error('response payload invalid'), { code: 'PROVIDER_SCHEMA_MISMATCH' });
      },
    },
    nullProvider: {
      providerId: 'null-harness-provider',
      isConfigured() {
        return true;
      },
      async generatePromptRecommendation() {
        nullCalls += 1;
        return { prompt: 'should not happen', provider_id: 'null-harness-provider' };
      },
    },
    evalArtifactPath,
  });

  await assert.rejects(
    adapter.generatePromptRecommendation({
      route: createRoute(),
      intakePacket: createIntakePacket(),
      basePrompt: '기본 프롬프트',
      correlationId: 'corr-2',
      requestId: 'req-2',
    }),
    (error) => error && error.code === 'PROVIDER_SCHEMA_MISMATCH',
  );
  assert.equal(nullCalls, 0);
  assert.equal(fs.existsSync(evalArtifactPath), false);
});

test('[harness provider adapter] missing live provider config falls back to null provider', async () => {
  const evalArtifactPath = createEvalArtifactPath();
  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: new OpenAIResponsesProvider(),
    nullProvider: new NullHarnessProvider(),
    evalArtifactPath,
  });

  const result = await adapter.generatePromptRecommendation({
    route: createRoute(),
    intakePacket: createIntakePacket(),
    basePrompt: '기본 프롬프트',
    correlationId: 'corr-3',
    requestId: 'req-3',
  });

  assert.equal(result.prompt, '기본 프롬프트');
  assert.equal(result.provider.provider_id, 'null-harness-provider');
  assert.equal(result.provider.fallback_applied, true);
});

test('[harness provider adapter] auth failure fallback does not leak secrets into eval artifact', async () => {
  const evalArtifactPath = createEvalArtifactPath();
  const secret = 'sk-stagee-secret';
  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: new OpenAIResponsesProvider({
      apiKey: secret,
      request: async () => {
        throw Object.assign(new Error('auth denied'), { code: 'PROVIDER_AUTH_FAILED' });
      },
    }),
    nullProvider: new NullHarnessProvider(),
    evalArtifactPath,
  });

  const result = await adapter.generatePromptRecommendation({
    route: createRoute(),
    intakePacket: createIntakePacket(),
    basePrompt: '기본 프롬프트',
    correlationId: 'corr-4',
    requestId: 'req-4',
  });

  assert.equal(result.provider.provider_id, 'null-harness-provider');
  assert.equal(result.provider.fallback_applied, true);

  const artifactText = fs.readFileSync(evalArtifactPath, 'utf8');
  assert.doesNotMatch(artifactText, /sk-stagee-secret/);
});

test('[harness provider adapter] rate limit triggers fallback to null provider', async () => {
  const evalArtifactPath = createEvalArtifactPath();

  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: {
      providerId: 'openai-responses',
      isConfigured() { return true; },
      async generatePromptRecommendation() {
        throw Object.assign(new Error('rate limited'), { code: 'PROVIDER_RATE_LIMITED' });
      },
    },
    nullProvider: new NullHarnessProvider(),
    evalArtifactPath,
  });

  const result = await adapter.generatePromptRecommendation({
    route: createRoute(),
    intakePacket: createIntakePacket(),
    basePrompt: 'rate limit test prompt',
    correlationId: 'corr-5',
    requestId: 'req-5',
  });

  assert.equal(result.provider.provider_id, 'null-harness-provider');
  assert.equal(result.provider.fallback_applied, true);
  assert.equal(result.prompt, 'rate limit test prompt');
});

test('[harness provider adapter] budget exceeded triggers fallback to null provider', async () => {
  const evalArtifactPath = createEvalArtifactPath();

  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: {
      providerId: 'openai-responses',
      isConfigured() { return true; },
      async generatePromptRecommendation() {
        throw Object.assign(new Error('budget exceeded'), { code: 'PROVIDER_BUDGET_EXCEEDED' });
      },
    },
    nullProvider: new NullHarnessProvider(),
    evalArtifactPath,
  });

  const result = await adapter.generatePromptRecommendation({
    route: createRoute(),
    intakePacket: createIntakePacket(),
    basePrompt: 'budget test prompt',
    correlationId: 'corr-6',
    requestId: 'req-6',
  });

  assert.equal(result.provider.provider_id, 'null-harness-provider');
  assert.equal(result.provider.fallback_applied, true);
});

test('[harness provider adapter] both providers fail — throws primary error without null provider fallback', async () => {
  const evalArtifactPath = createEvalArtifactPath();
  const primaryError = Object.assign(new Error('openai unavailable'), { code: 'PROVIDER_UNAVAILABLE' });
  const nullError = Object.assign(new Error('null also failed'), { code: 'PROVIDER_UNAVAILABLE' });

  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: {
      providerId: 'openai-responses',
      isConfigured() { return true; },
      async generatePromptRecommendation() { throw primaryError; },
    },
    nullProvider: {
      providerId: 'null-harness-provider',
      async generatePromptRecommendation() { throw nullError; },
    },
    evalArtifactPath,
  });

  await assert.rejects(
    adapter.generatePromptRecommendation({
      route: createRoute(),
      intakePacket: createIntakePacket(),
      basePrompt: 'both fail',
      correlationId: 'corr-7',
      requestId: 'req-7',
    }),
    (error) => error.message === 'null also failed',
  );
});
