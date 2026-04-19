'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  OpenAIResponsesProvider,
  buildOpenAiInput,
  buildWorkPacketInput,
  buildPromptPayload,
  extractOutputText,
} = require('../../infrastructure/ai/OpenAIResponsesProvider');

// ── buildOpenAiInput ──────────────────────────────────────────────────────────

test('[openai responses provider] buildOpenAiInput compacts empty fields to reduce token overhead', () => {
  const input = buildOpenAiInput({
    route: {
      mode: 'Build',
      route_id: '',
      selected_model_tier: '',
      reasoning_effort: '',
      prompt_version: '',
    },
    intakePacket: {
      goal: 'provider payload compacting',
      context: [],
      constraints: ['keep contract'],
      done_when: [],
      verification: [],
      work_mode: [],
    },
    basePrompt: '',
  });

  const userPayloadText = input[1].content[0].text;
  const userPayload = JSON.parse(userPayloadText);

  assert.doesNotMatch(userPayloadText, /\n/);
  assert.deepEqual(userPayload, {
    goal: 'provider payload compacting',
    constraints: ['keep contract'],
    route: {
      mode: 'Build',
    },
  });
});

test('[openai responses provider] buildWorkPacketInput preserves route/session metadata and emits compact JSON', () => {
  const input = buildWorkPacketInput({
    route: {
      mode: 'Build',
      route_id: 'mini-build',
      selected_model_tier: 'mini',
      reasoning_effort: 'medium',
      prompt_version: '0.2.0',
    },
    sessionId: 'mpo-session-test',
    wp: {
      id: 'WP-TEST-001',
      title: 'Validate provider execution',
      allowed_paths: ['src/server/routes/**'],
      verification_bundle: {
        required: [
          {
            command: 'npm test',
            pass_criteria: 'exit code 0',
          },
        ],
      },
    },
  });

  const userPayloadText = input[1].content[0].text;
  const userPayload = JSON.parse(userPayloadText);

  assert.doesNotMatch(userPayloadText, /\n/);
  assert.equal(userPayload.session_id, 'mpo-session-test');
  assert.equal(userPayload.wp.id, 'WP-TEST-001');
  assert.equal(userPayload.route.route_id, 'mini-build');
  assert.equal(userPayload.route.prompt_version, '0.2.0');
});

// ── buildPromptPayload ────────────────────────────────────────────────────────

test('[openai responses provider] buildPromptPayload strips empty arrays and strings', () => {
  const payload = buildPromptPayload({
    route: { mode: 'Build', route_id: '', selected_model_tier: '', reasoning_effort: '', prompt_version: '' },
    intakePacket: { goal: 'test', context: [], constraints: [], done_when: [], verification: [], work_mode: [] },
    basePrompt: '',
  });
  assert.deepEqual(payload, { goal: 'test', route: { mode: 'Build' } });
});

test('[openai responses provider] buildPromptPayload keeps all non-empty fields', () => {
  const payload = buildPromptPayload({
    route: { mode: 'Research', route_id: 'frontier-research', selected_model_tier: 'frontier', reasoning_effort: 'high', prompt_version: '0.2.0' },
    intakePacket: { goal: 'plan sprint', context: ['wp=001'], constraints: ['budget'], done_when: ['PR merged'], verification: ['smoke'], work_mode: ['async'] },
    basePrompt: 'plan next sprint carefully',
  });
  assert.equal(payload.goal, 'plan sprint');
  assert.deepEqual(payload.context, ['wp=001']);
  assert.deepEqual(payload.route.selected_model_tier, 'frontier');
  assert.equal(payload.current_prompt, 'plan next sprint carefully');
});

// ── extractOutputText ─────────────────────────────────────────────────────────

test('[openai responses provider] extractOutputText reads output_text field', () => {
  assert.equal(extractOutputText({ output_text: '  optimized  ' }), 'optimized');
});

test('[openai responses provider] extractOutputText falls back to prompt field', () => {
  assert.equal(extractOutputText({ output_text: '', prompt: 'fallback prompt' }), 'fallback prompt');
});

test('[openai responses provider] extractOutputText reads nested output array', () => {
  const response = {
    output: [{ content: [{ text: 'nested text' }] }],
  };
  assert.equal(extractOutputText(response), 'nested text');
});

test('[openai responses provider] extractOutputText returns empty string for empty or unknown shape', () => {
  assert.equal(extractOutputText({}), '');
  assert.equal(extractOutputText(null), '');
  assert.equal(extractOutputText({ output_text: '   ' }), '');
  assert.equal(extractOutputText({ output: [] }), '');
});

// ── isConfigured ──────────────────────────────────────────────────────────────

