'use strict';

// Domain Core: UI/DB/프레임워크/네트워크 import 금지 (C002)

const VALID_STATUSES = Object.freeze(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

// INV002: 허용된 상태 전이 맵.  DONE / CANCELLED 는 terminal.
const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING:     ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE:        [],
  CANCELLED:   [],
});

class TaskStatus {
  #value;

  constructor(value) {
    if (!VALID_STATUSES.includes(value)) {
      throw Object.assign(
        new Error(`유효하지 않은 작업 상태: ${value}. 허용값: ${VALID_STATUSES.join(', ')}`),
        { code: 'VALIDATION_ERROR' },
      );
    }
    this.#value = value;
  }

  get value() { return this.#value; }

  canTransitionTo(nextStatus) {
    return ALLOWED_TRANSITIONS[this.#value].includes(nextStatus);
  }

  transitionTo(nextStatus) {
    if (!this.canTransitionTo(nextStatus)) {
      throw Object.assign(
        new Error(
          `[INV002] 상태 전이 불가: ${this.#value} → ${nextStatus}. ` +
          `허용된 전이: ${ALLOWED_TRANSITIONS[this.#value].join(', ') || '없음 (terminal 상태)'}`
        ),
        { code: 'CONFLICT' },
      );
    }
    return new TaskStatus(nextStatus);
  }

  equals(other) {
    return other instanceof TaskStatus && this.#value === other.value;
  }

  toString() { return this.#value; }

  static PENDING      = new TaskStatus('PENDING');
  static IN_PROGRESS  = new TaskStatus('IN_PROGRESS');
  static DONE         = new TaskStatus('DONE');
  static CANCELLED    = new TaskStatus('CANCELLED');

  static from(value) { return new TaskStatus(value); }
}

module.exports = { TaskStatus, VALID_STATUSES, ALLOWED_TRANSITIONS };
