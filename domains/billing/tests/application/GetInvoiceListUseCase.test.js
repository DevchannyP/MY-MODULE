'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GetInvoiceListUseCase }              = require('../../src/application/GetInvoiceListUseCase');
const { CreateInvoiceUseCase }               = require('../../src/application/CreateInvoiceUseCase');
const { TransitionInvoiceStatusUseCase }     = require('../../src/application/TransitionInvoiceStatusUseCase');
const { InMemoryInvoiceRepository }          = require('../../src/infrastructure/InMemoryInvoiceRepository');

const READ_CALLER  = { permissions: ['billing.read'],  userId: 'user-1' };
const WRITE_CALLER = { permissions: ['billing.write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeSetup() {
  const repo         = new InMemoryInvoiceRepository();
  const listUC       = new GetInvoiceListUseCase(repo);
  const createUC     = new CreateInvoiceUseCase(repo);
  const transitionUC = new TransitionInvoiceStatusUseCase(repo);
  return { repo, listUC, createUC, transitionUC };
}

describe('GetInvoiceListUseCase', () => {
  test('빈 저장소 → items=[], total=0', async () => {
    const { listUC } = makeSetup();
    const result = await listUC.execute({}, READ_CALLER);
    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  test('인보이스 3개 → total=3, items 반환', async () => {
    const { listUC, createUC } = makeSetup();
    for (let i = 1; i <= 3; i++) {
      await createUC.execute({ customerId: `cust-${i}` }, WRITE_CALLER);
    }
    const result = await listUC.execute({}, READ_CALLER);
    assert.equal(result.total, 3);
    assert.equal(result.items.length, 3);
  });

  test('customerId 필터 동작', async () => {
    const { listUC, createUC } = makeSetup();
    const invA = await createUC.execute({ customerId: 'cust-A' }, WRITE_CALLER);
    await createUC.execute({ customerId: 'cust-B' }, WRITE_CALLER);
    const result = await listUC.execute({ customerId: 'cust-A' }, READ_CALLER);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].invoiceId, invA.invoiceId);
  });

  test('status 필터: PENDING만 반환', async () => {
    const { listUC, createUC, transitionUC } = makeSetup();
    const inv1 = await createUC.execute({ customerId: 'c1' }, WRITE_CALLER);
    await createUC.execute({ customerId: 'c2' }, WRITE_CALLER);
    await transitionUC.execute({ invoiceId: inv1.invoiceId, newStatus: 'PENDING' }, WRITE_CALLER);
    const result = await listUC.execute({ status: 'PENDING' }, READ_CALLER);
    assert.equal(result.total, 1);
    assert.ok(result.items[0].status.equals('PENDING'));
  });

  test('페이지네이션: pageSize=1', async () => {
    const { listUC, createUC } = makeSetup();
    for (let i = 1; i <= 3; i++) {
      await createUC.execute({ customerId: `cust-${i}` }, WRITE_CALLER);
    }
    const result = await listUC.execute({ page: 1, pageSize: 1 }, READ_CALLER);
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 3);
  });

  test('권한 없음 → FORBIDDEN', async () => {
    const { listUC } = makeSetup();
    await assert.rejects(() => listUC.execute({}, NO_PERM), { code: 'FORBIDDEN' });
  });
});
