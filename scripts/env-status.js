#!/usr/bin/env node
//@ts-check
'use strict';

/**
 * env-status — 현재 .env의 WOS_FLAG_* 활성화 상태를 flags.yaml + metadata.json과 비교해 출력
 *
 * 사용법:
 *   node scripts/env-status.js           # 상태 표 출력
 *   node scripts/env-status.js --json    # JSON 출력 (CI/파이프라인용)
 *
 * 출력 항목:
 *   - 각 플래그의 활성(ON) / 비활성(OFF) / 누락(MISSING) 상태
 *   - 소스: env_active | env_commented | not_in_env
 *   - rollout 정책 경고 (env override는 rollout을 우회함)
 *   - 만료 플래그 경고 (expires_on < today)
 *   - phantom key 경고 (.env에 선언됐으나 flags.yaml에 없는 WOS_FLAG_* 키)
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const FLAGS_PATH = path.resolve(ROOT, 'master-shell/feature-flags/flags.yaml');
const METADATA_PATH = path.resolve(ROOT, 'master-shell/feature-flags/metadata.json');
const ENV_PATH = path.resolve(ROOT, '.env');

const args = process.argv.slice(2);
const JSON_MODE = args.includes('--json');

// ── 간이 YAML 파서 ────────────────────────────────────────────────────────
/** @param {string} text @returns {Record<string, Record<string,unknown>|unknown>} */
function parseSimpleYaml(text) {
  /** @type {Record<string, Record<string,unknown>|unknown>} */
  const result = {};
  let section = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[a-z_]+:$/.test(trimmed)) { section = trimmed.slice(0, -1); result[section] = {}; continue; }
    const kv = line.match(/^(\s*)([a-z_.]+):\s*(.*)$/);
    if (!kv) continue;
    const [, indent, key, rawVal] = kv;
    const val = rawVal.trim();
    let parsed;
    if (val === 'true') parsed = true;
    else if (val === 'false') parsed = false;
    else if (val === '' || val === 'null' || val === '~') parsed = null;
    else if (/^\d+(\.\d+)?$/.test(val)) parsed = Number(val);
    else parsed = val;
    if (indent.length > 0 && section && typeof result[section] === 'object' && result[section] !== null) {
      /** @type {Record<string,unknown>} */ (result[section])[key] = parsed;
    } else {
      section = '';
      result[key] = parsed;
    }
  }
  return result;
}

/** @param {string} flagKey @returns {string} */
function toEnvKey(flagKey) {
  return 'WOS_FLAG_' + flagKey.replace(/[.-]/g, '_').toUpperCase();
}

// ── flags.yaml 읽기 ───────────────────────────────────────────────────────
function loadFlags() {
  const text = fs.readFileSync(FLAGS_PATH, 'utf8');
  const parsed = parseSimpleYaml(text);
  /** @type {{ key: string, envKey: string, yamlDefault: boolean }[]} */
  const flags = [];
  for (const section of ['global_flags', 'plugin_flags']) {
    const group = parsed[section];
    if (group && typeof group === 'object') {
      for (const [k, v] of Object.entries(group)) {
        flags.push({ key: k, envKey: toEnvKey(k), yamlDefault: Boolean(v) });
      }
    }
  }
  return flags;
}

// ── metadata.json 읽기 ────────────────────────────────────────────────────
function loadMetadata() {
  try {
    const raw = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
    return (raw && typeof raw.flags === 'object') ? raw.flags : {};
  } catch {
    return {};
  }
}

// ── .env 파싱 ─────────────────────────────────────────────────────────────
/**
 * @param {string} envPath
 * @returns {{
 *   exists: boolean,
 *   activeKeys: Set<string>,
 *   commentedKeys: Set<string>,
 *   activeNonFlag: { key: string, value: string }[],
 * }}
 */
function parseEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return { exists: false, activeKeys: new Set(), commentedKeys: new Set(), activeNonFlag: [], commentedNonFlag: [] };
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const activeKeys = new Set();
  const commentedKeys = new Set();
  /** @type {{ key: string, value: string }[]} */
  const activeNonFlag = [];
  /** @type {{ key: string, value: string }[]} */
  const commentedNonFlag = [];

  for (const line of lines) {
    const activeLine = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (activeLine) {
      const [, key, value] = activeLine;
      if (key.startsWith('WOS_FLAG_')) {
        activeKeys.add(key);
      } else {
        activeNonFlag.push({ key, value });
      }
      continue;
    }
    const commentedLine = line.match(/^#\s*([A-Z_0-9]+)=(.*)/);
    if (commentedLine) {
      const [, key, value] = commentedLine;
      if (key.startsWith('WOS_FLAG_')) {
        commentedKeys.add(key);
      } else {
        commentedNonFlag.push({ key, value: value.trim() });
      }
    }
  }

  return { exists: true, activeKeys, commentedKeys, activeNonFlag, commentedNonFlag };
}

// ── 출력 헬퍼 ─────────────────────────────────────────────────────────────
const COL_FLAG = 33;
const COL_STATE = 10;
const COL_SOURCE = 14;

