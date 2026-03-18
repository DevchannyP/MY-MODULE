'use strict';

// Domain Core: UI/DB/프레임워크/네트워크 import 금지 (C002)

let _eventIdCounter = 0;
function generateEventId() {
  return `evt-${Date.now()}-${++_eventIdCounter}`;
}

class DomainEvent {
  constructor(eventType, payload) {
    this.event_id    = generateEventId();
    this.event_type  = eventType;
    this.occurred_at = new Date().toISOString();
    this.payload     = Object.freeze({ ...payload });
  }
}

class TaskCreated extends DomainEvent {
  constructor({ task_id, title, assignee_id, due_date, status }) {
    super('TaskCreated', { task_id, title, assignee_id, due_date: due_date ?? null, status });
  }
}

class TaskStatusChanged extends DomainEvent {
  constructor({ task_id, old_status, new_status }) {
    super('TaskStatusChanged', { task_id, old_status, new_status });
  }
}

class TaskReassigned extends DomainEvent {
  constructor({ task_id, old_assignee_id, new_assignee_id }) {
    super('TaskReassigned', { task_id, old_assignee_id, new_assignee_id });
  }
}

module.exports = { TaskCreated, TaskStatusChanged, TaskReassigned };
