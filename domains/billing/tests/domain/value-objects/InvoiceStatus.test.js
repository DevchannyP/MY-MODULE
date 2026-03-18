'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { InvoiceStatus } = require('../../../src/domain/value-objects/InvoiceStatus');

describe('InvoiceStatus', () => {
  describe('INV-B002: 허용된 전이 규칙', () => {
    test('DRAFT → PENDING 허용', () => {
      assert.equal(InvoiceStatus.DRAFT.canTransitionTo('PENDING'), true);
    });

    test('DRAFT → PAID 불허', () => {
      assert.equal(InvoiceStatus.DRAFT.canTransitionTo('PAID'), false);
    });

    test('PENDING → PAID 허용', () => {
      assert.equal(InvoiceStatus.PENDING.canTransitionTo('PAID'), true);
    });

    test('PENDING → CANCELLED 허용', () => {
      assert.equal(InvoiceStatus.PENDING.canTransitionTo('CANCELLED'), true);
    });

    test('PENDING → DISPUTED 허용', () => {
      assert.equal(InvoiceStatus.PENDING.canTransitionTo('DISPUTED'), true);
    });

    test('PAID → 어떤 상태로도 전이 불가 (terminal)', () => {
      for (const status of ['DRAFT', 'PENDING', 'DISPUTED', 'CANCELLED']) {
        assert.equal(InvoiceStatus.PAID.canTransitionTo(status), false, `PAID → ${status} 불허`);
      }
    });

    test('CANCELLED → 어떤 상태로도 전이 불가 (terminal)', () => {
      assert.equal(InvoiceStatus.CANCELLED.canTransitionTo('PENDING'), false);
    });

    test('DISPUTED → PAID 허용 (도메인 수준; INV-B005 관리자 승인은 서비스 계층)', () => {
      assert.equal(InvoiceStatus.DISPUTED.canTransitionTo('PAID'), true);
    });

    test('DISPUTED → CANCELLED 허용', () => {
      assert.equal(InvoiceStatus.DISPUTED.canTransitionTo('CANCELLED'), true);
    });

    test('DISPUTED → DRAFT 불허', () => {
      assert.equal(InvoiceStatus.DISPUTED.canTransitionTo('DRAFT'), false);
    });
  });

  describe('isTerminal()', () => {
    test('PAID는 terminal', () => {
      assert.equal(InvoiceStatus.PAID.isTerminal(), true);
    });

    test('CANCELLED는 terminal', () => {
      assert.equal(InvoiceStatus.CANCELLED.isTerminal(), true);
    });

    test('DRAFT는 terminal이 아님', () => {
      assert.equal(InvoiceStatus.DRAFT.isTerminal(), false);
    });
  });

  describe('유효성', () => {
    test('잘못된 값으로 생성하면 오류', () => {
      assert.throws(() => InvoiceStatus.of('UNKNOWN'), /Invalid InvoiceStatus/);
    });

    test('InvoiceStatus 인스턴스와 문자열 비교', () => {
      assert.equal(InvoiceStatus.DRAFT.equals(InvoiceStatus.DRAFT), true);
      assert.equal(InvoiceStatus.DRAFT.equals('DRAFT'), true);
      assert.equal(InvoiceStatus.DRAFT.equals('PENDING'), false);
    });
  });
});
