//@ts-check
'use strict';

/**
 * SQLiteBillingRepository — billing 도메인 SQLite 영속성 어댑터
 *
 * InvoiceRepository, PaymentRepository, BillingExceptionRepository 세 포트를
 * 하나의 DB 연결과 schema.sql로 운영한다. 각 클래스를 독립 export.
 *
 * Benchmark: SQLiteTaskRepository 패턴 (Hexagonal Architecture, node:sqlite)
 * Migration strategy: docs/db/migration-strategy.md Phase 1 (SQLite)
 */

const path = require('node:path');
const fs   = require('node:fs');

const { Invoice }          = require('../domain/entities/Invoice');
const { Payment }          = require('../domain/entities/Payment');
const { BillingException } = require('../domain/entities/BillingException');
const { InvoiceStatus }    = require('../domain/value-objects/InvoiceStatus');
const { Money }            = require('../domain/value-objects/Money');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

function openDb(dbPath) {
  if (!DatabaseSync) {
    throw new Error(
      'node:sqlite을 사용할 수 없습니다. Node.js 22.5+ 가 필요합니다.',
    );
  }
  const db = new DatabaseSync(dbPath);
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  return db;
}

// ── Invoice row ↔ entity mappers ──────────────────────────────────────────────

function rowToInvoice(row) {
  const lineItems = row.line_items ? JSON.parse(row.line_items) : [];
  const mappedItems = lineItems.map((li) => ({
    lineItemId:  li.lineItemId,
    description: li.description,
    quantity:    li.quantity,
    unitPrice:   new Money(li.unitPrice_amount, li.unitPrice_currency),
    amount:      new Money(li.amount_amount, li.amount_currency),
  }));
  return new Invoice({
    invoiceId:  row.id,
    customerId: row.customer_id,
    status:     InvoiceStatus.of(row.status),
    lineItems:  mappedItems,
    currency:   row.currency,
    dueDate:    row.due_date || null,
    notes:      row.notes || null,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  });
}

function invoiceToRow(invoice) {
  const lineItemsJson = JSON.stringify(
    invoice.lineItems.map((li) => ({
      lineItemId:          li.lineItemId,
      description:         li.description,
      quantity:            li.quantity,
      unitPrice_amount:    li.unitPrice.amount,
      unitPrice_currency:  li.unitPrice.currency,
      amount_amount:       li.amount.amount,
      amount_currency:     li.amount.currency,
    })),
  );
  return {
    id:          invoice.invoiceId,
    customer_id: invoice.customerId,
    status:      invoice.status.value,
    amount:      invoice.total.amount,
    currency:    invoice.currency,
    due_date:    invoice.dueDate || null,
    notes:       invoice.notes || null,
    line_items:  lineItemsJson,
    created_at:  invoice.createdAt,
    updated_at:  invoice.updatedAt,
  };
}

// ── SQLiteInvoiceRepository ───────────────────────────────────────────────────

class SQLiteInvoiceRepository {
  /** @param {object} db */
  constructor(db) {
    this._db = db;
  }

  static create(dbPath = ':memory:') {
    return new SQLiteInvoiceRepository(openDb(dbPath));
  }

  async findById(invoiceId) {
    const row = this._db.prepare(
      'SELECT *, (SELECT json_group_array(json_object(' +
      "'lineItemId',li_id,'description',li_desc,'quantity',li_qty," +
      "'unitPrice_amount',li_up_amt,'unitPrice_currency',li_up_cur,'amount_amount',li_amt,'amount_currency',li_cur" +
      ')) FROM billing_invoice_items WHERE invoice_id=billing_invoices.id) AS line_items ' +
      'FROM billing_invoices WHERE id=?',
    ).get(invoiceId);
    if (!row) return null;
    return rowToInvoice(row);
  }

  async findAll({ status, customerId, amountMin, amountMax, dueFrom, dueTo, page = 1, pageSize = 20 } = {}) {
    const conditions = [];
    const params = [];
    if (status)               { conditions.push('status=?');         params.push(typeof status === 'string' ? status : status.value); }
    if (customerId)           { conditions.push('customer_id=?');    params.push(customerId); }
    if (amountMin !== undefined) { conditions.push('amount>=?');     params.push(amountMin); }
    if (amountMax !== undefined) { conditions.push('amount<=?');     params.push(amountMax); }
    if (dueFrom)              { conditions.push('due_date>=?');      params.push(dueFrom); }
    if (dueTo)                { conditions.push('due_date<=?');      params.push(dueTo); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const total = this._db.prepare(`SELECT COUNT(*) AS cnt FROM billing_invoices ${where}`).get(...params).cnt;
    const offset = (page - 1) * pageSize;
    const rows = this._db.prepare(
      `SELECT * FROM billing_invoices ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, offset);

    return { items: rows.map(rowToInvoice), total, page, page_size: pageSize };
  }

  async save(invoice) {
    const row = invoiceToRow(invoice);
    this._db.prepare(`
      INSERT INTO billing_invoices (id,customer_id,status,amount,currency,due_date,notes,created_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, amount=excluded.amount, currency=excluded.currency,
        due_date=excluded.due_date, notes=excluded.notes, updated_at=excluded.updated_at,
        version=version+1
    `).run(row.id, row.customer_id, row.status, row.amount, row.currency, row.due_date, row.notes, row.created_at, row.updated_at);

    // upsert line items
    this._db.prepare('DELETE FROM billing_invoice_items WHERE invoice_id=?').run(invoice.invoiceId);
    for (const li of invoice.lineItems) {
      this._db.prepare(`
        INSERT INTO billing_invoice_items
          (id,invoice_id,li_id,li_desc,li_qty,li_up_amt,li_up_cur,li_amt,li_cur)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        `${invoice.invoiceId}:${li.lineItemId}`, invoice.invoiceId,
        li.lineItemId, li.description, li.quantity,
        li.unitPrice.amount, li.unitPrice.currency,
        li.amount.amount, li.amount.currency,
      );
    }
    return invoice;
  }

  async delete(invoiceId) {
    const row = this._db.prepare('SELECT status FROM billing_invoices WHERE id=?').get(invoiceId);
    if (!row) throw Object.assign(new Error(`Invoice not found: ${invoiceId}`), { code: 'NOT_FOUND' });
    if (row.status === 'PAID') {
      throw Object.assign(new Error('INV-B003: PAID 인보이스는 삭제할 수 없다'), { code: 'CONFLICT' });
    }
    this._db.prepare('DELETE FROM billing_invoice_items WHERE invoice_id=?').run(invoiceId);
    this._db.prepare('DELETE FROM billing_invoices WHERE id=?').run(invoiceId);
  }
}

// ── SQLitePaymentRepository ───────────────────────────────────────────────────

class SQLitePaymentRepository {
  constructor(db) { this._db = db; }
  static create(dbPath = ':memory:') { return new SQLitePaymentRepository(openDb(dbPath)); }

