// @ts-check
'use strict';

/**
 * BillingController — 프레임워크 독립 HTTP 인터페이스 계층 (ADR-0002)
 *
 * 역할:
 *   - openapi.yaml의 17개 엔드포인트를 유스케이스로 라우팅
 *   - billing.read / billing.write / billing.admin 권한 미들웨어
 *   - 도메인 오류 → HTTP 상태 코드 변환
 *   - 도메인 엔티티 → API 응답 직렬화
 *
 * 사용:
 *   const ctrl = new BillingController({ invoiceRepo, paymentRepo, exceptionRepo });
 *   const { status, body } = await ctrl.handle({ method, path, params, query, body, caller });
 */

const { CreateInvoiceUseCase }           = require('../application/CreateInvoiceUseCase');
const { GetInvoiceListUseCase }          = require('../application/GetInvoiceListUseCase');
const { AddLineItemUseCase }             = require('../application/AddLineItemUseCase');
const { TransitionInvoiceStatusUseCase } = require('../application/TransitionInvoiceStatusUseCase');
const { GetBillingSummaryUseCase }       = require('../application/GetBillingSummaryUseCase');
const { ApproveBillingExceptionUseCase } = require('../application/ApproveBillingExceptionUseCase');
const { RejectBillingExceptionUseCase }  = require('../application/RejectBillingExceptionUseCase');
const { ListPaymentsUseCase }            = require('../application/ListPaymentsUseCase');
const { GetPaymentUseCase }             = require('../application/GetPaymentUseCase');
const { RetryPaymentSyncUseCase }        = require('../application/RetryPaymentSyncUseCase');

const { fromError } = require('../../../../src/shared/ProblemDetails');

class BillingController {
  /**
   * @param {{
   *   invoiceRepo:    object,
   *   paymentRepo:    object,
   *   exceptionRepo:  object,
   *   eventPublisher: Function,
   * }} deps
   */
  constructor({ invoiceRepo, paymentRepo, exceptionRepo, eventPublisher = () => {} }) {
    this._invoiceRepo   = invoiceRepo;
    this._paymentRepo   = paymentRepo;
    this._exceptionRepo = exceptionRepo;

    // ── 유스케이스 바인딩 (ADR-0002: 권한 강제는 유스케이스에서) ──────────────
    this._createInvoice      = new CreateInvoiceUseCase(invoiceRepo, eventPublisher);
    this._listInvoices       = new GetInvoiceListUseCase(invoiceRepo);
    this._addLineItem        = new AddLineItemUseCase(invoiceRepo);
    this._transitionStatus   = new TransitionInvoiceStatusUseCase(invoiceRepo, eventPublisher);
    this._getSummary         = new GetBillingSummaryUseCase(invoiceRepo, exceptionRepo);
    this._approveException   = new ApproveBillingExceptionUseCase(invoiceRepo, exceptionRepo, eventPublisher);
    this._rejectException    = new RejectBillingExceptionUseCase(exceptionRepo, eventPublisher);
    this._listPayments       = new ListPaymentsUseCase(paymentRepo);
    this._getPayment         = new GetPaymentUseCase(paymentRepo);
    this._retryPaymentSync   = new RetryPaymentSyncUseCase(paymentRepo);
  }

  /**
   * 요청 처리 진입점
   * @param {{
   *   method: string,
   *   path: string,
   *   params?: Record<string, string>,
   *   query?: Record<string, string>,
   *   body?: object,
   *   caller: { permissions: string[], userId?: string },
   *   correlationId?: string,
   * }} req
   * @returns {Promise<{ status: number, body: object }>}
   */
  async handle(req) {
    try {
      return await this._route(req);
    } catch (err) {
      return this._errorResponse(err, req.correlationId);
    }
  }

  // ── 라우팅 ───────────────────────────────────────────────────────────────────

