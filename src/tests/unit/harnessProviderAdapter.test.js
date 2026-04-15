'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  HarnessProviderAdapter,
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
