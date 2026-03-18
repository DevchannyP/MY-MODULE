'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Money } = require('../../../src/domain/value-objects/Money');

describe('Money', () => {
  describe('생성', () => {
    test('유효한 값으로 생성된다', () => {
      const m = new Money(1000, 'KRW');
      assert.equal(m.amount, 1000);
      assert.equal(m.currency, 'KRW');
    });

    test('currency를 대문자로 정규화한다', () => {
      assert.equal(new Money(100, 'krw').currency, 'KRW');
    });

    test('amount가 숫자가 아니면 오류', () => {
      assert.throws(() => new Money('1000', 'KRW'), /must be a finite number/);
    });

    test('currency가 3자리가 아니면 오류', () => {
      assert.throws(() => new Money(100, 'KR'));
      assert.throws(() => new Money(100, 'KRWW'));
    });

    test('Infinity는 거부한다', () => {
      assert.throws(() => new Money(Infinity, 'KRW'));
    });
  });

  describe('INV-B004: isPositive()', () => {
    test('0은 양수가 아니다', () => {
      assert.equal(new Money(0, 'KRW').isPositive(), false);
    });

    test('음수는 양수가 아니다', () => {
      assert.equal(new Money(-100, 'KRW').isPositive(), false);
    });

    test('양수는 true', () => {
      assert.equal(new Money(1, 'KRW').isPositive(), true);
    });
  });

  describe('add()', () => {
    test('같은 통화끼리 더한다', () => {
      const result = new Money(1000, 'KRW').add(new Money(500, 'KRW'));
      assert.equal(result.amount, 1500);
    });

    test('다른 통화끼리 더하면 오류', () => {
      assert.throws(() => new Money(1000, 'KRW').add(new Money(10, 'USD')), /Currency mismatch/);
    });
  });

  describe('delta()', () => {
    test('두 금액 차이의 절댓값을 반환한다', () => {
      const a = new Money(1000, 'KRW');
      const b = new Money(700, 'KRW');
      assert.equal(a.delta(b).amount, 300);
      assert.equal(b.delta(a).amount, 300);
    });
  });

  describe('equals()', () => {
    test('같은 금액과 통화면 true', () => {
      assert.equal(new Money(1000, 'KRW').equals(new Money(1000, 'KRW')), true);
    });

    test('금액이 다르면 false', () => {
      assert.equal(new Money(1000, 'KRW').equals(new Money(900, 'KRW')), false);
    });

    test('Money가 아닌 값이면 false', () => {
      assert.equal(new Money(1000, 'KRW').equals({ amount: 1000, currency: 'KRW' }), false);
    });
  });

  describe('직렬화', () => {
    test('toJSON / fromJSON 왕복 변환', () => {
      const m = new Money(5000, 'KRW');
      assert.equal(Money.fromJSON(m.toJSON()).equals(m), true);
    });
  });
});