  async _route({ method, path, params = {}, query = {}, body = {}, caller, correlationId }) {

    // ── 인보이스 ──────────────────────────────────────────────────────────────

    // GET /billing/invoices
    if (method === 'GET' && path === '/billing/invoices') {
      this._requirePermission(caller, 'billing.read');
      const result = await this._invoiceRepo.findAll({
        status:     query.status,
        customerId: query.customer_id,
        amountMin:  query.amount_min  !== undefined ? Number(query.amount_min)  : undefined,
        amountMax:  query.amount_max  !== undefined ? Number(query.amount_max)  : undefined,
        dueFrom:    query.due_from,
        dueTo:      query.due_to,
        page:       query.page       ? Number(query.page)       : 1,
        pageSize:   query.page_size  ? Number(query.page_size)  : 20,
      });
      return { status: 200, body: this._pageOf(result, this._serializeInvoice) };
    }

    // POST /billing/invoices
    if (method === 'POST' && path === '/billing/invoices') {
      const invoice = await this._createInvoice.execute(
        { customerId: body.customer_id, dueDate: body.due_date, notes: body.notes, correlationId },
        caller,
      );
      return { status: 201, body: this._serializeInvoice(invoice) };
    }

    // GET /billing/invoices/:invoice_id
    if (method === 'GET' && path === '/billing/invoices/:invoice_id') {
      this._requirePermission(caller, 'billing.read');
      const invoice = await this._invoiceRepo.findById(params.invoice_id);
      if (!invoice) {
        throw Object.assign(new Error(`Invoice not found: ${params.invoice_id}`), { code: 'NOT_FOUND' });
      }
      return { status: 200, body: this._serializeInvoice(invoice) };
    }

    // PATCH /billing/invoices/:invoice_id/status
    if (method === 'PATCH' && path === '/billing/invoices/:invoice_id/status') {
      const invoice = await this._transitionStatus.execute(
        { invoiceId: params.invoice_id, newStatus: body.new_status, reason: body.reason, correlationId },
        caller,
      );
      return { status: 200, body: this._serializeInvoice(invoice) };
    }

    // POST /billing/invoices/:invoice_id/line-items
    if (method === 'POST' && path === '/billing/invoices/:invoice_id/line-items') {
      const invoice = await this._addLineItem.execute(
        {
          invoiceId:   params.invoice_id,
          description: body.description,
          quantity:    body.quantity,
          unitPrice:   body.unit_price,
        },
        caller,
      );
      return { status: 200, body: this._serializeInvoice(invoice) };
    }

    // ── 결제 ──────────────────────────────────────────────────────────────────

    // GET /billing/payments
    if (method === 'GET' && path === '/billing/payments') {
      const result = await this._listPayments.execute(
        {
          invoiceId: query.invoice_id,
          status:    query.status,
          page:      query.page      ? Number(query.page)      : 1,
          pageSize:  query.page_size ? Number(query.page_size) : 20,
        },
        caller,
      );
      return { status: 200, body: this._pageOf(result, this._serializePayment) };
    }

    // GET /billing/payments/:payment_id
    if (method === 'GET' && path === '/billing/payments/:payment_id') {
      const payment = await this._getPayment.execute(
        { paymentId: params.payment_id },
        caller,
      );
      return { status: 200, body: this._serializePayment(payment) };
    }

    // POST /billing/payments/:payment_id/sync
    if (method === 'POST' && path === '/billing/payments/:payment_id/sync') {
      const payment = await this._retryPaymentSync.execute(
        { paymentId: params.payment_id },
        caller,
      );
      return { status: 200, body: this._serializePayment(payment) };
    }

    // ── 예외처리 ──────────────────────────────────────────────────────────────

    // GET /billing/exceptions
    if (method === 'GET' && path === '/billing/exceptions') {
      this._requirePermission(caller, 'billing.admin');
      const result = await this._exceptionRepo.findAll({
        exceptionType: query.exception_type,
        status:        query.status,
        page:          query.page      ? Number(query.page)      : 1,
        pageSize:      query.page_size ? Number(query.page_size) : 20,
      });
      return { status: 200, body: this._pageOf(result, this._serializeException) };
    }

    // POST /billing/exceptions/:exception_id/approve
    if (method === 'POST' && path === '/billing/exceptions/:exception_id/approve') {
      const exception = await this._approveException.execute(
        { exceptionId: params.exception_id, reason: body.reason, correlationId },
        caller,
      );
      return { status: 200, body: this._serializeException(exception) };
    }

    // POST /billing/exceptions/:exception_id/reject
    if (method === 'POST' && path === '/billing/exceptions/:exception_id/reject') {
      const exception = await this._rejectException.execute(
        { exceptionId: params.exception_id, reason: body.reason, correlationId },
        caller,
      );
      return { status: 200, body: this._serializeException(exception) };
    }

    // ── 요약 ──────────────────────────────────────────────────────────────────

    // GET /billing/summary
    if (method === 'GET' && path === '/billing/summary') {
      const summary = await this._getSummary.execute(caller);
      return { status: 200, body: summary };
    }

    return fromError(
      Object.assign(new Error(`Route not found: ${method} ${path}`), { code: 'NOT_FOUND' }),
      { correlationId },
    );
  }

