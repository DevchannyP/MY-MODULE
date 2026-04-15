'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { URL } = require('node:url');

const { TaskController } = require('../../domains/productivity/task-tracking/src/interface/TaskController');
const { CreateTaskUseCase } = require('../../domains/productivity/task-tracking/src/application/CreateTaskUseCase');
const { GetTaskUseCase } = require('../../domains/productivity/task-tracking/src/application/GetTaskUseCase');
const { ListTasksUseCase } = require('../../domains/productivity/task-tracking/src/application/ListTasksUseCase');
const { TransitionTaskStatusUseCase } = require('../../domains/productivity/task-tracking/src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase } = require('../../domains/productivity/task-tracking/src/application/ReassignTaskUseCase');
const { InMemoryTaskRepository } = require('../../domains/productivity/task-tracking/src/infrastructure/InMemoryTaskRepository');
const { SQLiteTaskRepository } = require('../../domains/productivity/task-tracking/src/infrastructure/SQLiteTaskRepository');
const { PostgresTaskRepository } = require('../../domains/productivity/task-tracking/src/infrastructure/PostgresTaskRepository');

const { BillingController } = require('../../domains/billing/src/interface/BillingController');
const { VideoController } = require('../../domains/video/src/interface/VideoController');
const { fromError } = require('../shared/ProblemDetails');
const { EventBusPublisher } = require('../shared/EventBusPublisher');
const { EventBus } = require('../shared/EventBus');
const { InMemoryIdempotencyStore } = require('../shared/IdempotencyStore');
const { InMemoryRateLimiter } = require('../shared/RateLimiter');
const { getFeatureFlags } = require('../infrastructure/FeatureFlagProvider');
const { tracer, metrics, logger } = require('../infrastructure/telemetry');
const { InMemoryInvoiceRepository } = require('../../domains/billing/src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryPaymentRepository } = require('../../domains/billing/src/infrastructure/InMemoryPaymentRepository');
const { InMemoryBillingExceptionRepository } = require('../../domains/billing/src/infrastructure/InMemoryBillingExceptionRepository');
const { InMemoryVideoRepository } = require('../../domains/video/src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository } = require('../../domains/video/src/infrastructure/InMemoryTranscodeJobRepository');
const { tryServeDynamicUi } = require('../frontend/renderDynamicUi');
const { buildOperatorCockpitSummary } = require('../../scripts/operator_cockpit');
const { InMemoryOutboxRepository } = require('../../domains/productivity/task-tracking/src/infrastructure/OutboxRepository');
const { OutboxPoller } = require('../../domains/productivity/task-tracking/src/infrastructure/OutboxPoller');
const {
  buildHomeRuntimeState,
  buildHomeRuntimeResponse,
  buildControlCenterRuntimeResponse,
  buildControlCenterRuntimeState,
} = require('../shared/uiRuntimeContracts');
const {
  normalizeRecentOperatorAction,
  mergeRecentOperatorActions,
} = require('../shared/operatorActionRuntime');

// ── DB_TYPE routing (WP-S18-002) ─────────────────────────────────────────────

function createUnconfiguredPostgresClient({
  connectionString = '',
  host = '',
  port = '',
  database = '',
} = {}) {
  return {
    async query() {
      throw Object.assign(
        new Error(
          'DB_TYPE=postgres 이지만 PostgreSQL client가 주입되지 않았습니다. ' +
          '실제 연결/Pool wiring은 후속 packet에서 구성해야 합니다.'
        ),
        {
          code: 'POSTGRES_CLIENT_NOT_CONFIGURED',
          connection_string_present: Boolean(connectionString),
          host_present: Boolean(host),
          port_present: Boolean(port),
          database_present: Boolean(database),
        },
      );
    },
  };
}

/**
 * Select a TaskRepository adapter based on DB_TYPE environment variable.
 *
 * DB_TYPE=sqlite  (default) → SQLiteTaskRepository
 * DB_TYPE=postgres          → PostgresTaskRepository (client must be injected)
 * DB_TYPE=inmemory          → InMemoryTaskRepository
 *
 * @param {{ dbType?: string, sqliteDbPath?: string, postgresClient?: object, postgresSchema?: string, postgresTable?: string }} opts
 */
function resolveTaskRepository({
  dbType = process.env.DB_TYPE || 'sqlite',
  sqliteDbPath = process.env.TASK_SQLITE_DB_PATH || ':memory:',
  postgresClient = null,
  postgresSchema = process.env.POSTGRES_SCHEMA || 'public',
  postgresTable = process.env.POSTGRES_TASK_TABLE || 'tasks',
} = {}) {
  const normalizedDbType = String(dbType || 'sqlite').trim().toLowerCase();

  if (normalizedDbType === 'sqlite') {
    return SQLiteTaskRepository.create(sqliteDbPath);
  }

  if (normalizedDbType === 'postgres') {
    return new PostgresTaskRepository({
      client: postgresClient || createUnconfiguredPostgresClient({
        connectionString: process.env.POSTGRES_URL || '',
        host: process.env.POSTGRES_HOST || '',
        port: process.env.POSTGRES_PORT || '',
        database: process.env.POSTGRES_DB || '',
      }),
      schema: postgresSchema,
      table: postgresTable,
    });
  }

  if (normalizedDbType === 'inmemory') {
    return new InMemoryTaskRepository();
  }

  throw new Error(`Unsupported DB_TYPE: ${dbType}`);
}

// ─────────────────────────────────────────────────────────────────────────────

function createTaskController(
  taskRepository = new InMemoryTaskRepository(),
  eventPublisher = new EventBusPublisher(),
  outboxRepository = null,
) {
  return new TaskController({
    createTask:           new CreateTaskUseCase(taskRepository, eventPublisher, outboxRepository),
    getTask:              new GetTaskUseCase(taskRepository),
    listTasks:            new ListTasksUseCase(taskRepository),
    transitionTaskStatus: new TransitionTaskStatusUseCase(taskRepository, eventPublisher, outboxRepository),
    reassignTask:         new ReassignTaskUseCase(taskRepository, eventPublisher, outboxRepository),
  });
}

function createBillingController(eventPublisher = null) {
  // billing/video의 eventPublisher는 (event) => void 시그니처 — EventBusPublisher 래핑
  const billingPublisher = eventPublisher
    || ((event) => _sharedDomainEventPublisher.publish(event));
  return new BillingController({
    invoiceRepo: new InMemoryInvoiceRepository(),
    paymentRepo: new InMemoryPaymentRepository(),
    exceptionRepo: new InMemoryBillingExceptionRepository(),
    eventPublisher: billingPublisher,
  });
}

function createVideoController(eventPublisher = null) {
  const videoPublisher = eventPublisher
    || ((event) => _sharedDomainEventPublisher.publish(event));
  return new VideoController({
    videoRepository: new InMemoryVideoRepository(),
    transcodeJobRepository: new InMemoryTranscodeJobRepository(),
    eventPublisher: videoPublisher,
  });
}

function parsePermissions(headerValue) {
  if (typeof headerValue !== 'string' || headerValue.trim() === '') {
    return [];
  }

  return headerValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCaller(headers) {
  return {
    userId: typeof headers['x-user-id'] === 'string' ? headers['x-user-id'] : 'anonymous',
    permissions: parsePermissions(headers['x-permissions']),
  };
}

function normalizeHeaderValue(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return value.trim();
}

function resolveRequestIdentity(headers) {
  const incomingCorrelationId = normalizeHeaderValue(headers['x-correlation-id']);
  const requestId = normalizeHeaderValue(headers['x-request-id']) || incomingCorrelationId || crypto.randomUUID();
  const correlationId = incomingCorrelationId || requestId;
  return { requestId, correlationId };
}

function createLifecycleState() {
  return {
    bootedAt: new Date().toISOString(),
    draining: false,
    drainStartedAt: null,
    shutdownReason: null,
  };
}

function enterDrainMode(lifecycleState, reason = 'manual') {
  if (!lifecycleState.draining) {
    lifecycleState.draining = true;
    lifecycleState.drainStartedAt = new Date().toISOString();
    lifecycleState.shutdownReason = reason;
    logger.warn('server.draining', {
      reason,
      drain_started_at: lifecycleState.drainStartedAt,
    });
  }
}

function readRequestBody(req, { maxBytes = 1024 * 1024, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    let timeoutHandle = null;

    const finish = (callback) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      callback(value);
    };
    const succeed = finish(resolve);
    const fail = finish(reject);

    const declaredLength = Number.parseInt(String(req.headers['content-length'] || ''), 10);
    if (Number.isInteger(declaredLength) && declaredLength > maxBytes) {
      fail(Object.assign(new Error(`Request body exceeds ${maxBytes} bytes`), { code: 'CONTENT_TOO_LARGE' }));
      req.resume();
      return;
    }

    timeoutHandle = setTimeout(() => {
      fail(Object.assign(new Error(`Request body was not fully received within ${timeoutMs}ms`), { code: 'REQUEST_TIMEOUT' }));
      req.resume();
    }, timeoutMs);
    timeoutHandle.unref?.();

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        fail(Object.assign(new Error(`Request body exceeds ${maxBytes} bytes`), { code: 'CONTENT_TOO_LARGE' }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) {
        return;
      }
      if (chunks.length === 0) {
        succeed({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        succeed(JSON.parse(raw));
      } catch {
        fail(Object.assign(new Error('Invalid JSON body'), { code: 'VALIDATION_ERROR' }));
      }
    });

    req.on('error', fail);
  });
}

function findBillingRoute(pathname) {
  const exactRoute = [
    '/billing/invoices',
    '/billing/payments',
    '/billing/exceptions',
    '/billing/summary',
  ].find((route) => route === pathname);

  if (exactRoute) {
    return { path: exactRoute, params: {} };
  }

  const routePatterns = [
    { match: /^\/billing\/invoices\/([^/]+)$/, path: '/billing/invoices/:invoice_id', param: 'invoice_id' },
    { match: /^\/billing\/invoices\/([^/]+)\/status$/, path: '/billing/invoices/:invoice_id/status', param: 'invoice_id' },
    { match: /^\/billing\/invoices\/([^/]+)\/line-items$/, path: '/billing/invoices/:invoice_id/line-items', param: 'invoice_id' },
    { match: /^\/billing\/payments\/([^/]+)$/, path: '/billing/payments/:payment_id', param: 'payment_id' },
    { match: /^\/billing\/payments\/([^/]+)\/sync$/, path: '/billing/payments/:payment_id/sync', param: 'payment_id' },
    { match: /^\/billing\/exceptions\/([^/]+)\/approve$/, path: '/billing/exceptions/:exception_id/approve', param: 'exception_id' },
    { match: /^\/billing\/exceptions\/([^/]+)\/reject$/, path: '/billing/exceptions/:exception_id/reject', param: 'exception_id' },
  ];

  for (const route of routePatterns) {
    const matched = pathname.match(route.match);
    if (matched) {
      return { path: route.path, params: { [route.param]: matched[1] } };
    }
  }

  return { path: pathname, params: {} };
}

function findVideoRoute(pathname) {
  if (pathname === '/videos') {
    return { path: '/videos', params: {} };
  }

  const routePatterns = [
    {
      match: /^\/videos\/([^/]+)$/,
      path: '/videos/:videoId',
      params: ['videoId'],
    },
    {
      match: /^\/videos\/([^/]+)\/transcode$/,
      path: '/videos/:videoId/transcode',
      params: ['videoId'],
    },
    {
      match: /^\/videos\/([^/]+)\/transcode-jobs\/([^/]+)$/,
      path: '/videos/:videoId/transcode-jobs/:jobId',
      params: ['videoId', 'jobId'],
    },
    {
      match: /^\/videos\/([^/]+)\/access-policy$/,
      path: '/videos/:videoId/access-policy',
      params: ['videoId'],
    },
    {
      match: /^\/videos\/([^/]+)\/archive$/,
      path: '/videos/:videoId/archive',
      params: ['videoId'],
    },
  ];

  for (const route of routePatterns) {
    const matched = pathname.match(route.match);
    if (matched) {
      const params = {};
      route.params.forEach((name, index) => {
        params[name] = matched[index + 1];
      });
      return { path: route.path, params };
    }
  }

  return { path: pathname, params: {} };
}

function hasMountedPrefix(pathname, mountPath) {
  return pathname === mountPath || pathname.startsWith(`${mountPath}/`);
}

function resolveVideoFeatureFlag(routePath, method) {
  if (routePath === '/videos' && method === 'POST') {
    return 'video.upload.enabled';
  }
  if (routePath === '/videos/:videoId/transcode' || routePath === '/videos/:videoId/transcode-jobs/:jobId') {
    return 'video.transcode.enabled';
  }
  if (routePath === '/videos/:videoId/archive') {
    return 'video.admin.enabled';
  }
  return null;
}

function evaluateFlag(provider, flagName, defaultValue, context) {
  if (provider && typeof provider.evaluate === 'function') {
    return provider.evaluate(flagName, context, defaultValue);
  }
  if (provider && typeof provider.isEnabled === 'function') {
    return { flagName, value: provider.isEnabled(flagName, defaultValue, context), reason: 'LEGACY_PROVIDER', metadata: {}, stale: false, context };
  }
  return { flagName, value: defaultValue, reason: 'NO_PROVIDER', metadata: {}, stale: false, context };
}

function getRuntimeStatus(provider) {
  if (provider && typeof provider.getRuntimeStatus === 'function') {
    return provider.getRuntimeStatus();
  }
  return {
    flagsLoaded: true,
    metadataLoaded: true,
    errors: [],
    flagCount: typeof provider?.getAll === 'function' ? Object.keys(provider.getAll()).length : 0,
    metadataCount: 0,
  };
}

function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length > 255) {
    throw Object.assign(new Error('Idempotency-Key must be 255 characters or fewer'), { code: 'INVALID_IDEMPOTENCY_KEY' });
  }
  return normalized;
}

function createEtag(payload) {
  return `"${crypto.createHash('sha256').update(payload).digest('hex')}"`;
}

function etagMatches(ifNoneMatchHeader, etag) {
  if (typeof ifNoneMatchHeader !== 'string' || !ifNoneMatchHeader.trim()) {
    return false;
  }
  return ifNoneMatchHeader
    .split(',')
    .map((part) => part.trim())
    .includes(etag);
}

function rateLimitHeaders(result) {
  return {
    'x-ratelimit-limit': String(result.limit),
    'x-ratelimit-remaining': String(result.remaining),
    'x-ratelimit-reset': String(Math.floor(result.resetAt / 1000)),
  };
}

function createResponseBaseHeaders({ correlationId, requestId, span, lifecycleState }) {
  const headers = {
    'x-correlation-id': correlationId,
    'x-request-id': requestId,
    'x-trace-id': span.traceId,
    traceparent: span.traceparent,
  };
  if (lifecycleState.draining) {
    headers.connection = 'close';
  }
  return headers;
}

function mergeHeaders(baseHeaders, extraHeaders = {}) {
  return {
    ...baseHeaders,
    ...extraHeaders,
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body, null, 2);
  const isProblemDetails = body
    && typeof body === 'object'
    && typeof body.type === 'string'
    && typeof body.title === 'string'
    && typeof body.status === 'number';
  res.writeHead(status, {
    'content-type': isProblemDetails
      ? 'application/problem+json; charset=utf-8'
      : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendResponse(req, res, status, body, extraHeaders = {}) {
  const method = req.method || 'GET';
  const payload = JSON.stringify(body, null, 2);
  const headers = { ...extraHeaders };

  if ((method === 'GET' || method === 'HEAD') && status >= 200 && status < 300) {
    const etag = createEtag(payload);
    headers.etag = etag;
    headers['cache-control'] = 'private, max-age=0, must-revalidate';
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
  }

  sendJson(res, status, body, headers);
}

/** FeatureFlagProvider stub — 모든 플래그 활성화 (테스트/smoke 전용) */
function createAllEnabledFlags() {
  return {
    isEnabled: () => true,
    evaluate(flagName, context) {
      return { flagName, value: true, reason: 'TEST_OVERRIDE', metadata: {}, stale: false, context: context || {} };
    },
    getAll: () => ({}),
    getRuntimeStatus: () => ({
      flagsLoaded: true,
      metadataLoaded: true,
      errors: [],
      flagCount: 0,
      metadataCount: 0,
      envOverridesApplied: 0,
      env_overridden_flags: [],
      enabled_flags: ['TEST_ALL_ENABLED'],
    }),
    getFullFlagDetails: () => [
      { flag: 'TEST_ALL_ENABLED', enabled: true, env_overridden: false, source: 'flags.yaml' },
    ],
  };
}

// ── Shared domain event publisher — wired to observable ring buffer ───────────
const DOMAIN_EVENT_RING_MAX = 100;
const _domainEventRingBuffer = [];

// EventBus 싱글톤 — 도메인 이벤트의 단일 in-process 라우팅 허브
const _sharedEventBus = EventBus.getInstance();
// wildcard 구독: 모든 도메인 이벤트를 ring buffer로 라우팅 (관측성 유지)
_sharedEventBus.subscribe('*', (evt) => {
  _domainEventRingBuffer.push(Object.assign({ _observed_at: new Date().toISOString() }, evt));
  if (_domainEventRingBuffer.length > DOMAIN_EVENT_RING_MAX) {
    _domainEventRingBuffer.shift();
  }
});
// EventBusPublisher: Use case → EventBus → ring buffer (+ 향후 모든 구독자)
const _sharedDomainEventPublisher = new EventBusPublisher(_sharedEventBus);

// ── Outbox 인프라 — Transactional Outbox 패턴의 서버 측 배선 ─────────────────
// DLQ(Dead-Letter Queue): 구독자 오류로 미전달된 이벤트를 캡처하는 링 버퍼
const DOMAIN_EVENT_DLQ_MAX = 50;
const _domainEventDlq = [];
// EventBus 핸들러 오류 → DLQ 링 버퍼로 라우팅
_sharedEventBus.setHandlerErrorCallback(({ event, handlerName, error }) => {
  _domainEventDlq.push({
    event,
    handlerName,
    errorMessage: error?.message ?? String(error),
    failed_at:    new Date().toISOString(),
  });
  if (_domainEventDlq.length > DOMAIN_EVENT_DLQ_MAX) _domainEventDlq.shift();
});
const _sharedOutboxRepo = new InMemoryOutboxRepository();
const _sharedOutboxPoller = new OutboxPoller({
  outboxRepo: _sharedOutboxRepo,
  eventBus:   _sharedEventBus,
  intervalMs: 500,
  batchSize:  50,
});

function buildControlBridgePrompt(snapshotData = {}) {
  const currentWp = snapshotData.current_wp || {};
  const nextActions = snapshotData.next_actions || {};
  const plannerSections = ((snapshotData.planner_sections_draft || {}).sections || [])
    .filter((section) => section && !section.done)
    .slice(0, 3)
    .map((section) => String(section.title || section.id || '').trim())
    .filter(Boolean);

  const goal = String(currentWp.goal || '현재 목표 미정').trim();
  const packetId = String(currentWp.id || nextActions.next_wp || 'NONE').trim();
  const nextTask = plannerSections[0] || String(nextActions.next_wp || '다음 작업 검토 필요').trim();

  return [
    '[실행 지시]',
    `현재 목표: ${goal}`,
    `현재 패킷: ${packetId}`,
    `다음 작업: ${nextTask || '다음 작업 검토 필요'}`,
    '계약과 기존 동작을 유지하면서 다음 액션만 진행하라.',
  ].join('\n');
}

function createNodePtyBridge(runtimeRoot) {
  const virtualSession = {
    pid: process.pid,
    ppid: process.ppid,
    pts: 'node-control-center',
    label: 'Node Runtime Control Bridge',
    command: 'virtual-control-center',
    cwd: runtimeRoot,
  };

  return {
    sessions: [virtualSession],
    scheduler: {
      running: false,
      startedAt: null,
      workers: [],
      activeWorkerIndex: null,
      lastActivity: null,
      log: [],
    },
    lastPromptText: '',
    lastError: null,
  };
}

function bridgePromptPreview(promptText, limit = 80) {
  return String(promptText || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function buildBridgeActivity(action, worker, pts, promptText, ok, error, packetId, workerIndex = null) {
  return {
    action,
    worker,
    worker_index: Number.isInteger(workerIndex) ? workerIndex : null,
    pts,
    packet_id: packetId || '',
    prompt_preview: bridgePromptPreview(promptText, 120),
    ok,
    error: error || null,
  };
}

function appendBridgeLog(scheduler, entry) {
  scheduler.log.unshift(entry);
  if (scheduler.log.length > 30) {
    scheduler.log.length = 30;
  }
}

function clearBridgeFailure(bridgeState) {
  bridgeState.lastError = null;
}

function setBridgeActiveWorker(bridgeState, workerIndex) {
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= bridgeState.scheduler.workers.length) {
    bridgeState.scheduler.activeWorkerIndex = null;
    return;
  }
  bridgeState.scheduler.activeWorkerIndex = workerIndex;
}

function findBridgeWorkerIndexByIdentity(bridgeState, { workerName = '', pts = '', packetId = '' } = {}) {
  return bridgeState.scheduler.workers.findIndex((worker) => (
    String(worker.name || '') === String(workerName || '')
    && String(worker.pts || '') === String(pts || '')
    && String(worker.plan_id || '') === String(packetId || '')
  ));
}

function recordBridgeFailure(bridgeState, {
  action = 'prompt',
  worker = 'Control Center',
  workerIndex = null,
  pts = '',
  promptText = '',
  error = 'unknown error',
  packetId = '',
} = {}) {
  const activity = buildBridgeActivity(action, worker, pts, promptText, false, error, packetId, workerIndex);
  bridgeState.lastError = activity;
  bridgeState.scheduler.lastActivity = activity;
  appendBridgeLog(bridgeState.scheduler, {
    ts: new Date().toISOString(),
    worker,
    action,
    pts,
    packet_id: packetId || '',
    ok: false,
    error,
  });
  return activity;
}

function dispatchBridgeAction(bridgeState, {
  action = 'prompt',
  workerName = 'Control Center',
  workerIndex = null,
  pts = '',
  promptText = '',
  packetId = '',
} = {}) {
  const session = bridgeState.sessions.find((item) => String(item.pts || '') === String(pts || ''));
  if (!session) {
    recordBridgeFailure(bridgeState, {
      action,
      worker: workerName,
      workerIndex,
      pts,
      promptText,
      error: `알 수 없는 PTY 세션입니다: ${pts}`,
      packetId,
    });
    return {
      ok: false,
      error: `알 수 없는 PTY 세션입니다: ${pts}`,
    };
  }

  clearBridgeFailure(bridgeState);
  if (promptText) {
    bridgeState.lastPromptText = promptText;
  }
  const matchedWorkerIndex = findBridgeWorkerIndexByIdentity(bridgeState, {
    workerName,
    pts,
    packetId,
  });
  const resolvedWorkerIndex = matchedWorkerIndex >= 0 ? matchedWorkerIndex : workerIndex;
  if (resolvedWorkerIndex >= 0) {
    setBridgeActiveWorker(bridgeState, resolvedWorkerIndex);
  }
  bridgeState.scheduler.lastActivity = buildBridgeActivity(
    action,
    workerName,
    pts,
    promptText,
    true,
    null,
    packetId,
    resolvedWorkerIndex,
  );
  appendBridgeLog(bridgeState.scheduler, {
    ts: new Date().toISOString(),
    worker: workerName,
    action,
    pts,
    packet_id: packetId || '',
    ok: true,
    error: null,
  });

  return {
    ok: true,
    error: null,
  };
}

function resolveBridgeCurrentWorkerIndex(scheduler) {
  const workers = Array.isArray(scheduler.workers) ? scheduler.workers : [];
  if (workers.length < 1) {
    return null;
  }

  const lastActivity = scheduler.lastActivity;
  if (lastActivity && lastActivity.ok === true) {
    const lastActivityIndex = workers.findIndex((worker) => (
      String(worker.name || '') === String(lastActivity.worker || '')
      && String(worker.pts || '') === String(lastActivity.pts || '')
      && String(worker.plan_id || '') === String(lastActivity.packet_id || '')
    ));
    if (lastActivityIndex >= 0) {
      return lastActivityIndex;
    }
  }

  if (
    Number.isInteger(scheduler.activeWorkerIndex)
    && scheduler.activeWorkerIndex >= 0
    && scheduler.activeWorkerIndex < workers.length
  ) {
    return scheduler.activeWorkerIndex;
  }

  return workers.findIndex((worker) => String(worker.pts || '').trim()) >= 0
    ? workers.findIndex((worker) => String(worker.pts || '').trim())
    : null;
}

function buildBridgeSchedulerStatus(bridgeState) {
  const now = Date.now();
  const scheduler = bridgeState.scheduler;
  const workers = scheduler.workers.map((worker, index) => ({
    name: worker.name,
    worker_index: index,
    plan_id: worker.plan_id,
    pts: worker.pts,
    prompt_preview: bridgePromptPreview(worker.prompt),
    active_issue: worker.plan_id || '',
    use_home_operator_prompt: Boolean(worker.use_home_operator_prompt),
    cycle_min: worker.cycle_minutes,
    enter_sec: worker.enter_seconds,
    next_enter_in: Math.max(0, Math.round((worker.nextEnterAt - now) / 1000)),
    next_prompt_in: Math.max(0, Math.round((worker.nextPromptAt - now) / 1000)),
  }));

  const currentWorkerIndex = scheduler.running ? resolveBridgeCurrentWorkerIndex(scheduler) : null;
  const currentWorker = Number.isInteger(currentWorkerIndex) ? workers[currentWorkerIndex] || null : null;
  const currentActivity = currentWorker
    ? {
      action: 'running',
      worker: currentWorker.name,
      worker_index: currentWorker.worker_index,
      pts: currentWorker.pts,
      packet_id: currentWorker.plan_id || '',
      prompt_preview: currentWorker.prompt_preview,
      ok: true,
      error: null,
      next_enter_in: currentWorker.next_enter_in,
      next_prompt_in: currentWorker.next_prompt_in,
    }
    : null;

  return {
    running: scheduler.running,
    started_at: scheduler.startedAt,
    active_worker_index: Number.isInteger(scheduler.activeWorkerIndex) ? scheduler.activeWorkerIndex : null,
    current_worker_index: Number.isInteger(currentWorkerIndex) ? currentWorkerIndex : null,
    workers,
    current_activity: currentActivity,
    last_activity: scheduler.lastActivity,
    log: scheduler.log,
  };
}

function recordControlCenterOperation({
  parentSpan,
  operation,
  route,
  method,
  correlationId,
  requestId,
  attributes = {},
  level = 'info',
  message = '',
}) {
  const childSpan = tracer.startSpan(operation, {
    traceId: parentSpan.traceId,
    parentSpanId: parentSpan.spanId,
    attributes: {
      'http.route': route,
      'http.request.method': method,
      'code.function': 'createAppHandler',
      ...attributes,
    },
  });

  const startedAt = Date.now();
  return {
    succeed(extraAttributes = {}) {
      const duration = Date.now() - startedAt;
      childSpan
        .setStatus('ok')
        .setAttribute('control_center.operation.duration_ms', duration);
      Object.entries(extraAttributes).forEach(([key, value]) => childSpan.setAttribute(key, value));
      childSpan.end();
      metrics.controlCenterOperationDurationMs.record(duration, {
        operation,
        route,
        method,
      });
      logger.info('control_center.operation', {
        trace_id: parentSpan.traceId,
        parent_span_id: parentSpan.spanId,
        span_id: childSpan.spanId,
        correlation_id: correlationId,
        request_id: requestId,
        operation,
        route,
        method,
        duration_ms: duration,
        message: message || 'ok',
        ...attributes,
        ...extraAttributes,
      });
    },
    fail(error, extraAttributes = {}) {
      const duration = Date.now() - startedAt;
      childSpan
        .recordException(error)
        .setAttribute('control_center.operation.duration_ms', duration);
      Object.entries(extraAttributes).forEach(([key, value]) => childSpan.setAttribute(key, value));
      childSpan.end();
      metrics.controlCenterOperationDurationMs.record(duration, {
        operation,
        route,
        method,
        error: true,
      });
      logger[level]('control_center.operation.failed', {
        trace_id: parentSpan.traceId,
        parent_span_id: parentSpan.spanId,
        span_id: childSpan.spanId,
        correlation_id: correlationId,
        request_id: requestId,
        operation,
        route,
        method,
        duration_ms: duration,
        error_message: error.message,
        ...attributes,
        ...extraAttributes,
      });
    },
  };
}

function createAppHandler({
  taskController = createTaskController(new InMemoryTaskRepository(), _sharedDomainEventPublisher, _sharedOutboxRepo),
  billingController = createBillingController(),
  videoController = createVideoController(),
  idempotencyStore = new InMemoryIdempotencyStore(),
  rateLimiter = new InMemoryRateLimiter(),
  rateLimitPolicy = { readLimit: 120, writeLimit: 30, windowMs: 60 * 1000 },
  routeRateLimitPolicies = {
    'POST:/billing/payments': { limit: 10, windowMs: 60 * 1000 },
    'POST:/video/videos': { limit: 5, windowMs: 60 * 1000 },
  },
  maxRequestBodyBytes = 1024 * 1024,
  requestBodyReadTimeoutMs = 5000,
  lifecycleState = createLifecycleState(),
  flags = null,  // null → 파일 기반 provider 사용 (프로덕션 기본값)
  runtimeRoot = path.resolve(__dirname, '../..'),
} = {}) {
  const nodePtyBridge = createNodePtyBridge(runtimeRoot);
  const uiOperatorState = {
    recentOperatorAction: null,
    recentOperatorActions: [],
  };

  return async function appHandler(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const method = req.method || 'GET';
    const caller = getCaller(req.headers);
    const requestIdentity = resolveRequestIdentity(req.headers);
    const correlationId = requestIdentity.correlationId;
    const requestId = requestIdentity.requestId;

    // ── OpenTelemetry 호환 계측 (W3C Trace Context 전파) ─────────────────
    const parentCtx = tracer.extractContext(
      typeof req.headers['traceparent'] === 'string' ? req.headers['traceparent'] : undefined
    );
    const span = tracer.startSpan(`http.${method} ${url.pathname}`, {
      traceId:      parentCtx?.traceId,
      parentSpanId: parentCtx?.parentSpanId,
      attributes:   { 'http.method': method, 'http.route': url.pathname },
    });
    const startMs = Date.now();
    let idempotencyScope = null;
    const responseBaseHeaders = createResponseBaseHeaders({
      correlationId,
      requestId,
      span,
      lifecycleState,
    });

    try {
      const resolvedFlags = flags || getFeatureFlags();
      const runtimeStatus = getRuntimeStatus(resolvedFlags);
      const isReadMethod = method === 'GET' || method === 'HEAD';
      const rateLimitKey = `${caller.userId}:${isReadMethod ? 'read' : 'write'}`;
      const rateLimitResult = rateLimiter.consume({
        key: rateLimitKey,
        limit: isReadMethod ? rateLimitPolicy.readLimit : rateLimitPolicy.writeLimit,
        windowMs: rateLimitPolicy.windowMs,
      });
      const responseHeaders = rateLimitHeaders(rateLimitResult);

      if (url.pathname === '/livez') {
        metrics.httpRequestsTotal.add(1, { route: '/livez', method });
        span.setStatus('ok').end();
        sendResponse(req, res, 200, { status: 'alive', service: 'my-module', transport: 'http', traceId: span.traceId }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (url.pathname === '/startupz') {
        metrics.httpRequestsTotal.add(1, { route: '/startupz', method });
        span.setStatus('ok').end();
        sendResponse(req, res, 200, {
          status: 'started',
          started_at: lifecycleState.bootedAt,
          service: 'my-module',
          traceId: span.traceId,
          lifecycle: {
            phase: lifecycleState.draining ? 'draining' : 'serving',
            drain_started_at: lifecycleState.drainStartedAt,
            shutdown_reason: lifecycleState.shutdownReason,
          },
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (url.pathname === '/readyz') {
        const ready = !lifecycleState.draining
          && runtimeStatus.flagsLoaded
          && runtimeStatus.metadataLoaded
          && runtimeStatus.errors.length === 0;
        metrics.httpRequestsTotal.add(1, { route: '/readyz', method, status: ready ? 200 : 503 });
        span.setAttribute('http.status_code', ready ? 200 : 503).setStatus(ready ? 'ok' : 'error').end();
        sendResponse(req, res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'not_ready',
          service: 'my-module',
          feature_flags: runtimeStatus,
          traceId: span.traceId,
          lifecycle: {
            phase: lifecycleState.draining ? 'draining' : 'serving',
            drain_started_at: lifecycleState.drainStartedAt,
            shutdown_reason: lifecycleState.shutdownReason,
          },
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (url.pathname === '/health') {
        metrics.httpRequestsTotal.add(1, { route: '/health', method });
        span.setStatus('ok').end();
        sendResponse(req, res, 200, {
          status: 'ok',
          service: 'my-module',
          transport: 'http',
          feature_flags: runtimeStatus,
          traceId: span.traceId,
          lifecycle: {
            phase: lifecycleState.draining ? 'draining' : 'serving',
            drain_started_at: lifecycleState.drainStartedAt,
            shutdown_reason: lifecycleState.shutdownReason,
          },
          observability: {
            event_bus:     _sharedEventBus.getStats(),
            outbox_poller: {
              running: _sharedOutboxPoller.isRunning,
              stats:   _sharedOutboxPoller.stats,
            },
            dlq_size: _domainEventDlq.length,
          },
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Feature Flag 상태 조회 (/flags) ─────────────────────────────────
      if (url.pathname === '/flags' && method === 'GET') {
        metrics.httpRequestsTotal.add(1, { route: '/flags', method });
        const currentFlags = resolvedFlags || getFeatureFlags();
        const flagDetails = currentFlags.getFullFlagDetails();
        span.setStatus('ok').end();
        sendResponse(req, res, 200, {
          as_of: new Date().toISOString(),
          env_overrides_applied: currentFlags.getRuntimeStatus().envOverridesApplied,
          env_overridden_flags: currentFlags.getRuntimeStatus().env_overridden_flags,
          enabled_flags: currentFlags.getRuntimeStatus().enabled_flags,
          flags: flagDetails,
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (lifecycleState.draining) {
        throw Object.assign(new Error('Server is draining and not accepting new requests'), {
          code: 'SERVICE_UNAVAILABLE',
          retryAfterSeconds: 5,
        });
      }

      if (!rateLimitResult.allowed) {
        throw Object.assign(new Error('Rate limit exceeded for this caller'), {
          code: 'RATE_LIMITED',
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
          rateLimitHeaders: responseHeaders,
        });
      }

      // ── Per-route stricter rate-limit (NFR: financial/storage risk routes) ─
      const routePolicyKey = `${method}:${url.pathname}`;
      const routePolicy = routeRateLimitPolicies[routePolicyKey];
      if (routePolicy) {
        const routeRateLimitKey = `${caller.userId}:route:${routePolicyKey}`;
        const routeRateLimitResult = rateLimiter.consume({
          key: routeRateLimitKey,
          limit: routePolicy.limit,
          windowMs: routePolicy.windowMs,
        });
        if (!routeRateLimitResult.allowed) {
          throw Object.assign(new Error(`Rate limit exceeded for route ${routePolicyKey}`), {
            code: 'RATE_LIMITED',
            retryAfterSeconds: routeRateLimitResult.retryAfterSeconds,
            rateLimitHeaders: rateLimitHeaders(routeRateLimitResult),
          });
        }
      }

      const body = method === 'GET' || method === 'HEAD'
        ? {}
        : await readRequestBody(req, {
          maxBytes: maxRequestBodyBytes,
          timeoutMs: requestBodyReadTimeoutMs,
        });
      const query = Object.fromEntries(url.searchParams.entries());
      const idempotencyKey = method === 'POST'
        ? validateIdempotencyKey(typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null)
        : null;
      if (method === 'POST' && idempotencyKey) {
        const claim = idempotencyStore.begin({
          key: idempotencyKey,
          method,
          path: url.pathname,
          callerId: caller.userId,
          body,
        });
        if (claim.outcome === 'replay' && claim.response) {
          sendResponse(req, res, claim.response.status, claim.response.body, mergeHeaders(responseBaseHeaders, {
            'idempotency-replayed': 'true',
            ...responseHeaders,
          }));
          return;
        }
        if (claim.outcome === 'in_progress') {
          throw Object.assign(new Error('An identical request with the same Idempotency-Key is still in progress'), { code: 'IDEMPOTENCY_IN_PROGRESS' });
        }
        if (claim.outcome === 'mismatch') {
          throw Object.assign(new Error('Idempotency-Key reuse detected with a different request payload'), { code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH' });
        }
        idempotencyScope = claim.scope;
      }

      // ── Feature Flag 라우트 게이트 (OpenFeature 패턴) ──────────────────────

      if (hasMountedPrefix(url.pathname, '/tasks')) {
        const flagDecision = evaluateFlag(resolvedFlags, 'enable_task_management', false, {
          userId: caller.userId,
          targetingKey: caller.userId,
          permissions: caller.permissions,
          route: url.pathname,
          method,
        });
        if (!flagDecision.value) {
          if (idempotencyScope) {
            idempotencyStore.abort(idempotencyScope);
          }
          sendResponse(req, res, 404, fromError(
            Object.assign(new Error('task-management 기능이 비활성화 상태입니다.'), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        const response = await taskController.handle({
          method,
          path: url.pathname,
          params: {},
          query,
          body,
          caller,
          correlationId,
        });
        if (idempotencyScope) {
          if (response.status >= 200 && response.status < 300) {
            idempotencyStore.complete(idempotencyScope, { status: response.status, body: response.body });
          } else {
            idempotencyStore.abort(idempotencyScope);
          }
        }
        sendResponse(req, res, response.status, response.body, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (hasMountedPrefix(url.pathname, '/billing')) {
        const flagDecision = evaluateFlag(resolvedFlags, 'billing.enabled', false, {
          userId: caller.userId,
          targetingKey: caller.userId,
          permissions: caller.permissions,
          route: url.pathname,
          method,
        });
        if (!flagDecision.value) {
          if (idempotencyScope) {
            idempotencyStore.abort(idempotencyScope);
          }
          sendResponse(req, res, 404, fromError(
            Object.assign(new Error('billing 기능이 비활성화 상태입니다.'), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        const route = findBillingRoute(url.pathname);
        const response = await billingController.handle({
          method,
          path: route.path,
          params: route.params,
          query,
          body,
          caller,
          correlationId,
        });
        if (idempotencyScope) {
          if (response.status >= 200 && response.status < 300) {
            idempotencyStore.complete(idempotencyScope, { status: response.status, body: response.body });
          } else {
            idempotencyStore.abort(idempotencyScope);
          }
        }
        sendResponse(req, res, response.status, response.body, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (hasMountedPrefix(url.pathname, '/videos')) {
        const rootDecision = evaluateFlag(resolvedFlags, 'video.enabled', false, {
          userId: caller.userId,
          targetingKey: caller.userId,
          permissions: caller.permissions,
          route: url.pathname,
          method,
        });
        if (!rootDecision.value) {
          if (idempotencyScope) {
            idempotencyStore.abort(idempotencyScope);
          }
          sendResponse(req, res, 404, fromError(
            Object.assign(new Error('video 기능이 비활성화 상태입니다.'), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        const route = findVideoRoute(url.pathname);
        const scopedFlag = resolveVideoFeatureFlag(route.path, method);
        const scopedDecision = scopedFlag
          ? evaluateFlag(resolvedFlags, scopedFlag, false, {
            userId: caller.userId,
            targetingKey: caller.userId,
            permissions: caller.permissions,
            route: url.pathname,
            method,
          })
          : null;
        if (scopedDecision && !scopedDecision.value) {
          if (idempotencyScope) {
            idempotencyStore.abort(idempotencyScope);
          }
          sendResponse(req, res, 404, fromError(
            Object.assign(new Error(`video 세부 기능이 비활성화 상태입니다: ${scopedFlag}`), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        const response = await videoController.handle({
          method,
          path: route.path,
          params: route.params,
          query,
          body,
          caller,
          correlationId,
        });
        if (idempotencyScope) {
          if (response.status >= 200 && response.status < 300) {
            idempotencyStore.complete(idempotencyScope, { status: response.status, body: response.body });
          } else {
            idempotencyStore.abort(idempotencyScope);
          }
        }
        sendResponse(req, res, response.status, response.body, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── System OS API (/api/v1/system/*) — WP-UI-004 / WP-S18 ──────────────
      if (hasMountedPrefix(url.pathname, '/api/v1/system')) {
        const { SystemApiController, findSystemRoute, broadcastSseEvent } = require('../infrastructure/SystemApiController');

        const sysEnabled = evaluateFlag(resolvedFlags, 'system_api.enabled', false, {
          userId: caller.userId, targetingKey: caller.userId, permissions: caller.permissions,
          route: url.pathname, method,
        });
        if (!sysEnabled.value) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          sendResponse(req, res, 404, fromError(
            Object.assign(new Error('system-api 기능이 비활성화 상태입니다.'), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        // SSE endpoint
        if (method === 'GET' && url.pathname === '/api/v1/system/events') {
          const sseEnabled = evaluateFlag(resolvedFlags, 'system_api.sse_stream.enabled', false, {
            userId: caller.userId, targetingKey: caller.userId, permissions: caller.permissions,
            route: url.pathname, method,
          });
          if (!sseEnabled.value) {
            if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
            sendResponse(req, res, 503, {
              type: 'about:blank', title: 'System SSE stream disabled', status: 503,
              detail: 'system_api.sse_stream.enabled=false',
            }, mergeHeaders(responseBaseHeaders, responseHeaders));
            return;
          }
          const controller = new SystemApiController({ flagProvider: resolvedFlags });
          controller.handleSse(req, res, requestId, responseBaseHeaders);
          // Emit a welcome event so clients detect the connection
          setTimeout(() => { try { broadcastSseEvent('system.health.updated', { domain: 'system', score: 100 }); } catch (_e) { /* SSE client may have disconnected */ } }, 100);
          return;
        }

        const { path: canonicalPath, params } = findSystemRoute(url.pathname);
        const controller = new SystemApiController({ flagProvider: resolvedFlags });
        const response = controller.handle({
          method,
          path: canonicalPath,
          params,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
          caller,
        });

        if (idempotencyScope) {
          if (response.status >= 200 && response.status < 300) {
            idempotencyStore.complete(idempotencyScope, { status: response.status, body: response.body });
          } else {
            idempotencyStore.abort(idempotencyScope);
          }
        }
        sendResponse(req, res, response.status, response.body, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Planning Studio — domain scaffold preview / create ────────────────
      if (
        method === 'POST' &&
        (url.pathname === '/api/planning-studio/scaffold-preview' ||
          url.pathname === '/api/planning-studio/scaffold-create')
      ) {
        const isDryRun = url.pathname.endsWith('/scaffold-preview');
        const reqBody = body || {};
        const domainArg = typeof reqBody.domain === 'string' ? reqBody.domain.trim() : '';
        const blueprintArg = typeof reqBody.blueprint === 'string' ? reqBody.blueprint.trim() : '';
        const SLUG_RE = /^[a-z][a-z0-9-]{1,62}$/;
        if (!SLUG_RE.test(domainArg) || !SLUG_RE.test(blueprintArg)) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          sendResponse(req, res, 400, fromError(
            Object.assign(new Error('domain and blueprint must match ^[a-z][a-z0-9-]{1,62}$'), { code: 'VALIDATION_ERROR' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        const scaffoldArgs = [
          path.resolve(__dirname, '../../scripts/generate-domain-scaffold.js'),
          '--root', runtimeRoot,
          '--domain', domainArg,
          '--blueprint', blueprintArg,
        ];
        if (typeof reqBody.recipe === 'string' && reqBody.recipe.trim()) {
          scaffoldArgs.push('--recipe', reqBody.recipe.trim());
        }
        if (isDryRun) scaffoldArgs.push('--dry-run');
        const scaffoldResult = spawnSync('node', scaffoldArgs, { cwd: runtimeRoot, encoding: 'utf8' });
        if (scaffoldResult.status !== 0) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          const errMsg = (scaffoldResult.stderr || '').trim() || 'scaffold failed';
          const isConflict = errMsg.includes('이미 존재합니다');
          sendResponse(req, res, isConflict ? 409 : 400, fromError(
            Object.assign(new Error(isConflict ? `requirements/${domainArg}.yaml already exists` : errMsg), {
              code: isConflict ? 'CONFLICT' : 'SCAFFOLD_ERROR',
            }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        if (!isDryRun) {
          const registrationArgs = [
            path.resolve(__dirname, '../../scripts/register_stage_c_plugin.py'),
            '--root', runtimeRoot,
            '--requirements', `requirements/${domainArg}.yaml`,
          ];
          const registrationResult = spawnSync('python3', registrationArgs, { cwd: runtimeRoot, encoding: 'utf8' });
          if (registrationResult.status !== 0) {
            const requirementsPath = path.resolve(runtimeRoot, `requirements/${domainArg}.yaml`);
            if (fs.existsSync(requirementsPath)) {
              fs.unlinkSync(requirementsPath);
            }
            if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
            const errMsg = (registrationResult.stderr || '').trim() || 'stage c registration failed';
            const isConflict = errMsg.includes('conflict') || errMsg.includes('already registered');
            sendResponse(req, res, isConflict ? 409 : 500, fromError(
              Object.assign(new Error(errMsg), {
                code: isConflict ? 'CONFLICT' : 'STAGE_C_ERROR',
              }),
              { path: url.pathname },
            ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
            return;
          }
        }
        const scaffoldStdout = (scaffoldResult.stdout || '').trim();
        const scaffoldResponseBody = {
          ok: true,
          data: {
            ok: true,
            command: `node scripts/generate-domain-scaffold.js --domain ${domainArg} --blueprint ${blueprintArg}${isDryRun ? ' --dry-run' : ''}`,
            stdout: scaffoldStdout,
            preview: isDryRun ? scaffoldStdout : '',
            requirements_path: `requirements/${domainArg}.yaml`,
            created: !isDryRun,
          },
        };
        if (idempotencyScope) idempotencyStore.complete(idempotencyScope, { status: 200, body: scaffoldResponseBody });
        sendResponse(req, res, 200, scaffoldResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Domain Event Bus — observable ring buffer ──────────────────────────
      if (url.pathname === '/api/v1/domain-events' && method === 'GET') {
        const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 100);
        const snapshot = _domainEventRingBuffer.slice(-limit);
        sendResponse(req, res, 200, { total: _domainEventRingBuffer.length, events: snapshot },
          mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Domain Event DLQ — 구독자 오류 격리 링 버퍼 ────────────────────────
      if (url.pathname === '/api/v1/domain-events/dlq' && method === 'GET') {
        const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 100);
        const snapshot = _domainEventDlq.slice(-limit);
        sendResponse(req, res, 200, { total: _domainEventDlq.length, entries: snapshot },
          mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Outbox Poller Stats ───────────────────────────────────────────────────
      if (url.pathname === '/api/v1/outbox/stats' && method === 'GET') {
        sendResponse(req, res, 200, {
          running:        _sharedOutboxPoller.isRunning,
          stats:          _sharedOutboxPoller.stats,
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── UI Runtime API ────────────────────────────────────────────────────
      if (method === 'GET' && url.pathname === '/ui/home-runtime') {
        const runtimeData = buildHomeRuntimeResponse();
        runtimeData.runtime_state = buildHomeRuntimeState({
          flagStatus: resolvedFlags.getRuntimeStatus(),
          schedulerStatus: buildBridgeSchedulerStatus(nodePtyBridge),
          operatorCockpit: buildOperatorCockpitSummary(),
          recentOperatorAction: uiOperatorState.recentOperatorAction,
          recentOperatorActions: uiOperatorState.recentOperatorActions,
        });
        sendResponse(req, res, 200, runtimeData, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Mindmap Rebuild (Worker Thread — CPU-bound) ───────────────────────
      if (method === 'POST' && url.pathname === '/api/mindmap/rebuild') {
        const workerPath = path.resolve(runtimeRoot, 'scripts', 'generateMindmapWorker.js');
        const worker = new Worker(workerPath, { workerData: { repoRoot: runtimeRoot } });
        worker.once('message', (msg) => {
          if (msg.ok) {
            sendResponse(req, res, 200,
              { ok: true, durationMs: msg.durationMs },
              mergeHeaders(responseBaseHeaders, responseHeaders));
          } else {
            sendResponse(req, res, 500,
              { ok: false, error: msg.error },
              mergeHeaders(responseBaseHeaders, responseHeaders));
          }
        });
        worker.once('error', (err) => {
          sendResponse(req, res, 500,
            { ok: false, error: String(err.message) },
            mergeHeaders(responseBaseHeaders, responseHeaders));
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/ui/control-center-runtime') {
        const runtimeData = buildControlCenterRuntimeResponse({
          runtime_state: buildControlCenterRuntimeState({
            flagStatus: resolvedFlags.getRuntimeStatus(),
            bridgeState: nodePtyBridge,
            schedulerStatus: buildBridgeSchedulerStatus(nodePtyBridge),
            operatorCockpit: buildOperatorCockpitSummary(),
            recentOperatorAction: uiOperatorState.recentOperatorAction,
            recentOperatorActions: uiOperatorState.recentOperatorActions,
          }),
        });
        sendResponse(req, res, 200, runtimeData, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/ui/operator-action') {
        const normalizedAction = normalizeRecentOperatorAction(body);
        if (!normalizedAction) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          const validationErr = Object.assign(new Error('label and command are required'), { code: 'VALIDATION_ERROR' });
          sendResponse(req, res, 400, fromError(validationErr, { path: url.pathname }).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        uiOperatorState.recentOperatorAction = normalizedAction;
        uiOperatorState.recentOperatorActions = mergeRecentOperatorActions(
          uiOperatorState.recentOperatorActions,
          normalizedAction,
        );
        const operatorActionResponseBody = {
          ok: true,
          data: normalizedAction,
        };
        if (idempotencyScope) {
          idempotencyStore.complete(idempotencyScope, { status: 200, body: operatorActionResponseBody });
        }
        sendResponse(req, res, 200, operatorActionResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Planning Studio — snapshot ────────────────────────────────────────
      if (method === 'GET' && url.pathname === '/api/planning-studio/snapshot') {
        const snapshotResult = spawnSync('python3', [
          path.resolve(__dirname, '../../scripts/planning_studio_api.py'), 'snapshot',
        ], { cwd: runtimeRoot, encoding: 'utf8' });
        if (snapshotResult.status !== 0) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          sendResponse(req, res, 500, fromError(
            Object.assign(new Error('snapshot collection failed'), { code: 'INTERNAL_ERROR' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        let snapshotData = {};
        try { snapshotData = JSON.parse(snapshotResult.stdout || '{}'); } catch (_) { snapshotData = {}; }
        sendResponse(req, res, 200, { ok: true, data: snapshotData }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/planning-studio/stage-run') {
        const stageRunObservation = recordControlCenterOperation({
          parentSpan: span,
          operation: 'planning_studio.stage_run',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        });
        const requestedStage = typeof body.stage === 'string' ? body.stage.trim().toUpperCase() : '';
        const requestedModule = typeof body.module === 'string' ? body.module.trim() : '';
        const executeStage = body.execute === true;
        const modulePattern = /^[a-z][a-z0-9-]{0,62}$/;

        if (!['A', 'B', 'C', 'D', 'E'].includes(requestedStage)) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          const validationErr = Object.assign(new Error('stage must be one of A, B, C, D, E'), { code: 'VALIDATION_ERROR' });
          stageRunObservation.fail(validationErr, { 'stage_run.reason': 'invalid_stage', 'stage_run.stage': requestedStage });
          sendResponse(req, res, 400, fromError(validationErr, { path: url.pathname }).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        if (requestedModule && !modulePattern.test(requestedModule)) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          const moduleErr = Object.assign(new Error('module must match ^[a-z][a-z0-9-]{0,62}$'), { code: 'VALIDATION_ERROR' });
          stageRunObservation.fail(moduleErr, { 'stage_run.reason': 'invalid_module', 'stage_run.module': requestedModule });
          sendResponse(req, res, 400, fromError(moduleErr, { path: url.pathname }).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        // execute 모드는 system.admin 전용 — 계약 execute_requires 준수
        if (executeStage && !caller.permissions.includes('system.admin')) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          const authzErr = Object.assign(new Error('stage execute 모드는 system.admin 권한이 필요합니다.'), { code: 'FORBIDDEN' });
          stageRunObservation.fail(authzErr, { 'stage_run.reason': 'forbidden_execute', 'stage_run.stage': requestedStage });
          sendResponse(req, res, 403, fromError(authzErr, { path: url.pathname, correlationId }).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        const stageArgs = [
          path.resolve(__dirname, '../../scripts/run_stage.js'),
          requestedStage,
          '--root', runtimeRoot,
          executeStage ? '--execute' : '--dry-run',
        ];
        if (requestedModule) {
          stageArgs.push('--module', requestedModule);
        }

        const stageResult = spawnSync('node', stageArgs, {
          cwd: runtimeRoot,
          encoding: 'utf8',
          timeout: 30_000,
        });

        let stageReport = null;
        try {
          stageReport = JSON.parse(stageResult.stdout || '{}');
        } catch (_) {
          stageReport = null;
        }

        if (!stageReport || typeof stageReport !== 'object') {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          const errMsg = stageResult.signal === 'SIGTERM'
            ? 'stage run timed out after 30s'
            : (stageResult.stderr || '').trim() || 'stage run failed';
          const stageRunErr = Object.assign(new Error(errMsg), {
            code: stageResult.signal === 'SIGTERM' ? 'STAGE_RUN_TIMEOUT' : 'STAGE_RUN_ERROR',
          });
          stageRunObservation.fail(stageRunErr, {
            'stage_run.stage': requestedStage,
            'stage_run.exit_code': stageResult.status,
            'stage_run.timed_out': stageResult.signal === 'SIGTERM',
          });
          sendResponse(req, res, 500, fromError(stageRunErr, { path: url.pathname }).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }

        stageRunObservation.succeed({
          'stage_run.stage': requestedStage,
          'stage_run.module': requestedModule || 'all',
          'stage_run.mode': executeStage ? 'execute' : 'dry-run',
          'stage_run.status': stageReport.status || 'unknown',
        });
        const saveStageRunResult = spawnSync('python3', [
          path.resolve(__dirname, '../../scripts/planning_studio_api.py'),
          'save-stage-run',
        ], {
          cwd: runtimeRoot,
          encoding: 'utf8',
          input: JSON.stringify({
            ...stageReport,
            requested_module: requestedModule || '',
          }),
        });
        if (saveStageRunResult.status !== 0 || saveStageRunResult.error) {
          logger.warn('stage_run.save_failed', {
            correlation_id: correlationId,
            request_id: requestId,
            stage: requestedStage,
            exit_code: saveStageRunResult.status,
            stderr: (saveStageRunResult.stderr || '').trim().slice(0, 200),
            error: saveStageRunResult.error ? String(saveStageRunResult.error.message) : null,
          });
        } else {
          logger.info('stage_run.save_ok', {
            correlation_id: correlationId,
            request_id: requestId,
            stage: requestedStage,
            module: requestedModule || '',
          });
        }
        const stageRunResponseBody = {
          ok: true,
          data: stageReport,
        };
        if (idempotencyScope) {
          idempotencyStore.complete(idempotencyScope, { status: 200, body: stageRunResponseBody });
        }
        sendResponse(req, res, 200, stageRunResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Control Center — prompt recommendation / virtual PTY bridge ──────
      if (method === 'GET' && url.pathname === '/api/automation/optimize-prompt') {
        const observation = recordControlCenterOperation({
          parentSpan: span,
          operation: 'control_center.optimize_prompt',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        });
        const snapshotResult = spawnSync('python3', [
          path.resolve(__dirname, '../../scripts/planning_studio_api.py'), 'snapshot',
        ], { cwd: runtimeRoot, encoding: 'utf8' });
        let snapshotData = {};
        try { snapshotData = JSON.parse(snapshotResult.stdout || '{}'); } catch (_) { snapshotData = {}; }
        metrics.controlCenterPromptRecommendationsTotal.add(1, {
          route: url.pathname,
          method,
        });
        observation.succeed({
          'control_center.prompt.source': 'planning-studio-snapshot',
          'control_center.snapshot.ok': snapshotResult.status === 0,
        });
        sendResponse(req, res, 200, {
          prompt: buildControlBridgePrompt(snapshotData),
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/pty/sessions') {
        const observation = recordControlCenterOperation({
          parentSpan: span,
          operation: 'pty.bridge.sessions',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        });
        metrics.ptyBridgeSessionsReadTotal.add(1, {
          route: url.pathname,
          method,
        });
        observation.succeed({
          'pty.session.count': nodePtyBridge.sessions.length,
        });
        sendResponse(req, res, 200, {
          sessions: nodePtyBridge.sessions,
          count: nodePtyBridge.sessions.length,
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/pty/send') {
        const observation = recordControlCenterOperation({
          parentSpan: span,
          operation: 'pty.bridge.send',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        });
        const pts = typeof body.pts === 'string' ? body.pts.trim() : '';
        const text = typeof body.text === 'string' ? body.text : '';
        const action = typeof body.action === 'string' && body.action.trim()
          ? body.action.trim()
          : (text === '\r' ? 'enter' : 'prompt');
        const promptText = typeof body.prompt === 'string' && body.prompt.trim()
          ? body.prompt.trim()
          : (text.endsWith('\r') ? text.slice(0, -1) : text);
        const packetId = typeof body.packet_id === 'string' ? body.packet_id : '';
        // 수동 전송은 항상 'Control Center' — body.name은 로깅/추적 전용
        const workerName = 'Control Center';
        if (!pts) {
          recordBridgeFailure(nodePtyBridge, {
            action,
            worker: workerName,
            pts,
            promptText,
            error: 'pts 필드가 필수입니다.',
            packetId,
          });
          metrics.ptyBridgeFailuresTotal.add(1, {
            route: url.pathname,
            method,
            reason: 'missing_pts',
          });
          observation.fail(new Error('pts required'), {
            'pty.send.reason': 'missing_pts',
          });
          const missingPtsErr = Object.assign(new Error('pts 필드가 필수입니다.'), { code: 'VALIDATION_ERROR' });
          const { status: missingPtsStatus, body: missingPtsBody } = fromError(missingPtsErr, { path: url.pathname, correlationId });
          sendResponse(req, res, missingPtsStatus, missingPtsBody, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        const dispatchResult = dispatchBridgeAction(nodePtyBridge, {
          action,
          workerName,
          pts,
          promptText,
          packetId,
        });
        if (!dispatchResult.ok) {
          metrics.ptyBridgeFailuresTotal.add(1, {
            route: url.pathname,
            method,
            reason: 'unknown_pts',
          });
          observation.fail(new Error('unknown pts'), {
            'pty.send.reason': 'unknown_pts',
            'pty.session.pts': pts,
          });
          const unknownPtsErr = Object.assign(new Error(dispatchResult.error), { code: 'NOT_FOUND' });
          const { status: unknownPtsStatus, body: unknownPtsBody } = fromError(unknownPtsErr, { path: url.pathname, correlationId });
          sendResponse(req, res, unknownPtsStatus, unknownPtsBody, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        metrics.ptyBridgeSendTotal.add(1, {
          route: url.pathname,
          method,
          action,
        });
        observation.succeed({
          'pty.session.pts': pts,
          'pty.send.action': action,
          'pty.packet.id': packetId || '',
        });
        const ptyResponseBody = { ok: true, error: null };
        if (idempotencyScope) {
          idempotencyStore.complete(idempotencyScope, { status: 200, body: ptyResponseBody });
        }
        sendResponse(req, res, 200, ptyResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/pty/scheduler/status') {
        const observation = recordControlCenterOperation({
          parentSpan: span,
          operation: 'pty.scheduler.status',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        });
        metrics.ptySchedulerStatusReadTotal.add(1, {
          route: url.pathname,
          method,
        });
        observation.succeed({
          'pty.scheduler.running': nodePtyBridge.scheduler.running,
          'pty.scheduler.worker_count': nodePtyBridge.scheduler.workers.length,
        });
        sendResponse(req, res, 200, buildBridgeSchedulerStatus(nodePtyBridge), mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/pty/scheduler/start') {
        const observation = recordControlCenterOperation({
          parentSpan: span,
          operation: 'pty.scheduler.start',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        });
        const workers = Array.isArray(body.workers) ? body.workers : [];
        const cycleMinutes = Number(body.cycle_minutes || 30);
        const enterSeconds = Number(body.enter_seconds || 10);
        const now = Date.now();
        clearBridgeFailure(nodePtyBridge);
        nodePtyBridge.scheduler.running = true;
        nodePtyBridge.scheduler.startedAt = new Date().toISOString();
        nodePtyBridge.scheduler.workers = workers
          .map((worker, index) => ({
            name: typeof worker.name === 'string' && worker.name.trim() ? worker.name.trim() : `Worker ${index + 1}`,
            plan_id: typeof worker.plan_id === 'string' ? worker.plan_id : '',
            pts: typeof worker.pts === 'string' ? worker.pts : '',
            prompt: typeof worker.prompt === 'string' && worker.prompt.trim()
              ? worker.prompt.trim()
              : (nodePtyBridge.lastPromptText || '계속'),
            use_home_operator_prompt: worker.use_home_operator_prompt === true,
            cycle_minutes: Number(worker.cycle_minutes || cycleMinutes),
            enter_seconds: Number(worker.enter_seconds || enterSeconds),
            nextEnterAt: now + (Number(worker.enter_seconds || enterSeconds) * 1000),
            nextPromptAt: now + (Number(worker.cycle_minutes || cycleMinutes) * 60 * 1000),
          }))
          .filter((worker) => String(worker.pts || '').trim());
        nodePtyBridge.scheduler.activeWorkerIndex = nodePtyBridge.scheduler.workers.length > 0 ? 0 : null;
        appendBridgeLog(nodePtyBridge.scheduler, {
          ts: 'system',
          worker: 'scheduler',
          action: 'start',
          pts: '',
          packet_id: '',
          ok: true,
          error: null,
        });
        metrics.ptySchedulerStartTotal.add(1, {
          route: url.pathname,
          method,
        });
        observation.succeed({
          'pty.scheduler.worker_count': nodePtyBridge.scheduler.workers.length,
        });
        const startResponseBody = { ok: true, workers: nodePtyBridge.scheduler.workers.length };
        if (idempotencyScope) {
          idempotencyStore.complete(idempotencyScope, { status: 200, body: startResponseBody });
        }
        sendResponse(req, res, 200, startResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/pty/scheduler/stop') {
        const observation = recordControlCenterOperation({
          parentSpan: span,
          operation: 'pty.scheduler.stop',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        });
        clearBridgeFailure(nodePtyBridge);
        nodePtyBridge.scheduler.running = false;
        nodePtyBridge.scheduler.startedAt = null;
        nodePtyBridge.scheduler.activeWorkerIndex = null;
        appendBridgeLog(nodePtyBridge.scheduler, {
          ts: 'system',
          worker: 'scheduler',
          action: 'stop',
          pts: '',
          packet_id: '',
          ok: true,
          error: null,
        });
        metrics.ptySchedulerStopTotal.add(1, {
          route: url.pathname,
          method,
        });
        observation.succeed({
          'pty.scheduler.worker_count': nodePtyBridge.scheduler.workers.length,
        });
        const stopResponseBody = { ok: true };
        if (idempotencyScope) {
          idempotencyStore.complete(idempotencyScope, { status: 200, body: stopResponseBody });
        }
        sendResponse(req, res, 200, stopResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/pty/send-now') {
        const workerIndex = Number.isInteger(body.worker_index) ? body.worker_index : 0;
        const worker = nodePtyBridge.scheduler.workers[workerIndex];
        let results;

        if (!worker) {
          recordBridgeFailure(nodePtyBridge, {
            action: 'prompt',
            worker: 'scheduler',
            workerIndex,
            pts: '',
            promptText: '',
            error: `유효한 scheduler worker가 없습니다: index ${workerIndex}`,
            packetId: '',
          });
          results = [{
            worker: `worker-${workerIndex}`,
            ok: false,
            error: `유효한 scheduler worker가 없습니다: index ${workerIndex}`,
          }];
        } else {
          const dispatchResult = dispatchBridgeAction(nodePtyBridge, {
            action: 'prompt',
            workerName: worker.name,
            workerIndex,
            pts: worker.pts,
            promptText: worker.prompt,
            packetId: worker.plan_id,
          });
          results = [{
            worker: worker.name,
            ok: dispatchResult.ok,
            error: dispatchResult.error,
          }];
          if (dispatchResult.ok) {
            metrics.ptyBridgeSendTotal.add(1, {
              route: url.pathname,
              method,
              action: 'prompt',
            });
          } else {
            metrics.ptyBridgeFailuresTotal.add(1, {
              route: url.pathname,
              method,
              reason: 'scheduler_send_now_failed',
            });
          }
        }

        const sendNowResponseBody = { results };
        if (idempotencyScope) {
          idempotencyStore.complete(idempotencyScope, { status: 200, body: sendNowResponseBody });
        }
        sendResponse(req, res, 200, sendNowResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/pty/enter-now') {
        const allWorkers = Array.isArray(nodePtyBridge.scheduler.workers) ? nodePtyBridge.scheduler.workers : [];
        const workerIndex = body && Number.isInteger(body.worker_index) ? body.worker_index : null;
        const workers = workerIndex !== null
          ? [allWorkers[workerIndex]].filter(Boolean)
          : allWorkers;
        const results = workers.length
          ? workers.map((worker) => {
            const dispatchResult = dispatchBridgeAction(nodePtyBridge, {
              action: 'enter',
              workerName: worker.name,
              workerIndex: workerIndex !== null ? workerIndex : allWorkers.indexOf(worker),
              pts: worker.pts,
              promptText: worker.prompt,
              packetId: worker.plan_id,
            });
            if (dispatchResult.ok) {
              metrics.ptyBridgeSendTotal.add(1, {
                route: url.pathname,
                method,
                action: 'enter',
              });
            } else {
              metrics.ptyBridgeFailuresTotal.add(1, {
                route: url.pathname,
                method,
                reason: 'scheduler_enter_now_failed',
              });
            }
            return {
              worker: worker.name,
              ok: dispatchResult.ok,
              error: dispatchResult.error,
            };
          })
          : [{
            worker: workerIndex !== null ? `worker-${workerIndex}` : 'scheduler',
            ok: false,
            error: workerIndex !== null
              ? `유효한 scheduler worker가 없습니다: index ${workerIndex}`
              : '즉시 엔터를 보낼 scheduler worker가 없습니다.',
          }];

        if (!workers.length) {
          const enterNowError = workerIndex !== null
            ? `유효한 scheduler worker가 없습니다: index ${workerIndex}`
            : '즉시 엔터를 보낼 scheduler worker가 없습니다.';
          recordBridgeFailure(nodePtyBridge, {
            action: 'enter',
            worker: workerIndex !== null ? `worker-${workerIndex}` : 'scheduler',
            workerIndex,
            pts: '',
            promptText: '',
            error: enterNowError,
            packetId: '',
          });
        }

        const enterNowResponseBody = { results };
        if (idempotencyScope) {
          idempotencyStore.complete(idempotencyScope, { status: 200, body: enterNowResponseBody });
        }
        sendResponse(req, res, 200, enterNowResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Planning Studio — save-packet / save-sections / save-automation ──
      if (
        method === 'POST' &&
        (url.pathname === '/api/planning-studio/save-packet' ||
          url.pathname === '/api/planning-studio/save-sections' ||
          url.pathname === '/api/planning-studio/save-automation')
      ) {
        const commandName = url.pathname.split('/').pop();
        const saveResult = spawnSync('python3', [
          path.resolve(__dirname, '../../scripts/planning_studio_api.py'), commandName,
        ], {
          cwd: runtimeRoot,
          encoding: 'utf8',
          input: JSON.stringify(body || {}),
        });
        if (saveResult.status !== 0) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          sendResponse(req, res, 500, fromError(
            Object.assign(new Error(`${commandName} failed`), { code: 'INTERNAL_ERROR' }),
            { path: url.pathname },
          ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
          return;
        }
        let saveData = {};
        try { saveData = JSON.parse(saveResult.stdout || '{}'); } catch (_) { saveData = {}; }
        const saveResponseBody = { ok: true, data: saveData };
        if (idempotencyScope) idempotencyStore.complete(idempotencyScope, { status: 200, body: saveResponseBody });
        sendResponse(req, res, 200, saveResponseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
        return;
      }

      // ── Dynamic UI serving (static artifacts catch-all) ──────────────────
      if (method === 'GET' || method === 'HEAD') {
        if (tryServeDynamicUi(req, res, url.pathname)) {
          if (idempotencyScope) idempotencyStore.abort(idempotencyScope);
          return;
        }
      }

      if (idempotencyScope) {
        idempotencyStore.abort(idempotencyScope);
      }
      metrics.httpRequestsTotal.add(1, { route: url.pathname, method, status: 404 });
      metrics.httpDurationMs.record(Date.now() - startMs, { route: url.pathname });
      span.setAttribute('http.status_code', 404).setStatus('error').end();
      sendResponse(req, res, 404, fromError(
        Object.assign(new Error(`Route not found: ${method} ${url.pathname}`), { code: 'NOT_FOUND' }),
        { path: url.pathname, traceId: span.traceId },
      ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
    } catch (error) {
      if (idempotencyScope) {
        idempotencyStore.abort(idempotencyScope);
      }
      // RFC 7807 Problem Details at transport layer
      const { status, body } = fromError(error, {
        path: req.url,
        correlationId,
        traceId: span.traceId,
      });
      metrics.httpErrorsTotal.add(1, { route: url.pathname, method, status });
      metrics.httpDurationMs.record(Date.now() - startMs, { route: url.pathname, error: true });
      span.setAttribute('http.status_code', status).recordException(error).end();
      logger.error('http.error', {
        trace_id: span.traceId,
        correlation_id: correlationId,
        route: url.pathname,
        status,
        message: error.message,
      });
      const errorHeaders = {
        ...responseBaseHeaders,
        ...(error.rateLimitHeaders || {}),
      };
      if (error.retryAfterSeconds) {
        errorHeaders['retry-after'] = String(error.retryAfterSeconds);
      }
      sendResponse(req, res, status, body, errorHeaders);
    }
  };
}

function createServer(overrides = {}) {
  return http.createServer(createAppHandler(overrides));
}

function startServer({
  port = 3000,
  host = '127.0.0.1',
  flags = null,
  runtimeRoot = path.resolve(__dirname, '../..'),
  idempotencyStore = undefined,
  rateLimiter = undefined,
  rateLimitPolicy = undefined,
  maxRequestBodyBytes = undefined,
  requestBodyReadTimeoutMs = undefined,
} = {}) {
  const lifecycleState = createLifecycleState();
  const server = createServer({
    flags,
    runtimeRoot,
    idempotencyStore,
    rateLimiter,
    rateLimitPolicy,
    maxRequestBodyBytes,
    requestBodyReadTimeoutMs,
    lifecycleState,
  });
  const sockets = new Set();
  let shutdownPromise = null;

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine listening address'));
        return;
      }

      // OutboxPoller 자동 시작 (서버 시작과 함께)
      _sharedOutboxPoller.start();

      resolve({
        server,
        port: address.port,
        host: address.address,
        url: `http://${host}:${address.port}`,
        enterDrainMode(reason = 'manual') {
          enterDrainMode(lifecycleState, reason);
        },
        async shutdown({ reason = 'manual', graceMs = 5000 } = {}) {
          if (shutdownPromise) {
            return shutdownPromise;
          }
          enterDrainMode(lifecycleState, reason);
          // OutboxPoller 정상 종료 (진행 중인 poll 완료 후 정지)
          await _sharedOutboxPoller.stop();
          shutdownPromise = new Promise((resolveShutdown, rejectShutdown) => {
            const forceCloseTimer = setTimeout(() => {
              for (const socket of sockets) {
                socket.destroy();
              }
            }, graceMs);
            forceCloseTimer.unref?.();

            server.close((error) => {
              clearTimeout(forceCloseTimer);
              if (error) {
                rejectShutdown(error);
                return;
              }
              resolveShutdown();
            });
          });
          return shutdownPromise;
        },
      });
    });
  });
}

module.exports = {
  createAppHandler,
  createServer,
  startServer,
  createAllEnabledFlags,
  resolveTaskRepository,
  _domainEventRingBuffer,
  _domainEventDlq,
  _sharedOutboxPoller,
};