/** @param {unknown} str @param {number} len @returns {string} */
function pad(str, len) {
  return String(str).padEnd(len);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const flags = loadFlags();
  const metadata = loadMetadata();
  const env = parseEnv(ENV_PATH);
  const todayStr = today();

  // ── 분석 ──────────────────────────────────────────────────────────────
  const allEnvKeys = new Set(flags.map((f) => f.envKey));

  // phantom: WOS_FLAG_* in env but not in flags.yaml
  const phantomActive = [...env.activeKeys].filter((k) => !allEnvKeys.has(k));
  const phantomCommented = [...env.commentedKeys].filter((k) => k.startsWith('WOS_FLAG_') && !allEnvKeys.has(k));

  const rows = flags.map(({ key, envKey, yamlDefault }) => {
    const meta = metadata[key] || {};
    const active = env.activeKeys.has(envKey);
    const commented = env.commentedKeys.has(envKey);
    const inEnv = active || commented;

    const state = active ? 'ON' : 'OFF';
    const source = active ? 'env_active' : commented ? 'env_commented' : 'not_in_env';
    const effectiveValue = active ? true : yamlDefault;

    const rollout = meta.rollout && typeof meta.rollout.percentage === 'number'
      ? meta.rollout.percentage
      : null;
    const hasRollout = rollout !== null && rollout < 100;
    const rolloutWarn = active && hasRollout;  // env override bypasses rollout

    const expiresOn = typeof meta.expires_on === 'string' ? meta.expires_on : '';
    const stale = expiresOn && expiresOn < todayStr;

    return {
      key, envKey, state, source, effectiveValue,
      yamlDefault, active, inEnv,
      rollout, hasRollout, rolloutWarn, stale, expiresOn,
      owner: meta.owner || '',
      description: meta.description || '',
      stage: meta.stage || '',
    };
  });

  const activeCount = rows.filter((r) => r.active).length;
  const warnings = rows.filter((r) => r.rolloutWarn || r.stale);

  // ── AI Harness 프로바이더 섹션 (JSON + 텍스트 공통 분석) ─────────────────
  const HARNESS_KEYS = ['HARNESS_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY'];
  const SENSITIVE_KEYS = new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);

  /** @param {string} key @returns {{ active: boolean, commented: boolean, displayValue: string }} */
  function resolveHarnessVar(key) {
    const activeEntry = env.activeNonFlag.find((e) => e.key === key);
    if (activeEntry) {
      const raw = activeEntry.value.trim();
      const displayValue = SENSITIVE_KEYS.has(key)
        ? (raw ? `설정됨 (${raw.length}자)` : '비어있음 — 미설정')
        : (raw || '(빈 값)');
      return { active: Boolean(raw), commented: false, displayValue };
    }
    const commentedEntry = env.commentedNonFlag.find((e) => e.key === key);
    if (commentedEntry) {
      return { active: false, commented: true, displayValue: '주석 처리됨' };
    }
    return { active: false, commented: false, displayValue: '미설정' };
  }

  const harnessProvider = resolveHarnessVar('HARNESS_PROVIDER');
  const openaiKey = resolveHarnessVar('OPENAI_API_KEY');
  const openaiBase = resolveHarnessVar('OPENAI_BASE_URL');
  const anthropicKey = resolveHarnessVar('ANTHROPIC_API_KEY');

  const providerActiveValue = harnessProvider.active
    ? env.activeNonFlag.find((e) => e.key === 'HARNESS_PROVIDER')?.value.trim() || ''
    : '';
  const keyConfigured = openaiKey.active;
  const effectiveProvider = (providerActiveValue === 'openai' || providerActiveValue === 'openai-responses') && keyConfigured
    ? 'openai-responses'
    : 'null-harness-provider';
  const fallbackReason = effectiveProvider === 'null-harness-provider'
    ? (providerActiveValue === 'openai' && !keyConfigured ? 'OPENAI_API_KEY 미설정' : 'HARNESS_PROVIDER 미설정')
    : null;

  const harnessStatus = {
    effective_provider: effectiveProvider,
    fallback_reason: fallbackReason,
    harness_provider: { active: harnessProvider.active, commented: harnessProvider.commented, value: providerActiveValue || null },
    openai_key_configured: keyConfigured,
    openai_base_url_active: openaiBase.active,
    anthropic_key_configured: anthropicKey.active,
  };

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({
      as_of: todayStr,
      env_exists: env.exists,
      env_path: ENV_PATH,
      server_settings: env.activeNonFlag.filter((e) => !HARNESS_KEYS.includes(e.key)),
      harness: harnessStatus,
      flags: rows.map(({ key, state, source, effectiveValue, rollout, stale, expiresOn, owner, stage }) => ({
        key, state, source, effective_value: effectiveValue,
        rollout_pct: rollout,
        stale, expires_on: expiresOn,
        owner, stage,
      })),
      active_count: activeCount,
      total_flags: rows.length,
      phantom_keys: [...phantomActive, ...phantomCommented],
    }, null, 2) + '\n');
    return;
  }

  // ── 텍스트 출력 ───────────────────────────────────────────────────────
  const sep = '─'.repeat(72);
  const line = (s = '') => process.stdout.write(s + '\n');

  line(sep);
  line(`[Workflow OS] .env 플래그 활성화 상태 — ${todayStr}`);
  line();
  line(`  .env 위치 : ${ENV_PATH} (${env.exists ? '로드됨' : '없음 — flags.yaml 기본값 사용'})`);
  if (env.activeNonFlag.length > 0) {
    const serverVars = env.activeNonFlag.map(({ key, value }) => `${key}=${value}`).join('  ');
    line(`  서버 설정 : ${serverVars}`);
  }
  line();
  // ── AI Harness 프로바이더 텍스트 섹션 (공통 harnessStatus 사용) ─────────
  const effectiveProviderLabel = harnessStatus.effective_provider === 'openai-responses'
    ? '● openai-responses (live LLM)'
    : harnessStatus.fallback_reason === 'OPENAI_API_KEY 미설정'
      ? '⚠ openai 지정됐으나 OPENAI_API_KEY 미설정 → null-harness-provider (fallback)'
      : '○ null-harness-provider (fallback — 추천은 null 반환, 기능 정상)';

  line(`  ┌─ AI 하네스 프로바이더 ─────────────────────────────────────────────┐`);
  line(`  │  활성 프로바이더 : ${effectiveProviderLabel}`);
  line(`  │  HARNESS_PROVIDER : ${harnessProvider.active ? `● ${providerActiveValue}` : harnessProvider.commented ? '○ 주석 처리됨 (활성화: # 제거 후 서버 재시작)' : '○ 미설정 (기본: null-harness-provider)'}`);
  line(`  │  OPENAI_API_KEY   : ${openaiKey.active ? `● ${openaiKey.displayValue}` : openaiKey.commented ? '○ 주석 처리됨 (활성화: # 제거 후 키 입력)' : '○ 미설정'}`);
  if (openaiBase.active) {
    line(`  │  OPENAI_BASE_URL  : ● ${env.activeNonFlag.find((e) => e.key === 'OPENAI_BASE_URL')?.value.trim()}`);
  }
  if (anthropicKey.active || anthropicKey.commented) {
    line(`  │  ANTHROPIC_API_KEY: ${anthropicKey.active ? `● ${anthropicKey.displayValue}` : '○ 주석 처리됨 (예약 — 미구현)'}`);
  }
  line(`  │`);
  line(`  │  라이브 연결 방법:`);
  line(`  │    1. .env에서 HARNESS_PROVIDER=openai 주석 해제`);
  line(`  │    2. OPENAI_API_KEY=sk-... 입력`);
  line(`  │    3. npm run harness:check  → E2E 검증 (서버 자동 기동/종료)`);
  line(`  └────────────────────────────────────────────────────────────────────┘`);
  line();

  line(`  ${pad('플래그', COL_FLAG)} ${pad('상태', COL_STATE)} ${pad('소스', COL_SOURCE)} 단계      비고`);
  line(`  ${'─'.repeat(COL_FLAG)} ${'─'.repeat(COL_STATE)} ${'─'.repeat(COL_SOURCE)} ${'─'.repeat(8)} ${'─'.repeat(20)}`);

  for (const row of rows) {
    const stateLabel = row.active ? '● ON  ' : '○ OFF ';
    const sourceLabel = row.source === 'env_active' ? 'env (활성)' : row.source === 'env_commented' ? 'env (주석)' : 'flags.yaml';
    const extras = [];
    if (row.rolloutWarn) extras.push(`⚠ rollout ${row.rollout}% 우회`);
    if (row.stale) extras.push(`⚠ 만료 ${row.expiresOn}`);
    if (row.hasRollout && !row.active) extras.push(`rollout ${row.rollout}%`);

    line(`  ${pad(row.key, COL_FLAG)} ${pad(stateLabel, COL_STATE)} ${pad(sourceLabel, COL_SOURCE)} ${pad(row.stage || '-', 9)} ${extras.join(' | ')}`);
  }

  line();

  // Phantom keys
  if (phantomActive.length > 0) {
    line(`  ⛔ phantom 활성 키 (.env에 선언됐으나 flags.yaml 미등록):`);
    for (const k of phantomActive) line(`     ${k}`);
    line();
  }
  if (phantomCommented.length > 0) {
    line(`  ⚠ phantom 주석 키 (flags.yaml 미등록):`);
    for (const k of phantomCommented) line(`     ${k}`);
    line();
  }

  // Summary
  line(`  활성 플래그 : ${activeCount}/${rows.length}`);
  if (activeCount === 0) {
    line(`  모든 플래그 비활성 — 안전한 기본 상태`);
  } else {
    line(`  활성 목록  : ${rows.filter((r) => r.active).map((r) => r.key).join(', ')}`);
  }

  if (warnings.length > 0) {
    line();
    line(`  경고:`);
    for (const r of warnings) {
      if (r.rolloutWarn) line(`    [rollout 우회] ${r.key}: env 활성화로 인해 ${r.rollout}% rollout 정책 무시됨`);
      if (r.stale) line(`    [만료] ${r.key}: expires_on=${r.expiresOn} 경과 — 플래그 정리 필요`);
    }
  }

  line();
  if (!env.exists) {
    line(`  ⓘ npm run env:init  → .env 생성 후 주석 해제로 플래그 활성화`);
  } else if (activeCount === 0) {
    line(`  ⓘ .env에서 # WOS_FLAG_xxx=true 의 # 를 제거 후 서버 재시작`);
    const hasPartialRolloutFlags = rows.some((r) => r.hasRollout);
    if (hasPartialRolloutFlags) {
      line(`  ⓘ env 활성화는 rollout 정책을 우회합니다 (전체 사용자 적용)`);
    } else {
      line(`  ⓘ released 단계 플래그는 주석 제거 후 즉시 전체 적용됩니다`);
    }
  }
  line(sep);
}

main();
