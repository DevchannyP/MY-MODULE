'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BillingDomainService } = require('../../../src/domain/services/BillingDomainService');
const { Invoice }              = require('../../../src/domain/entities/Invoice');
const { Payment }              = require('../../../src/domain/entities/Payment');
const { Money }                = require('../../../src/domain/value-objects/Money');

const svc = new BillingDomainService();

const makeInvoice = (lineItems = []) => {
  let inv = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
  for (const li of lineItems) {
    inv = inv.addLineItem(li);
  }
  return inv;
};

describe('BillingDomainService', () => {
  describe('INV-B006: detectMismatch()', () => {
    test('결제 금액 = 인보이스 합계이면 isMismatch=false', () => {
      const inv     = makeInvoice([{ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(1000, 'KRW') }]);
      const payment = Payment.create({ paymentId: 'p-1', invoiceId: 'inv-1', amount: new Money(1000, 'KRW') });
      const result  = svc.detectMismatch(inv, payment);
      assert.equal(result.isMismatch, false);
    });

    test('결제 금액 ≠ 인보이스 합계이면 isMismatch=true', () => {
      const inv     = makeInvoice([{ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(1000, 'KRW') }]);
      const payment = Payment.create({ paymentId: 'p-1', invoiceId: 'inv-1', amount: new Money(800, 'KRW') });
      const result  = svc.detectMismatch(inv, payment);
      assert.equal(result.isMismatch, true);
      assert.equal(result.delta.amount, 200);
    });
  });

  describe('INV-B005: canTransitionDisputedToPaid()', () => {
    test('DISPUTED + 관리자 승인 있으면 true', () => {
      let inv = makeInvoice([{ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(1000, 'KRW') }]);
      inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
      assert.equal(svc.canTransitionDisputedToPaid(inv, true), true);
    });

    test('DISPUTED + 관리자 승인 없으면 오류 (INV-B005)', () => {
      let inv = makeInvoice([{ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(1000, 'KRW') }]);
      inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
      assert.throws(() => svc.canTransitionDisputedToPaid(inv, false), /INV-B005/);
    });

    test('DISPUTED이 아닌 상태에서 호출하면 오류', () => {
      const inv = makeInvoice();
      assert.throws(() => svc.canTransitionDisputedToPaid(inv, true));
    });
  });

  describe('resolvePaymentStatus()', () => {
    test('동기화 성공 + 금액 일치 → SUCCESS', () => {
      const inv     = makeInvoice([{ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(500, 'KRW') }]);
      const payment = Payment.create({ paymentId: 'p-1', invoiceId: 'inv-1', amount: new Money(500, 'KRW') });
      assert.equal(svc.resolvePaymentStatus(payment, inv, true), 'SUCCESS');
    });

    test('동기화 성공 + 금액 불일치 → MISMATCH', () => {
      const inv     = makeInvoice([{ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(500, 'KRW') }]);
      const payment = Payment.create({ paymentId: 'p-1', invoiceId: 'inv-1', amount: new Money(400, 'KRW') });
      assert.equal(svc.resolvePaymentStatus(payment, inv, true), 'MISMATCH');
    });

    test('동기화 실패 → FAILED', () => {
      const inv     = makeInvoice();
      const payment = Payment.create({ paymentId: 'p-1', invoiceId: 'inv-1', amount: new Money(0, 'KRW') });
      assert.equal(svc.resolvePaymentStatus(payment, inv, false), 'FAILED');
    });
  });
});
