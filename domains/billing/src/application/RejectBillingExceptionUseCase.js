'use strict';

const { BillingEvents } = require('../domain/events/BillingEvents');

class RejectBillingExceptionUseCase {
  constructor(exceptionRepository, eventPublisher = () => {}) {
    this._exceptionRepo = exceptionRepository;
    this._publisher     = eventPublisher;
  }

  async execute({ exceptionId, reason, correlationId }, caller) {
    if (!caller?.permissions?.includes('billing.admin')) {
      throw Object.assign(new Error('Forbidden: billing.admin 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    if (!reason) {
      throw Object.assign(new Error('거부 사유는 필수입니다'), { code: 'VALIDATION_ERROR' });
    }

    const exception = await this._exceptionRepo.findById(exceptionId);
    if (!exception) {
      throw Object.assign(new Error(`BillingException not found: ${exceptionId}`), { code: 'NOT_FOUND' });
    }
    if (!exception.isOpen()) {
      throw Object.assign(new Error('이미 처리된 예외 항목입니다'), { code: 'CONFLICT' });
    }

    const rejectedBy       = caller.userId || 'admin';
    const updatedException = exception.reject({ rejectedBy, reason });
    await this._exceptionRepo.save(updatedException);

    this._publisher(BillingEvents.billingExceptionRejected({
      exceptionId,
      invoiceId: exception.invoiceId,
      rejectedBy,
      reason,
    }, correlationId));

    return updatedException;
  }
}

module.exports = { RejectBillingExceptionUseCase };
