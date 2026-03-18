'use strict';

const { Task } = require('../domain/entities/Task');
const { TaskRepository } = require('../application/ports/TaskRepository');

/**
 * 인메모리 TaskRepository 구현체.
 * 프로덕션에서는 DB 어댑터로 교체한다. 인터페이스(포트)는 동일하다.
 */
class InMemoryTaskRepository extends TaskRepository {
  constructor() {
    super();
    this._store = new Map(); // task_id → snapshot
  }

  async save(task) {
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
