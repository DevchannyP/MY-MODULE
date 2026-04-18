'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  OpenAIResponsesProvider,
  buildOpenAiInput,
} = require('../../infrastructure/ai/OpenAIResponsesProvider');

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
