// @ts-check
'use strict';

// Domain Core: UI/DB/프레임워크/네트워크 import 금지 (C002)
const { TaskStatus } = require('../value-objects/TaskStatus');
const { TaskCreated, TaskStatusChanged, TaskReassigned } = require('../events/TaskEvents');

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   assignee_id: string,
 *   due_date?: string|null,
 *   description?: string|null,
 *   status: string|import('../value-objects/TaskStatus').TaskStatus,
 *   created_at?: string,
 *   updated_at?: string,
 *   version?: number,
 * }} TaskSnapshot
 */
/**
 * @typedef {{
 *   title: string,
 *   assignee_id: string,
 *   due_date?: string|null,
 *   description?: string|null,
 * }} CreateTaskInput
 */

let _idCounter = 0;
function generateId() {
  return `task-${Date.now()}-${++_idCounter}`;
}

class Task {
  #id;
  #title;
  #assignee_id;
  #due_date;
  #description;
  #status;
  #created_at;
  #updated_at;
  #domainEvents;
  #version;

  /**
   * @param {TaskSnapshot} param0
   */
  constructor({ id, title, assignee_id, due_date, description, status, created_at, updated_at, version }) {
    this.#id          = id;
    this.#title       = title;
    this.#assignee_id = assignee_id;
    this.#due_date    = due_date ?? null;
    this.#description = description ?? null;
    this.#status      = status instanceof TaskStatus ? status : TaskStatus.from(status);
    this.#created_at  = created_at ?? new Date().toISOString();
    this.#updated_at  = updated_at ?? this.#created_at;
    this.#domainEvents = [];
    this.#version     = typeof version === 'number' ? version : 1;
  }

  // ── 팩토리: 새 작업 생성 (INV001, INV003 강제) ──────────────────────────
  /**
   * @param {CreateTaskInput} param0
   * @returns {Task}
   */
  static create({ title, assignee_id, due_date, description }) {
    // INV001: 담당자 필수
    if (!assignee_id || String(assignee_id).trim() === '') {
      throw Object.assign(
        new Error('[INV001] 담당자(assignee_id)는 필수입니다.'),
        { code: 'VALIDATION_ERROR' },
      );
    }
    // title 검증
    if (!title || String(title).trim() === '') {
      throw Object.assign(new Error('제목(title)은 필수입니다.'), { code: 'VALIDATION_ERROR' });
    }
    if (String(title).length > 200) {
      throw Object.assign(
        new Error('제목(title)은 200자를 초과할 수 없습니다.'),
        { code: 'VALIDATION_ERROR' },
      );
    }
    // INV003: 마감일이 오늘 이전이면 불가
    if (due_date !== null && due_date !== undefined) {
      const today = new Date().toISOString().slice(0, 10);
      if (due_date < today) {
        throw Object.assign(
          new Error(`[INV003] 마감일(${due_date})은 오늘(${today}) 이후여야 합니다.`),
          { code: 'VALIDATION_ERROR' },
        );
      }
    }
    if (description !== null && description !== undefined && String(description).length > 2000) {
      throw Object.assign(
        new Error('설명(description)은 2000자를 초과할 수 없습니다.'),
        { code: 'VALIDATION_ERROR' },
      );
    }

    const task = new Task({
      id: generateId(),
      title: String(title).trim(),
      assignee_id: String(assignee_id).trim(),
      due_date: due_date ?? null,
      description: description ?? null,
      status: TaskStatus.PENDING,
    });

    task.#domainEvents.push(new TaskCreated({
      task_id: task.#id,
      title: task.#title,
      assignee_id: task.#assignee_id,
      due_date: task.#due_date,
      status: task.#status.value,
    }));

    return task;
  }

  // ── 재구성: 저장소에서 불러올 때 사용 ──────────────────────────────────
  /**
   * @param {TaskSnapshot} snapshot
   * @returns {Task}
   */
  static reconstitute(snapshot) {
    return new Task(snapshot);
  }

  // ── 상태 전이 (INV002 강제) ─────────────────────────────────────────────
  /**
   * @param {string} newStatusValue
   * @returns {Task}
   */
  transitionTo(newStatusValue) {
    const oldStatus  = this.#status;
    const nextStatus = this.#status.transitionTo(newStatusValue); // INV002는 TaskStatus 내부에서 throw
    const updated = new Task({
      ...this.toSnapshot(),
      status:     nextStatus,
      updated_at: new Date().toISOString(),
      version:    this.#version + 1,
    });
    updated.#domainEvents.push(new TaskStatusChanged({
      task_id:    this.#id,
      old_status: oldStatus.value,
      new_status: nextStatus.value,
    }));
    return updated;
  }

  // ── 담당자 변경 (INV001 강제) ────────────────────────────────────────────
  /**
   * @param {string} newAssigneeId
   * @returns {Task}
   */
  reassign(newAssigneeId) {
    if (!newAssigneeId || String(newAssigneeId).trim() === '') {
      throw Object.assign(
        new Error('[INV001] 새 담당자(new_assignee_id)는 필수입니다.'),
        { code: 'VALIDATION_ERROR' },
      );
    }
    const oldAssigneeId = this.#assignee_id;
    const trimmedId     = String(newAssigneeId).trim();
    const updated = new Task({
      ...this.toSnapshot(),
      assignee_id: trimmedId,
      updated_at:  new Date().toISOString(),
      version:     this.#version + 1,
    });
    updated.#domainEvents.push(new TaskReassigned({
      task_id:         this.#id,
      old_assignee_id: oldAssigneeId,
      new_assignee_id: trimmedId,
    }));
    return updated;
  }

  // ── 도메인 이벤트 수집 및 클리어 ─────────────────────────────────────────
  /**
   * @returns {Array<object>}
   */
  pullDomainEvents() {
    const events = [...this.#domainEvents];
    this.#domainEvents = [];
    return events;
  }

  // ── 스냅샷 (저장소가 직렬화할 때 사용) ──────────────────────────────────
  /**
   * @returns {TaskSnapshot}
   */
  toSnapshot() {
    return {
      id:          this.#id,
      title:       this.#title,
      assignee_id: this.#assignee_id,
      due_date:    this.#due_date,
      description: this.#description,
      status:      this.#status.value,
      created_at:  this.#created_at,
      updated_at:  this.#updated_at,
      version:     this.#version,
    };
  }

  // ── Getters ──────────────────────────────────────────────────────────────
  get id()          { return this.#id; }
  get title()       { return this.#title; }
  get assignee_id() { return this.#assignee_id; }
  get due_date()    { return this.#due_date; }
  get description() { return this.#description; }
  get version()     { return this.#version; }
  get status()      { return this.#status.value; }
  get created_at()  { return this.#created_at; }
  get updated_at()  { return this.#updated_at; }
}

module.exports = { Task };
