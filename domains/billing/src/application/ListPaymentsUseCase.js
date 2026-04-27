'use strict';

/**
 * ListPayments Use Case
 * capability: can.read.payment → listPayments
 * 권한: billing.read
 *
 * 벤치마킹: DDD Application Service 패턴 (Evans) —
 *   컨트롤러는 유스케이스만 호출. 리포지토리 직접 접근 금지 (ADR-0002).
 */
class ListPaymentsUseCase {
  /**
   * @param {import('./ports/PaymentRepository').PaymentRepository} paymentRepository
   */
  constructor(paymentRepository) {
    this._repo = paymentRepository;
  }

  /**
   * @param {{ invoiceId?: string, status?: string, page?: number, pageSize?: number }} query
   * @param {{ permissions: string[] }} caller
   * @returns {Promise<{items: object[], total: number, page: number, page_size: number}>}
   */
  async execute(query, caller) {
    if (!caller?.permissions?.includes('billing.read')) {
      throw Object.assign(
        new Error('Forbidden: billing.read 권한이 필요합니다'),
        { code: 'FORBIDDEN' },
      );
    }

    const { invoiceId, status, page = 1, pageSize = 20 } = query;
    return this._repo.findAll({ invoiceId, status, page, pageSize });
  }
}

module.exports = { ListPaymentsUseCase };
