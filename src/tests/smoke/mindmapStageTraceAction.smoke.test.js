'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  if (!match) {
    throw new Error('unable to extract inline script');
  }
  return match[1];
}

function extractFunctionSource(script, functionName) {
  const signature = `function ${functionName}(`;
  const start = script.indexOf(signature);
  if (start < 0) {
    throw new Error(`unable to find function ${functionName}`);
  }
  const braceStart = script.indexOf('{', start);
  if (braceStart < 0) {
    throw new Error(`unable to find function body for ${functionName}`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = braceStart; index < script.length; index += 1) {
    const char = script[index];
    const next = script[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingle) {
      if (!escaped && char === "'") {
        inSingle = false;
      }
      escaped = !escaped && char === '\\';
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') {
        inDouble = false;
      }
      escaped = !escaped && char === '\\';
      continue;
    }

    if (inTemplate) {
      if (!escaped && char === '`') {
        inTemplate = false;
      }
      escaped = !escaped && char === '\\';
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      escaped = false;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      escaped = false;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      escaped = false;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }

  throw new Error(`unterminated function ${functionName}`);
}

async function loadTraceHelpers() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const artifactPath = path.join(repoRoot, 'artifacts', 'mindmap', 'index.html');

  await execFileAsync('node', ['scripts/generate-mindmap.js'], {
    cwd: repoRoot,
  });

  const html = fs.readFileSync(artifactPath, 'utf8');
  const script = extractInlineScript(html);
  const copiedValues = [];
  const toasts = [];
  const statuses = [];

  const context = {
    S: {
      execution: {
        promptText: '',
        controls: {
          sendPrompt: true,
        },
      },
      stageRun: {
        history: [],
        lastReport: null,
        contract: null,
        selectedStage: 'D',
        selectedModule: '',
      },
    },
    Number,
    String,
    Promise,
    copiedValues,
    toasts,
    statuses,
    sendCalls: 0,
    normalizeStageRunHistory(reports) {
      return Array.isArray(reports) ? reports : [];
    },
    normalizeStageRunReport(report) {
      return report && typeof report === 'object' ? report : null;
    },
    copyTextToClipboard(value) {
      copiedValues.push(String(value || ''));
      return Promise.resolve();
    },
    setExecutionStatus(tone, title, detail) {
      statuses.push({ tone, title, detail });
    },
    renderExecutionConsole() {},
    hydrateCalls: 0,
    hydrateShouldFail: false,
    hydratePlanningSnapshot() {
      context.hydrateCalls += 1;
      return context.hydrateShouldFail
        ? Promise.reject(new Error('snapshot refresh failed'))
        : Promise.resolve();
    },
    sendPromptNow() {
      context.sendCalls += 1;
    },
    showToast(message) {
      toasts.push(String(message || ''));
    },
  };

  vm.createContext(context);
  [
    'normalizeStageRunContract',
    'stageRunContractStatus',
    'stageRunContractIssues',
    'stageRunContractNextAction',
    'stageRunRequestId',
    'stageRunCorrelationId',
    'stageRunTraceQuery',
    'copyStageRunTraceQuery',
    'loadStageRunTracePrompt',
    'sendStageRunTracePrompt',
    'stageRunContractRecoveryPrompt',
    'loadStageRunContractRecoveryPrompt',
    'sendStageRunContractRecoveryPrompt',
    'refreshStageRunContract',
  ].forEach((name) => {
    vm.runInContext(extractFunctionSource(script, name), context);
  });

  return context;
}

test('[mindmap stage trace action smoke] trace query helper includes request and correlation ids', async () => {
  const context = await loadTraceHelpers();
  const report = {
    requested_stage: 'D',
    requested_module: 'task-management',
    runtime_observability: {
      request_id: 'req-stage-123',
      correlation_id: 'corr-stage-456',
    },
  };

  assert.equal(
    context.stageRunTraceQuery(report),
    'stage_run request_id=req-stage-123 correlation_id=corr-stage-456 requested_stage=D requested_module=task-management',
  );
});

