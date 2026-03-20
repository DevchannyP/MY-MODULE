'use strict';

/**
 * InvoiceStatus value object
 * INV-B002: 허용된 전이만 가능, 역전이 불가
 *
 * 상태 전이도:
 *   DRAFT → PENDING → PAID        (terminal)
 *                  └→ CANCELLED   (terminal)
 *                  └→ DISPUTED → PAID        (관리자 승인 필요 — INV-B005)
 *                              └→ CANCELLED
 */

const STATUSES = Object.freeze({
  DRAFT:     'DRAFT',
  PENDING:   'PENDING',
  PAID:      'PAID',
  CANCELLED: 'CANCELLED',
  DISPUTED:  'DISPUTED',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  DRAFT:     ['PENDING'],
  PENDING:   ['PAID', 'CANCELLED', 'DISPUTED'],
  DISPUTED:  ['PAID', 'CANCELLED'],   // PAID requires admin approval (INV-B005, enforced at service layer)
  PAID:      [],                       // terminal
  CANCELLED: [],                       // terminal
});

class InvoiceStatus {
  constructor(value) {
    if (!Object.values(STATUSES).includes(value)) {
      throw Object.assign(
        new Error(`Invalid InvoiceStatus: ${value}`),
        { code: 'VALIDATION_ERROR' },
      );
    }
    this._value = value;
    Object.freeze(this);
  }

  get value() { return this._value; }

  isTerminal() {
    return this._value === STATUSES.PAID || this._value === STATUSES.CANCELLED;
  }

  canTransitionTo(nextStatus) {
    const next = nextStatus instanceof InvoiceStatus ? nextStatus.value : nextStatus;
    return ALLOWED_TRANSITIONS[this._value].includes(next);
  }

  equals(other) {
    if (other instanceof InvoiceStatus) return this._value === other.value;
    return this._value === other;
  }

  toString() { return this._value; }
  toJSON()   { return this._value; }

  static of(value) { return new InvoiceStatus(value); }
}

// Named constructors
Object.entries(STATUSES).forEach(([key, val]) => {
  InvoiceStatus[key] = new InvoiceStatus(val);
});

module.exports = { InvoiceStatus, STATUSES, ALLOWED_TRANSITIONS };
