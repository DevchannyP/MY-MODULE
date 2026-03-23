'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const { TaskController } = require('../../domains/productivity/task-tracking/src/interface/TaskController');
const { CreateTaskUseCase } = require('../../domains/productivity/task-tracking/src/application/CreateTaskUseCase');
const { GetTaskUseCase } = require('../../domains/productivity/task-tracking/src/application/GetTaskUseCase');
const { ListTasksUseCase } = require('../../domains/productivity/task-tracking/src/application/ListTasksUseCase');
const { TransitionTaskStatusUseCase } = require('../../domains/productivity/task-tracking/src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase } = require('../../domains/productivity/task-tracking/src/application/ReassignTaskUseCase');
const { InMemoryTaskRepository } = require('../../domains/productivity/task-tracking/src/infrastructure/InMemoryTaskRepository');

const { BillingController } = require('../../domains/billing/src/interface/BillingController');
const { VideoController } = require('../../domains/video/src/interface/VideoController');
const { fromError } = require('../shared/ProblemDetails');
const { InMemoryEventPublisher } = require('../shared/EventPublisher');
const { InMemoryIdempotencyStore } = require('../shared/IdempotencyStore');
const { getFeatureFlags } = require('../infrastructure/FeatureFlagProvider');
const { tracer, metrics, logger } = require('../infrastructure/telemetry');
const { InMemoryInvoiceRepository } = require('../../domains/billing/src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryPaymentRepository } = require('../../domains/billing/src/infrastructure/InMemoryPaymentRepository');
const { InMemoryBillingExceptionRepository } = require('../../domains/billing/src/infrastructure/InMemoryBillingExceptionRepository');
const { InMemoryVideoRepository } = require('../../domains/video/src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository } = require('../../domains/video/src/infrastructure/InMemoryTranscodeJobRepository');

function createTaskController(taskRepository = new InMemoryTaskRepository(), eventPublisher = new InMemoryEventPublisher()) {
  return new TaskController({
    createTask:           new CreateTaskUseCase(taskRepository, eventPublisher),
    getTask:              new GetTaskUseCase(taskRepository),
    listTasks:            new ListTasksUseCase(taskRepository),
    transitionTaskStatus: new TransitionTaskStatusUseCase(taskRepository),
    reassignTask:         new ReassignTaskUseCase(taskRepository),
  });
}

function createBillingController() {
  return new BillingController({
    invoiceRepo: new InMemoryInvoiceRepository(),
    paymentRepo: new InMemoryPaymentRepository(),
    exceptionRepo: new InMemoryBillingExceptionRepository(),
  });
}

function createVideoController() {
  return new VideoController({
    videoRepository: new InMemoryVideoRepository(),
    transcodeJobRepository: new InMemoryTranscodeJobRepository(),
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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { code: 'VALIDATION_ERROR' }));
      }
    });

    req.on('error', reject);
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

/** FeatureFlagProvider stub — 모든 플래그 활성화 (테스트/smoke 전용) */
function createAllEnabledFlags() {
  return {
    isEnabled: () => true,
    evaluate(flagName, context) {
      return { flagName, value: true, reason: 'TEST_OVERRIDE', metadata: {}, stale: false, context: context || {} };
    },
    getAll: () => ({}),
    getRuntimeStatus: () => ({ flagsLoaded: true, metadataLoaded: true, errors: [], flagCount: 0, metadataCount: 0 }),
  };
}

function createAppHandler({
  taskController = createTaskController(),
  billingController = createBillingController(),
  videoController = createVideoController(),
  idempotencyStore = new InMemoryIdempotencyStore(),
  flags = null,  // null → 파일 기반 provider 사용 (프로덕션 기본값)
} = {}) {
  const bootedAt = new Date().toISOString();
  return async function appHandler(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const method = req.method || 'GET';
    const caller = getCaller(req.headers);
    const correlationId = typeof req.headers['x-correlation-id'] === 'string'
      ? req.headers['x-correlation-id']
      : undefined;

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

    try {
      const resolvedFlags = flags || getFeatureFlags();
      const runtimeStatus = getRuntimeStatus(resolvedFlags);

      if (url.pathname === '/livez') {
        metrics.httpRequestsTotal.add(1, { route: '/livez', method });
        span.setStatus('ok').end();
        sendJson(res, 200, { status: 'alive', service: 'my-module', transport: 'http', traceId: span.traceId });
        return;
      }

      if (url.pathname === '/startupz') {
        metrics.httpRequestsTotal.add(1, { route: '/startupz', method });
        span.setStatus('ok').end();
        sendJson(res, 200, {
          status: 'started',
          started_at: bootedAt,
          service: 'my-module',
          traceId: span.traceId,
        });
        return;
      }

      if (url.pathname === '/readyz') {
        const ready = runtimeStatus.flagsLoaded && runtimeStatus.metadataLoaded && runtimeStatus.errors.length === 0;
        metrics.httpRequestsTotal.add(1, { route: '/readyz', method, status: ready ? 200 : 503 });
        span.setAttribute('http.status_code', ready ? 200 : 503).setStatus(ready ? 'ok' : 'error').end();
        sendJson(res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'not_ready',
          service: 'my-module',
          feature_flags: runtimeStatus,
          traceId: span.traceId,
        });
        return;
      }

      if (url.pathname === '/health') {
        metrics.httpRequestsTotal.add(1, { route: '/health', method });
        span.setStatus('ok').end();
        sendJson(res, 200, {
          status: 'ok',
          service: 'my-module',
          transport: 'http',
          feature_flags: runtimeStatus,
          traceId: span.traceId,
        });
        return;
      }

      const body = method === 'GET' || method === 'HEAD' ? {} : await readRequestBody(req);
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
          sendJson(res, claim.response.status, claim.response.body, {
            'idempotency-replayed': 'true',
          });
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
          sendJson(res, 404, fromError(
            Object.assign(new Error('task-management 기능이 비활성화 상태입니다.'), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body);
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
        sendJson(res, response.status, response.body);
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
          sendJson(res, 404, fromError(
            Object.assign(new Error('billing 기능이 비활성화 상태입니다.'), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body);
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
        sendJson(res, response.status, response.body);
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
          sendJson(res, 404, fromError(
            Object.assign(new Error('video 기능이 비활성화 상태입니다.'), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body);
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
          sendJson(res, 404, fromError(
            Object.assign(new Error(`video 세부 기능이 비활성화 상태입니다: ${scopedFlag}`), { code: 'NOT_FOUND' }),
            { path: url.pathname },
          ).body);
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
        sendJson(res, response.status, response.body);
        return;
      }

      if (idempotencyScope) {
        idempotencyStore.abort(idempotencyScope);
      }
      metrics.httpRequestsTotal.add(1, { route: url.pathname, method, status: 404 });
      metrics.httpDurationMs.record(Date.now() - startMs, { route: url.pathname });
      span.setAttribute('http.status_code', 404).setStatus('error').end();
      sendJson(res, 404, fromError(
        Object.assign(new Error(`Route not found: ${method} ${url.pathname}`), { code: 'NOT_FOUND' }),
        { path: url.pathname, traceId: span.traceId },
      ).body);
    } catch (error) {
      if (idempotencyScope) {
        idempotencyStore.abort(idempotencyScope);
      }
      // RFC 7807 Problem Details at transport layer
      const { status, body } = fromError(error, {
        path: req.url,
        correlationId: typeof req.headers['x-correlation-id'] === 'string'
          ? req.headers['x-correlation-id'] : undefined,
        traceId: span.traceId,
      });
      metrics.httpErrorsTotal.add(1, { route: url.pathname, method, status });
      metrics.httpDurationMs.record(Date.now() - startMs, { route: url.pathname, error: true });
      span.setAttribute('http.status_code', status).recordException(error).end();
      logger.error('http.error', { trace_id: span.traceId, route: url.pathname, status, message: error.message });
      sendJson(res, status, body);
    }
  };
}

function createServer(overrides = {}) {
  return http.createServer(createAppHandler(overrides));
}

function startServer({ port = 3000, host = '127.0.0.1', flags = null, idempotencyStore = undefined } = {}) {
  const server = createServer({ flags, idempotencyStore });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine listening address'));
        return;
      }

      resolve({
        server,
        port: address.port,
        host: address.address,
        url: `http://${host}:${address.port}`,
      });
    });
  });
}

module.exports = {
  createAppHandler,
  createServer,
  startServer,
  createAllEnabledFlags,
};
