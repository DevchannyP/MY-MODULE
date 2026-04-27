'use strict';

/**
 * WP-S19-001 — Harness live provider 구조 테스트
 *
 * OPENAI_API_KEY 환경변수 존재 시: HARNESS_PROVIDER=openai → provider_id=openai-responses
 * OPENAI_API_KEY 없을 때: NullProvider fallback 유지 (기존 동작 회귀 없음)
 *
 * Note: 실제 OpenAI API 호출은 수행하지 않습니다.
 *   - 키 있는 경우: 어댑터가 OpenAIResponsesProvider를 선택하는지만 확인 (네트워크 없이)
 *   - 키 없는 경우: NullProvider fallback 경로 확인
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { HarnessProviderAdapter } = require('../../infrastructure/ai/HarnessProviderAdapter');
const { NullHarnessProvider } = require('../../infrastructure/ai/NullHarnessProvider');
const { OpenAIResponsesProvider } = require('../../infrastructure/ai/OpenAIResponsesProvider');
const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

function makeTempArtifact(prefix = 'live-provider-') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'eval.json');
}

// ── Provider chain selection (no network) ────────────────────────────────────

test('[harness live provider] HARNESS_PROVIDER=openai selects openai-responses chain', () => {
  const adapter = new HarnessProviderAdapter({
    preferredProvider: 'openai',
    openAiProvider: new OpenAIResponsesProvider({ apiKey: 'sk-test-fake' }),
    nullProvider: new NullHarnessProvider(),
  });
  const chain = adapter.resolveProviderChain();
  assert.ok(chain.length >= 1, 'provider chain must not be empty');
  const first = chain[0];
  const firstId = String(first?.providerId || first?.provider_id || '');
  assert.match(firstId, /openai-responses/, 'first provider must be openai-responses');
});

test('[harness live provider] no HARNESS_PROVIDER uses null fallback chain', () => {
  const adapter = new HarnessProviderAdapter({
    preferredProvider: '',
    openAiProvider: new OpenAIResponsesProvider(),
    nullProvider: new NullHarnessProvider(),
  });
  const chain = adapter.resolveProviderChain();
  assert.equal(chain.length, 1, 'null chain must have exactly 1 provider');
  const firstId = String(chain[0]?.providerId || chain[0]?.provider_id || '');
  assert.match(firstId, /null-harness-provider/, 'must fall back to null provider');
});

test('[harness live provider] HARNESS_PROVIDER=openai with no key returns null fallback on HTTP surface', async (t) => {
  // Simulates live config without a real key → expect NullProvider fallback via HTTP
  const evalArtifactPath = makeTempArtifact();
  const runtime = await startServerOrSkip(t, startServer, {
    port: 0,
    flags: createAllEnabledFlags(),
    harnessProviderAdapter: new HarnessProviderAdapter({
      preferredProvider: 'openai',
      openAiProvider: new OpenAIResponsesProvider({ apiKey: '' }),  // empty key
      nullProvider: new NullHarnessProvider(),
      evalArtifactPath,
    }),
  });
  if (!runtime) return;

  try {
    const res = await fetch(new URL('/api/harness/prompt-recommendation', runtime.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'Build', basePrompt: 'test' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, `expected 200 but got ${res.status}: ${JSON.stringify(body)}`);
    // No real key → OpenAI provider throws PROVIDER_NOT_CONFIGURED → NullProvider fallback
    assert.ok(body.provider, 'response must include provider object');
    assert.equal(body.provider.fallback_applied, true);
    assert.match(body.provider.provider_id, /null-harness-provider/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
    fs.rmSync(evalArtifactPath, { force: true });
  }
});
