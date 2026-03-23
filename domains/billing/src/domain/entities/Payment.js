// @ts-check
'use strict';

const { Money } = require('../value-objects/Money');

/**
 * @typedef {{
 *   paymentId: string,
 *   invoiceId: string,
 *   amount: import('../value-objects/Money').Money|ReturnType<import('../value-objects/Money').Money['toJSON']>,
 *   status: string,
 *   syncedAt?: string|null,
 *   mismatchDelta?: import('../value-objects/Money').Money|null,
 *   createdAt: string,
 * }} PaymentSnapshot
 */
/**
 * @typedef {{
 *   paymentId: string,
 *   invoiceId: string,
 *   amount: import('../value-objects/Money').Money|ReturnType<import('../value-objects/Money').Money['toJSON']>,
 * }} CreatePaymentInput
 */

const PAYMENT_STATUSES = Object.freeze({
  PENDING:  'PENDING',
  SUCCESS:  'SUCCESS',
  FAILED:   'FAILED',
  MISMATCH: 'MISMATCH',
});

/**
 * Payment Entity
 * INV-B006: 결제 금액 ≠ 인보이스 총액이면 MISMATCH 분류
 */
class Payment {
  /**
   * @param {PaymentSnapshot} param0
   */
  constructor({ paymentId, invoiceId, amount, status, syncedAt, mismatchDelta, createdAt }) {
    this.paymentId     = paymentId;
    this.invoiceId     = invoiceId;
    this.amount        = amount instanceof Money ? amount : Money.fromJSON(amount);
    this.status        = status;
    this.syncedAt      = syncedAt ?? null;
    this.mismatchDelta = mismatchDelta === null || mismatchDelta === undefined
      ? null
      : mismatchDelta instanceof Money
        ? mismatchDelta
        : Money.fromJSON(mismatchDelta);
    this.createdAt     = createdAt;

    if (!Object.values(PAYMENT_STATUSES).includes(status)) {
      throw new Error(`Invalid Payment status: ${status}`);
    }
  }

  /** @returns {boolean} */
  isMismatch() { return this.status === PAYMENT_STATUSES.MISMATCH; }
  /** @returns {boolean} */
  isFailed()   { return this.status === PAYMENT_STATUSES.FAILED; }

  /** @returns {object} */
  toJSON() {
    return {
      payment_id:      this.paymentId,
      invoice_id:      this.invoiceId,
      amount:          this.amount.toJSON(),
      status:          this.status,
      synced_at:       this.syncedAt,
      mismatch_delta:  this.mismatchDelta !== null ? this.mismatchDelta.toJSON() : null,
      created_at:      this.createdAt,
    };
  }

  /**
   * @param {CreatePaymentInput} param0
   * @returns {Payment}
   */
  static create({ paymentId, invoiceId, amount }) {
    return new Payment({
      paymentId,
      invoiceId,
      amount,
      status:    PAYMENT_STATUSES.PENDING,
      syncedAt:  null,
      createdAt: new Date().toISOString(),
    });
  }
}

module.exports = { Payment, PAYMENT_STATUSES };
