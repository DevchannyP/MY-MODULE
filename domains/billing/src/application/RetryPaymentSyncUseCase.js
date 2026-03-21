'use strict';

/**
 * RetryPaymentSync Use Case
 * capability: can.retry.payment.sync → retryPaymentSync
 * 권한: billing.write
 *
 * ADR-0006: 재시도 횟수 상한 정책 (Phase 2 구체화 예정).
 *   현재 InMemory 구현에서는 retryCount를 Payment 엔티티에 추가하지 않았으므로
 *   재시도 카운팅 없이 현재 결제 상태를 반환한다.
 *   Phase 2에서 retryCount >= 3 시 PAYMENT_RETRY_LIMIT_EXCEEDED 에러를 추가한다.
 *
 * 벤치마킹: DDD Application Service 패턴 — 비즈니스 규칙(ADR-0006)은
 *   컨트롤러가 아닌 유스케이스에 문서화한다.
 */
class RetryPaymentSyncUseCase {
  /**
   * @param {import('./ports/PaymentRepository').PaymentRepository} paymentRepository
   */
  constructor(paymentRepository) {
    this._repo = paymentRepository;
  }

  /**
   * @param {{ paymentId: string }} cmd
   * @param {{ permissions: string[] }} caller
   * @returns {Promise<import('../domain/entities/Payment').Payment>}
   */
  async execute(cmd, caller) {
    if (!caller?.permissions?.includes('billing.write')) {
      throw Object.assign(
        new Error('Forbidden: billing.write 권한이 필요합니다'),
        { code: 'FORBIDDEN' },
      );
    }

    if (!cmd.paymentId) {
      throw Object.assign(
        new Error('paymentId is required'),
        { code: 'VALIDATION_ERROR' },
      );
    }

    const payment = await this._repo.findById(cmd.paymentId);
    if (!payment) {
      throw Object.assign(
        new Error(`Payment not found: ${cmd.paymentId}`),
        { code: 'NOT_FOUND' },
      );
    }

    // ADR-0006: Phase 2에서 retryCount 체크 및 exponential backoff 구현 예정.
    // 현재는 결제 조회 후 반환 (재시도 가능 상태 확인만 수행).
    return payment;
  }
}

module.exports = { RetryPaymentSyncUseCase };
