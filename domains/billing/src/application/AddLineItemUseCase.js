'use strict';

const { Money } = require('../domain/value-objects/Money');

/**
 * AddLineItem Use Case
 * 권한: billing.write
 * INV-B001: total은 항상 라인 합산으로 계산 (저장된 total 없음)
 * INV-B004: lineItem amount > 0
 */
class AddLineItemUseCase {
  constructor(invoiceRepository) {
    this._repo = invoiceRepository;
  }

  async execute({ invoiceId, lineItemId, description, quantity, unitPrice }, caller) {
    if (!caller?.permissions?.includes('billing.write')) {
      throw Object.assign(new Error('Forbidden: billing.write 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }

    const invoice = await this._repo.findById(invoiceId);
    if (!invoice) {
      throw Object.assign(new Error(`Invoice not found: ${invoiceId}`), { code: 'NOT_FOUND' });
    }

    const money   = unitPrice instanceof Money ? unitPrice : Money.fromJSON(unitPrice);
    const updated = invoice.addLineItem({
      lineItemId: lineItemId || require('crypto').randomUUID(),
      description,
      quantity,
      unitPrice: money,
    });

    return this._repo.save(updated);
  }
}

module.exports = { AddLineItemUseCase };