test('[mindmap stage trace action smoke] copy action stores current stage trace query and updates status', async () => {
  const context = await loadTraceHelpers();
  context.S.stageRun.lastReport = {
    requested_stage: 'D',
    requested_module: 'task-management',
    runtime_observability: {
      request_id: 'req-current-1',
      correlation_id: 'corr-current-1',
    },
  };

  context.copyStageRunTraceQuery();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(context.copiedValues, [
    'stage_run request_id=req-current-1 correlation_id=corr-current-1 requested_stage=D requested_module=task-management',
  ]);
  assert.deepEqual(context.toasts, ['stage 실행 추적값 복사 완료']);
  assert.deepEqual(context.statuses, [
    {
      tone: 'idle',
      title: '로그 확인 문장 복사 완료',
      detail: 'stage_run request_id=req-current-1 correlation_id=corr-current-1 requested_stage=D requested_module=task-management',
    },
  ]);
});

test('[mindmap stage trace action smoke] copy action can target history entry and warns when no report exists', async () => {
  const context = await loadTraceHelpers();
  context.S.stageRun.history = [
    {
      requested_stage: 'E',
      requested_module: '',
      runtime_observability: {
        request_id: 'req-history-7',
        correlation_id: 'corr-history-7',
      },
    },
  ];

  context.copyStageRunTraceQuery(0);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    context.copiedValues[0],
    'stage_run request_id=req-history-7 correlation_id=corr-history-7 requested_stage=E requested_module=all',
  );

  const emptyContext = await loadTraceHelpers();
  emptyContext.copyStageRunTraceQuery();
  assert.deepEqual(emptyContext.copiedValues, []);
  assert.deepEqual(emptyContext.statuses, []);
  assert.deepEqual(emptyContext.toasts, ['복사할 stage 실행 추적값이 없습니다.']);
});

test('[mindmap stage trace action smoke] load action stores trace query into execution prompt and updates status', async () => {
  const context = await loadTraceHelpers();
  context.S.stageRun.lastReport = {
    requested_stage: 'D',
    requested_module: 'task-management',
    runtime_observability: {
      request_id: 'req-load-1',
      correlation_id: 'corr-load-1',
    },
  };

  context.loadStageRunTracePrompt();

  assert.equal(
    context.S.execution.promptText,
    'stage_run request_id=req-load-1 correlation_id=corr-load-1 requested_stage=D requested_module=task-management',
  );
  assert.deepEqual(context.statuses, [
    {
      tone: 'idle',
      title: '로그 확인 문장 준비 완료',
      detail: 'stage_run request_id=req-load-1 correlation_id=corr-load-1 requested_stage=D requested_module=task-management 전송 전에 세션을 확인하세요.',
    },
  ]);
  assert.deepEqual(context.toasts, ['stage 실행 추적값 실행 패널 반영 완료']);
});

test('[mindmap stage trace action smoke] load action can target history entry and warns when no report exists', async () => {
  const context = await loadTraceHelpers();
  context.S.stageRun.history = [
    {
      requested_stage: 'B',
      requested_module: '',
      runtime_observability: {
        request_id: 'req-load-history',
        correlation_id: 'corr-load-history',
      },
    },
  ];

  context.loadStageRunTracePrompt(0);

  assert.equal(
    context.S.execution.promptText,
    'stage_run request_id=req-load-history correlation_id=corr-load-history requested_stage=B requested_module=all',
  );

  const emptyContext = await loadTraceHelpers();
  emptyContext.loadStageRunTracePrompt();
  assert.equal(emptyContext.S.execution.promptText, '');
  assert.deepEqual(emptyContext.statuses, []);
  assert.deepEqual(emptyContext.toasts, ['채울 stage 실행 추적값이 없습니다.']);
});

