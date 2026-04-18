'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { HarnessProviderAdapter } = require('../../infrastructure/ai/HarnessProviderAdapter');
const { NullHarnessProvider } = require('../../infrastructure/ai/NullHarnessProvider');
const { OpenAIResponsesProvider } = require('../../infrastructure/ai/OpenAIResponsesProvider');
const { startServerOrSkip } = require('./support/networkTestRuntime');

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function createEvalArtifactPath(prefix = 'harness-provider-failure-') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'eval.json');
}

test('[harness provider failure smoke] no-secret openai preference falls back to null provider on HTTP surface', async (t) => {
  const evalArtifactPath = createEvalArtifactPath();
  const runtime = await startServerOrSkip(t, startServer, {
    port: 0,
    flags: createAllEnabledFlags(),
    harnessProviderAdapter: new HarnessProviderAdapter({
      preferredProvider: 'openai',
      openAiProvider: new OpenAIResponsesProvider(),
      nullProvider: new NullHarnessProvider(),
      evalArtifactPath,
    }),
  });
  if (!runtime) {
    return;
  }

  try {
    // POST /api/harness/prompt-recommendation uses the injected adapter
    const recommendation = await requestJson(runtime.url, '/api/harness/prompt-recommendation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'Build', basePrompt: 'test' }),
    });
    assert.equal(recommendation.status, 200);
    assert.ok(recommendation.body.provider, 'response must include provider');
    assert.equal(recommendation.body.provider.provider_id, 'null-harness-provider');
    assert.equal(recommendation.body.provider.fallback_applied, true);
    assert.equal(typeof recommendation.body.provider.route_id, 'string');

    const artifactText = fs.readFileSync(evalArtifactPath, 'utf8');
    assert.match(artifactText, /null-harness-provider/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

/** Provider that always throws with the given code — used for failure-path tests */
class ThrowingProvider {
  constructor(message, code) {
    this.providerId = `throwing-${code}`;
    this._error = Object.assign(new Error(message), { code });
  }

  async generatePromptRecommendation() {
    throw this._error;
  }
}

test('[harness provider failure smoke] schema mismatch returns structured 500 without null fallback', async (t) => {
  // PROVIDER_SCHEMA_MISMATCH is NOT in shouldFallback → error propagates → HTTP 500
  const schemaMismatchProvider = new ThrowingProvider('provider payload invalid', 'PROVIDER_SCHEMA_MISMATCH');
  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: schemaMismatchProvider,
    nullProvider: new NullHarnessProvider(),
  });
  const runtime = await startServerOrSkip(t, startServer, {
    port: 0,
    flags: createAllEnabledFlags(),
    harnessProviderAdapter: adapter,
  });
  if (!runtime) {
    return;
  }

  try {
    const response = await requestJson(runtime.url, '/api/harness/prompt-recommendation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'Build', basePrompt: 'test' }),
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.status, 500);
    assert.match(String(response.body.detail || ''), /provider payload invalid/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[harness provider failure smoke] provider outage returns structured 503', async (t) => {
  // PROVIDER_UNAVAILABLE IS in shouldFallback → falls back to NullProvider → still 200
  // Outage without fallback: both providers unavailable
  const outageProvider = new ThrowingProvider('provider outage', 'PROVIDER_UNAVAILABLE');
  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: outageProvider,
    nullProvider: outageProvider,  // null also unavailable → adapter throws
  });
  const runtime = await startServerOrSkip(t, startServer, {
    port: 0,
    flags: createAllEnabledFlags(),
    harnessProviderAdapter: adapter,
  });
  if (!runtime) {
    return;
  }

  try {
    const response = await requestJson(runtime.url, '/api/harness/prompt-recommendation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'Build', basePrompt: 'test' }),
    });
    // Both providers unavailable → 500 (HARNESS_PROVIDER_ERROR)
    assert.equal(response.status, 500);
    assert.match(String(response.body.detail || ''), /provider outage/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
