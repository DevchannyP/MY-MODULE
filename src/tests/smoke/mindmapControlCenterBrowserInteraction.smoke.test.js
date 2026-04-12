'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

async function requestText(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  return {
    status: response.status,
    text: await response.text(),
  };
}

async function requestJson(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('[mindmap control center browser interaction smoke] selected worker wiring reaches send-now runtime path', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const mindmap = await requestText(runtime.url, '/mindmap/index.html');
    assert.equal(mindmap.status, 200);
    assert.match(mindmap.text, /id="execution-worker-select"/);
    assert.match(mindmap.text, /id="execution-rollback-target"/);
    assert.match(mindmap.text, /id="execution-stage-select"/);
    assert.match(mindmap.text, /Stage dry-run/);
    assert.match(mindmap.text, /Stage execute/);
    assert.match(mindmap.text, /최근 이력/);
    assert.match(mindmap.text, /전체 보기/);
    assert.match(mindmap.text, /실패\/차단만/);
    assert.match(mindmap.text, /execute만/);
    assert.match(mindmap.text, /실패 우선 정렬/);
    assert.match(mindmap.text, /최신순 정렬/);
    assert.match(mindmap.text, /최근 실패 우선/);
    assert.match(mindmap.text, /실패 명령:/);
    assert.match(mindmap.text, /선행 조건:/);
    assert.match(mindmap.text, /같은 신호 탐색/);
    assert.match(mindmap.text, /매칭 /);
    assert.match(mindmap.text, /현재 포커스/);
    assert.match(mindmap.text, /같은 신호/);
    assert.match(mindmap.text, /탐색 기준/);
    assert.match(mindmap.text, /현재 포커스 이력/);
    assert.match(mindmap.text, /현재 포커스 배치/);
    assert.match(mindmap.text, /상단 고정/);
    assert.match(mindmap.text, /보조 이력/);
    assert.match(mindmap.text, /현재 포커스 카드/);
    assert.match(mindmap.text, /같은 신호 그룹에서 현재 포커스 이력을 최상단에 고정했습니다\./);
    assert.match(mindmap.text, /gate /);
    assert.match(mindmap.text, /stageRunFailureBadgeMarkupWithHandler\(highlightedHistoryReport, highlightedHistoryEntry\.index, 'focusPinnedStageRunFailureSignal'\)/);
    assert.match(mindmap.text, /현재 포커스 dry-run/);
    assert.match(mindmap.text, /현재 포커스 execute/);
    assert.match(mindmap.text, /같은 신호만 보기/);
    assert.match(mindmap.text, /전체 이력 복원/);
    assert.match(mindmap.text, /같은 신호 접기/);
    assert.match(mindmap.text, /같은 신호 펼치기/);
    assert.match(mindmap.text, /이전 매칭/);
    assert.match(mindmap.text, /다음 매칭/);
    assert.match(mindmap.text, /focusStageRunFailureSignal\('failed_command'/);
    assert.match(mindmap.text, /focusStageRunFailureSignal\('prerequisites'/);
    assert.match(mindmap.text, /focusPinnedStageRunFailureSignal\('failed_command'/);
    assert.match(mindmap.text, /focusPinnedStageRunFailureSignal\('prerequisites'/);
    assert.match(mindmap.text, /function stepStageRunFailureMatch\(direction\)/);
    assert.match(mindmap.text, /function setStageRunSignalHistoryView\(mode\)/);
    assert.match(mindmap.text, /function setStageRunSignalGroupCollapsed\(collapsed\)/);
    assert.match(mindmap.text, /function stageRunMatchedCountLabel\(\)/);
    assert.match(mindmap.text, /function stageRunSecondaryMatchCountLabel\(\)/);
    assert.match(mindmap.text, /function stageRunQualityGateTone\(report\)/);
    assert.match(mindmap.text, /function focusPinnedStageRunFailureSignal\(signalType, historyIndex\)/);
    assert.match(mindmap.text, /function stageRunFocusedSignalLabel\(\)/);
    assert.match(mindmap.text, /function pinStageRunFocusedEntry\(entries\)/);
    assert.match(mindmap.text, /execution-history-item-\d+/);
    assert.match(mindmap.text, /is-highlighted/);
    assert.match(mindmap.text, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
    assert.match(mindmap.text, /실패 위치/);
    assert.match(mindmap.text, /실패 원인/);
    assert.match(mindmap.text, /가능한 다음 행동/);
    assert.match(mindmap.text, /첫 실패 불러오기/);
    assert.match(mindmap.text, /첫 실패 dry-run/);
    assert.match(mindmap.text, /첫 실패 execute/);
    assert.match(mindmap.text, /표시 개수/);
    assert.match(mindmap.text, /이 기록 불러오기/);
    assert.match(mindmap.text, /dry-run 재실행/);
    assert.match(mindmap.text, /execute 재실행/);
    assert.match(mindmap.text, /dispatchSchedulerPromptNow\(\)/);
    assert.match(mindmap.text, /openExecutionRollbackModal\(\)/);
    assert.match(mindmap.text, /runSelectedStage\(false\)/);
    assert.match(mindmap.text, /runSelectedStage\(true\)/);
    assert.match(mindmap.text, /worker_index: workerIndex/);
    assert.match(mindmap.text, /execution-worker-action/);
    assert.match(mindmap.text, /execution-failure-focus/);
    assert.match(mindmap.text, /execution-failure-badges/);
    assert.match(mindmap.text, /execution-history-pill is-info/);
    assert.match(mindmap.text, /execution-history-pill is-focus/);
    assert.match(mindmap.text, /execution-history-anchor/);
    assert.match(mindmap.text, /현재 실행/);
    assert.match(mindmap.text, /마지막 전송/);
    assert.match(mindmap.text, /즉시 가능 제어/);
    assert.match(mindmap.text, /focusExecutionWorker\(/);
    assert.match(mindmap.text, /sendExecutionWorkerNow\(/);
    assert.match(mindmap.text, /function focusExecutionWorker\(index\)/);
    assert.match(mindmap.text, /function sendExecutionWorkerNow\(index\)/);
    assert.match(mindmap.text, /function executionWorkerLabel\(worker, fallbackIndex\)/);
    assert.match(mindmap.text, /function executionMatchesWorker\(activityWorkerName, worker, fallbackIndex\)/);
    assert.match(mindmap.text, /function executionActivityWorkerLabel\(activity\)/);
    assert.match(mindmap.text, /function executionSummaryWithIndexedWorker\(summary, activity\)/);
    assert.match(mindmap.text, /function executionFailureLocationSummary\(summary, activity\)/);
    assert.match(mindmap.text, /function executionFailureReasonSummary\(summary, activity\)/);
    assert.match(mindmap.text, /function refreshExecutionSelectionUi\(\)/);
    assert.match(mindmap.text, /function selectedExecutionWorkerLabel\(\)/);
    assert.match(mindmap.text, /function rollbackModalSummary\(domainNode\)/);
    assert.match(mindmap.text, /function rollbackModalContextEntries\(domainNode\)/);
    assert.match(mindmap.text, /function rollbackModalMarkup\(domainNode\)/);
    assert.match(mindmap.text, /function rollbackModalValidationState\(\)/);
    assert.match(mindmap.text, /function refreshRollbackModalContext\(\)/);
    assert.match(mindmap.text, /function refreshRollbackModalValidation\(\)/);
    assert.match(mindmap.text, /function executionNextActionBase\(\)/);
    assert.match(mindmap.text, /function executionNextAction\(\)/);
    assert.match(mindmap.text, /S\.execution\.selectedWorkerIndex = index;/);
    assert.match(mindmap.text, /var previousWorkerIndex = S\.execution\.selectedWorkerIndex;/);
    assert.match(mindmap.text, /var previousRollbackTarget = String\(S\.execution\.rollbackTargetDomain \|\| ''\)\.trim\(\);/);
    assert.match(mindmap.text, /if \(\(workerEl && previousWorkerIndex !== S\.execution\.selectedWorkerIndex\) \|\| \(rollbackEl && previousRollbackTarget !== S\.execution\.rollbackTargetDomain\)\) \{/);
    assert.match(mindmap.text, /refreshExecutionSelectionUi\(\);/);
    assert.match(mindmap.text, /executionWorkerLabel\(worker, index\)/);
    assert.match(mindmap.text, /executionSummaryWithIndexedWorker\(String\(brief\.currentExecution\)\.trim\(\), S\.execution\.currentActivity\)/);
    assert.match(mindmap.text, /executionSummaryWithIndexedWorker\(String\(brief\.lastDispatch\)\.trim\(\), dispatchActivity\)/);
    assert.match(mindmap.text, /var errorText = executionFailureReasonSummary\(/);
    assert.match(mindmap.text, /var failureLocation = executionFailureLocationSummary\(/);
    assert.match(mindmap.text, /var message = executionNextActionBase\(\);/);
    assert.match(mindmap.text, /var rollbackTarget = selectedRollbackDomain\(\);/);
    assert.match(mindmap.text, /context\.push\('선택 worker: ' \+ executionWorkerLabel\(selectedWorker, selectedWorkerIndex\)\);/);
    assert.match(mindmap.text, /context\.push\('롤백 대상: ' \+ String\(rollbackTarget\.label \|\| rollbackTarget\.id \|\| '없음'\)\);/);
    assert.match(mindmap.text, /'선택 도메인: ' \+ domainLabel/);
    assert.match(mindmap.text, /'선택 worker: ' \+ selectedExecutionWorkerLabel\(\)/);
    assert.match(mindmap.text, /class="modal-warning-box"/);
    assert.match(mindmap.text, /class="modal-context-list"/);
    assert.match(mindmap.text, /class="modal-context-row"/);
    assert.match(mindmap.text, /class="modal-validation-state"/);
    assert.match(mindmap.text, /modal\.querySelector\('\.modal-body'\)\.innerHTML = rollbackModalMarkup\(n\);/);
    assert.match(mindmap.text, /body\.innerHTML = rollbackModalMarkup\(modalTarget\);/);
    assert.match(mindmap.text, /refreshRollbackModalContext\(\);/);
    assert.match(mindmap.text, /modal\.querySelector\('\.modal-reason'\)\.value = '';/);
    assert.match(mindmap.text, /confirmButton\.disabled = !state\.ok;/);
    assert.match(mindmap.text, /setExecutionStatus\('warning', '롤백 확인 필요', validation\.message\);/);
    assert.match(mindmap.text, /showToast\('롤백 대상 다시 확인 필요'\);/);
    assert.match(mindmap.text, /실패 위치: /);
    assert.match(mindmap.text, /dispatchSchedulerPromptNow\(\);/);
    assert.match(mindmap.text, /window\.focusExecutionWorker = focusExecutionWorker;/);
    assert.match(mindmap.text, /window\.sendExecutionWorkerNow = sendExecutionWorkerNow;/);
    assert.match(mindmap.text, /window\.openExecutionRollbackModal = openExecutionRollbackModal;/);
    assert.match(mindmap.text, /window\.runSelectedStage = runSelectedStage;/);
    assert.match(mindmap.text, /window\.reuseStageRunHistory = reuseStageRunHistory;/);
    assert.match(mindmap.text, /window\.rerunStageHistory = rerunStageHistory;/);
    assert.match(mindmap.text, /window\.focusStageRunFailureSignal = focusStageRunFailureSignal;/);
    assert.match(mindmap.text, /window\.focusPinnedStageRunFailureSignal = focusPinnedStageRunFailureSignal;/);
    assert.match(mindmap.text, /window\.stepStageRunFailureMatch = stepStageRunFailureMatch;/);
    assert.match(mindmap.text, /window\.setStageRunHistoryFilter = setStageRunHistoryFilter;/);
    assert.match(mindmap.text, /window\.setStageRunSignalHistoryView = setStageRunSignalHistoryView;/);
    assert.match(mindmap.text, /window\.setStageRunSignalGroupCollapsed = setStageRunSignalGroupCollapsed;/);
    assert.match(mindmap.text, /window\.setStageRunHistorySort = setStageRunHistorySort;/);

    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(Array.isArray(ptySessions.body.sessions));
    assert.ok(ptySessions.body.sessions.length >= 1);

    const selectedSession = ptySessions.body.sessions[0];
    const schedulerStart = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        {
          name: 'Browser Worker Alpha',
          plan_id: 'WP-BROWSER-A',
          pts: selectedSession.pts,
          prompt: 'alpha prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
        {
          name: 'Browser Worker Beta',
          plan_id: 'WP-BROWSER-B',
          pts: selectedSession.pts,
          prompt: 'beta prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);
    assert.equal(schedulerStart.body.workers, 2);

    const controlRuntimeBeforeSend = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeBeforeSend.status, 200);
    assert.equal(controlRuntimeBeforeSend.body.runtime_state.scheduler.workers.length, 2);
    assert.equal(controlRuntimeBeforeSend.body.runtime_state.scheduler.workers[1].name, 'Browser Worker Beta');

    const sendSelectedWorker = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 1,
    });
    assert.equal(sendSelectedWorker.status, 200);
    assert.ok(Array.isArray(sendSelectedWorker.body.results));
    assert.equal(sendSelectedWorker.body.results.length, 1);
    assert.equal(sendSelectedWorker.body.results[0].worker, 'Browser Worker Beta');
    assert.equal(sendSelectedWorker.body.results[0].ok, true);
    assert.equal(sendSelectedWorker.body.results[0].error, null);

    const controlRuntimeAfterSend = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeAfterSend.status, 200);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.last_activity.worker, 'Browser Worker Beta');
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.last_activity.packet_id, 'WP-BROWSER-B');
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.current_worker_index, 1);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.scheduler.current_worker_index, 1);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.scheduler.active_worker_index, 1);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.last_prompt_text, 'beta prompt');
    assert.match(controlRuntimeAfterSend.body.runtime_state.execution.current_activity.worker, /Browser Worker Beta/);
    assert.match(controlRuntimeAfterSend.body.runtime_state.execution.operator_brief.current_execution, /running \/ Browser Worker Beta/);
    assert.match(controlRuntimeAfterSend.body.runtime_state.execution.operator_brief.last_dispatch, /prompt \/ Browser Worker Beta/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[mindmap control center browser interaction smoke] selected failing worker propagates runtime error details', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const mindmap = await requestText(runtime.url, '/mindmap/index.html');
    assert.equal(mindmap.status, 200);
    assert.match(mindmap.text, /이 worker 즉시 전송/);
    assert.match(mindmap.text, /이 worker 재시도/);
    assert.match(mindmap.text, /execution-worker-action primary/);
    assert.match(mindmap.text, /execution-worker-action secondary/);
    assert.match(mindmap.text, /execution-worker-action warn/);
    assert.match(mindmap.text, /focusExecutionWorker\(/);
    assert.match(mindmap.text, /sendExecutionWorkerNow\(/);
    assert.match(mindmap.text, /retryExecutionWorker\(/);
    assert.match(mindmap.text, /stopAutoSendFromWorkerCard\(/);
    assert.match(mindmap.text, /function retryExecutionWorker\(index\)/);
    assert.match(mindmap.text, /function stopAutoSendFromWorkerCard\(index\)/);
    assert.match(mindmap.text, /재시도 비활성화/);
    assert.match(mindmap.text, /자동 전송 중지 비활성화/);
    assert.match(mindmap.text, /이 worker에서 자동 전송 중지/);
    assert.match(mindmap.text, /window\.retryExecutionWorker = retryExecutionWorker;/);
    assert.match(mindmap.text, /window\.stopAutoSendFromWorkerCard = stopAutoSendFromWorkerCard;/);

    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(Array.isArray(ptySessions.body.sessions));
    assert.ok(ptySessions.body.sessions.length >= 1);

    const selectedSession = ptySessions.body.sessions[0];
    const schedulerStart = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        {
          name: 'Browser Worker Stable',
          plan_id: 'WP-BROWSER-STABLE',
          pts: selectedSession.pts,
          prompt: 'stable prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
        {
          name: 'Browser Worker Broken',
          plan_id: 'WP-BROWSER-BROKEN',
          pts: '/dev/pts/99999',
          prompt: 'broken prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);
    assert.equal(schedulerStart.body.workers, 2);

    const sendStableWorker = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 0,
    });
    assert.equal(sendStableWorker.status, 200);
    assert.ok(Array.isArray(sendStableWorker.body.results));
    assert.equal(sendStableWorker.body.results.length, 1);
    assert.equal(sendStableWorker.body.results[0].worker, 'Browser Worker Stable');
    assert.equal(sendStableWorker.body.results[0].ok, true);
    assert.equal(sendStableWorker.body.results[0].error, null);

    const sendSelectedWorker = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 1,
    });
    assert.equal(sendSelectedWorker.status, 200);
    assert.ok(Array.isArray(sendSelectedWorker.body.results));
    assert.equal(sendSelectedWorker.body.results.length, 1);
    assert.equal(sendSelectedWorker.body.results[0].worker, 'Browser Worker Broken');
    assert.equal(sendSelectedWorker.body.results[0].ok, false);
    assert.match(String(sendSelectedWorker.body.results[0].error || ''), /알 수 없는 PTY 세션입니다: \/dev\/pts\/99999/);

    const controlRuntimeAfterFailure = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeAfterFailure.status, 200);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.worker, 'Browser Worker Broken');
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.packet_id, 'WP-BROWSER-BROKEN');
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.ok, false);
    assert.match(String(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.error || ''), /알 수 없는 PTY 세션입니다: \/dev\/pts\/99999/);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.current_worker_index, 0);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.scheduler.current_worker_index, 0);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.scheduler.active_worker_index, 0);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.current_activity.worker, 'Browser Worker Stable');
    assert.match(controlRuntimeAfterFailure.body.runtime_state.execution.operator_brief.current_execution, /running \/ Browser Worker Stable/);
    assert.match(controlRuntimeAfterFailure.body.runtime_state.execution.operator_brief.last_dispatch, /prompt \/ Browser Worker Broken/);
    assert.match(controlRuntimeAfterFailure.body.runtime_state.execution.operator_brief.blocked_at, /prompt \/ Browser Worker Broken \/ \/dev\/pts\/99999/);
    assert.match(controlRuntimeAfterFailure.body.runtime_state.execution.operator_brief.failure_reason, /알 수 없는 PTY 세션입니다: \/dev\/pts\/99999/);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.user_controls.failure_reason_visible, true);
    assert.match(String(controlRuntimeAfterFailure.body.runtime_state.execution.next_action || ''), /실패 원인/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[mindmap control center browser interaction smoke] send-now idempotency key replays completed response', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(ptySessions.body.sessions.length >= 1);

    const selectedSession = ptySessions.body.sessions[0];
    const schedulerStart = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        {
          name: 'Idempotency Worker',
          plan_id: 'WP-IDEM-TEST',
          pts: selectedSession.pts,
          prompt: 'idempotency test prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);

    const idempotencyKey = `send-now-idem-${Date.now()}`;

    // First request — should succeed and store result
    const first = await fetch(new URL('/api/pty/send-now', runtime.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ worker_index: 0 }),
    });
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('idempotency-replayed'), null, 'first request must not be replayed');
    assert.ok(Array.isArray(firstBody.results));
    assert.equal(firstBody.results[0].ok, true);

    // Second request — same key, same path → must replay
    const second = await fetch(new URL('/api/pty/send-now', runtime.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ worker_index: 0 }),
    });
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('idempotency-replayed'), 'true', 'second request must be replayed');
    assert.deepEqual(secondBody, firstBody, 'replayed body must match original');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[mindmap control center browser interaction smoke] enter-now worker_index targets single worker', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(ptySessions.body.sessions.length >= 1);
    const selectedSession = ptySessions.body.sessions[0];

    await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        { name: 'Enter Alpha', plan_id: 'WP-ENTER-A', pts: selectedSession.pts, prompt: 'alpha', cycle_minutes: 15, enter_seconds: 5 },
        { name: 'Enter Beta', plan_id: 'WP-ENTER-B', pts: selectedSession.pts, prompt: 'beta', cycle_minutes: 15, enter_seconds: 5 },
      ],
    });

    // No worker_index — should target ALL workers (2 results)
    const allWorkers = await postJson(runtime.url, '/api/pty/enter-now', {});
    assert.equal(allWorkers.status, 200);
    assert.equal(allWorkers.body.results.length, 2, 'no worker_index → all workers');
    assert.ok(allWorkers.body.results.every((r) => r.ok === true));

    // worker_index: 1 — should target only Beta
    const specificWorker = await postJson(runtime.url, '/api/pty/enter-now', { worker_index: 1 });
    assert.equal(specificWorker.status, 200);
    assert.equal(specificWorker.body.results.length, 1, 'worker_index:1 → single worker');
    assert.equal(specificWorker.body.results[0].worker, 'Enter Beta');
    assert.equal(specificWorker.body.results[0].ok, true);

    const runtimeAfterSpecificWorker = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(runtimeAfterSpecificWorker.status, 200);
    assert.equal(runtimeAfterSpecificWorker.body.runtime_state.execution.current_worker_index, 1);
    assert.equal(runtimeAfterSpecificWorker.body.runtime_state.scheduler.current_worker_index, 1);
    assert.equal(runtimeAfterSpecificWorker.body.runtime_state.scheduler.active_worker_index, 1);
    assert.equal(runtimeAfterSpecificWorker.body.runtime_state.execution.current_activity.worker, 'Enter Beta');
    assert.match(runtimeAfterSpecificWorker.body.runtime_state.execution.operator_brief.current_execution, /running \/ Enter Beta/);

    // worker_index out of range — should return error result
    const invalidWorker = await postJson(runtime.url, '/api/pty/enter-now', { worker_index: 99 });
    assert.equal(invalidWorker.status, 200);
    assert.equal(invalidWorker.body.results.length, 1);
    assert.equal(invalidWorker.body.results[0].ok, false);
    assert.match(String(invalidWorker.body.results[0].error || ''), /99/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
