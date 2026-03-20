'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BillingEvents }  = require('../../../src/domain/events/BillingEvents');
const { Invoice }        = require('../../../src/domain/entities/Invoice');
const { Money }          = require('../../../src/domain/value-objects/Money');

describe('BillingEvents 팩토리', () => {
  test('invoiceCreated — 필수 필드 존재 + domain=billing', () => {
    const inv = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
    const evt = BillingEvents.invoiceCreated(inv, 'corr-1');
    assert.ok(evt.event_id);
    assert.equal(evt.event_type,     'InvoiceCreated');
    assert.equal(evt.domain,         'billing');
    assert.equal(evt.correlation_id, 'corr-1');
    assert.ok(evt.occurred_at);
    assert.equal(evt.payload.customer_id, 'cust-1');
  });

  test('invoiceStatusChanged — from/to/changedBy 포함', () => {
    const evt = BillingEvents.invoiceStatusChanged(
      { invoiceId: 'inv-1', fromStatus: 'DRAFT', toStatus: 'PENDING', changedBy: 'user-1' },
      'corr-2'
    );
    assert.equal(evt.event_type, 'InvoiceStatusChanged');
    assert.equal(evt.payload.from_status, 'DRAFT');
    assert.equal(evt.payload.to_status,   'PENDING');
    assert.equal(evt.payload.changed_by,  'user-1');
  });

  test('billingExceptionApproved — exceptionId/invoiceId/approvedBy/reason 포함', () => {
    const evt = BillingEvents.billingExceptionApproved(
      { exceptionId: 'exc-1', invoiceId: 'inv-1', approvedBy: 'admin-1', reason: '승인 이유' },
      'corr-3'
    );
    assert.equal(evt.event_type, 'BillingExceptionApproved');
    assert.equal(evt.payload.exception_id, 'exc-1');
    assert.equal(evt.payload.approved_by,  'admin-1');
    assert.equal(evt.payload.reason,       '승인 이유');
  });

  test('billingExceptionRejected — rejectedBy 포함', () => {
    const evt = BillingEvents.billingExceptionRejected(
      { exceptionId: 'exc-2', invoiceId: 'inv-2', rejectedBy: 'admin-2', reason: '거부 이유' },
      'corr-4'
    );
    assert.equal(evt.event_type, 'BillingExceptionRejected');
    assert.equal(evt.payload.rejected_by, 'admin-2');
  });

  test('paymentMismatchDetected — paymentAmount/invoiceTotal 포함', () => {
    const evt = BillingEvents.paymentMismatchDetected(
      { paymentId: 'pay-1', invoiceId: 'inv-1', paymentAmount: new Money(900, 'KRW'), invoiceTotal: new Money(1000, 'KRW') },
      'corr-5'
    );
    assert.equal(evt.event_type, 'PaymentMismatchDetected');
    assert.equal(evt.payload.payment_amount.amount, 900);
    assert.equal(evt.payload.invoice_total.amount,  1000);
  });

  test('correlationId 미전달 시 자동 생성됨', () => {
    const inv = Invoice.create({ invoiceId: 'inv-x', customerId: 'cust-x' });
    const evt = BillingEvents.invoiceCreated(inv);
    assert.ok(evt.correlation_id);
    assert.equal(typeof evt.correlation_id, 'string');
    assert.ok(evt.correlation_id.length > 0);
  });

  test('각 이벤트마다 고유한 event_id 생성', () => {
    const inv = Invoice.create({ invoiceId: 'inv-y', customerId: 'cust-y' });
    const evt1 = BillingEvents.invoiceCreated(inv);
    const evt2 = BillingEvents.invoiceCreated(inv);
    assert.notEqual(evt1.event_id, evt2.event_id);
  });
});
