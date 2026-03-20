// @ts-check
'use strict';

const EXCEPTION_TYPES   = Object.freeze({ MISMATCH: 'MISMATCH', DISPUTED: 'DISPUTED', SYNC_FAILURE: 'SYNC_FAILURE' });
const EXCEPTION_STATUSES = Object.freeze({ OPEN: 'OPEN', APPROVED: 'APPROVED', REJECTED: 'REJECTED', RESOLVED: 'RESOLVED' });

/**
 * @typedef {{
 *   exceptionId: string,
 *   invoiceId: string,
 *   paymentId?: string|null,
 *   exceptionType: string,
 *   status: string,
 *   reason?: string|null,
 *   approvedBy?: string|null,
 *   resolvedAt?: string|null,
 *   createdAt: string,
 * }} BillingExceptionSnapshot
 */
/**
 * @typedef {{
 *   exceptionId: string,
 *   invoiceId: string,
 *   paymentId?: string|null,
 *   exceptionType: string,
 * }} CreateBillingExceptionInput
 */

/**
 * BillingException Entity
 * 미매칭·오류 항목의 관리자 예외처리 집계 루트.
 * INV-B005: DISPUTED→PAID는 이 엔티티의 approve()를 통해서만 가능.
 */
class BillingException {
  /**
   * @param {BillingExceptionSnapshot} param0
   */
  constructor({ exceptionId, invoiceId, paymentId, exceptionType, status, reason, approvedBy, resolvedAt, createdAt }) {
    this.exceptionId   = exceptionId;
    this.invoiceId     = invoiceId;
    this.paymentId     = paymentId   || null;
    this.exceptionType = exceptionType;
    this.status        = status;
    this.reason        = reason      || null;
    this.approvedBy    = approvedBy  || null;
    this.resolvedAt    = resolvedAt  || null;
    this.createdAt     = createdAt;

    if (!Object.values(EXCEPTION_TYPES).includes(exceptionType)) {
      throw new Error(`Invalid exception type: ${exceptionType}`);
    }
    if (!Object.values(EXCEPTION_STATUSES).includes(status)) {
      throw new Error(`Invalid exception status: ${status}`);
    }
  }

  /** @returns {boolean} */
  isOpen() { return this.status === EXCEPTION_STATUSES.OPEN; }

  /**
   * INV-B005: 관리자 승인 처리
   * 서비스 계층은 adminRole 검증 후 이 메서드를 호출한다.
   * @param {{ approvedBy: string, reason?: string|null }} param0
   * @returns {BillingException}
   */
  approve({ approvedBy, reason }) {
    if (!this.isOpen()) {
      throw Object.assign(
        new Error('INV-B005: 이미 처리된 예외 항목은 승인할 수 없다'),
        { code: 'CONFLICT' },
      );
    }
    if (!approvedBy) throw Object.assign(new Error('approvedBy is required'), { code: 'VALIDATION_ERROR' });
    return new BillingException({
      ...this._snapshot(),
      status:      EXCEPTION_STATUSES.APPROVED,
      approvedBy,
      reason,
      resolvedAt:  new Date().toISOString(),
    });
  }

  /**
   * @param {{ rejectedBy: string, reason?: string|null }} param0
   * @returns {BillingException}
   */
  reject({ rejectedBy, reason }) {
    if (!this.isOpen()) {
      throw Object.assign(
        new Error('INV-B005: 이미 처리된 예외 항목은 거부할 수 없다'),
        { code: 'CONFLICT' },
      );
    }
    return new BillingException({
      ...this._snapshot(),
      status:     EXCEPTION_STATUSES.REJECTED,
      approvedBy: rejectedBy,
      reason,
      resolvedAt: new Date().toISOString(),
    });
  }

  /**
   * @returns {BillingExceptionSnapshot}
   */
  _snapshot() {
    return {
      exceptionId:   this.exceptionId,
      invoiceId:     this.invoiceId,
      paymentId:     this.paymentId,
      exceptionType: this.exceptionType,
      status:        this.status,
      reason:        this.reason,
      approvedBy:    this.approvedBy,
      resolvedAt:    this.resolvedAt,
      createdAt:     this.createdAt,
    };
  }

  /** @returns {object} */
  toJSON() {
    return {
      exception_id:   this.exceptionId,
      invoice_id:     this.invoiceId,
      payment_id:     this.paymentId,
      exception_type: this.exceptionType,
      status:         this.status,
      reason:         this.reason,
      approved_by:    this.approvedBy,
      resolved_at:    this.resolvedAt,
      created_at:     this.createdAt,
    };
  }

  /**
   * @param {CreateBillingExceptionInput} param0
   * @returns {BillingException}
   */
  static create({ exceptionId, invoiceId, paymentId, exceptionType }) {
    return new BillingException({
      exceptionId,
      invoiceId,
      paymentId,
      exceptionType,
      status:     EXCEPTION_STATUSES.OPEN,
      createdAt:  new Date().toISOString(),
    });
  }
}

module.exports = { BillingException, EXCEPTION_TYPES, EXCEPTION_STATUSES };
