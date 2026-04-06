//@ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 서버 시작 시 운영자가 터미널에서 즉시 확인해야 할 상태를 진단한다.
 * - .env 로드 여부
 * - WOS_FLAG_* 오버라이드 수
 * - 활성 플래그 목록
 *
 * 순수 함수 부분(`buildStartupDiagnosticLines`)은 외부 의존성 없이 테스트 가능.
 *
 * @param {{
 *   envExists: boolean,
 *   wosVarCount: number,
 *   enabledFlags: string[],
 *   envOverriddenFlags: string[],
 *   envOverridesApplied: number,
 *   flagsLoaded: boolean,
 * }} opts
 * @returns {string[]}
 */
function buildStartupDiagnosticLines(opts) {
  const {
    envExists,
    wosVarCount,
    enabledFlags,
    envOverriddenFlags,
    envOverridesApplied,
    flagsLoaded,
  } = opts;

  const sep = '─'.repeat(50);
  const lines = [
    sep,
    '[Workflow OS] 시작 진단',
    `  .env 파일       : ${envExists ? '로드됨' : '없음  (flags.yaml 기본값 사용)'}`,
    `  WOS_FLAG_* 변수 : ${wosVarCount > 0 ? String(wosVarCount) + '개 설정됨' : '없음'}`,
    `  flags.yaml 로드 : ${flagsLoaded ? 'OK' : 'FAIL — yaml 로드 실패, 모든 플래그 비활성'}`,
    `  ENV 오버라이드  : ${envOverridesApplied > 0 ? envOverriddenFlags.join(', ') : '없음'}`,
    `  활성 플래그     : ${enabledFlags.length > 0 ? enabledFlags.join(', ') : '없음 (모두 비활성)'}`,
  ];

  if (!envExists) {
    lines.push('');
    lines.push('  ⓘ  cp .env.example .env 후 WOS_FLAG_* 주석을 해제하면 플래그를 활성화할 수 있습니다.');
  } else if (envExists && wosVarCount === 0) {
    lines.push('');
    lines.push('  ⓘ  .env 파일이 있지만 WOS_FLAG_* 변수가 없습니다. .env.example을 참고하세요.');
  }

  lines.push(sep);
  return lines;
}

/**
 * 서버 프로세스 환경에서 진단 상태를 수집하여 stderr에 출력한다.
 * 실패해도 서버 시작을 막지 않는다.
 *
 * @param {{ flagsProvider?: import('./FeatureFlagProvider').FeatureFlagProvider, cwd?: string }} [opts]
 */
function emitStartupDiagnostic(opts = {}) {
  try {
    const cwd = opts.cwd || process.cwd();
    const envPath = path.resolve(cwd, '.env');
    const envExists = fs.existsSync(envPath);

    const wosVarCount = Object.keys(process.env).filter((k) => k.startsWith('WOS_FLAG_')).length;

    let flagStatus = {
      flagsLoaded: false,
      enabled_flags: /** @type {string[]} */ ([]),
      env_overridden_flags: /** @type {string[]} */ ([]),
      envOverridesApplied: 0,
    };

    if (opts.flagsProvider) {
      const s = opts.flagsProvider.getRuntimeStatus();
      flagStatus = {
        flagsLoaded: s.flagsLoaded === true,
        enabled_flags: Array.isArray(s.enabled_flags) ? s.enabled_flags : [],
        env_overridden_flags: Array.isArray(s.env_overridden_flags) ? s.env_overridden_flags : [],
        envOverridesApplied: typeof s.envOverridesApplied === 'number' ? s.envOverridesApplied : 0,
      };
    }

    const lines = buildStartupDiagnosticLines({
      envExists,
      wosVarCount,
      enabledFlags: flagStatus.enabled_flags,
      envOverriddenFlags: flagStatus.env_overridden_flags,
      envOverridesApplied: flagStatus.envOverridesApplied,
      flagsLoaded: flagStatus.flagsLoaded,
    });

    process.stderr.write(lines.join('\n') + '\n');
  } catch (_) {
    // 진단 실패가 서버 시작을 막으면 안 된다
  }
}

module.exports = { buildStartupDiagnosticLines, emitStartupDiagnostic };
