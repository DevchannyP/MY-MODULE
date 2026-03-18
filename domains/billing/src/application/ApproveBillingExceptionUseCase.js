'use strict';

const { BillingDomainService } = require('../domain/services/BillingDomainService');
const { BillingEvents }        = require('../domain/events/BillingEvents');

/**
 * ApproveBillingException Use Case
 * 권한: billing.admin
 * INV-B005: DISPUTED → PAID는 오직 관리자 승인을 통해서만 가능
 *
 * 처리 순서:
 *   1. 예외 항목 조회
 *   2. 관련 인보이스 조회
 *   3. 도메인 서비스로 DISPUTED→PAID 전이 가능 여부 확인 (INV-B005)
 *   4. 인보이스 상태 전이
 *   5. 예외 항목 APPROVED로 전이
 *   6. 이벤트 발행
 */
class ApproveBillingExceptionUseCase {
  constructor(invoiceRepository, exceptionRepository, eventPublisher = () => {}) {
    this._invoiceRepo   = invoiceRepository;
    this._exceptionRepo = exceptionRepository;
    this._svc           = new BillingDomainService();
    this._publisher     = eventPublisher;
  }

  async execute({ exceptionId, reason, correlationId }, caller) {
    if (!caller?.permissions?.includes('billing.admin')) {
      throw Object.assign(new Error('Forbidden: billing.admin 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    if (!reason) {
      throw Object.assign(new Error('승인 사유는 필수입니다'), { code: 'VALIDATION_ERROR' });
    }

    const exception = await this._exceptionRepo.findById(exceptionId);
    if (!exception) {
      throw Object.assign(new Error(`BillingException not found: ${exceptionId}`), { code: 'NOT_FOUND' });
    }
    if (!exception.isOpen()) {
      throw Object.assign(new Error('이미 처리된 예외 항목입니다'), { code: 'CONFLICT' });
    }

    const invoice = await this._invoiceRepo.findById(exception.invoiceId);
    if (!invoice) {
      throw Object.assign(new Error(`Invoice not found: ${exception.invoiceId}`), { code: 'NOT_FOUND' });
    }

    // INV-B005 사전 조건: 연결된 인보이스가 DISPUTED 상태여야 한다
    // (PAID/CANCELLED/PENDING 인보이스에 연결된 예외는 approve 불가)
    if (!invoice.status.equals('DISPUTED')) {
      throw Object.assign(
        new Error(`INV-B005: approve는 DISPUTED 인보이스에만 가능. 현재 상태: ${invoice.status.value}`),
        { code: 'CONFLICT' }
      );
    }

    // INV-B005 도메인 서비스 검사 (관리자 승인 확인)
    this._svc.canTransitionDisputedToPaid(invoice, true /* caller has billing.admin */);

    const updatedInvoice   = invoice.transitionTo('PAID');
    const approvedBy       = caller.userId || 'admin';
    const updatedException = exception.approve({ approvedBy, reason });

    await this._invoiceRepo.save(updatedInvoice);
    await this._exceptionRepo.save(updatedException);

    this._publisher(BillingEvents.billingExceptionApproved({
      exceptionId,
      invoiceId: invoice.invoiceId,
      approvedBy,
      reason,
    }, correlationId));

    return updatedException;
  }
}

module.exports = { ApproveBillingExceptionUseCase };
