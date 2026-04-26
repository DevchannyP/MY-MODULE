#!/usr/bin/env node
//@ts-check
'use strict';

/**
 * env-init — .env 파일을 flags.yaml에서 자동 생성/갱신
 *
 * 사용법:
 *   node scripts/env-init.js           # 기존 .env에 누락된 플래그 추가
 *   node scripts/env-init.js --force   # .env 전체 재생성 (기존 내용 백업 후 덮어씀)
 *   node scripts/env-init.js --dry-run # 변경 내용만 미리 출력 (파일 미수정)
 *
 * 동작 원칙:
 *   - flags.yaml에 선언된 플래그만 출력 (phantom flag 방지)
 *   - 기존 .env의 활성 설정(주석 없는 줄)은 절대 덮어쓰지 않는다
 *   - 누락된 플래그만 주석 처리된 형태로 추가한다
 *   - --force 시 기존 파일을 .env.bak으로 백업 후 전체 재생성
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const FLAGS_PATH = path.resolve(ROOT, 'master-shell/feature-flags/flags.yaml');
const METADATA_PATH = path.resolve(ROOT, 'master-shell/feature-flags/metadata.json');
const ENV_PATH = path.resolve(ROOT, '.env');
const ENV_BAK_PATH = path.resolve(ROOT, '.env.bak');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

// ── 간이 YAML 파서 (flags.yaml 형식 전용) ────────────────────────────────
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

// ── 플래그 키 → WOS_FLAG_* 변환 ─────────────────────────────────────────
/** @param {string} flagKey @returns {string} */
function toEnvKey(flagKey) {
  return 'WOS_FLAG_' + flagKey.replace(/[.-]/g, '_').toUpperCase();
}

// ── flags.yaml 읽기 ───────────────────────────────────────────────────────
function loadFlags() {
  if (!fs.existsSync(FLAGS_PATH)) {
    process.stderr.write(`[env-init] flags.yaml를 찾을 수 없습니다: ${FLAGS_PATH}\n`);
    process.exit(1);
  }
  const text = fs.readFileSync(FLAGS_PATH, 'utf8');
  const parsed = parseSimpleYaml(text);

  /** @type {{ section: string, key: string, envKey: string, defaultValue: boolean }[]} */
  const flags = [];
  for (const section of ['global_flags', 'plugin_flags']) {
    const group = parsed[section];
    if (group && typeof group === 'object') {
      for (const [k, v] of Object.entries(group)) {
        flags.push({ section, key: k, envKey: toEnvKey(k), defaultValue: Boolean(v) });
      }
    }
  }
  return flags;
}

// ── metadata.json 읽기 (stage 정보) ──────────────────────────────────────
/** @returns {Record<string, { stage?: string }>} */
function loadMetadata() {
  if (!fs.existsSync(METADATA_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
    return (parsed && typeof parsed.flags === 'object') ? parsed.flags : {};
  } catch (_) {
    return {};
  }
}

// ── 기존 .env 파싱 ────────────────────────────────────────────────────────
/** @param {string} envPath @returns {{ lines: string[], activeKeys: Set<string>, commentedKeys: Set<string> }} */
function parseExistingEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return { lines: [], activeKeys: new Set(), commentedKeys: new Set() };
  }
  const text = fs.readFileSync(envPath, 'utf8');
  const lines = text.split('\n');
  const activeKeys = new Set();
  const commentedKeys = new Set();
  for (const line of lines) {
    const active = line.match(/^([A-Z_0-9]+)=/);
    if (active) activeKeys.add(active[1]);
    const commented = line.match(/^#\s*([A-Z_0-9]+)=/);
    if (commented) commentedKeys.add(commented[1]);
  }
  return { lines, activeKeys, commentedKeys };
}

// ── AI Harness 섹션 생성 ──────────────────────────────────────────────────
/**
 * HARNESS_PROVIDER / OPENAI_API_KEY / OPENAI_BASE_URL 은 WOS_FLAG_* 플래그가 아니므로
 * flags.yaml에 선언되지 않는다. env-init이 명시적으로 생성해야 force 재생성 후에도 보존된다.
 */
