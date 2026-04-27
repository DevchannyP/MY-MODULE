'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Money } = require('../../../src/domain/value-objects/Money');

describe('Money.multiply() — 금융 연산', () => {
  test('정수 배수 곱셈', () => {
    const m = new Money(500, 'KRW');
    assert.equal(m.multiply(3).amount,   1500);
    assert.equal(m.multiply(3).currency, 'KRW');
  });

  test('소수 배수 곱셈 → Math.round 적용', () => {
    const m = new Money(100, 'KRW');
    // 100 * 1.5 = 150 (정확)
    assert.equal(m.multiply(1.5).amount, 150);
    // 100 * 0.333 = 33.3 → round → 33
    assert.equal(m.multiply(0.333).amount, 33);
  });

  test('factor=0 → VALIDATION_ERROR', () => {
    const m = new Money(100, 'KRW');
    assert.throws(() => m.multiply(0),  err => err.code === 'VALIDATION_ERROR');
  });

  test('factor 음수 → VALIDATION_ERROR', () => {
    const m = new Money(100, 'KRW');
    assert.throws(() => m.multiply(-1), err => err.code === 'VALIDATION_ERROR');
  });

  test('factor Infinity → VALIDATION_ERROR', () => {
    const m = new Money(100, 'KRW');
    assert.throws(() => m.multiply(Infinity), err => err.code === 'VALIDATION_ERROR');
  });

  test('multiply 후 원본 불변 (freeze 보장)', () => {
    const original = new Money(200, 'KRW');
    const result   = original.multiply(2);
    assert.equal(original.amount, 200, '원본 Money가 변경됨 (불변 패턴 위반)');
    assert.equal(result.amount,   400);
    assert.notStrictEqual(original, result);
  });

  test('multiply 결과로 add 연산 가능 (체이닝)', () => {
    const unit = new Money(100, 'KRW');
    const sum  = unit.multiply(3).add(unit.multiply(2));
    assert.equal(sum.amount, 500);
  });
});
