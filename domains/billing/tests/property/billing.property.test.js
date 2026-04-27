'use strict';

/**
 * Billing 도메인 Property-Based 테스트 (fast-check)
 * 금융 불변조건 INV-B001, INV-B004를 임의 입력으로 검증한다.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { Invoice }  = require('../../src/domain/entities/Invoice');
const { Money }    = require('../../src/domain/value-objects/Money');

describe('[Property] Money: 연산 정합성', () => {
  test('양수 금액 × 양수 수량 → 항상 양수 total', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100000 }),
      fc.integer({ min: 1, max: 100 }),
      (unitAmount, qty) => {
        const total = new Money(unitAmount * qty, 'KRW');
        assert.ok(total.amount > 0, `total이 양수가 아님: ${total.amount}`);
        assert.equal(total.amount, unitAmount * qty);
      }
    ));
  });

  test('Money.add 교환법칙: a+b === b+a', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50000 }),
      fc.integer({ min: 1, max: 50000 }),
      (a, b) => {
        const ma   = new Money(a, 'KRW');
        const mb   = new Money(b, 'KRW');
        const sum1 = ma.add(mb);
        const sum2 = mb.add(ma);
        assert.equal(sum1.amount, sum2.amount);
      }
    ));
  });

  test('통화 불일치 Money.add → Currency mismatch 오류', () => {
    fc.assert(fc.property(
      fc.constantFrom('USD', 'EUR', 'JPY'),
      (currency) => {
        const krw = new Money(100, 'KRW');
        const fgn = new Money(100, currency);
        assert.throws(() => krw.add(fgn), /Currency mismatch/);
      }
    ));
  });
});

describe('[Property] INV-B001: Invoice total은 항상 lineItems 합산', () => {
  test('임의 라인 항목 N개 추가 → total = 각 금액 합산', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        id:     fc.string({ minLength: 1, maxLength: 10 }),
        amount: fc.integer({ min: 1, max: 10000 }),
        qty:    fc.integer({ min: 1, max: 10 }),
      }), { minLength: 1, maxLength: 5 }),
      (items) => {
        let inv = Invoice.create({ invoiceId: 'inv-p', customerId: 'c' });
        let expected = 0;
        for (const item of items) {
          inv = inv.addLineItem({
            lineItemId:  item.id,
            description: 'test',
            quantity:    item.qty,
            unitPrice:   new Money(item.amount, 'KRW'),
          });
          expected += item.amount * item.qty;
        }
        assert.equal(inv.total.amount, expected, `INV-B001 위반: total=${inv.total.amount}, expected=${expected}`);
      }
    ));
  });
});

describe('[Property] INV-B004: 0 이하 금액 항상 거부', () => {
  test('amount ≤ 0인 Money로 addLineItem → 거부', () => {
    fc.assert(fc.property(
      fc.integer({ min: -10000, max: 0 }),
      (amount) => {
        const inv = Invoice.create({ invoiceId: 'inv-z', customerId: 'c' });
        assert.throws(
          () => inv.addLineItem({ lineItemId: 'li', description: 'x', quantity: 1, unitPrice: new Money(amount, 'KRW') }),
          /INV-B004/
        );
      }
    ));
  });
});