  _rowToPayment(row) {
    return new Payment({
      paymentId:      row.id,
      invoiceId:      row.invoice_id,
      status:         row.status,
      amount:         new Money(row.amount, row.currency),
      syncedAt:       row.synced_at || null,
      mismatchDelta:  row.mismatch_delta_amount !== null && row.mismatch_delta_amount !== undefined
        ? new Money(row.mismatch_delta_amount, row.mismatch_delta_cur)
        : null,
      createdAt:      row.created_at,
    });
  }

  async findById(paymentId) {
    const row = this._db.prepare('SELECT * FROM billing_payments WHERE id=?').get(paymentId);
    return row ? this._rowToPayment(row) : null;
  }

  async findAll({ invoiceId, status, page = 1, pageSize = 20 } = {}) {
    const conditions = [];
    const params = [];
    if (invoiceId) { conditions.push('invoice_id=?'); params.push(invoiceId); }
    if (status)    { conditions.push('status=?');     params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const total = this._db.prepare(`SELECT COUNT(*) AS cnt FROM billing_payments ${where}`).get(...params).cnt;
    const offset = (page - 1) * pageSize;
    const rows = this._db.prepare(
      `SELECT * FROM billing_payments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, offset);
    return { items: rows.map((r) => this._rowToPayment(r)), total, page, page_size: pageSize };
  }

  async save(payment) {
    this._db.prepare(`
      INSERT INTO billing_payments
        (id,invoice_id,status,amount,currency,synced_at,mismatch_delta_amount,mismatch_delta_cur,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, amount=excluded.amount,
        synced_at=excluded.synced_at,
        mismatch_delta_amount=excluded.mismatch_delta_amount,
        mismatch_delta_cur=excluded.mismatch_delta_cur
    `).run(
      payment.paymentId, payment.invoiceId,
      payment.status,
      payment.amount.amount, payment.amount.currency,
      payment.syncedAt || null,
      payment.mismatchDelta ? payment.mismatchDelta.amount : null,
      payment.mismatchDelta ? payment.mismatchDelta.currency : null,
      payment.createdAt,
    );
    return payment;
  }
}

// ── SQLiteBillingExceptionRepository ─────────────────────────────────────────

class SQLiteBillingExceptionRepository {
  constructor(db) { this._db = db; }
  static create(dbPath = ':memory:') { return new SQLiteBillingExceptionRepository(openDb(dbPath)); }

  _rowToException(row) {
    return new BillingException({
      exceptionId:   row.id,
      invoiceId:     row.invoice_id,
      paymentId:     row.payment_id || null,
      exceptionType: row.exception_type,
      status:        row.status,
      reason:        row.reason || null,
      approvedBy:    row.approved_by || null,
      rejectedBy:    row.rejected_by || null,
      resolvedAt:    row.resolved_at || null,
      createdAt:     row.created_at,
    });
  }

  async findById(exceptionId) {
    const row = this._db.prepare('SELECT * FROM billing_exceptions WHERE id=?').get(exceptionId);
    return row ? this._rowToException(row) : null;
  }

  async findAll({ exceptionType, status, page = 1, pageSize = 20 } = {}) {
    const conditions = [];
    const params = [];
    if (exceptionType) { conditions.push('exception_type=?'); params.push(exceptionType); }
    if (status)        { conditions.push('status=?');         params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const total = this._db.prepare(`SELECT COUNT(*) AS cnt FROM billing_exceptions ${where}`).get(...params).cnt;
    const offset = (page - 1) * pageSize;
    const rows = this._db.prepare(
      `SELECT * FROM billing_exceptions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, offset);
    return { items: rows.map((r) => this._rowToException(r)), total, page, page_size: pageSize };
  }

  async save(exception) {
    this._db.prepare(`
      INSERT INTO billing_exceptions
        (id,invoice_id,payment_id,exception_type,status,reason,approved_by,rejected_by,resolved_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, reason=excluded.reason,
        approved_by=excluded.approved_by, rejected_by=excluded.rejected_by,
        resolved_at=excluded.resolved_at
    `).run(
      exception.exceptionId, exception.invoiceId,
      exception.paymentId || null, exception.exceptionType,
      exception.status,
      exception.reason || null,
      exception.approvedBy || null, exception.rejectedBy || null,
      exception.resolvedAt || null, exception.createdAt,
    );
    return exception;
  }
}

module.exports = {
  SQLiteInvoiceRepository,
  SQLitePaymentRepository,
  SQLiteBillingExceptionRepository,
};
