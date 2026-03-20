'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { AddLineItemUseCase }           = require('../../src/application/AddLineItemUseCase');
const { CreateInvoiceUseCase }         = require('../../src/application/CreateInvoiceUseCase');
const { InMemoryInvoiceRepository }    = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { Money }                        = require('../../src/domain/value-objects/Money');

const WRITE_CALLER = { permissions: ['billing.write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeSetup() {
  const repo      = new InMemoryInvoiceRepository();
  const createUC  = new CreateInvoiceUseCase(repo);
  const addUC     = new AddLineItemUseCase(repo);
  return { repo, createUC, addUC };
}

async function seedInvoice(createUC) {
  return createUC.execute({ customerId: 'cust-1' }, WRITE_CALLER);
}

describe('AddLineItemUseCase', () => {
  test('라인 항목 추가 성공 → total 합산 반영 (INV-B001)', async () => {
    const { createUC, addUC } = makeSetup();
    const invoice = await seedInvoice(createUC);
    const inv = await addUC.execute(
      { invoiceId: invoice.invoiceId, lineItemId: 'li-1', description: '상품A', quantity: 2, unitPrice: { amount: 500, currency: 'KRW' } },
      WRITE_CALLER,
    );
    assert.equal(inv.total.amount, 1000);
    assert.equal(inv.lineItems.length, 1);
  });

  test('Money 인스턴스 직접 전달 성공', async () => {
    const { createUC, addUC } = makeSetup();
    const invoice = await seedInvoice(createUC);
    const inv = await addUC.execute(
      { invoiceId: invoice.invoiceId, lineItemId: 'li-2', description: '상품B', quantity: 3, unitPrice: new Money(100, 'KRW') },
      WRITE_CALLER,
    );
    assert.equal(inv.total.amount, 300);
  });

  test('권한 없음 → FORBIDDEN', async () => {
    const { createUC, addUC } = makeSetup();
    const invoice = await seedInvoice(createUC);
    await assert.rejects(
      () => addUC.execute({ invoiceId: invoice.invoiceId, lineItemId: 'li-3', description: '상품', quantity: 1, unitPrice: { amount: 100, currency: 'KRW' } }, NO_PERM),
      { code: 'FORBIDDEN' },
    );
  });

  test('존재하지 않는 invoiceId → NOT_FOUND', async () => {
    const { addUC } = makeSetup();
    await assert.rejects(
      () => addUC.execute({ invoiceId: 'nonexistent', lineItemId: 'li-1', description: '상품', quantity: 1, unitPrice: { amount: 100, currency: 'KRW' } }, WRITE_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('INV-B004: 0원 라인 항목 → 거부', async () => {
    const { createUC, addUC } = makeSetup();
    const invoice = await seedInvoice(createUC);
    await assert.rejects(
      () => addUC.execute({ invoiceId: invoice.invoiceId, lineItemId: 'li-z', description: '무료', quantity: 1, unitPrice: { amount: 0, currency: 'KRW' } }, WRITE_CALLER),
      /INV-B004/,
    );
  });

  test('INV-B004: 음수 금액 → 거부', async () => {
    const { createUC, addUC } = makeSetup();
    const invoice = await seedInvoice(createUC);
    await assert.rejects(
      () => addUC.execute({ invoiceId: invoice.invoiceId, lineItemId: 'li-n', description: '환불', quantity: 1, unitPrice: { amount: -100, currency: 'KRW' } }, WRITE_CALLER),
      /INV-B004/,
    );
  });

  test('여러 라인 항목 누적 → total 합산', async () => {
    const { createUC, addUC } = makeSetup();
    const invoice = await seedInvoice(createUC);
    const inv1 = await addUC.execute({ invoiceId: invoice.invoiceId, lineItemId: 'li-a', description: 'A', quantity: 1, unitPrice: { amount: 300, currency: 'KRW' } }, WRITE_CALLER);
    const inv2 = await addUC.execute({ invoiceId: inv1.invoiceId, lineItemId: 'li-b', description: 'B', quantity: 2, unitPrice: { amount: 200, currency: 'KRW' } }, WRITE_CALLER);
    assert.equal(inv2.total.amount, 700);
    assert.equal(inv2.lineItems.length, 2);
  });
});