test('[openai responses provider] isConfigured returns true when injected request fn is provided', () => {
  const provider = new OpenAIResponsesProvider({ request: async () => ({}) });
  assert.equal(provider.isConfigured(), true);
});

test('[openai responses provider] isConfigured returns true when apiKey is provided', () => {
  const provider = new OpenAIResponsesProvider({ apiKey: 'sk-test-key', request: null });
  assert.equal(provider.isConfigured(), true);
});

test('[openai responses provider] isConfigured returns false without key or request', () => {
  const provider = new OpenAIResponsesProvider({ apiKey: '', request: null });
  assert.equal(provider.isConfigured(), false);
});

// ── resolveModel ──────────────────────────────────────────────────────────────

test('[openai responses provider] resolveModel selects correct model for each tier', () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => ({}),
    modelByTier: { frontier: 'model-f', standard: 'model-s', mini: 'model-m' },
  });
  assert.equal(provider.resolveModel({ selected_model_tier: 'frontier' }), 'model-f');
  assert.equal(provider.resolveModel({ selected_model_tier: 'standard' }), 'model-s');
  assert.equal(provider.resolveModel({ selected_model_tier: 'mini' }), 'model-m');
});

test('[openai responses provider] resolveModel falls back to standard for unknown or missing tier', () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => ({}),
    modelByTier: { frontier: 'model-f', standard: 'model-s', mini: 'model-m' },
  });
  assert.equal(provider.resolveModel({ selected_model_tier: 'unknown-tier' }), 'model-s');
  assert.equal(provider.resolveModel({}), 'model-s');
  assert.equal(provider.resolveModel({ selected_model_tier: '  FRONTIER  ' }), 'model-f');
});

// ── generatePromptRecommendation — error paths ─────────────────────────────

test('[openai responses provider] generatePromptRecommendation keeps non-empty prompt context', async () => {
  let capturedPayload = null;
  const provider = new OpenAIResponsesProvider({
    request: async ({ payload }) => {
      capturedPayload = payload;
      return {
        output_text: 'optimized prompt',
        usage: {
          input_tokens: 12,
          output_tokens: 4,
        },
      };
    },
  });

  const result = await provider.generatePromptRecommendation({
    route: {
      mode: 'Debug',
      route_id: 'standard-debug',
      selected_model_tier: 'standard',
      reasoning_effort: 'high',
      prompt_version: '0.2.0',
    },
    intakePacket: {
      goal: 'diagnose regression',
      context: ['wp=current'],
      constraints: [],
      done_when: ['repro isolated'],
      verification: [],
      work_mode: [],
    },
    basePrompt: 'keep rollback path',
    correlationId: 'corr-openai-1',
    requestId: 'req-openai-1',
  });

  const userPayloadText = capturedPayload.input[1].content[0].text;
  const userPayload = JSON.parse(userPayloadText);

  assert.equal(result.prompt, 'optimized prompt');
  assert.doesNotMatch(userPayloadText, /\n/);
  assert.equal(userPayload.current_prompt, 'keep rollback path');
  assert.deepEqual(userPayload.route, {
    mode: 'Debug',
    route_id: 'standard-debug',
    selected_model_tier: 'standard',
    reasoning_effort: 'high',
    prompt_version: '0.2.0',
  });
});

test('[openai responses provider] generatePromptRecommendation throws PROVIDER_NOT_CONFIGURED without key or request', async () => {
  const provider = new OpenAIResponsesProvider({ apiKey: '', request: null });
  await assert.rejects(
    () => provider.generatePromptRecommendation({ route: { mode: 'Build' }, intakePacket: {} }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_NOT_CONFIGURED');
      return true;
    },
  );
});

test('[openai responses provider] generatePromptRecommendation throws PROVIDER_SCHEMA_MISMATCH on empty output', async () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => ({ output_text: '' }),
  });
  await assert.rejects(
    () => provider.generatePromptRecommendation({ route: { mode: 'Build' }, intakePacket: { goal: 'test' } }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_SCHEMA_MISMATCH');
      return true;
    },
  );
});

test('[openai responses provider] generatePromptRecommendation propagates PROVIDER_AUTH_FAILED from request fn', async () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => {
      throw Object.assign(new Error('auth failed'), { code: 'PROVIDER_AUTH_FAILED' });
    },
  });
  await assert.rejects(
    () => provider.generatePromptRecommendation({ route: { mode: 'Build' }, intakePacket: {} }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_AUTH_FAILED');
      return true;
    },
  );
});

