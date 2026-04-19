'use strict';

const path = require('node:path');
const { EventBus } = require('../../shared/EventBus');
const { createMpoPipeline } = require('../../../scripts/mpo-pipeline');

function createMpoRouteHandler({
  runtimeRoot = path.resolve(__dirname, '../../..'),
  harnessProviderAdapter,
  flagsProvider = null,
} = {}) {
  const eventBus = EventBus.getInstance();
  const sessions = new Map();
  const pipeline = createMpoPipeline({
    root: runtimeRoot,
    harnessProviderAdapter,
    flagsProvider,
    emitEvent(type, payload) {
      eventBus.publish({
        type,
        occurred_at: new Date().toISOString(),
        ...payload,
      });
      const sessionId = payload && payload.session_id ? String(payload.session_id) : '';
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        const events = Array.isArray(session.events) ? session.events.slice(-49) : [];
        events.push({ type, payload, occurred_at: new Date().toISOString() });
        sessions.set(sessionId, { ...session, events });
      }
    },
  });

  async function runExecution(sessionId) {
    const current = sessions.get(sessionId);
    if (!current) {
      return;
    }
    sessions.set(sessionId, { ...current, status: 'running' });
    try {
      const execution = await pipeline.execute(current);
      const next = sessions.get(sessionId);
      sessions.set(sessionId, {
        ...next,
        status: execution.replanned ? 'completed_with_replan' : 'completed',
        execution,
      });
    } catch (error) {
      const next = sessions.get(sessionId);
      sessions.set(sessionId, {
        ...next,
        status: 'failed',
        error: {
          message: error.message,
          code: error.code || 'MPO_EXECUTION_FAILED',
        },
      });
      eventBus.publish({
        type: 'mpo.wp.failed',
        occurred_at: new Date().toISOString(),
        session_id: sessionId,
        reason: error.code || 'MPO_EXECUTION_FAILED',
        detail: error.message,
      });
    }
  }

  function buildSessionResponse(session) {
    return {
      session_id: session.session_id,
      status: session.status,
      approval_state: session.approval_state,
      intake_packet: session.intake_packet,
      dag: session.dag,
      execution: session.execution || null,
      error: session.error || null,
      events: session.events || [],
    };
  }

  return async function handleMpoRoute(req, res, context = {}) {
    const {
      url,
      body = {},
      sendResponse,
      mergeHeaders,
      responseBaseHeaders = {},
      responseHeaders = {},
      idempotencyScope = null,
      idempotencyStore = null,
    } = context;

    if (!url.pathname.startsWith('/api/v1/mpo')) {
      return false;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/mpo/plan') {
      const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
      if (!goal) {
        sendResponse(req, res, 400, {
          type: 'about:blank',
          title: 'Validation Error',
          status: 400,
          detail: 'goal is required',
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return true;
      }

      const session = await pipeline.createPlan({
        goal,
        approvalRequested: body.auto_approve === true ? false : true,
      });
      sessions.set(session.session_id, {
        ...session,
        status: session.approval_state === 'auto-approved' ? 'queued' : 'awaiting_approval',
        events: [],
      });

      if (session.approval_state === 'auto-approved') {
        void runExecution(session.session_id);
      }

      const responseBody = buildSessionResponse(sessions.get(session.session_id));
      const statusCode = session.approval_state === 'auto-approved' ? 202 : 200;
      if (idempotencyScope && idempotencyStore) {
        idempotencyStore.complete(idempotencyScope, { status: statusCode, body: responseBody });
      }
      sendResponse(req, res, statusCode, responseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
      return true;
    }

    const sessionMatch = url.pathname.match(/^\/api\/v1\/mpo\/session\/([^/]+)$/);
    if (req.method === 'GET' && sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      if (!session) {
        sendResponse(req, res, 404, {
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `unknown MPO session: ${sessionMatch[1]}`,
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return true;
      }
      sendResponse(req, res, 200, buildSessionResponse(session), mergeHeaders(responseBaseHeaders, responseHeaders));
      return true;
    }

    const approveMatch = url.pathname.match(/^\/api\/v1\/mpo\/session\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      const session = sessions.get(approveMatch[1]);
      if (!session) {
        sendResponse(req, res, 404, {
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `unknown MPO session: ${approveMatch[1]}`,
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return true;
      }
      if (session.status !== 'awaiting_approval') {
        sendResponse(req, res, 409, {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: `session is not awaiting approval: ${session.status}`,
        }, mergeHeaders(responseBaseHeaders, responseHeaders));
        return true;
      }
      sessions.set(session.session_id, {
        ...session,
        approval_state: 'approved',
        status: 'queued',
      });
      void runExecution(session.session_id);
      const responseBody = buildSessionResponse(sessions.get(session.session_id));
      if (idempotencyScope && idempotencyStore) {
        idempotencyStore.complete(idempotencyScope, { status: 202, body: responseBody });
      }
      sendResponse(req, res, 202, responseBody, mergeHeaders(responseBaseHeaders, responseHeaders));
      return true;
    }

    return false;
  };
}

module.exports = {
  createMpoRouteHandler,
};
