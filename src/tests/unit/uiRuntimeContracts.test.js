'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildControlCenterRuntimeState,
} = require('../../shared/uiRuntimeContracts');

test('[ui runtime contracts] control center runtime exposes execution guidance for control and failure visibility', () => {
  const state = buildControlCenterRuntimeState({
    flagStatus: {
      enabled_flags: ['system_api.rollback_ui.enabled'],
    },
    bridgeState: {
      sessions: [{ pts: '/dev/pts/1', label: 'Primary PTY' }],
      lastPromptText: 'retry this prompt',
      lastError: {
        action: 'prompt',
        worker: 'Broken Worker',
        pts: '/dev/pts/99999',
        error: '알 수 없는 PTY 세션입니다: /dev/pts/99999',
      },
    },
    schedulerStatus: {
      running: false,
      last_activity: {
        action: 'prompt',
        worker: 'Broken Worker',
        pts: '/dev/pts/99999',
        error: '알 수 없는 PTY 세션입니다: /dev/pts/99999',
      },
    },
  });

  assert.ok(state.execution.guidance);
  assert.match(state.execution.guidance.control_summary, /프롬프트 전송: 가능/);
  assert.match(state.execution.guidance.control_summary, /롤백: 가능/);
  assert.match(state.execution.guidance.control_summary, /로그 확인: 표시 중/);
  assert.match(state.execution.guidance.failure_summary, /Broken Worker/);
  assert.match(state.execution.guidance.failure_summary, /알 수 없는 PTY 세션입니다/);
  assert.equal(state.execution.guidance.next_action, state.execution.next_action);
  assert.equal(state.execution.guidance.controls.find((item) => item.id === 'retry_last_prompt')?.enabled, true);
  assert.equal(state.execution.guidance.controls.find((item) => item.id === 'rollback')?.enabled, true);
  assert.match(state.user_controls.control_readiness.summary, /실행 제어/);
  assert.equal(state.user_controls.control_readiness.items.find((item) => item.id === 'log_visibility')?.enabled, true);
  assert.equal(state.user_controls.control_readiness.items.find((item) => item.id === 'log_visibility')?.status_label, '표시 중');
});
