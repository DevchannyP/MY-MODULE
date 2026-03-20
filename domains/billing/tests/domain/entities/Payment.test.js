'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Payment, PAYMENT_STATUSES } = require('../../../src/domain/entities/Payment');
const { Money }                     = require('../../../src/domain/value-objects/Money');

describe('Payment Entity', () => {
  test('Payment.create → PENDING 상태, amount/invoiceId 보존', () => {
    const p = Payment.create({
      paymentId: 'pay-1',
      invoiceId: 'inv-1',
      amount:    new Money(1000, 'KRW'),
    });
    assert.equal(p.paymentId,  'pay-1');
    assert.equal(p.invoiceId,  'inv-1');
    assert.equal(p.status,     PAYMENT_STATUSES.PENDING);
    assert.equal(p.amount.amount, 1000);
    assert.equal(p.syncedAt,   null);
    assert.ok(p.createdAt);
  });

  test('amount JSON 형태로 전달해도 Money 인스턴스로 변환됨', () => {
    const p = Payment.create({
      paymentId: 'pay-2',
      invoiceId: 'inv-1',
      amount:    { amount: 500, currency: 'KRW' },
    });
    assert.ok(p.amount instanceof Money);
    assert.equal(p.amount.amount, 500);
  });

  test('isMismatch() — MISMATCH 상태에서만 true', () => {
    const base = Payment.create({ paymentId: 'p', invoiceId: 'i', amount: new Money(100, 'KRW') });
    assert.equal(base.isMismatch(), false);

    const mismatch = new Payment({
      paymentId: 'p', invoiceId: 'i',
      amount: new Money(100, 'KRW'),
      status: PAYMENT_STATUSES.MISMATCH,
      createdAt: new Date().toISOString(),
    });
    assert.equal(mismatch.isMismatch(), true);
  });

  test('isFailed() — FAILED 상태에서만 true', () => {
    const base = Payment.create({ paymentId: 'p', invoiceId: 'i', amount: new Money(100, 'KRW') });
    assert.equal(base.isFailed(), false);

    const failed = new Payment({
      paymentId: 'p', invoiceId: 'i',
      amount: new Money(100, 'KRW'),
      status: PAYMENT_STATUSES.FAILED,
      createdAt: new Date().toISOString(),
    });
    assert.equal(failed.isFailed(), true);
  });

  test('유효하지 않은 status → 생성 오류', () => {
    assert.throws(() => new Payment({
      paymentId: 'p', invoiceId: 'i',
      amount: new Money(100, 'KRW'),
      status: 'INVALID_STATUS',
      createdAt: new Date().toISOString(),
    }), /Invalid Payment status/);
  });

  test('toJSON() → snake_case 직렬화 구조 검증', () => {
    const p = Payment.create({ paymentId: 'pay-3', invoiceId: 'inv-3', amount: new Money(300, 'KRW') });
    const json = p.toJSON();
    assert.ok('payment_id'     in json);
    assert.ok('invoice_id'     in json);
    assert.ok('amount'         in json);
    assert.ok('status'         in json);
    assert.ok('synced_at'      in json);
    assert.ok('mismatch_delta' in json);
    assert.ok('created_at'     in json);
    assert.equal(json.payment_id, 'pay-3');
    assert.equal(json.amount.amount, 300);
    assert.equal(json.mismatch_delta, null);
  });

  test('INV-B006: mismatchDelta가 있으면 toJSON에 포함됨', () => {
    const p = new Payment({
      paymentId: 'pay-m', invoiceId: 'inv-1',
      amount: new Money(900, 'KRW'),
      status: PAYMENT_STATUSES.MISMATCH,
      mismatchDelta: new Money(100, 'KRW'),
      createdAt: new Date().toISOString(),
    });
    const json = p.toJSON();
    assert.ok(json.mismatch_delta !== null);
    assert.equal(json.mismatch_delta.amount, 100);
  });

  test('모든 유효한 PAYMENT_STATUSES 값으로 Payment 생성 가능', () => {
    for (const status of Object.values(PAYMENT_STATUSES)) {
      const p = new Payment({
        paymentId: 'p', invoiceId: 'i',
        amount: new Money(100, 'KRW'),
        status,
        createdAt: new Date().toISOString(),
      });
      assert.equal(p.status, status);
    }
  });
});
