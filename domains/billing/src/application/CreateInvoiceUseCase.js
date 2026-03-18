'use strict';

const { randomUUID }   = require('crypto');
const { Invoice }      = require('../domain/entities/Invoice');
const { BillingEvents } = require('../domain/events/BillingEvents');

/**
 * CreateInvoice Use Case
 * 권한: billing.write
 * 결과: DRAFT 인보이스 생성 + InvoiceCreated 이벤트
 */
class CreateInvoiceUseCase {
  /**
   * @param {import('./ports/InvoiceRepository').InvoiceRepository} invoiceRepository
   * @param {Function} eventPublisher — (event) => void
   */
  constructor(invoiceRepository, eventPublisher = () => {}) {
    this._repo      = invoiceRepository;
    this._publisher = eventPublisher;
  }

  /**
   * @param {{ customerId: string, dueDate?: string, notes?: string, correlationId?: string }} cmd
   * @param {{ permissions: string[] }} caller
   * @returns {Promise<Invoice>}
   */
  async execute(cmd, caller) {
    if (!caller?.permissions?.includes('billing.write')) {
      throw Object.assign(new Error('Forbidden: billing.write 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    if (!cmd.customerId) {
      throw Object.assign(new Error('customerId is required'), { code: 'VALIDATION_ERROR' });
    }

    const invoice = Invoice.create({
      invoiceId:  randomUUID(),
      customerId: cmd.customerId,
      dueDate:    cmd.dueDate  || null,
      notes:      cmd.notes    || null,
    });

    const saved  = await this._repo.save(invoice);
    this._publisher(BillingEvents.invoiceCreated(saved, cmd.correlationId));
    return saved;
  }
}

module.exports = { CreateInvoiceUseCase };
