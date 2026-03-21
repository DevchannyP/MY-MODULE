'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Invoice }       = require('../../../src/domain/entities/Invoice');
const { Money }         = require('../../../src/domain/value-objects/Money');

const validCreate = () => Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });

describe('Invoice Entity', () => {
  describe('Invoice.create()', () => {
    test('DRAFT 상태로 생성된다', () => {
      const inv = validCreate();
      assert.equal(inv.status.equals('DRAFT'), true);
    });

    test('customerId 없으면 오류', () => {
      assert.throws(() => Invoice.create({ invoiceId: 'x', customerId: '' }), /customerId is required/);
    });

    test('생성 직후 lineItems는 빈 배열', () => {
      assert.equal(validCreate().lineItems.length, 0);
    });
  });

  describe('INV-B001: total 계산 불변조건', () => {
    test('라인 항목이 없으면 total은 0', () => {
      assert.equal(validCreate().total.amount, 0);
    });

    test('라인 항목 합산이 total과 일치한다', () => {
      let inv = validCreate();
      inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 2, unitPrice: new Money(500, 'KRW') });
      inv = inv.addLineItem({ lineItemId: 'li-2', description: 'B', quantity: 1, unitPrice: new Money(300, 'KRW') });
      assert.equal(inv.total.amount, 1300);
    });

    test('total은 항상 계산값 — setter 없음', () => {
      const inv = validCreate();
      // getter-only이므로 setter 없음 (strict mode에서 할당 시 오류 또는 무시)
      assert.equal(typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inv), 'total').set, 'undefined');
    });
  });

  describe('addLineItem()', () => {
    test('DRAFT 상태에서 라인 항목 추가 성공', () => {
      const inv = validCreate().addLineItem({
        lineItemId:  'li-1',
        description: '서비스 A',
        quantity:    3,
        unitPrice:   new Money(1000, 'KRW'),
      });
      assert.equal(inv.lineItems.length, 1);
      assert.equal(inv.lineItems[0].amount.amount, 3000);
    });

    test('INV-B004: unitPrice가 0이면 거부', () => {
      assert.throws(
        () => validCreate().addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(0, 'KRW') }),
        /INV-B004/
      );
    });

    test('INV-B004: 음수 단가 거부', () => {
      assert.throws(
        () => validCreate().addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(-100, 'KRW') }),
        /INV-B004/
      );
    });

    test('INV-B002: PENDING 상태에서는 라인 항목 추가 불가', () => {
      const inv = validCreate().transitionTo('PENDING');
      assert.throws(
        () => inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') }),
        /INV-B002/
      );
    });

    test('quantity < 1이면 오류', () => {
      assert.throws(
        () => validCreate().addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 0, unitPrice: new Money(100, 'KRW') }),
        /quantity/
      );
    });
  });

  describe('INV-B002: transitionTo()', () => {
    test('DRAFT → PENDING 성공', () => {
      const inv = validCreate().transitionTo('PENDING');
      assert.equal(inv.status.equals('PENDING'), true);
    });

    test('DRAFT → PAID 실패 (허용되지 않은 전이)', () => {
      assert.throws(() => validCreate().transitionTo('PAID'), /INV-B002/);
    });

    test('PAID → PENDING 실패 (terminal)', () => {
      const inv = validCreate().transitionTo('PENDING').transitionTo('PAID');
      assert.throws(() => inv.transitionTo('PENDING'), /INV-B002/);
    });

    test('상태 전이 후 새 Invoice 인스턴스 반환 (불변 패턴)', () => {
      const before = validCreate();
      const after  = before.transitionTo('PENDING');
      assert.notEqual(after, before);
    });
  });

  describe('에러 코드 회귀 테스트', () => {
    test('[회귀] INV-B002 라인항목 DRAFT 외 → code=CONFLICT', () => {
      const inv = validCreate().transitionTo('PENDING');
      assert.throws(
        () => inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') }),
        err => { assert.equal(err.code, 'CONFLICT'); return true; },
      );
    });

    test('[회귀] INV-B004 음수 단가 → code=VALIDATION_ERROR', () => {
      assert.throws(
        () => validCreate().addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(-100, 'KRW') }),
        err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; },
      );
    });

    test('[회귀] INV-B002 허용되지 않은 전이 → code=CONFLICT', () => {
      assert.throws(
        () => validCreate().transitionTo('PAID'),
        err => { assert.equal(err.code, 'CONFLICT'); return true; },
      );
    });

    test('[회귀] quantity < 1 → code=VALIDATION_ERROR', () => {
      assert.throws(
        () => validCreate().addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 0, unitPrice: new Money(100, 'KRW') }),
        err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; },
      );
    });
  });

  describe('불변 패턴 검증', () => {
    test('addLineItem은 새 Invoice를 반환한다', () => {
      const inv1 = validCreate();
      const inv2 = inv1.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
      assert.notEqual(inv1, inv2);
      assert.equal(inv1.lineItems.length, 0);
      assert.equal(inv2.lineItems.length, 1);
    });
  });
});
