'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { SQLiteInvoiceRepository, SQLitePaymentRepository, SQLiteBillingExceptionRepository } =
  require('../../src/infrastructure/SQLiteBillingRepository');
const { Invoice }          = require('../../src/domain/entities/Invoice');
const { Payment }          = require('../../src/domain/entities/Payment');
const { BillingException } = require('../../src/domain/entities/BillingException');
const { Money }            = require('../../src/domain/value-objects/Money');

const NOW = new Date().toISOString();

function makeInvoice(id = 'inv-001', status = 'DRAFT') {
  return new Invoice({
    invoiceId:  id,
    customerId: 'cust-1',
    status,
    lineItems:  [],
    currency:   'KRW',
    createdAt:  NOW,
    updatedAt:  NOW,
  });
}

// ── SQLiteInvoiceRepository ───────────────────────────────────────────────────

test('SQLiteInvoiceRepository: save → findById 왕복', async () => {
  const repo    = SQLiteInvoiceRepository.create(':memory:');
  const invoice = makeInvoice();
  await repo.save(invoice);
  const found = await repo.findById('inv-001');
  assert.ok(found);
  assert.equal(found.invoiceId,  'inv-001');
  assert.equal(found.customerId, 'cust-1');
  assert.equal(found.status.value, 'DRAFT');
});

test('SQLiteInvoiceRepository: findById 없으면 null', async () => {
  const repo = SQLiteInvoiceRepository.create(':memory:');
  const found = await repo.findById('nonexistent');
  assert.equal(found, null);
});

test('SQLiteInvoiceRepository: findAll 페이지네이션', async () => {
  const repo = SQLiteInvoiceRepository.create(':memory:');
  await repo.save(makeInvoice('inv-1'));
  await repo.save(makeInvoice('inv-2'));
  await repo.save(makeInvoice('inv-3', 'PENDING'));

  const all    = await repo.findAll();
  assert.equal(all.total, 3);

  const pending = await repo.findAll({ status: 'PENDING' });
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0].invoiceId, 'inv-3');

  const paged = await repo.findAll({ page: 1, pageSize: 2 });
  assert.equal(paged.items.length, 2);
  assert.equal(paged.page_size, 2);
});

test('SQLiteInvoiceRepository: upsert — status 갱신', async () => {
  const repo    = SQLiteInvoiceRepository.create(':memory:');
  const invoice = makeInvoice();
  await repo.save(invoice);
  const updated = new Invoice({
    ...invoice,
    status:    'PENDING',
    updatedAt: new Date().toISOString(),
  });
  await repo.save(updated);
  const found = await repo.findById('inv-001');
  assert.equal(found.status.value, 'PENDING');
});

test('SQLiteInvoiceRepository: delete — PAID는 삭제 불가 (INV-B003)', async () => {
  const repo    = SQLiteInvoiceRepository.create(':memory:');
  const invoice = makeInvoice('inv-paid', 'PAID');
  await repo.save(invoice);
  await assert.rejects(() => repo.delete('inv-paid'), { code: 'CONFLICT' });
});

test('SQLiteInvoiceRepository: delete — DRAFT는 삭제 가능', async () => {
  const repo    = SQLiteInvoiceRepository.create(':memory:');
  const invoice = makeInvoice('inv-del');
  await repo.save(invoice);
  await repo.delete('inv-del');
  const found = await repo.findById('inv-del');
  assert.equal(found, null);
});

// ── SQLitePaymentRepository ───────────────────────────────────────────────────

test('SQLitePaymentRepository: save → findById 왕복', async () => {
  const invRepo = SQLiteInvoiceRepository.create(':memory:');
  const db      = invRepo._db;
  const repo    = new SQLitePaymentRepository(db);

  await invRepo.save(makeInvoice('inv-p1'));
  const payment = new Payment({
    paymentId: 'pay-001',
    invoiceId: 'inv-p1',
    amount:    new Money(10000, 'KRW'),
    status:    'PENDING',
    createdAt: NOW,
  });
  await repo.save(payment);
  const found = await repo.findById('pay-001');
  assert.ok(found);
  assert.equal(found.paymentId, 'pay-001');
  assert.equal(found.amount.amount, 10000);
  assert.equal(found.status, 'PENDING');
});

test('SQLitePaymentRepository: findAll by invoiceId', async () => {
  const invRepo = SQLiteInvoiceRepository.create(':memory:');
  const db      = invRepo._db;
  const repo    = new SQLitePaymentRepository(db);

  await invRepo.save(makeInvoice('inv-q1'));
  const p1 = new Payment({ paymentId: 'pay-q1', invoiceId: 'inv-q1', amount: new Money(5000, 'KRW'), status: 'PENDING', createdAt: NOW });
  const p2 = new Payment({ paymentId: 'pay-q2', invoiceId: 'inv-q1', amount: new Money(5000, 'KRW'), status: 'SUCCESS', createdAt: NOW });
  await repo.save(p1);
  await repo.save(p2);

  const result = await repo.findAll({ invoiceId: 'inv-q1' });
  assert.equal(result.total, 2);

  const success = await repo.findAll({ status: 'SUCCESS' });
  assert.equal(success.total, 1);
});

// ── SQLiteBillingExceptionRepository ─────────────────────────────────────────

test('SQLiteBillingExceptionRepository: save → findById 왕복', async () => {
  const invRepo = SQLiteInvoiceRepository.create(':memory:');
  const db      = invRepo._db;
  const repo    = new SQLiteBillingExceptionRepository(db);

  await invRepo.save(makeInvoice('inv-e1'));
  const exc = new BillingException({
    exceptionId:   'exc-001',
    invoiceId:     'inv-e1',
    exceptionType: 'MISMATCH',
    status:        'OPEN',
    createdAt:     NOW,
  });
  await repo.save(exc);
  const found = await repo.findById('exc-001');
  assert.ok(found);
  assert.equal(found.exceptionId,   'exc-001');
  assert.equal(found.exceptionType, 'MISMATCH');
  assert.equal(found.status,        'OPEN');
  assert.equal(found.approvedBy,    null);
});

test('SQLiteBillingExceptionRepository: approve 후 upsert', async () => {
  const invRepo = SQLiteInvoiceRepository.create(':memory:');
  const db      = invRepo._db;
  const repo    = new SQLiteBillingExceptionRepository(db);

  await invRepo.save(makeInvoice('inv-e2'));
  const exc = new BillingException({
    exceptionId:   'exc-002',
    invoiceId:     'inv-e2',
    exceptionType: 'DISPUTED',
    status:        'OPEN',
    createdAt:     NOW,
  });
  await repo.save(exc);
  const approved = exc.approve({ approvedBy: 'admin-1' });
  await repo.save(approved);
  const found = await repo.findById('exc-002');
  assert.equal(found.status,     'APPROVED');
  assert.equal(found.approvedBy, 'admin-1');
  assert.ok(found.resolvedAt);
});
