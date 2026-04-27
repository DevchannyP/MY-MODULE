'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GetPaymentUseCase }          = require('../../src/application/GetPaymentUseCase');
const { InMemoryPaymentRepository }  = require('../../src/infrastructure/InMemoryPaymentRepository');
const { Payment }                    = require('../../src/domain/entities/Payment');
const { Money }                      = require('../../src/domain/value-objects/Money');

const READ_CALLER  = { permissions: ['billing.read'],  userId: 'u-1' };
const WRITE_CALLER = { permissions: ['billing.write'], userId: 'u-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

async function makeRepoWithPayment() {
  const repo = new InMemoryPaymentRepository();
  const p = Payment.create({ paymentId: 'pay-1', invoiceId: 'inv-1', amount: new Money(500, 'KRW') });
  await repo.save(p);
  return repo;
}

describe('GetPaymentUseCase', () => {
  // ── 권한 검사 ───────────────────────────────────────────────────────────────
  test('billing.read 없으면 FORBIDDEN', async () => {
    const uc = new GetPaymentUseCase(new InMemoryPaymentRepository());
    await assert.rejects(() => uc.execute({ paymentId: 'pay-1' }, NO_PERM), { code: 'FORBIDDEN' });
  });

  test('billing.write만 있으면 FORBIDDEN', async () => {
    const uc = new GetPaymentUseCase(new InMemoryPaymentRepository());
    await assert.rejects(() => uc.execute({ paymentId: 'pay-1' }, WRITE_CALLER), { code: 'FORBIDDEN' });
  });

  // ── 입력 검증 ────────────────────────────────────────────────────────────────
  test('paymentId 누락 → VALIDATION_ERROR', async () => {
    const uc = new GetPaymentUseCase(new InMemoryPaymentRepository());
    await assert.rejects(() => uc.execute({ paymentId: '' }, READ_CALLER), { code: 'VALIDATION_ERROR' });
  });

  // ── 정상 경로 ────────────────────────────────────────────────────────────────
  test('존재하는 paymentId → Payment 반환', async () => {
    const repo = await makeRepoWithPayment();
    const uc = new GetPaymentUseCase(repo);
    const payment = await uc.execute({ paymentId: 'pay-1' }, READ_CALLER);
    assert.equal(payment.paymentId, 'pay-1');
    assert.equal(payment.invoiceId, 'inv-1');
  });

  test('존재하지 않는 paymentId → NOT_FOUND', async () => {
    const uc = new GetPaymentUseCase(new InMemoryPaymentRepository());
    await assert.rejects(
      () => uc.execute({ paymentId: 'no-such-pay' }, READ_CALLER),
      { code: 'NOT_FOUND' },
    );
  });
});
