#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * harness-check — 현재 .env 설정으로 하네스 프로바이더 체인을 원클릭 E2E 검증
 *
 * 사용법:
 *   npm run harness:check                  # null-provider 또는 live LLM 자동 선택
 *   npm run harness:check -- --mode Build  # 모드 지정 (Build|Debug|Research|Operate)
 *   npm run harness:check -- --json        # JSON 출력 (CI/파이프라인용)
 *
 * 수행 내용:
 *   1. .env를 읽어 HARNESS_PROVIDER / OPENAI_API_KEY 상태 확인
 *   2. 임시 포트(0)로 서버 기동
 *   3. POST /api/harness/prompt-recommendation 전송
 *   4. 응답(provider_id, latency_ms, prompt 미리보기) 출력
 *   5. 서버 종료 후 exit(0)
 *
 * 보안: API Key 값은 절대 출력하지 않는다.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// ── .env 로드 (node --env-file 없이 직접 파싱) ───────────────────────────────
function loadEnvFile() {
  const envPath = path.resolve(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}
loadEnvFile();

const args = process.argv.slice(2);
const JSON_MODE = args.includes('--json');
const modeIndex = args.indexOf('--mode');
const MODE = modeIndex !== -1 && args[modeIndex + 1] ? args[modeIndex + 1] : 'Build';
const BASE_PROMPT = 'harness-check: verify provider chain is healthy';

// JSON 모드에서는 서버 텔레메트리 로그를 stderr로 리다이렉트해 stdout을 오염하지 않게 한다.
// 복원 포인트를 보관하고, 최종 JSON 출력 직전에 원복한다.
const _originalStdoutWrite = process.stdout.write.bind(process.stdout);
if (JSON_MODE) {
  // 서버 텔레메트리(JSON lines)를 stderr로 보내고 최종 JSON만 stdout에 출력
  process.stdout.write = process.stderr.write.bind(process.stderr);
}

const { startServer, createAllEnabledFlags } = require('../src/server/createServer');

// ── 출력 헬퍼 ─────────────────────────────────────────────────────────────────
const sep = '─'.repeat(72);
function line(s = '') { process.stdout.write(s + '\n'); }

async function main() {
  const startedAt = Date.now();

  // ── 1. 현재 프로바이더 설정 요약 ────────────────────────────────────────────
  const harnessProvider = (process.env.HARNESS_PROVIDER || '').trim();
  const hasApiKey = Boolean((process.env.OPENAI_API_KEY || '').trim());
  const expectedProvider = (harnessProvider === 'openai' || harnessProvider === 'openai-responses') && hasApiKey
    ? 'openai-responses'
    : 'null-harness-provider';

  if (!JSON_MODE) {
    line(sep);
    line('[Workflow OS] harness:check — 프로바이더 체인 E2E 검증');
    line();
    line(`  모드            : ${MODE}`);
    line(`  예상 프로바이더  : ${expectedProvider === 'openai-responses' ? '● openai-responses (live LLM)' : '○ null-harness-provider (fallback)'}`);
    if (expectedProvider === 'null-harness-provider' && harnessProvider === 'openai') {
      line(`  ⚠ HARNESS_PROVIDER=openai 이지만 OPENAI_API_KEY 미설정 → fallback`);
    }
    line();
    line('  서버 기동 중...');
  }

  // ── 2. 서버 기동 ─────────────────────────────────────────────────────────────
  let runtime;
  try {
    runtime = await startServer({
      port: 0,
      flags: createAllEnabledFlags(),
    });
  } catch (err) {
    const msg = `서버 기동 실패: ${err.message}`;
    if (JSON_MODE) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    } else {
      line(`  ⛔ ${msg}`);
      line(sep);
    }
    process.exit(1);
  }

  // ── 3. 요청 전송 ─────────────────────────────────────────────────────────────
  let responseData;
  let httpStatus = 0;
  let requestError = null;

  try {
    const url = new URL('/api/harness/prompt-recommendation', runtime.url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': 'harness-check',
        'x-request-id': `check-${Date.now()}`,
      },
      body: JSON.stringify({ mode: MODE, basePrompt: BASE_PROMPT }),
    });
    httpStatus = response.status;
    responseData = await response.json();
  } catch (err) {
    requestError = err.message;
  } finally {
    await runtime.shutdown({ reason: 'harness-check' });
  }

  const elapsedMs = Date.now() - startedAt;

  // ── 4. 결과 출력 ─────────────────────────────────────────────────────────────
  if (JSON_MODE) {
    const output = {
      ok: httpStatus === 200 && !requestError,
      http_status: httpStatus,
      elapsed_ms: elapsedMs,
      mode: MODE,
      expected_provider: expectedProvider,
      error: requestError || (httpStatus !== 200 ? `HTTP ${httpStatus}` : null),
      provider: responseData?.provider ?? null,
      prompt_preview: typeof responseData?.prompt === 'string'
        ? responseData.prompt.slice(0, 120)
        : null,
    };
    // stdout 원복 후 JSON 출력
    process.stdout.write = _originalStdoutWrite;
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(output.ok ? 0 : 1);
  }

  if (requestError) {
    line(`  ⛔ 요청 실패: ${requestError}`);
    line(sep);
    process.exit(1);
  }

  const ok = httpStatus === 200;
  const providerId = responseData?.provider?.provider_id ?? '(알 수 없음)';
  const latencyMs = responseData?.provider?.latency_ms ?? '?';
  const fallbackApplied = responseData?.provider?.fallback_applied === true;
  const promptPreview = typeof responseData?.prompt === 'string'
    ? responseData.prompt.slice(0, 120) + (responseData.prompt.length > 120 ? '...' : '')
    : '(없음)';

  line(`  ${ok ? '✅' : '⛔'} HTTP ${httpStatus} — ${ok ? 'PASS' : 'FAIL'}`);
  line();
  line(`  실제 프로바이더 : ${providerId === 'openai-responses' ? '● ' : '○ '}${providerId}`);
  if (fallbackApplied) line(`  ⚠ 폴백 적용됨 — 1차 프로바이더 실패 후 자동 전환`);
  line(`  latency_ms     : ${latencyMs}`);
  line(`  전체 경과시간   : ${elapsedMs}ms (서버 기동 포함)`);
  line();
  line(`  prompt 미리보기:`);
  line(`    ${promptPreview}`);

  if (!ok) {
    line();
    line(`  실패 원인 : HTTP ${httpStatus}`);
    if (responseData?.detail) line(`  상세      : ${responseData.detail}`);
    line();
    line('  다음 행동:');
    line('    • 서버 로그 확인: npm start → 별도 터미널에서 위 요청 재전송');
    line('    • 플래그 확인   : npm run env:status');
  } else if (providerId === 'null-harness-provider') {
    line();
    line('  ⓘ 현재 null-provider — 추천은 입력 basePrompt를 그대로 반환합니다.');
    line('  ⓘ live LLM 연결: .env에서 HARNESS_PROVIDER=openai + OPENAI_API_KEY 설정');
  } else {
    line();
    line('  ● live LLM 응답 확인됨 — 하네스 프로바이더 체인 정상');
  }

  line();
  line(sep);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(err.message) }) + '\n');
  } else {
    process.stderr.write(`harness:check 치명적 오류: ${err.message}\n`);
  }
  process.exit(1);
});
