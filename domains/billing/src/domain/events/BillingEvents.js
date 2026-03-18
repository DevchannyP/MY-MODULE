'use strict';

const { randomUUID } = require('crypto');

/**
 * Billing Domain Events 팩토리
 * events.schema.json의 EventEnvelope 구조를 따른다.
 */
function createEvent(eventType, payload, correlationId) {
  return {
    event_id:       randomUUID(),
    event_type:     eventType,
    domain:         'billing',
    occurred_at:    new Date().toISOString(),
    correlation_id: correlationId || randomUUID(),
    payload,
  };
}

const BillingEvents = {
  invoiceCreated(invoice, correlationId) {
    return createEvent('InvoiceCreated', {
      invoice_id:  invoice.invoiceId,
      customer_id: invoice.customerId,
      status:      invoice.status.value,
    }, correlationId);
  },

  invoiceStatusChanged({ invoiceId, fromStatus, toStatus, changedBy }, correlationId) {
    return createEvent('InvoiceStatusChanged', {
      invoice_id:  invoiceId,
      from_status: fromStatus,
      to_status:   toStatus,
      changed_by:  changedBy,
    }, correlationId);
  },

  invoiceTotalMismatchDetected({ invoiceId, declaredTotal, computedTotal }, correlationId) {
    return createEvent('InvoiceTotalMismatchDetected', {
      invoice_id:     invoiceId,
      declared_total: declaredTotal.toJSON(),
      computed_total: computedTotal.toJSON(),
    }, correlationId);
  },

  paymentMismatchDetected({ paymentId, invoiceId, paymentAmount, invoiceTotal }, correlationId) {
    return createEvent('PaymentMismatchDetected', {
      payment_id:     paymentId,
      invoice_id:     invoiceId,
      payment_amount: paymentAmount.toJSON(),
      invoice_total:  invoiceTotal.toJSON(),
    }, correlationId);
  },

  billingExceptionApproved({ exceptionId, invoiceId, approvedBy, reason }, correlationId) {
    return createEvent('BillingExceptionApproved', {
      exception_id: exceptionId,
      invoice_id:   invoiceId,
      approved_by:  approvedBy,
      reason,
    }, correlationId);
  },

  billingExceptionRejected({ exceptionId, invoiceId, rejectedBy, reason }, correlationId) {
    return createEvent('BillingExceptionRejected', {
      exception_id: exceptionId,
      invoice_id:   invoiceId,
      rejected_by:  rejectedBy,
      reason,
    }, correlationId);
  },
};

module.exports = { BillingEvents };
