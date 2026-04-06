'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildStartupDiagnosticLines } = require('../../infrastructure/startupDiagnostic');

test('[startup diagnostic] shows env-absent hint when .env not found', () => {
  const lines = buildStartupDiagnosticLines({
    envExists: false,
    wosVarCount: 0,
    enabledFlags: [],
    envOverriddenFlags: [],
    envOverridesApplied: 0,
    flagsLoaded: true,
  });

  const text = lines.join('\n');
  assert.match(text, /없음.*flags\.yaml 기본값 사용/);
  assert.match(text, /npm run env:init/);
  assert.match(text, /활성 플래그\s*:.*없음/);
  assert.match(text, /WOS_FLAG_\* 변수\s*:.*없음/);
});

test('[startup diagnostic] shows loaded flags when .env present with overrides', () => {
  const lines = buildStartupDiagnosticLines({
    envExists: true,
    wosVarCount: 2,
    enabledFlags: ['enable_task_management', 'billing.enabled'],
    envOverriddenFlags: ['enable_task_management', 'billing.enabled'],
    envOverridesApplied: 2,
    flagsLoaded: true,
  });

  const text = lines.join('\n');
  assert.match(text, /\.env 파일\s*:.*로드됨/);
  assert.match(text, /WOS_FLAG_\* 변수\s*:.*2개 설정됨/);
  assert.match(text, /ENV 오버라이드\s*:.*enable_task_management/);
  assert.match(text, /활성 플래그\s*:.*billing\.enabled/);
  // 플래그 설정됐으니 env:init 힌트 없어야 함
  assert.doesNotMatch(text, /npm run env:init/);
});

test('[startup diagnostic] shows hint when .env present but no WOS_FLAG_ vars', () => {
  const lines = buildStartupDiagnosticLines({
    envExists: true,
    wosVarCount: 0,
    enabledFlags: [],
    envOverriddenFlags: [],
    envOverridesApplied: 0,
    flagsLoaded: true,
  });

  const text = lines.join('\n');
  assert.match(text, /\.env 파일\s*:.*로드됨/);
  assert.match(text, /WOS_FLAG_\* 변수\s*:.*없음/);
  assert.match(text, /npm run env:init/);
});

test('[startup diagnostic] shows flags.yaml load failure warning', () => {
  const lines = buildStartupDiagnosticLines({
    envExists: false,
    wosVarCount: 0,
    enabledFlags: [],
    envOverriddenFlags: [],
    envOverridesApplied: 0,
    flagsLoaded: false,
  });

  const text = lines.join('\n');
  assert.match(text, /FAIL.*yaml 로드 실패/);
});

test('[startup diagnostic] separator lines present for terminal readability', () => {
  const lines = buildStartupDiagnosticLines({
    envExists: true,
    wosVarCount: 0,
    enabledFlags: ['my_flag'],
    envOverriddenFlags: [],
    envOverridesApplied: 0,
    flagsLoaded: true,
  });

  // 첫 줄과 마지막 줄은 구분선
  assert.match(lines[0], /─{10,}/);
  assert.match(lines[lines.length - 1], /─{10,}/);
  assert.match(lines.join('\n'), /시작 진단/);
});
