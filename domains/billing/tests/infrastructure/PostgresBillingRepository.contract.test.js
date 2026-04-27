'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { PostgresInvoiceRepository, PostgresPaymentRepository, PostgresBillingExceptionRepository } =
  require('../../src/infrastructure/PostgresBillingRepository');
const { Invoice }          = require('../../src/domain/entities/Invoice');
const { Payment }          = require('../../src/domain/entities/Payment');
const { BillingException } = require('../../src/domain/entities/BillingException');
const { Money }            = require('../../src/domain/value-objects/Money');

const NOW = new Date().toISOString();

// ── FakePgClient ──────────────────────────────────────────────────────────────

class FakePgClient {
  constructor() {
    this._store = new Map();
    this._liStore = new Map();
    this._payStore = new Map();
    this._excStore = new Map();
    this._jobStore = new Map();
  }

  async query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();

    // billing_invoices SELECT
    if (/^SELECT i\.\*/.test(s) && params.length === 1) {
      const row = this._store.get(params[0]);
      if (!row) return { rows: [] };
      const lis = [...(this._liStore.entries())]
        .filter(([, v]) => v.invoice_id === params[0])
        .map(([, v]) => v);
      return { rows: [{ ...row, line_items: lis }] };
    }
    if (/^SELECT \* FROM public\.billing_invoices WHERE id=/.test(s)) {
      const row = this._store.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO public\.billing_invoices/.test(s)) {
      const [id, customerId, status, amount, currency, dueDate, notes, createdAt, updatedAt] = params;
      this._store.set(id, { id, customer_id: customerId, status, amount, currency, due_date: dueDate, notes, created_at: createdAt, updated_at: updatedAt, version: 1 });
      return { rows: [], rowCount: 1 };
    }
    if (/DELETE FROM public\.billing_invoice_items/.test(s)) {
      for (const [k, v] of this._liStore) { if (v.invoice_id === params[0]) this._liStore.delete(k); }
      return { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO public\.billing_invoice_items/.test(s)) {
      this._liStore.set(params[0], { id: params[0], invoice_id: params[1], li_id: params[2], li_desc: params[3], li_qty: params[4], li_up_amt: params[5], li_up_cur: params[6], li_amt: params[7], li_cur: params[8] });
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT status FROM public\.billing_invoices WHERE id=/.test(s)) {
      const row = this._store.get(params[0]);
      return { rows: row ? [{ status: row.status }] : [] };
    }
    if (/DELETE FROM public\.billing_invoices WHERE id=/.test(s)) {
      this._store.delete(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\)::int AS cnt FROM public\.billing_invoices/.test(s)) {
      return { rows: [{ cnt: this._store.size }] };
    }
    if (/SELECT \* FROM public\.billing_invoices/.test(s)) {
      return { rows: [...this._store.values()] };
    }

    // billing_payments
    if (/SELECT \* FROM public\.billing_payments WHERE id=/.test(s)) {
      const row = this._payStore.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO public\.billing_payments/.test(s)) {
      const [id, invoiceId, status, amount, currency, syncedAt, mdAmt, mdCur, createdAt] = params;
      this._payStore.set(id, { id, invoice_id: invoiceId, status, amount, currency, synced_at: syncedAt, mismatch_delta_amount: mdAmt, mismatch_delta_cur: mdCur, created_at: createdAt });
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\)::int AS cnt FROM public\.billing_payments/.test(s)) {
      return { rows: [{ cnt: this._payStore.size }] };
    }
    if (/SELECT \* FROM public\.billing_payments/.test(s)) {
      return { rows: [...this._payStore.values()] };
    }

    // billing_exceptions
    if (/SELECT \* FROM public\.billing_exceptions WHERE id=/.test(s)) {
      const row = this._excStore.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO public\.billing_exceptions/.test(s)) {
      const [id, invoiceId, paymentId, excType, status, reason, approvedBy, rejectedBy, resolvedAt, createdAt] = params;
      this._excStore.set(id, { id, invoice_id: invoiceId, payment_id: paymentId, exception_type: excType, status, reason, approved_by: approvedBy, rejected_by: rejectedBy, resolved_at: resolvedAt, created_at: createdAt });
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\)::int AS cnt FROM public\.billing_exceptions/.test(s)) {
      return { rows: [{ cnt: this._excStore.size }] };
    }

    return { rows: [], rowCount: 0 };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('PostgresInvoiceRepository: client.query 없으면 TypeError', () => {
  assert.throws(() => new PostgresInvoiceRepository({ client: null }), TypeError);
});

test('PostgresInvoiceRepository: save → findById 왕복 (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresInvoiceRepository({ client });
  const inv    = new Invoice({ invoiceId: 'inv-pg1', customerId: 'c1', status: 'DRAFT', lineItems: [], currency: 'KRW', createdAt: NOW, updatedAt: NOW });
  await repo.save(inv);
  const found = await repo.findById('inv-pg1');
  assert.ok(found);
  assert.equal(found.invoiceId, 'inv-pg1');
  assert.equal(found.status.value, 'DRAFT');
});

test('PostgresInvoiceRepository: delete — PAID 거부 (INV-B003)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresInvoiceRepository({ client });
  const inv    = new Invoice({ invoiceId: 'inv-pgp', customerId: 'c1', status: 'PAID', lineItems: [], currency: 'KRW', createdAt: NOW, updatedAt: NOW });
  await repo.save(inv);
  await assert.rejects(() => repo.delete('inv-pgp'), { code: 'CONFLICT' });
});

test('PostgresPaymentRepository: save → findById 왕복 (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresPaymentRepository({ client });
  const pay    = new Payment({ paymentId: 'pay-pg1', invoiceId: 'inv-x', amount: new Money(5000, 'KRW'), status: 'PENDING', createdAt: NOW });
  await repo.save(pay);
  const found = await repo.findById('pay-pg1');
  assert.ok(found);
  assert.equal(found.paymentId, 'pay-pg1');
  assert.equal(found.amount.amount, 5000);
});

test('PostgresBillingExceptionRepository: save → findById 왕복 (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresBillingExceptionRepository({ client });
  const exc    = new BillingException({ exceptionId: 'exc-pg1', invoiceId: 'inv-x', exceptionType: 'MISMATCH', status: 'OPEN', createdAt: NOW });
  await repo.save(exc);
  const found = await repo.findById('exc-pg1');
  assert.ok(found);
  assert.equal(found.exceptionId,   'exc-pg1');
  assert.equal(found.exceptionType, 'MISMATCH');
  assert.equal(found.approvedBy,    null);
});

test('PostgresBillingExceptionRepository: approve upsert (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresBillingExceptionRepository({ client });
  const exc    = new BillingException({ exceptionId: 'exc-pg2', invoiceId: 'inv-y', exceptionType: 'DISPUTED', status: 'OPEN', createdAt: NOW });
  await repo.save(exc);
  const approved = exc.approve({ approvedBy: 'admin-1' });
  await repo.save(approved);
  const found = await repo.findById('exc-pg2');
  assert.equal(found.status,     'APPROVED');
  assert.equal(found.approvedBy, 'admin-1');
});
