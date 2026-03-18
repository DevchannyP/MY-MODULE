'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { BillingController }                   = require('../../src/interface/BillingController');
const { InMemoryInvoiceRepository }           = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryPaymentRepository }           = require('../../src/infrastructure/InMemoryPaymentRepository');
const { InMemoryBillingExceptionRepository }  = require('../../src/infrastructure/InMemoryBillingExceptionRepository');
const { Invoice }                             = require('../../src/domain/entities/Invoice');
const { Payment }                             = require('../../src/domain/entities/Payment');
const { Money }                               = require('../../src/domain/value-objects/Money');

function makeCtrl() {
  const invoiceRepo = new InMemoryInvoiceRepository();
  const paymentRepo = new InMemoryPaymentRepository();
  const exceptionRepo = new InMemoryBillingExceptionRepository();
  return {
    ctrl: new BillingController({ invoiceRepo, paymentRepo, exceptionRepo }),
    invoiceRepo,
    paymentRepo,
  };
}

const READ_CALLER = { permissions: ['billing.read'], userId: 'reader-1' };
const NO_PERM = { permissions: [], userId: 'nobody-1' };

async function seedInvoice(repo) {
  let invoice = Invoice.create({ invoiceId: 'inv-smoke-1', customerId: 'cust-1' });
  invoice = invoice.addLineItem({
    lineItemId: 'li-smoke-1',
    description: 'smoke-line',
    quantity: 1,
    unitPrice: new Money(1000, 'KRW'),
  });
  await repo.save(invoice);
}

async function seedPayment(repo) {
  const payment = Payment.create({
    paymentId: 'pay-smoke-1',
    invoiceId: 'inv-smoke-1',
    amount: new Money(1000, 'KRW'),
  });
  await repo.save(payment);
}

test('[billing smoke] 인보이스 목록 조회 성공', async () => {
  const { ctrl, invoiceRepo } = makeCtrl();
  await seedInvoice(invoiceRepo);
  const res = await ctrl.handle({
    method: 'GET',
    path: '/billing/invoices',
    caller: READ_CALLER,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);
});

test('[billing smoke] 권한 없는 인보이스 생성 거부', async () => {
  const { ctrl } = makeCtrl();
  const res = await ctrl.handle({
    method: 'POST',
    path: '/billing/invoices',
    body: { customer_id: 'cust-1' },
    caller: NO_PERM,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('[billing smoke] 존재하지 않는 결제 조회는 404', async () => {
  const { ctrl, paymentRepo, invoiceRepo } = makeCtrl();
  await seedInvoice(invoiceRepo);
  await seedPayment(paymentRepo);
  const res = await ctrl.handle({
    method: 'GET',
    path: '/billing/payments/:payment_id',
    params: { payment_id: 'missing-payment' },
    caller: READ_CALLER,
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});
