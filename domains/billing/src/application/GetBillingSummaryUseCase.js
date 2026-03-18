'use strict';

/**
 * GetBillingSummary Use Case — 정산관리 홈 요약 데이터
 * 권한: billing.read
 */
class GetBillingSummaryUseCase {
  constructor(invoiceRepository, exceptionRepository) {
    this._invoiceRepo   = invoiceRepository;
    this._exceptionRepo = exceptionRepository;
  }

  async execute(caller) {
    if (!caller?.permissions?.includes('billing.read')) {
      throw Object.assign(new Error('Forbidden: billing.read 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }

    const [
      { total: totalInvoices },
      { total: pendingCount },
      { total: disputedCount },
      { total: openExceptions },
    ] = await Promise.all([
      this._invoiceRepo.findAll({ page: 1, pageSize: 1 }),
      this._invoiceRepo.findAll({ status: 'PENDING',  page: 1, pageSize: 1 }),
      this._invoiceRepo.findAll({ status: 'DISPUTED', page: 1, pageSize: 1 }),
      this._exceptionRepo.findAll({ status: 'OPEN',   page: 1, pageSize: 1 }),
    ]);

    return {
      total_invoices:  totalInvoices,
      pending_count:   pendingCount,
      disputed_count:  disputedCount,
      open_exceptions: openExceptions,
      month_total:     null,   // GAP-B004: 월간 합계 계산은 Phase 2 구현 (현재 nullable)
    };
  }
}

module.exports = { GetBillingSummaryUseCase };
