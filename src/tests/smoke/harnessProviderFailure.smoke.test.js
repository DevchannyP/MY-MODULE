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
    const recommendation = await requestJson(runtime.url, '/api/automation/optimize-prompt');
    assert.equal(recommendation.status, 200);
    assert.equal(recommendation.body.provider.provider_id, 'null-harness-provider');
    assert.equal(recommendation.body.provider.fallback_applied, true);
    assert.equal(typeof recommendation.body.harness_runtime.route_id, 'string');

    const artifactText = fs.readFileSync(evalArtifactPath, 'utf8');
    assert.match(artifactText, /null-harness-provider/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[harness provider failure smoke] schema mismatch returns structured 500 without null fallback', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, {
    port: 0,
    flags: createAllEnabledFlags(),
    harnessProviderAdapter: {
      async generatePromptRecommendation() {
        throw Object.assign(new Error('provider payload invalid'), { code: 'PROVIDER_SCHEMA_MISMATCH' });
      },
    },
  });
  if (!runtime) {
    return;
  }

  try {
    const response = await requestJson(runtime.url, '/api/automation/optimize-prompt');
    assert.equal(response.status, 500);
    assert.equal(response.body.status, 500);
    assert.match(String(response.body.type || ''), /internal-error/);
    assert.match(String(response.body.detail || ''), /provider payload invalid/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[harness provider failure smoke] provider outage returns structured 503', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, {
    port: 0,
    flags: createAllEnabledFlags(),
    harnessProviderAdapter: {
      async generatePromptRecommendation() {
        throw Object.assign(new Error('provider outage'), { code: 'PROVIDER_UNAVAILABLE' });
      },
    },
  });
  if (!runtime) {
    return;
  }

  try {
    const response = await requestJson(runtime.url, '/api/automation/optimize-prompt');
    assert.equal(response.status, 503);
    assert.equal(response.body.status, 503);
    assert.match(String(response.body.type || ''), /service-unavailable/);
    assert.match(String(response.body.detail || ''), /provider outage/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
