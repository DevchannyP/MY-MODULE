'use strict';

/**
 * BillingController — authz regression + 라우팅 테스트
 *
 * ADR-0002: 권한 강제는 interface 레이어(유스케이스)에서 수행.
 * 각 엔드포인트별로:
 *   1. 권한 없는 호출 → 403 FORBIDDEN
 *   2. 정상 호출 → 2xx + 올바른 body 구조
 *   3. 존재하지 않는 리소스 → 404
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { BillingController }              = require('../../src/interface/BillingController');
const { InMemoryInvoiceRepository }      = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryPaymentRepository }      = require('../../src/infrastructure/InMemoryPaymentRepository');
const { InMemoryBillingExceptionRepository } = require('../../src/infrastructure/InMemoryBillingExceptionRepository');
const { Invoice }                        = require('../../src/domain/entities/Invoice');
const { Payment }                        = require('../../src/domain/entities/Payment');
const { BillingException }              = require('../../src/domain/entities/BillingException');
const { Money }                          = require('../../src/domain/value-objects/Money');

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────

function makeCtrl(overrides = {}) {
  const invoiceRepo   = overrides.invoiceRepo   || new InMemoryInvoiceRepository();
  const paymentRepo   = overrides.paymentRepo   || new InMemoryPaymentRepository();
  const exceptionRepo = overrides.exceptionRepo || new InMemoryBillingExceptionRepository();
  const ctrl = new BillingController({ invoiceRepo, paymentRepo, exceptionRepo });
  return { ctrl, invoiceRepo, paymentRepo, exceptionRepo };
}

const READ_CALLER  = { permissions: ['billing.read'],  userId: 'user-1' };
const WRITE_CALLER = { permissions: ['billing.write'], userId: 'user-2' };
const ADMIN_CALLER = { permissions: ['billing.admin'], userId: 'admin-1' };
const FULL_CALLER  = { permissions: ['billing.read', 'billing.write', 'billing.admin'], userId: 'super-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

async function seedInvoice(repo, status = 'DRAFT') {
  let inv = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
  inv = inv.addLineItem({ lineItemId: 'li-1', description: '항목A', quantity: 1, unitPrice: new Money(1000, 'KRW') });
  if (status !== 'DRAFT') inv = inv.transitionTo('PENDING');
  if (status === 'PAID')  inv = inv.transitionTo('PAID');
  await repo.save(inv);
  return inv;
}

async function seedPayment(repo) {
  const payment = Payment.create({ paymentId: 'pay-1', invoiceId: 'inv-1', amount: new Money(1000, 'KRW') });
  await repo.save(payment);
  return payment;
}

async function seedException(repo) {
  const exc = BillingException.create({ exceptionId: 'exc-1', invoiceId: 'inv-1', exceptionType: 'DISPUTED' });
  await repo.save(exc);
  return exc;
}

// ── 1. 알 수 없는 라우트 ─────────────────────────────────────────────────────
describe('[BillingController] 알 수 없는 라우트', () => {
  test('매핑되지 않은 경로 → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'DELETE', path: '/billing/unknown', caller: FULL_CALLER });
    assert.equal(res.status, 404);
  });

  test('[회귀] 404 응답은 RFC 9457 Problem Details 구조를 따른다', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'DELETE', path: '/billing/unknown', caller: FULL_CALLER });
    assert.equal(res.status, 404);
    assert.equal(res.body.status, 404);
    assert.equal(res.body.title, 'Not Found');
    assert.ok(typeof res.body.type === 'string');
  });
});

// ── 2. GET /billing/invoices ──────────────────────────────────────────────────
describe('[BillingController] GET /billing/invoices', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/invoices', caller: NO_PERM });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });

  test('billing.write만 있어도 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/invoices', caller: WRITE_CALLER });
    assert.equal(res.status, 403);
  });

  test('billing.read → 200 + 목록 구조', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({ method: 'GET', path: '/billing/invoices', caller: READ_CALLER });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.equal(res.body.items.length, 1);
    assert.equal(typeof res.body.total, 'number');
    assert.ok('invoice_id' in res.body.items[0]);
    assert.ok('status'     in res.body.items[0]);
    assert.ok('total'      in res.body.items[0]);
  });
});

// ── 3. POST /billing/invoices ─────────────────────────────────────────────────
describe('[BillingController] POST /billing/invoices', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/invoices',
      body: { customer_id: 'cust-1' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('billing.read만 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/invoices',
      body: { customer_id: 'cust-1' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 403);
  });

  test('billing.write → 201 + Invoice body', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/invoices',
      body: { customer_id: 'cust-99' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.customer_id, 'cust-99');
    assert.equal(res.body.status, 'DRAFT');
    assert.ok(res.body.invoice_id);
  });

  test('customer_id 누락 → 400', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/invoices',
      body: {}, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 400);
  });
});

// ── 4. GET /billing/invoices/:invoice_id ──────────────────────────────────────
describe('[BillingController] GET /billing/invoices/:invoice_id', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/invoices/:invoice_id',
      params: { invoice_id: 'inv-1' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('존재하지 않는 ID → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/invoices/:invoice_id',
      params: { invoice_id: 'nonexistent' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 404);
  });

  test('존재하는 인보이스 → 200 + Invoice body', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/invoices/:invoice_id',
      params: { invoice_id: 'inv-1' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.invoice_id, 'inv-1');
    assert.equal(res.body.customer_id, 'cust-1');
    assert.equal(typeof res.body.total_invariant_valid, 'boolean');
  });
});

// ── 5. PATCH /billing/invoices/:invoice_id/status ────────────────────────────
describe('[BillingController] PATCH /billing/invoices/:invoice_id/status', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({
      method: 'PATCH', path: '/billing/invoices/:invoice_id/status',
      params: { invoice_id: 'inv-1' }, body: { new_status: 'PENDING' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('billing.read만 → 403', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({
      method: 'PATCH', path: '/billing/invoices/:invoice_id/status',
      params: { invoice_id: 'inv-1' }, body: { new_status: 'PENDING' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 403);
  });

  test('billing.write → 200 + 새 상태', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({
      method: 'PATCH', path: '/billing/invoices/:invoice_id/status',
      params: { invoice_id: 'inv-1' }, body: { new_status: 'PENDING' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'PENDING');
  });

  test('DISPUTED→PAID는 billing.write로 불가 → 403', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    let inv = Invoice.create({ invoiceId: 'inv-d', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
    await invoiceRepo.save(inv);
    const res = await ctrl.handle({
      method: 'PATCH', path: '/billing/invoices/:invoice_id/status',
      params: { invoice_id: 'inv-d' }, body: { new_status: 'PAID' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 403);  // INV-B005
  });

  test('허용되지 않는 역전이 → 409', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo, 'PENDING');
    const res = await ctrl.handle({
      method: 'PATCH', path: '/billing/invoices/:invoice_id/status',
      params: { invoice_id: 'inv-1' }, body: { new_status: 'DRAFT' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 409);
  });
});

// ── 6. POST /billing/invoices/:invoice_id/line-items ─────────────────────────
describe('[BillingController] POST /billing/invoices/:invoice_id/line-items', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/invoices/:invoice_id/line-items',
      params: { invoice_id: 'inv-1' },
      body: { description: '항목', quantity: 1, unit_price: { amount: 500, currency: 'KRW' } },
      caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('billing.write → 200 + 라인 항목 추가된 Invoice', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/invoices/:invoice_id/line-items',
      params: { invoice_id: 'inv-1' },
      body: { description: '추가항목', quantity: 2, unit_price: { amount: 500, currency: 'KRW' } },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.line_items.length, 2);
    assert.equal(res.body.total.amount, 2000);  // 기존 1000 + 신규 1000
  });

  test('0원 라인 항목 → 400 (INV-B004)', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo);
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/invoices/:invoice_id/line-items',
      params: { invoice_id: 'inv-1' },
      body: { description: '무료', quantity: 1, unit_price: { amount: 0, currency: 'KRW' } },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 400);
  });
});

// ── 7. GET /billing/payments ──────────────────────────────────────────────────
describe('[BillingController] GET /billing/payments', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/payments', caller: NO_PERM });
    assert.equal(res.status, 403);
  });

  test('billing.read → 200 + 목록 구조', async () => {
    const { ctrl, paymentRepo } = makeCtrl();
    await seedPayment(paymentRepo);
    const res = await ctrl.handle({ method: 'GET', path: '/billing/payments', caller: READ_CALLER });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.equal(res.body.items.length, 1);
    assert.ok('payment_id' in res.body.items[0]);
  });
});

// ── 8. GET /billing/payments/:payment_id ─────────────────────────────────────
describe('[BillingController] GET /billing/payments/:payment_id', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/payments/:payment_id',
      params: { payment_id: 'pay-1' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('존재하지 않는 결제 → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/payments/:payment_id',
      params: { payment_id: 'nonexistent' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 404);
  });

  test('billing.read → 200 + Payment body', async () => {
    const { ctrl, paymentRepo } = makeCtrl();
    await seedPayment(paymentRepo);
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/payments/:payment_id',
      params: { payment_id: 'pay-1' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.payment_id, 'pay-1');
    assert.equal(res.body.status, 'PENDING');
  });
});

// ── 9. POST /billing/payments/:payment_id/sync ────────────────────────────────
describe('[BillingController] POST /billing/payments/:payment_id/sync', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/payments/:payment_id/sync',
      params: { payment_id: 'pay-1' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('billing.read만 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/payments/:payment_id/sync',
      params: { payment_id: 'pay-1' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 403);
  });

  test('존재하지 않는 결제 → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/payments/:payment_id/sync',
      params: { payment_id: 'nonexistent' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 404);
  });

  test('billing.write → 200 + Payment body', async () => {
    const { ctrl, paymentRepo } = makeCtrl();
    await seedPayment(paymentRepo);
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/payments/:payment_id/sync',
      params: { payment_id: 'pay-1' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.payment_id, 'pay-1');
  });
});

// ── 10. GET /billing/exceptions ───────────────────────────────────────────────
describe('[BillingController] GET /billing/exceptions', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/exceptions', caller: NO_PERM });
    assert.equal(res.status, 403);
  });

  test('billing.read만 → 403 (admin 필요)', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/exceptions', caller: READ_CALLER });
    assert.equal(res.status, 403);
  });

  test('billing.write만 → 403 (admin 필요)', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/exceptions', caller: WRITE_CALLER });
    assert.equal(res.status, 403);
  });

  test('billing.admin → 200 + 목록 구조', async () => {
    const { ctrl, exceptionRepo } = makeCtrl();
    await seedException(exceptionRepo);
    const res = await ctrl.handle({ method: 'GET', path: '/billing/exceptions', caller: ADMIN_CALLER });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.equal(res.body.items.length, 1);
    assert.ok('exception_id' in res.body.items[0]);
  });
});

// ── 11. POST /billing/exceptions/:exception_id/approve ───────────────────────
describe('[BillingController] POST /billing/exceptions/:exception_id/approve', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/approve',
      params: { exception_id: 'exc-1' }, body: { reason: '승인' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('billing.write만 → 403 (admin 필요)', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/approve',
      params: { exception_id: 'exc-1' }, body: { reason: '승인' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 403);
  });

  test('존재하지 않는 예외 항목 → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/approve',
      params: { exception_id: 'nonexistent' }, body: { reason: '승인' }, caller: ADMIN_CALLER,
    });
    assert.equal(res.status, 404);
  });

  test('billing.admin + DISPUTED 인보이스 → 200 + APPROVED exception', async () => {
    const { ctrl, invoiceRepo, exceptionRepo } = makeCtrl();
    let inv = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
    await invoiceRepo.save(inv);
    await seedException(exceptionRepo);

    const res = await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/approve',
      params: { exception_id: 'exc-1' }, body: { reason: '관리자 검토 완료' }, caller: ADMIN_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'APPROVED');
    assert.equal(res.body.exception_id, 'exc-1');
  });

  test('이미 승인된 예외 재승인 → 409', async () => {
    const { ctrl, invoiceRepo, exceptionRepo } = makeCtrl();
    let inv = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
    await invoiceRepo.save(inv);
    await seedException(exceptionRepo);

    // 1차 승인
    await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/approve',
      params: { exception_id: 'exc-1' }, body: { reason: '1차 승인' }, caller: ADMIN_CALLER,
    });
    // 2차 재승인 시도 → 409
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/approve',
      params: { exception_id: 'exc-1' }, body: { reason: '2차 시도' }, caller: ADMIN_CALLER,
    });
    assert.equal(res.status, 409);
  });
});

// ── 12. POST /billing/exceptions/:exception_id/reject ────────────────────────
describe('[BillingController] POST /billing/exceptions/:exception_id/reject', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/reject',
      params: { exception_id: 'exc-1' }, body: { reason: '거부' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('billing.admin + 존재하는 예외 → 200 + REJECTED exception', async () => {
    const { ctrl, exceptionRepo } = makeCtrl();
    await seedException(exceptionRepo);
    const res = await ctrl.handle({
      method: 'POST', path: '/billing/exceptions/:exception_id/reject',
      params: { exception_id: 'exc-1' }, body: { reason: '사유 불충분' }, caller: ADMIN_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'REJECTED');
  });
});

// ── 13. GET /billing/summary ──────────────────────────────────────────────────
describe('[BillingController] GET /billing/summary', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/summary', caller: NO_PERM });
    assert.equal(res.status, 403);
  });

  test('billing.read → 200 + 요약 구조', async () => {
    const { ctrl, invoiceRepo } = makeCtrl();
    await seedInvoice(invoiceRepo, 'PENDING');
    const res = await ctrl.handle({ method: 'GET', path: '/billing/summary', caller: READ_CALLER });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.total_invoices, 'number');
    assert.equal(typeof res.body.pending_count,  'number');
    assert.equal(typeof res.body.disputed_count, 'number');
    assert.equal(typeof res.body.open_exceptions,'number');
  });
});

// ── 14. 오류 응답 구조 검증 ──────────────────────────────────────────────────
describe('[BillingController] 오류 응답 구조', () => {
  test('403 응답에 code + message 필드 있음', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/billing/invoices', caller: NO_PERM });
    assert.equal(res.status, 403);
    assert.ok(res.body.code);
    assert.ok(res.body.message);
  });

  test('404 응답에 code + message 필드 있음', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/invoices/:invoice_id',
      params: { invoice_id: 'missing' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 404);
    assert.ok(res.body.code);
    assert.ok(res.body.message);
  });

  test('correlationId가 오류 응답에 포함됨', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/billing/invoices',
      caller: NO_PERM, correlationId: 'corr-abc-123',
    });
    assert.equal(res.body.correlation_id, 'corr-abc-123');
  });
});
