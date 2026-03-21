'use strict';

/**
 * GetPayment Use Case
 * capability: can.read.payment → getPayment
 * 권한: billing.read
 *
 * 벤치마킹: DDD Application Service 패턴 (Evans) —
 *   NOT_FOUND 오류 발생 책임은 유스케이스에 있다 (컨트롤러 책임 분리).
 */
class GetPaymentUseCase {
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
    if (!caller?.permissions?.includes('billing.read')) {
      throw Object.assign(
        new Error('Forbidden: billing.read 권한이 필요합니다'),
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

    return payment;
  }
}

module.exports = { GetPaymentUseCase };
