'use strict';

const { Task } = require('../domain/entities/Task');
const { TaskRepository } = require('../application/ports/TaskRepository');

/**
 * 인메모리 TaskRepository 구현체.
 * 프로덕션에서는 DB 어댑터로 교체한다. 인터페이스(포트)는 동일하다.
 *
 * NFR: nfr_extended.concurrency.thread_safety
 *   쓰기는 낙관적 잠금: 저장된 version + 1 === 저장하려는 version이어야 함.
 *   신규 엔티티(ID 없음)는 버전 체크 생략.
 */
class InMemoryTaskRepository extends TaskRepository {
  constructor() {
    super();
    this._store = new Map(); // task_id → snapshot
  }

  async save(task) {
    const existing = this._store.get(task.id);
    if (existing && existing.version !== undefined && task.version !== undefined) {
      if (existing.version + 1 !== task.version) {
        throw Object.assign(
          new Error(
            `Optimistic lock conflict for task ${task.id}: ` +
            `expected version ${existing.version + 1}, got ${task.version}`
          ),
          { code: 'OPTIMISTIC_LOCK_CONFLICT', expected: existing.version + 1, actual: task.version },
        );
      }
    }
    this._store.set(task.id, task.toSnapshot());
    return task;
  }

  async findById(taskId) {
    const snapshot = this._store.get(taskId);
    if (!snapshot) return null;
    return Task.reconstitute(snapshot);
  }

  async findAll({ assignee_id, status, due_before, page = 1, page_size = 20 } = {}) {
    let items = Array.from(this._store.values()).map(s => Task.reconstitute(s));

    if (assignee_id) items = items.filter(t => t.assignee_id === assignee_id);
    if (status)      items = items.filter(t => t.status === status);
    if (due_before)  items = items.filter(t => t.due_date && t.due_date < due_before);

    const total  = items.length;
    const offset = (page - 1) * page_size;
    items = items.slice(offset, offset + page_size);

    return { items, total };
  }
}

module.exports = { InMemoryTaskRepository };
