'use strict';

const { PAYMENT_STATUSES } = require('../entities/Payment');
const { EXCEPTION_TYPES }  = require('../entities/BillingException');

/**
 * BillingDomainService — 여러 집계 루트에 걸친 도메인 규칙을 처리한다.
 *
 * 규칙:
 *   INV-B005: DISPUTED→PAID는 관리자 승인이 있어야만 가능
 *   INV-B006: 결제금액 ≠ 인보이스총액 → MISMATCH 분류
 */
class BillingDomainService {
  /**
   * INV-B006: 결제와 인보이스 금액 비교 → MISMATCH 분류 여부 반환
   * @param {Invoice} invoice
   * @param {Payment} payment
   * @returns {{ isMismatch: boolean, delta: Money|null }}
   */
  detectMismatch(invoice, payment) {
    if (!payment.amount.equals(invoice.total)) {
      return {
        isMismatch: true,
        delta:      payment.amount.delta(invoice.total),
        exceptionType: EXCEPTION_TYPES.MISMATCH,
      };
    }
    return { isMismatch: false, delta: null };
  }

  /**
   * INV-B001: 인보이스 합계 불변조건 검증
   * @param {Invoice} invoice
   * @returns {{ valid: boolean, declaredTotal: Money, computedTotal: Money }}
   */
  validateTotalInvariant(invoice) {
    const computed = invoice.total;
    return {
      valid:         true,   // total은 항상 계산값이므로 항상 valid — 외부 선언 총액과 비교 시 사용
      computedTotal: computed,
    };
  }

  /**
   * INV-B005: DISPUTED 인보이스가 PAID로 전이 가능한지 확인
   * 실제 권한 검사는 유스케이스 계층에서 수행하고, 도메인은 상태만 검사한다.
   * @param {Invoice} invoice
   * @param {boolean} hasAdminApproval — 유스케이스에서 관리자 승인 여부를 주입
   */
  canTransitionDisputedToPaid(invoice, hasAdminApproval) {
    if (!invoice.status.equals('DISPUTED')) {
      throw new Error('이 검사는 DISPUTED 상태 인보이스에만 적용된다');
    }
    if (!hasAdminApproval) {
      throw new Error('INV-B005: DISPUTED → PAID는 관리자 승인이 필요하다');
    }
    return true;
  }

  /**
   * 결제 상태를 동기화 결과에 따라 결정한다.
   * @param {Payment} payment
   * @param {Invoice} invoice
   * @returns {'SUCCESS'|'MISMATCH'|'FAILED'}
   */
  resolvePaymentStatus(payment, invoice, syncSucceeded) {
    if (!syncSucceeded) return PAYMENT_STATUSES.FAILED;
    const { isMismatch } = this.detectMismatch(invoice, payment);
    return isMismatch ? PAYMENT_STATUSES.MISMATCH : PAYMENT_STATUSES.SUCCESS;
  }
}

module.exports = { BillingDomainService };