test('[mindmap stage trace action smoke] send action fills prompt and forwards to send-now helper', async () => {
  const context = await loadTraceHelpers();
  context.S.stageRun.lastReport = {
    requested_stage: 'C',
    requested_module: 'billing',
    runtime_observability: {
      request_id: 'req-send-1',
      correlation_id: 'corr-send-1',
    },
  };

  context.sendStageRunTracePrompt();

  assert.equal(
    context.S.execution.promptText,
    'stage_run request_id=req-send-1 correlation_id=corr-send-1 requested_stage=C requested_module=billing',
  );
  assert.equal(context.sendCalls, 1);
  assert.deepEqual(context.toasts, ['stage 실행 추적값 실행 패널 반영 완료']);
});

test('[mindmap stage trace action smoke] send action does not forward when no report exists', async () => {
  const context = await loadTraceHelpers();

  context.sendStageRunTracePrompt();

  assert.equal(context.S.execution.promptText, '');
  assert.equal(context.sendCalls, 0);
  assert.deepEqual(context.statuses, []);
  assert.deepEqual(context.toasts, ['채울 stage 실행 추적값이 없습니다.']);
});

test('[mindmap stage trace action smoke] contract recovery load action stores recovery prompt into execution prompt', async () => {
  const context = await loadTraceHelpers();
  context.S.stageRun.lastReport = {
    requested_stage: 'D',
    requested_module: 'task-management',
  };
  context.S.stageRun.contract = {
    drift_status: 'drifted',
    issues: ['latest-release-evidence-missing'],
  };

  context.loadStageRunContractRecoveryPrompt();

  assert.match(context.S.execution.promptText, /\[stage-run 계약 복구\]/);
  assert.match(context.S.execution.promptText, /드리프트 이슈: latest-release-evidence-missing/);
  assert.deepEqual(context.toasts, ['stage-run 계약 복구 안내 반영 완료']);
  assert.deepEqual(context.statuses, [
    {
      tone: 'idle',
      title: 'stage-run 계약 복구 안내 준비 완료',
      detail: '계약 드리프트 복구 지시를 실행 패널에 채웠습니다. 전송 전에 세션과 명령을 확인하세요.',
    },
  ]);
});

test('[mindmap stage trace action smoke] contract recovery send action loads prompt and forwards to send-now helper', async () => {
  const context = await loadTraceHelpers();
  context.S.stageRun.lastReport = {
    requested_stage: 'D',
    requested_module: 'task-management',
  };
  context.S.stageRun.contract = {
    drift_status: 'drifted',
    issues: ['latest-release-evidence-missing'],
  };

  context.sendStageRunContractRecoveryPrompt();

  assert.match(context.S.execution.promptText, /\[stage-run 계약 복구\]/);
  assert.equal(context.sendCalls, 1);
  assert.deepEqual(context.toasts, ['stage-run 계약 복구 안내 반영 완료']);
});

test('[mindmap stage trace action smoke] contract refresh action rehydrates snapshot and reports result', async () => {
  const context = await loadTraceHelpers();

  context.refreshStageRunContract();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.hydrateCalls, 1);
  assert.deepEqual(context.toasts, ['stage-run 계약 재확인 완료']);
  assert.deepEqual(context.statuses, [
    {
      tone: 'idle',
      title: 'stage-run 계약 재확인 중',
      detail: 'planning studio snapshot을 다시 불러와 계약 드리프트를 재확인하는 중입니다.',
    },
    {
      tone: 'idle',
      title: 'stage-run 계약 재확인 완료',
      detail: '최신 snapshot 기준으로 stage-run 계약 상태를 다시 반영했습니다.',
    },
  ]);

  const failedContext = await loadTraceHelpers();
  failedContext.hydrateShouldFail = true;
  failedContext.refreshStageRunContract();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(failedContext.hydrateCalls, 1);
  assert.deepEqual(failedContext.toasts, ['stage-run 계약 재확인 실패']);
  assert.deepEqual(failedContext.statuses, [
    {
      tone: 'idle',
      title: 'stage-run 계약 재확인 중',
      detail: 'planning studio snapshot을 다시 불러와 계약 드리프트를 재확인하는 중입니다.',
    },
    {
      tone: 'error',
      title: 'stage-run 계약 재확인 실패',
      detail: 'snapshot refresh failed',
    },
  ]);
});