test('[openai responses provider] generatePromptRecommendation propagates PROVIDER_RATE_LIMITED from request fn', async () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => {
      throw Object.assign(new Error('rate limited'), { code: 'PROVIDER_RATE_LIMITED' });
    },
  });
  await assert.rejects(
    () => provider.generatePromptRecommendation({ route: { mode: 'Build' }, intakePacket: {} }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_RATE_LIMITED');
      return true;
    },
  );
});

test('[openai responses provider] generatePromptRecommendation propagates PROVIDER_TIMEOUT from request fn', async () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => {
      throw Object.assign(new Error('timed out'), { code: 'PROVIDER_TIMEOUT' });
    },
  });
  await assert.rejects(
    () => provider.generatePromptRecommendation({ route: { mode: 'Build' }, intakePacket: {} }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_TIMEOUT');
      return true;
    },
  );
});

// ── generatePromptRecommendation — success result shape ───────────────────

test('[openai responses provider] generatePromptRecommendation returns correct result shape on success', async () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => ({
      output_text: 'refined sprint prompt',
      usage: { input_tokens: 50, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } },
      id: 'resp-abc123',
      stop_reason: 'end_turn',
    }),
    modelByTier: { standard: 'gpt-test', frontier: 'gpt-f', mini: 'gpt-m' },
  });

  const result = await provider.generatePromptRecommendation({
    route: { mode: 'Build', route_id: 'mini-build', selected_model_tier: 'standard', reasoning_effort: 'medium', prompt_version: '0.2.0' },
    intakePacket: { goal: 'sprint planning' },
    correlationId: 'corr-1',
    requestId: 'req-1',
  });

  assert.equal(result.prompt, 'refined sprint prompt');
  assert.equal(result.provider_id, 'openai-responses');
  assert.equal(result.model, 'gpt-test');
  assert.equal(result.input_tokens, 50);
  assert.equal(result.output_tokens, 20);
  assert.equal(result.cache_read_input_tokens, 10);
  assert.equal(result.response_id, 'resp-abc123');
  assert.equal(result.stop_reason, 'end_turn');
  assert.equal(result.fallback_applied, false);
  assert.equal(result.retry_count, 0);
});

// ── generateWorkPacketResult ────────────────────────────────────────────────

test('[openai responses provider] generateWorkPacketResult parses strict JSON payload', async () => {
  let capturedPayload = null;
  const provider = new OpenAIResponsesProvider({
    request: async ({ payload }) => {
      capturedPayload = payload;
      return {
        output_text: JSON.stringify({
          session_id: 'mpo-session-test',
          wp_id: 'WP-TEST-001',
          changed_files: ['src/server/routes/mpo.js'],
          summary: 'provider executed packet',
        }),
        usage: {
          input_tokens: 24,
          output_tokens: 16,
        },
      };
    },
    modelByTier: { standard: 'gpt-test', frontier: 'gpt-f', mini: 'gpt-m' },
  });

  const result = await provider.generateWorkPacketResult({
    route: {
      mode: 'Build',
      route_id: 'standard-build',
      selected_model_tier: 'standard',
      reasoning_effort: 'medium',
      prompt_version: '0.2.0',
    },
    sessionId: 'mpo-session-test',
    wp: {
      id: 'WP-TEST-001',
      title: 'provider execution',
      allowed_paths: ['src/server/routes/**'],
    },
    correlationId: 'corr-work-packet-1',
    requestId: 'req-work-packet-1',
  });

  const userPayloadText = capturedPayload.input[1].content[0].text;
  const userPayload = JSON.parse(userPayloadText);

  assert.equal(userPayload.session_id, 'mpo-session-test');
  assert.equal(userPayload.wp.id, 'WP-TEST-001');
  assert.equal(result.session_id, 'mpo-session-test');
  assert.equal(result.wp_id, 'WP-TEST-001');
  assert.deepEqual(result.changed_files, ['src/server/routes/mpo.js']);
  assert.equal(result.provider.provider_id, 'openai-responses');
  assert.equal(result.provider.model, 'gpt-test');
  assert.equal(result.input_tokens, 24);
  assert.equal(result.output_tokens, 16);
});

test('[openai responses provider] generateWorkPacketResult throws PROVIDER_SCHEMA_MISMATCH on invalid JSON', async () => {
  const provider = new OpenAIResponsesProvider({
    request: async () => ({
      output_text: '{ invalid-json',
    }),
  });

  await assert.rejects(
    () => provider.generateWorkPacketResult({
      route: { mode: 'Build', route_id: 'standard-build', selected_model_tier: 'standard' },
      sessionId: 'mpo-session-test',
      wp: { id: 'WP-TEST-001' },
    }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_SCHEMA_MISMATCH');
      return true;
    },
  );
});
