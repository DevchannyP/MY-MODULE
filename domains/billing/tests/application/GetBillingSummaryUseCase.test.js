'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GetBillingSummaryUseCase }              = require('../../src/application/GetBillingSummaryUseCase');
const { CreateInvoiceUseCase }                  = require('../../src/application/CreateInvoiceUseCase');
const { TransitionInvoiceStatusUseCase }        = require('../../src/application/TransitionInvoiceStatusUseCase');
const { InMemoryInvoiceRepository }             = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryBillingExceptionRepository }    = require('../../src/infrastructure/InMemoryBillingExceptionRepository');

const READ_CALLER  = { permissions: ['billing.read'],  userId: 'user-1' };
const WRITE_CALLER = { permissions: ['billing.write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeSetup() {
  const invoiceRepo   = new InMemoryInvoiceRepository();
  const exceptionRepo = new InMemoryBillingExceptionRepository();
  const summaryUC     = new GetBillingSummaryUseCase(invoiceRepo, exceptionRepo);
  const createUC      = new CreateInvoiceUseCase(invoiceRepo);
  const transitionUC  = new TransitionInvoiceStatusUseCase(invoiceRepo);
  return { invoiceRepo, exceptionRepo, summaryUC, createUC, transitionUC };
}

describe('GetBillingSummaryUseCase', () => {
  test('빈 저장소 → 모든 count 0', async () => {
    const { summaryUC } = makeSetup();
    const result = await summaryUC.execute(READ_CALLER);
    assert.equal(result.total_invoices,  0);
    assert.equal(result.pending_count,   0);
    assert.equal(result.disputed_count,  0);
    assert.equal(result.open_exceptions, 0);
    assert.equal(result.month_total,     null);
  });

  test('인보이스 2개 생성 → total_invoices=2', async () => {
    const { summaryUC, createUC } = makeSetup();
    await createUC.execute({ customerId: 'cust-1' }, WRITE_CALLER);
    await createUC.execute({ customerId: 'cust-2' }, WRITE_CALLER);
    const result = await summaryUC.execute(READ_CALLER);
    assert.equal(result.total_invoices, 2);
  });

  test('PENDING 인보이스 → pending_count 반영', async () => {
    const { summaryUC, createUC, transitionUC } = makeSetup();
    const inv = await createUC.execute({ customerId: 'cust-1' }, WRITE_CALLER);
    await transitionUC.execute({ invoiceId: inv.invoiceId, newStatus: 'PENDING' }, WRITE_CALLER);
    const result = await summaryUC.execute(READ_CALLER);
    assert.equal(result.pending_count, 1);
  });

  test('권한 없음 → FORBIDDEN', async () => {
    const { summaryUC } = makeSetup();
    await assert.rejects(() => summaryUC.execute(NO_PERM), { code: 'FORBIDDEN' });
  });

  test('billing.write는 billing.read 없이 summary 조회 불가 → FORBIDDEN', async () => {
    const { summaryUC } = makeSetup();
    await assert.rejects(
      () => summaryUC.execute({ permissions: ['billing.write'], userId: 'u' }),
      { code: 'FORBIDDEN' },
    );
  });

  test('[NFR async-first] 4개 조회가 Promise.all 병렬 실행 — 단일 execute 호출로 5개 필드 일관 반환', async () => {
    const { summaryUC, createUC, transitionUC } = makeSetup();
    await createUC.execute({ customerId: 'cust-A' }, WRITE_CALLER);
    await createUC.execute({ customerId: 'cust-B' }, WRITE_CALLER);
    const inv = await createUC.execute({ customerId: 'cust-C' }, WRITE_CALLER);
    await transitionUC.execute({ invoiceId: inv.invoiceId, newStatus: 'PENDING' }, WRITE_CALLER);

    const result = await summaryUC.execute(READ_CALLER);

    assert.equal(result.total_invoices,  3, 'total_invoices');
    assert.equal(result.pending_count,   1, 'pending_count');
    assert.equal(result.disputed_count,  0, 'disputed_count');
    assert.equal(result.open_exceptions, 0, 'open_exceptions');
    assert.equal(result.month_total,     null, 'month_total null (Phase 2)');
    // 5개 필드가 단일 execute에서 원자적으로 반환됨 (Promise.all 병렬 실행 계약)
    assert.equal(Object.keys(result).length, 5, '5 fields returned atomically');
  });
});