const HARNESS_VARS = ['HARNESS_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];

function buildHarnessSection() {
  return [
    `# ── AI Harness — live provider 연결 (선택) ──────────────────────────────────`,
    `# 키 없으면 NullProvider fallback — 모든 기능 정상 동작 (추천만 null 반환).`,
    `# 활성화 순서: 1) HARNESS_PROVIDER 주석 해제  2) OPENAI_API_KEY 실제 키 입력  3) npm run harness:check`,
    `#`,
    `# HARNESS_PROVIDER=openai         # "openai" 설정 시 OpenAI Responses API 사용`,
    `# OPENAI_API_KEY=sk-...           # OpenAI API 키 (필수 — 없으면 NullProvider fallback)`,
    `# OPENAI_BASE_URL=https://api.openai.com/v1  # (선택) 커스텀 엔드포인트`,
    ``,
  ];
}

// ── 스캐폴드 헤더 생성 ────────────────────────────────────────────────────
function buildScaffoldHeader() {
  const date = new Date().toISOString().slice(0, 10);
  return [
    `# Workflow OS — 환경 변수 오버라이드`,
    `# npm run env:init 으로 자동 생성됨 (${date})`,
    `# 주석(#)을 제거하면 서버 재시작 시 즉시 적용됩니다.`,
    `# 참고: flags.yaml 기본값은 모두 false (안전한 기본값).`,
    `# 현재 상태 확인: npm run env:status`,
    ``,
    `# ── 서버 설정 ───────────────────────────────────────────────────`,
    `PORT=3000`,
    `HOST=127.0.0.1`,
    ``,
  ];
}

// ── 플래그 섹션 블록 생성 (stage 인식) ───────────────────────────────────
/**
 * @param {{ section: string, key: string, envKey: string, defaultValue: boolean }[]} flags
 * @param {Record<string, { stage?: string }>} metadata
 */
function buildFlagBlocks(flags, metadata) {
  /** @type {string[]} */
  const lines = [];

  // released 단계 플래그와 internal 단계 플래그를 분리
  const released = flags.filter((f) => (metadata[f.key] || {}).stage === 'released');
  const internal = flags.filter((f) => (metadata[f.key] || {}).stage !== 'released');

  if (released.length > 0) {
    lines.push(`# ── released 단계 플래그 — 주석 제거 후 즉시 전체 적용 가능 ──────────`);
    for (const { envKey, defaultValue } of released) {
      const hint = defaultValue ? ' # yaml 기본값: true' : '';
      lines.push(`# ${envKey}=true${hint}`);
    }
    lines.push('');
  }

  if (internal.length > 0) {
    lines.push(`# ── internal 단계 플래그 — 권한/검토 후 활성화 ─────────────────────`);
    for (const { key, envKey, defaultValue } of internal) {
      const stage = (metadata[key] || {}).stage || 'internal';
      const hint = defaultValue ? ' # yaml 기본값: true' : ` # ${stage}`;
      lines.push(`# ${envKey}=true${hint}`);
    }
    lines.push('');
  }

  return lines;
}

// ── 메인 ─────────────────────────────────────────────────────────────────
function main() {
  const flags = loadFlags();
  const existing = parseExistingEnv(ENV_PATH);
  const envExists = fs.existsSync(ENV_PATH);

  if (FORCE || !envExists || existing.lines.filter((l) => l.trim() && !l.startsWith('#')).length === 0) {
    // 전체 재생성 경로
    if (FORCE && envExists) {
      if (!DRY_RUN) {
        fs.copyFileSync(ENV_PATH, ENV_BAK_PATH);
        process.stdout.write(`[env-init] 기존 .env → .env.bak 백업\n`);
      }
    }

    const metadata = loadMetadata();
    const header = buildScaffoldHeader();
    const flagLines = buildFlagBlocks(flags, metadata);
    const harnessLines = buildHarnessSection();
    const output = [...header, ...flagLines, ...harnessLines].join('\n');

    if (DRY_RUN) {
      process.stdout.write('[env-init] --dry-run 출력 미리보기:\n\n');
      process.stdout.write(output + '\n');
      process.stdout.write('\n[env-init] 파일이 수정되지 않았습니다. --force 없이 실행하면 적용됩니다.\n');
    } else {
      fs.writeFileSync(ENV_PATH, output, 'utf8');
      process.stdout.write(`[env-init] .env 생성 완료 (${flags.length}개 플래그 주석 처리됨)\n`);
      process.stdout.write(`[env-init] 활성화: 주석(#)을 제거하고 npm start 재실행\n`);
      process.stdout.write(`[env-init] AI Harness: OPENAI_API_KEY 입력 후 npm run harness:check 로 검증\n`);
    }
    return;
  }

  // 증분 추가 경로 — 기존 내용 보존, 누락된 플래그만 추가
  const allKnownEnvKeys = new Set(flags.map((f) => f.envKey));
  const missingKeys = flags.filter(
    (f) => !existing.activeKeys.has(f.envKey) && !existing.commentedKeys.has(f.envKey)
  );

  // harness 섹션 누락 여부 확인 (WOS_FLAG_* 가 아닌 비-플래그 변수)
  const harnessAbsent = HARNESS_VARS.every(
    (v) => !existing.activeKeys.has(v) && !existing.commentedKeys.has(v)
  );

  if (missingKeys.length === 0 && !harnessAbsent) {
    process.stdout.write(`[env-init] .env에 누락된 플래그가 없습니다 (${flags.length}/${flags.length} 플래그 포함됨)\n`);
    return;
  }

  const metadata = loadMetadata();
  const appendLines = [];

  if (missingKeys.length > 0) {
    appendLines.push('');
    appendLines.push(`# ── env-init ${new Date().toISOString().slice(0, 10)} 추가 (누락된 플래그) ───────────────────`);
    for (const { key, envKey, defaultValue } of missingKeys) {
      const stage = (metadata[key] || {}).stage || 'internal';
      const hint = defaultValue ? ' # yaml 기본값: true' : ` # ${stage}`;
      appendLines.push(`# ${envKey}=true${hint}`);
    }
    appendLines.push('');
  }

  if (harnessAbsent) {
    appendLines.push(...buildHarnessSection());
  }

  if (DRY_RUN) {
    const count = missingKeys.length + (harnessAbsent ? HARNESS_VARS.length : 0);
    process.stdout.write(`[env-init] --dry-run: 추가될 ${count}개 항목 (플래그 ${missingKeys.length}개 + harness ${harnessAbsent ? HARNESS_VARS.length : 0}개):\n`);
    process.stdout.write(appendLines.join('\n') + '\n');
  } else {
    const currentContent = fs.readFileSync(ENV_PATH, 'utf8');
    fs.writeFileSync(ENV_PATH, currentContent + appendLines.join('\n'), 'utf8');
    if (missingKeys.length > 0) {
      process.stdout.write(`[env-init] .env에 ${missingKeys.length}개 누락 플래그 추가 완료\n`);
      for (const { key, envKey } of missingKeys) {
        process.stdout.write(`  + ${envKey}  (${key})\n`);
      }
    }
    if (harnessAbsent) {
      process.stdout.write(`[env-init] AI Harness 섹션 추가됨 — OPENAI_API_KEY 입력 후 npm run harness:check\n`);
    }
  }

  // phantom key 경고
  const phantomKeys = [...existing.activeKeys, ...existing.commentedKeys]
    .filter((k) => k.startsWith('WOS_FLAG_') && !allKnownEnvKeys.has(k));
  if (phantomKeys.length > 0) {
    process.stderr.write(`[env-init] 경고: flags.yaml에 없는 phantom 키 발견:\n`);
    for (const k of phantomKeys) process.stderr.write(`  ? ${k}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
};
