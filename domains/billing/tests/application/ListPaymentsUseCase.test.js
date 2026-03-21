'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ListPaymentsUseCase }        = require('../../src/application/ListPaymentsUseCase');
const { InMemoryPaymentRepository }  = require('../../src/infrastructure/InMemoryPaymentRepository');
const { Payment }                    = require('../../src/domain/entities/Payment');
const { Money }                      = require('../../src/domain/value-objects/Money');

const READ_CALLER  = { permissions: ['billing.read'],  userId: 'u-1' };
const WRITE_CALLER = { permissions: ['billing.write'], userId: 'u-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeRepo() {
  return new InMemoryPaymentRepository();
}

async function seedPayment(repo, overrides = {}) {
  const p = Payment.create({
    paymentId: overrides.paymentId || 'pay-1',
    invoiceId: overrides.invoiceId || 'inv-1',
    amount: new Money(1000, 'KRW'),
  });
  await repo.save(p);
  return p;
}

describe('ListPaymentsUseCase', () => {
  // ── 권한 검사 ───────────────────────────────────────────────────────────────
  test('billing.read 없으면 FORBIDDEN', async () => {
    const uc = new ListPaymentsUseCase(makeRepo());
    await assert.rejects(() => uc.execute({}, NO_PERM), { code: 'FORBIDDEN' });
  });

  test('billing.write만 있으면 FORBIDDEN (read 없음)', async () => {
    const uc = new ListPaymentsUseCase(makeRepo());
    await assert.rejects(() => uc.execute({}, WRITE_CALLER), { code: 'FORBIDDEN' });
  });

  // ── 정상 경로 ────────────────────────────────────────────────────────────────
  test('빈 저장소 → items=[], total=0', async () => {
    const uc = new ListPaymentsUseCase(makeRepo());
    const result = await uc.execute({}, READ_CALLER);
    assert.equal(result.items.length, 0);
    assert.equal(result.total, 0);
  });

  test('결제 1건 저장 후 조회 → items.length=1', async () => {
    const repo = makeRepo();
    await seedPayment(repo);
    const uc = new ListPaymentsUseCase(repo);
    const result = await uc.execute({}, READ_CALLER);
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 1);
  });

  test('invoiceId 필터 → 해당 invoice 결제만 반환', async () => {
    const repo = makeRepo();
    await seedPayment(repo, { paymentId: 'pay-1', invoiceId: 'inv-1' });
    await seedPayment(repo, { paymentId: 'pay-2', invoiceId: 'inv-2' });
    const uc = new ListPaymentsUseCase(repo);
    const result = await uc.execute({ invoiceId: 'inv-1' }, READ_CALLER);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].invoiceId, 'inv-1');
  });

  test('페이지네이션 — pageSize=1, page=2 → 두 번째 항목', async () => {
    const repo = makeRepo();
    await seedPayment(repo, { paymentId: 'pay-1', invoiceId: 'inv-1' });
    await seedPayment(repo, { paymentId: 'pay-2', invoiceId: 'inv-2' });
    const uc = new ListPaymentsUseCase(repo);
    const result = await uc.execute({ page: 2, pageSize: 1 }, READ_CALLER);
    assert.equal(result.items.length, 1);
    assert.equal(result.page, 2);
  });
});
