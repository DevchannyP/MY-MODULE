'use strict';

const { resolveHarnessRuntimeRoute } = require('../../infrastructure/HarnessRuntimeRouter');
const { fromError } = require('../../shared/ProblemDetails');

function createHarnessRouteHandler({
  harnessProviderAdapter,
  flagsProvider = null,
  recordOperation = null,
  onMetric = null,
} = {}) {
  return async function handleHarnessRoute(req, res, context = {}) {
    const {
      url,
      body = {},
      method,
      sendResponse,
      mergeHeaders,
      responseBaseHeaders = {},
      responseHeaders = {},
      correlationId = '',
      requestId = '',
      span = null,
      idempotencyScope = null,
      idempotencyStore = null,
    } = context;

    if (method !== 'POST' || url.pathname !== '/api/harness/prompt-recommendation') {
      return false;
    }

    const observation = recordOperation
      ? recordOperation({
          parentSpan: span || { traceId: '', spanId: '' },
          operation: 'harness.prompt_recommendation',
          route: url.pathname,
          method,
          correlationId,
          requestId,
        })
      : { succeed() {}, fail() {} };

    const requestedMode = typeof body.mode === 'string' ? body.mode.trim() : 'Build';
    const intakePacket = body.intakePacket && typeof body.intakePacket === 'object'
      ? body.intakePacket
      : { goal: String(body.basePrompt || ''), context: [], constraints: [], done_when: [] };
    const basePrompt = String(body.basePrompt || intakePacket.goal || '');

    const route = resolveHarnessRuntimeRoute({ mode: requestedMode, flagsProvider });

    try {
      const result = await harnessProviderAdapter.generatePromptRecommendation({
        route,
        intakePacket,
        basePrompt,
        correlationId,
        requestId,
      });

      if (onMetric) {
        onMetric('controlCenterPromptRecommendationsTotal', { route: url.pathname, method });
      }

      observation.succeed({
        'harness.mode': requestedMode,
        'harness.route_id': route.route_id,
        'harness.provider_id': String(result.provider?.provider_id || 'unknown'),
        'harness.fallback_applied': String(result.provider?.fallback_applied || false),
      });

      if (idempotencyScope && idempotencyStore) {
        idempotencyStore.complete(idempotencyScope, { status: 200, body: result });
      }
      sendResponse(req, res, 200, result, mergeHeaders(responseBaseHeaders, responseHeaders));
      return true;
    } catch (harnessErr) {
      observation.fail(harnessErr, { 'harness.mode': requestedMode });
      if (idempotencyScope && idempotencyStore) {
        idempotencyStore.abort(idempotencyScope);
      }
      sendResponse(req, res, 500, fromError(
        Object.assign(harnessErr, { code: harnessErr.code || 'HARNESS_PROVIDER_ERROR' }),
        { path: url.pathname },
      ).body, mergeHeaders(responseBaseHeaders, responseHeaders));
      return true;
    }
  };
}

module.exports = {
  createHarnessRouteHandler,
};
