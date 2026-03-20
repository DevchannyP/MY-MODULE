'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BillingException, EXCEPTION_STATUSES } = require('../../../src/domain/entities/BillingException');

describe('BillingException Entity', () => {
  test('create → OPEN 상태 생성', () => {
    const exc = BillingException.create({ exceptionId: 'exc-1', invoiceId: 'inv-1', exceptionType: 'DISPUTED' });
    assert.equal(exc.exceptionId,   'exc-1');
    assert.equal(exc.invoiceId,     'inv-1');
    assert.equal(exc.exceptionType, 'DISPUTED');
    assert.equal(exc.status,        EXCEPTION_STATUSES.OPEN);
    assert.equal(exc.isOpen(),      true);
  });

  test('approve() → APPROVED 상태 + 불변 패턴(새 인스턴스)', () => {
    const original = BillingException.create({ exceptionId: 'exc-2', invoiceId: 'inv-2', exceptionType: 'MISMATCH' });
    const approved = original.approve({ approvedBy: 'admin-1', reason: '승인' });
    assert.equal(original.status, EXCEPTION_STATUSES.OPEN,     '원본이 변경됨 (불변 패턴 위반)');
    assert.equal(approved.status, EXCEPTION_STATUSES.APPROVED);
    assert.notStrictEqual(original, approved);
  });

  test('reject() → REJECTED 상태 + 불변 패턴', () => {
    const original = BillingException.create({ exceptionId: 'exc-3', invoiceId: 'inv-3', exceptionType: 'SYNC_FAILURE' });
    const rejected = original.reject({ rejectedBy: 'admin-1', reason: '거부' });
    assert.equal(original.status, EXCEPTION_STATUSES.OPEN);
    assert.equal(rejected.status, EXCEPTION_STATUSES.REJECTED);
  });

  // ── P1 버그 수정 회귀 테스트 ─────────────────────────────────────────────────
  test('[회귀] 이중 approve 시도 → code=CONFLICT (HTTP 409 보장)', () => {
    const exc      = BillingException.create({ exceptionId: 'exc-r1', invoiceId: 'inv-1', exceptionType: 'DISPUTED' });
    const approved = exc.approve({ approvedBy: 'admin-1', reason: '1차 승인' });
    try {
      approved.approve({ approvedBy: 'admin-2', reason: '2차 시도' });
      assert.fail('이중 승인이 허용됨 (버그)');
    } catch (err) {
      assert.equal(err.code, 'CONFLICT', `에러 코드가 CONFLICT가 아님: ${err.code} → HTTP 500 발생 위험`);
    }
  });

  test('[회귀] 이중 reject 시도 → code=CONFLICT (HTTP 409 보장)', () => {
    const exc      = BillingException.create({ exceptionId: 'exc-r2', invoiceId: 'inv-1', exceptionType: 'DISPUTED' });
    const rejected = exc.reject({ rejectedBy: 'admin-1', reason: '1차 거부' });
    try {
      rejected.reject({ rejectedBy: 'admin-2', reason: '2차 시도' });
      assert.fail('이중 거부가 허용됨 (버그)');
    } catch (err) {
      assert.equal(err.code, 'CONFLICT', `에러 코드가 CONFLICT가 아님: ${err.code} → HTTP 500 발생 위험`);
    }
  });

  test('[회귀] approve 후 reject 시도 → code=CONFLICT', () => {
    const exc      = BillingException.create({ exceptionId: 'exc-r3', invoiceId: 'inv-1', exceptionType: 'DISPUTED' });
    const approved = exc.approve({ approvedBy: 'admin-1', reason: '승인' });
    try {
      approved.reject({ rejectedBy: 'admin-2', reason: '뒤늦은 거부 시도' });
      assert.fail('APPROVED 예외 거부가 허용됨 (버그)');
    } catch (err) {
      assert.equal(err.code, 'CONFLICT');
    }
  });

  test('유효하지 않은 exceptionType → 생성 오류', () => {
    assert.throws(
      () => BillingException.create({ exceptionId: 'exc-x', invoiceId: 'inv-x', exceptionType: 'INVALID' }),
      /Invalid exception type/,
    );
  });

  test('toJSON() → snake_case 구조 검증', () => {
    const exc  = BillingException.create({ exceptionId: 'exc-j', invoiceId: 'inv-j', exceptionType: 'MISMATCH' });
    const json = exc.toJSON();
    assert.ok('exception_id'   in json);
    assert.ok('invoice_id'     in json);
    assert.ok('exception_type' in json);
    assert.ok('status'         in json);
    assert.equal(json.status,   'OPEN');
  });
});
