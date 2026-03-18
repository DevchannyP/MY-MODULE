'use strict';

/**
 * GetInvoiceList Use Case
 * 권한: billing.read
 */
class GetInvoiceListUseCase {
  constructor(invoiceRepository) {
    this._repo = invoiceRepository;
  }

  async execute(query, caller) {
    if (!caller?.permissions?.includes('billing.read')) {
      throw Object.assign(new Error('Forbidden: billing.read 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }

    const { status, customerId, amountMin, amountMax, dueFrom, dueTo, page = 1, pageSize = 20 } = query;
    return this._repo.findAll({ status, customerId, amountMin, amountMax, dueFrom, dueTo, page, pageSize });
  }
}

module.exports = { GetInvoiceListUseCase };
