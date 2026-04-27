'use strict';

/**
 * InMemory Repository 계약 테스트 — billing 도메인
 *
 * 벤치마킹: Robert C. Martin "Clean Architecture" + Eric Evans DDD (Evans, 2003) —
 *   Repository 포트 계약은 구현체와 독립적으로 검증해야 한다.
 *   InMemory 어댑터는 실제 영속성(SQLite/RDB) 어댑터의 계약과 동일하게 동작해야 한다.
 *   어댑터 교체 시 이 테스트를 통과하면 계약 준수를 보장한다.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryInvoiceRepository }          = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryPaymentRepository }          = require('../../src/infrastructure/InMemoryPaymentRepository');
const { InMemoryBillingExceptionRepository } = require('../../src/infrastructure/InMemoryBillingExceptionRepository');
const { Invoice }                            = require('../../src/domain/entities/Invoice');
const { Payment, PAYMENT_STATUSES }          = require('../../src/domain/entities/Payment');
const { BillingException, EXCEPTION_TYPES }  = require('../../src/domain/entities/BillingException');
const { Money }                              = require('../../src/domain/value-objects/Money');

// ── InMemoryInvoiceRepository ────────────────────────────────────────────────

describe('InMemoryInvoiceRepository — 계약 테스트', () => {
  function makeRepo() { return new InMemoryInvoiceRepository(); }

  function makeInvoice(id = 'inv-1', customerId = 'cust-1') {
    return Invoice.create({ invoiceId: id, customerId });
  }

  test('save → findById 반환', async () => {
    const repo = makeRepo();
    const inv = makeInvoice();
    await repo.save(inv);
    const found = await repo.findById('inv-1');
    assert.ok(found);
    assert.equal(found.invoiceId, 'inv-1');
  });

  test('없는 ID → findById null 반환', async () => {
    const repo = makeRepo();
    const found = await repo.findById('no-such');
    assert.equal(found, null);
  });

  test('findAll 빈 저장소 → total=0', async () => {
    const repo = makeRepo();
    const result = await repo.findAll();
    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  test('findAll status 필터 — DRAFT만 반환', async () => {
    const repo = makeRepo();
    const inv1 = makeInvoice('inv-1');
    const inv2 = makeInvoice('inv-2').transitionTo('PENDING');
    await repo.save(inv1);
    await repo.save(inv2);
    const result = await repo.findAll({ status: 'DRAFT' });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].invoiceId, 'inv-1');
  });

  test('findAll 페이지네이션 — page=2, pageSize=1', async () => {
    const repo = makeRepo();
    await repo.save(makeInvoice('inv-1'));
    await repo.save(makeInvoice('inv-2'));
    const result = await repo.findAll({ page: 2, pageSize: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.page, 2);
  });

  test('INV-B003: PAID 인보이스 delete → CONFLICT 오류', async () => {
    const repo = makeRepo();
    const inv = makeInvoice().transitionTo('PENDING').transitionTo('PAID');
    await repo.save(inv);
    await assert.rejects(() => repo.delete('inv-1'), { code: 'CONFLICT' });
  });

  test('없는 ID delete → NOT_FOUND 오류', async () => {
    const repo = makeRepo();
    await assert.rejects(() => repo.delete('no-such'), { code: 'NOT_FOUND' });
  });

  test('DRAFT 인보이스 delete → 성공', async () => {
    const repo = makeRepo();
    await repo.save(makeInvoice('inv-del'));
    await repo.delete('inv-del');
    const found = await repo.findById('inv-del');
    assert.equal(found, null);
  });

  test('amountMin 필터 — total >= amountMin인 인보이스만', async () => {
    const repo = makeRepo();
    const inv = makeInvoice('inv-rich').addLineItem({
      lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(5000, 'KRW'),
    });
    const invSmall = makeInvoice('inv-small');
    await repo.save(inv);
    await repo.save(invSmall);
    const result = await repo.findAll({ amountMin: 1000 });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].invoiceId, 'inv-rich');
  });
});

// ── InMemoryPaymentRepository ────────────────────────────────────────────────

describe('InMemoryPaymentRepository — 계약 테스트', () => {
  function makeRepo() { return new InMemoryPaymentRepository(); }

  function makePayment(id = 'pay-1', invoiceId = 'inv-1') {
    return Payment.create({ paymentId: id, invoiceId, amount: new Money(1000, 'KRW') });
  }

  test('save → findById 반환', async () => {
    const repo = makeRepo();
    await repo.save(makePayment());
    const found = await repo.findById('pay-1');
    assert.ok(found);
    assert.equal(found.paymentId, 'pay-1');
  });

  test('없는 ID → findById null 반환', async () => {
    const repo = makeRepo();
    assert.equal(await repo.findById('none'), null);
  });

  test('findAll 빈 저장소 → total=0', async () => {
    const repo = makeRepo();
    const result = await repo.findAll();
    assert.equal(result.total, 0);
  });

  test('invoiceId 필터 — 해당 invoice의 결제만', async () => {
    const repo = makeRepo();
    await repo.save(makePayment('pay-1', 'inv-A'));
    await repo.save(makePayment('pay-2', 'inv-B'));
    const result = await repo.findAll({ invoiceId: 'inv-A' });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].invoiceId, 'inv-A');
  });

  test('status 필터 — PENDING만 반환', async () => {
    const repo = makeRepo();
    await repo.save(makePayment('pay-1'));
    const result = await repo.findAll({ status: PAYMENT_STATUSES.PENDING });
    assert.equal(result.items.length, 1);
  });

  test('findAll 페이지네이션 — page=1, pageSize=1', async () => {
    const repo = makeRepo();
    await repo.save(makePayment('pay-1'));
    await repo.save(makePayment('pay-2'));
    const result = await repo.findAll({ page: 1, pageSize: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 2);
  });
});

// ── InMemoryBillingExceptionRepository ──────────────────────────────────────

describe('InMemoryBillingExceptionRepository — 계약 테스트', () => {
  function makeRepo() { return new InMemoryBillingExceptionRepository(); }

  function makeException(id = 'exc-1') {
    return BillingException.create({ exceptionId: id, invoiceId: 'inv-1', paymentId: 'pay-1', exceptionType: EXCEPTION_TYPES.MISMATCH });
  }

  test('save → findById 반환', async () => {
    const repo = makeRepo();
    await repo.save(makeException());
    const found = await repo.findById('exc-1');
    assert.ok(found);
    assert.equal(found.exceptionId, 'exc-1');
  });

  test('없는 ID → findById null 반환', async () => {
    const repo = makeRepo();
    assert.equal(await repo.findById('none'), null);
  });

  test('findAll 빈 저장소 → total=0', async () => {
    const repo = makeRepo();
    const result = await repo.findAll();
    assert.equal(result.total, 0);
  });

  test('status 필터 — OPEN만 반환', async () => {
    const repo = makeRepo();
    await repo.save(makeException('exc-1'));
    await repo.save(makeException('exc-2'));
    const result = await repo.findAll({ status: 'OPEN' });
    assert.equal(result.items.length, 2); // 둘 다 OPEN 초기 상태
  });

  test('findAll 페이지네이션 — page=2, pageSize=1', async () => {
    const repo = makeRepo();
    await repo.save(makeException('exc-1'));
    await repo.save(makeException('exc-2'));
    const result = await repo.findAll({ page: 2, pageSize: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 2);
  });
});