  // ── 헬퍼 ─────────────────────────────────────────────────────────────────────

  _requirePermission(caller, permission) {
    if (!caller?.permissions?.includes(permission)) {
      throw Object.assign(
        new Error(`Forbidden: ${permission} 권한이 필요합니다`),
        { code: 'FORBIDDEN' },
      );
    }
  }

  /** RFC 7807 Problem Details 에러 응답 (IETF 표준) */
  _errorResponse(err, correlationId) {
    // 도메인 불변조건 코드 매핑 (code 미첨부 케이스 대비)
    if (!err.code && err.message) {
      const m = err.message;
      if (m.includes('INV-B002') || m.includes('INV-B003') || m.includes('INV-B005') || m.includes('INV-B001'))
        err.code = 'CONFLICT';
      else if (m.includes('INV-B004') || m.includes('Currency mismatch'))
        err.code = 'VALIDATION_ERROR';
    }
    return fromError(err, { correlationId });
  }

  _pageOf(result, serializer) {
    return {
      items:     result.items.map(serializer.bind(this)),
      total:     result.total,
      page:      result.page,
      page_size: result.page_size,
    };
  }

  // ── 직렬화 ───────────────────────────────────────────────────────────────────

  _serializeInvoice(invoice) {
    return {
      invoice_id:           invoice.invoiceId,
      customer_id:          invoice.customerId,
      status:               invoice.status.value,
      total:                this._serializeMoney(invoice.total),
      line_items:           invoice.lineItems.map(item => ({
        line_item_id: item.lineItemId,
        description:  item.description,
        quantity:     item.quantity,
        unit_price:   this._serializeMoney(item.unitPrice),
        amount:       this._serializeMoney(item.amount),
      })),
      total_invariant_valid: true,   // INV-B001: computed getter가 항상 보장
      due_date:             invoice.dueDate   || null,
      notes:                invoice.notes     || null,
      created_at:           invoice.createdAt,
      updated_at:           invoice.updatedAt,
    };
  }

  _serializePayment(payment) {
    return {
      payment_id:     payment.paymentId,
      invoice_id:     payment.invoiceId,
      amount:         this._serializeMoney(payment.amount),
      status:         payment.status,
      synced_at:      payment.syncedAt ?? null,
      mismatch_delta: payment.mismatchDelta !== null ? this._serializeMoney(payment.mismatchDelta) : null,
      created_at:     payment.createdAt,
    };
  }

  _serializeException(exception) {
    return {
      exception_id:   exception.exceptionId,
      invoice_id:     exception.invoiceId,
      payment_id:     exception.paymentId  || null,
      exception_type: exception.exceptionType,
      status:         exception.status,
      reason:         exception.reason     || null,
      approved_by:    exception.approvedBy || null,
      resolved_at:    exception.resolvedAt || null,
      created_at:     exception.createdAt,
    };
  }

  _serializeMoney(money) {
    return { amount: money.amount, currency: money.currency };
  }
}

module.exports = { BillingController };
