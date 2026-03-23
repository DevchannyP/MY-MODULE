// @ts-check
'use strict';

/**
 * TaskController — task-tracking HTTP 인터페이스 계층
 *
 * openapi.yaml 5개 경로 / 5개 오퍼레이션을 구현한다.
 * 프레임워크 독립(Express/Fastify 무관): handle(req) → { status, body }
 *
 * ADR-0002: 인터페이스 레이어 authz 강제 결정 이행.
 * 권한 집합:
 *   task:read  → task-viewer 이상
 *   task:write → task-owner 이상
 */

const { fromError } = require('../../../../../src/shared/ProblemDetails');

class TaskController {
  /**
   * @param {{
   *   createTask:           import('../application/CreateTaskUseCase').CreateTaskUseCase,
   *   getTask:              import('../application/GetTaskUseCase').GetTaskUseCase,
   *   listTasks:            import('../application/ListTasksUseCase').ListTasksUseCase,
   *   transitionTaskStatus: import('../application/TransitionTaskStatusUseCase').TransitionTaskStatusUseCase,
   *   reassignTask:         import('../application/ReassignTaskUseCase').ReassignTaskUseCase,
   * }} useCases
   */
  constructor(useCases) {
    this._createTask           = useCases.createTask;
    this._getTask              = useCases.getTask;
    this._listTasks            = useCases.listTasks;
    this._transitionTaskStatus = useCases.transitionTaskStatus;
    this._reassignTask         = useCases.reassignTask;
  }

  /**
   * 단일 진입점: 모든 HTTP 요청을 처리한다.
   *
   * @param {{
   *   method:  string,
   *   path:    string,
   *   params:  Record<string, string>,
   *   query:   Record<string, string>,
   *   body:    unknown,
   *   caller:  { userId: string, permissions: string[] },
   *   correlationId?: string,
   * }} req
   * @returns {Promise<{ status: number, body: unknown }>}
   */
  async handle(req) {
    try {
      return await this._route(req);
    } catch (err) {
      return this._errorResponse(err, req.correlationId);
    }
  }

  // ── 라우터 ────────────────────────────────────────────────────────────────

  async _route(req) {
    const { method, path } = req;

    // GET /tasks
    if (method === 'GET' && path === '/tasks') {
      return this._handleListTasks(req);
    }
    // POST /tasks
    if (method === 'POST' && path === '/tasks') {
      return this._handleCreateTask(req);
    }

    // /tasks/{task_id} 계열
    const taskDetailMatch = path.match(/^\/tasks\/([^/]+)$/);
    if (taskDetailMatch) {
      const taskId = taskDetailMatch[1];
      if (method === 'GET') return this._handleGetTask(req, taskId);
    }

    const statusMatch = path.match(/^\/tasks\/([^/]+)\/status$/);
    if (statusMatch && method === 'PATCH') {
      return this._handleTransitionStatus(req, statusMatch[1]);
    }

    const assigneeMatch = path.match(/^\/tasks\/([^/]+)\/assignee$/);
    if (assigneeMatch && method === 'PATCH') {
      return this._handleReassign(req, assigneeMatch[1]);
    }

    const err = Object.assign(new Error('경로를 찾을 수 없습니다.'), { code: 'NOT_FOUND' });
    return fromError(err, { path: req.path, correlationId: req.correlationId });
  }

  // ── 핸들러 ────────────────────────────────────────────────────────────────

  async _handleListTasks(req) {
    this._requirePermission(req.caller, 'task:read');
    const { assignee_id, status, due_before, page, page_size } = req.query || {};
    const result = await this._listTasks.execute({
      assignee_id,
      status,
      due_before,
      page:      page      ? Number(page)      : 1,
      page_size: page_size ? Number(page_size) : 20,
    }, req.caller);
    return { status: 200, body: result };
  }

  async _handleCreateTask(req) {
    this._requirePermission(req.caller, 'task:write');
    const { title, assignee_id, due_date, description } = req.body || {};
    const result = await this._createTask.execute({ title, assignee_id, due_date, description }, req.caller);
    return { status: 201, body: { task_id: result.task_id, status: result.status } };
  }

  async _handleGetTask(req, taskId) {
    this._requirePermission(req.caller, 'task:read');
    const task = await this._getTask.execute({ task_id: taskId }, req.caller);
    return { status: 200, body: this._serializeTask(task) };
  }

  async _handleTransitionStatus(req, taskId) {
    this._requirePermission(req.caller, 'task:write');
    const { new_status } = req.body || {};
    const result = await this._transitionTaskStatus.execute({ task_id: taskId, new_status }, req.caller);
    return { status: 200, body: result };
  }

  async _handleReassign(req, taskId) {
    this._requirePermission(req.caller, 'task:write');
    const { new_assignee_id } = req.body || {};
    const result = await this._reassignTask.execute({ task_id: taskId, new_assignee_id }, req.caller);
    return { status: 200, body: this._serializeTask(result) };
  }

  // ── 권한 강제 (ADR-0002) ──────────────────────────────────────────────────

  _requirePermission(caller, permission) {
    if (!caller || !Array.isArray(caller.permissions) || !caller.permissions.includes(permission)) {
      const err = new Error(`권한이 없습니다: ${permission}`);
      err.code = 'FORBIDDEN';
      throw err;
    }
  }

  // ── 직렬화 ────────────────────────────────────────────────────────────────

  _serializeTask(snapshot) {
    return {
      task_id:     snapshot.id ?? snapshot.task_id,
      title:       snapshot.title,
      assignee_id: snapshot.assignee_id,
      due_date:    snapshot.due_date ?? null,
      description: snapshot.description ?? null,
      status:      snapshot.status,
      created_at:  snapshot.created_at,
      updated_at:  snapshot.updated_at,
    };
  }

  // ── 오류 응답 ─────────────────────────────────────────────────────────────

  /** RFC 7807 Problem Details 에러 응답 (IETF 표준) */
  _errorResponse(err, correlationId) {
    return fromError(err, { correlationId });
  }
}

module.exports = { TaskController };
