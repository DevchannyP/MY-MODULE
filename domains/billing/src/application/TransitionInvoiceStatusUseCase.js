'use strict';

const { BillingDomainService } = require('../domain/services/BillingDomainService');
const { BillingEvents }        = require('../domain/events/BillingEvents');

/**
 * TransitionInvoiceStatus Use Case
 * 권한: billing.write
 * INV-B002: 허용된 전이만 가능
 * INV-B005: DISPUTED→PAID는 이 유스케이스로 처리하지 않는다 (ApproveBillingException 전용)
 */
class TransitionInvoiceStatusUseCase {
  constructor(invoiceRepository, eventPublisher = () => {}) {
    this._repo      = invoiceRepository;
    this._svc       = new BillingDomainService();
    this._publisher = eventPublisher;
  }

  async execute({ invoiceId, newStatus, reason: _reason, correlationId }, caller) {
    if (!caller?.permissions?.includes('billing.write')) {
      throw Object.assign(new Error('Forbidden: billing.write 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }

    const invoice = await this._repo.findById(invoiceId);
    if (!invoice) {
      throw Object.assign(new Error(`Invoice not found: ${invoiceId}`), { code: 'NOT_FOUND' });
    }

    // DISPUTED→PAID는 ApproveBillingException에서만 허용 (INV-B005)
    if (invoice.status.equals('DISPUTED') && newStatus === 'PAID') {
      throw Object.assign(
        new Error('INV-B005: DISPUTED → PAID는 ApproveBillingException 유스케이스를 통해야 한다'),
        { code: 'FORBIDDEN' }
      );
    }

    const fromStatus = invoice.status.value;
    const updated    = invoice.transitionTo(newStatus);  // INV-B002 검사 내부에서 수행
    const saved      = await this._repo.save(updated);

    this._publisher(BillingEvents.invoiceStatusChanged({
      invoiceId,
      fromStatus,
      toStatus:   newStatus,
      changedBy:  caller.userId || 'unknown',
    }, correlationId));

    return saved;
  }
}

module.exports = { TransitionInvoiceStatusUseCase };
