//@ts-check
'use strict';

/**
 * PostgresBillingRepository — Phase 2 어댑터 스캐폴딩
 *
 * InvoiceRepository, PaymentRepository, BillingExceptionRepository 세 포트를
 * pg 클라이언트 주입 방식으로 구현한다.
 *
 * 주입 계약:
 *   client.query(sql, params) -> Promise<{ rows?: any[], rowCount?: number }>
 *
 * 전환 조건: docs/db/migration-strategy.md Phase 2
 * SQLite 동등 구현: SQLiteBillingRepository.js
 */

const { Invoice }          = require('../domain/entities/Invoice');
const { Payment }          = require('../domain/entities/Payment');
const { BillingException } = require('../domain/entities/BillingException');
const { InvoiceStatus }    = require('../domain/value-objects/InvoiceStatus');
const { Money }            = require('../domain/value-objects/Money');

// ── PostgresInvoiceRepository ─────────────────────────────────────────────────

class PostgresInvoiceRepository {
  /**
   * @param {{ client: { query: Function }, schema?: string }} deps
   */
  constructor({ client, schema = 'public' }) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('PostgresInvoiceRepository: client.query 주입 필요');
    }
    this._client = client;
    this._tbl    = `${schema}.billing_invoices`;
    this._liTbl  = `${schema}.billing_invoice_items`;
  }

  async findById(invoiceId) {
    const result = await this._client.query(
      `SELECT i.*, COALESCE(json_agg(li ORDER BY li.li_id) FILTER (WHERE li.id IS NOT NULL), '[]') AS line_items
       FROM ${this._tbl} i
       LEFT JOIN ${this._liTbl} li ON li.invoice_id = i.id
       WHERE i.id = $1
       GROUP BY i.id`,
      [invoiceId],
    );
    const row = result?.rows?.[0];
    return row ? this._rowToInvoice(row) : null;
  }

  async findAll({ status, customerId, amountMin, amountMax, dueFrom, dueTo, page = 1, pageSize = 20 } = {}) {
    const where = []; const params = []; let idx = 1;
    if (status)               { where.push(`status=$${idx++}`);      params.push(typeof status === 'string' ? status : status.value); }
    if (customerId)           { where.push(`customer_id=$${idx++}`); params.push(customerId); }
    if (amountMin !== undefined) { where.push(`amount>=$${idx++}`);  params.push(amountMin); }
    if (amountMax !== undefined) { where.push(`amount<=$${idx++}`);  params.push(amountMax); }
    if (dueFrom)              { where.push(`due_date>=$${idx++}`);   params.push(dueFrom); }
    if (dueTo)                { where.push(`due_date<=$${idx++}`);   params.push(dueTo); }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countRes = await this._client.query(`SELECT COUNT(*)::int AS cnt FROM ${this._tbl} ${whereSql}`, params);
    const total    = Number(countRes?.rows?.[0]?.cnt || 0);
    const offset   = (page - 1) * pageSize;
    const listRes  = await this._client.query(
      `SELECT * FROM ${this._tbl} ${whereSql} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset],
    );
    const items = await Promise.all((listRes?.rows || []).map((r) => this._enrichWithLineItems(r)));
    return { items, total, page, page_size: pageSize };
  }

  async save(invoice) {
    await this._client.query(
      `INSERT INTO ${this._tbl} (id,customer_id,status,amount,currency,due_date,notes,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
       ON CONFLICT(id) DO UPDATE SET
         status=EXCLUDED.status, amount=EXCLUDED.amount, currency=EXCLUDED.currency,
         due_date=EXCLUDED.due_date, notes=EXCLUDED.notes, updated_at=EXCLUDED.updated_at,
         version=${this._tbl}.version+1`,
      [invoice.invoiceId, invoice.customerId, invoice.status.value,
       invoice.total.amount, invoice.currency,
       invoice.dueDate || null, invoice.notes || null,
       invoice.createdAt, invoice.updatedAt],
    );
    await this._client.query(`DELETE FROM ${this._liTbl} WHERE invoice_id=$1`, [invoice.invoiceId]);
    for (const li of invoice.lineItems) {
      await this._client.query(
        `INSERT INTO ${this._liTbl} (id,invoice_id,li_id,li_desc,li_qty,li_up_amt,li_up_cur,li_amt,li_cur)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [`${invoice.invoiceId}:${li.lineItemId}`, invoice.invoiceId,
         li.lineItemId, li.description, li.quantity,
         li.unitPrice.amount, li.unitPrice.currency,
         li.amount.amount, li.amount.currency],
      );
    }
    return invoice;
  }

  async delete(invoiceId) {
    const res = await this._client.query(`SELECT status FROM ${this._tbl} WHERE id=$1`, [invoiceId]);
    const row = res?.rows?.[0];
    if (!row) throw Object.assign(new Error(`Invoice not found: ${invoiceId}`), { code: 'NOT_FOUND' });
    if (row.status === 'PAID') throw Object.assign(new Error('INV-B003: PAID 인보이스는 삭제할 수 없다'), { code: 'CONFLICT' });
    await this._client.query(`DELETE FROM ${this._liTbl} WHERE invoice_id=$1`, [invoiceId]);
    await this._client.query(`DELETE FROM ${this._tbl} WHERE id=$1`, [invoiceId]);
  }

  async _enrichWithLineItems(row) {
    const liRes = await this._client.query(
      `SELECT * FROM ${this._liTbl} WHERE invoice_id=$1`, [row.id],
    );
    row.line_items = liRes?.rows || [];
    return this._rowToInvoice(row);
  }

  _rowToInvoice(row) {
    const lineItems = Array.isArray(row.line_items) ? row.line_items : [];
    return new Invoice({
      invoiceId:  row.id,
      customerId: row.customer_id,
      status:     InvoiceStatus.of(row.status),
      lineItems:  lineItems.map((li) => ({
        lineItemId:  li.li_id,
        description: li.li_desc,
        quantity:    li.li_qty,
        unitPrice:   new Money(li.li_up_amt, li.li_up_cur),
        amount:      new Money(li.li_amt, li.li_cur),
      })),
      currency:   row.currency,
      dueDate:    row.due_date || null,
      notes:      row.notes   || null,
      createdAt:  row.created_at,
      updatedAt:  row.updated_at,
    });
  }
}

// ── PostgresPaymentRepository ─────────────────────────────────────────────────

class PostgresPaymentRepository {
  constructor({ client, schema = 'public' }) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('PostgresPaymentRepository: client.query 주입 필요');
    }
    this._client = client;
    this._tbl    = `${schema}.billing_payments`;
  }

  async findById(paymentId) {
    const res = await this._client.query(`SELECT * FROM ${this._tbl} WHERE id=$1`, [paymentId]);
    const row = res?.rows?.[0];
    return row ? this._rowToPayment(row) : null;
  }

  async findAll({ invoiceId, status, page = 1, pageSize = 20 } = {}) {
    const where = []; const params = []; let idx = 1;
    if (invoiceId) { where.push(`invoice_id=$${idx++}`); params.push(invoiceId); }
    if (status)    { where.push(`status=$${idx++}`);     params.push(status); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const cntRes   = await this._client.query(`SELECT COUNT(*)::int AS cnt FROM ${this._tbl} ${whereSql}`, params);
    const total    = Number(cntRes?.rows?.[0]?.cnt || 0);
    const offset   = (page - 1) * pageSize;
    const listRes  = await this._client.query(
      `SELECT * FROM ${this._tbl} ${whereSql} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset],
    );
    return { items: (listRes?.rows || []).map((r) => this._rowToPayment(r)), total, page, page_size: pageSize };
  }

  async save(payment) {
    await this._client.query(
      `INSERT INTO ${this._tbl}
         (id,invoice_id,status,amount,currency,synced_at,mismatch_delta_amount,mismatch_delta_cur,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET
         status=EXCLUDED.status, amount=EXCLUDED.amount,
         synced_at=EXCLUDED.synced_at,
         mismatch_delta_amount=EXCLUDED.mismatch_delta_amount,
         mismatch_delta_cur=EXCLUDED.mismatch_delta_cur`,
      [payment.paymentId, payment.invoiceId, payment.status,
       payment.amount.amount, payment.amount.currency,
       payment.syncedAt || null,
       payment.mismatchDelta ? payment.mismatchDelta.amount   : null,
       payment.mismatchDelta ? payment.mismatchDelta.currency : null,
       payment.createdAt],
    );
    return payment;
  }

  _rowToPayment(row) {
    return new Payment({
      paymentId:     row.id,
      invoiceId:     row.invoice_id,
      status:        row.status,
      amount:        new Money(row.amount, row.currency),
      syncedAt:      row.synced_at || null,
      mismatchDelta: row.mismatch_delta_amount !== null && row.mismatch_delta_amount !== undefined
        ? new Money(row.mismatch_delta_amount, row.mismatch_delta_cur)
        : null,
      createdAt:     row.created_at,
    });
  }
}

// ── PostgresBillingExceptionRepository ───────────────────────────────────────

class PostgresBillingExceptionRepository {
  constructor({ client, schema = 'public' }) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('PostgresBillingExceptionRepository: client.query 주입 필요');
    }
    this._client = client;
    this._tbl    = `${schema}.billing_exceptions`;
  }

  async findById(exceptionId) {
    const res = await this._client.query(`SELECT * FROM ${this._tbl} WHERE id=$1`, [exceptionId]);
    const row = res?.rows?.[0];
    return row ? this._rowToException(row) : null;
  }

  async findAll({ exceptionType, status, page = 1, pageSize = 20 } = {}) {
    const where = []; const params = []; let idx = 1;
    if (exceptionType) { where.push(`exception_type=$${idx++}`); params.push(exceptionType); }
    if (status)        { where.push(`status=$${idx++}`);         params.push(status); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const cntRes   = await this._client.query(`SELECT COUNT(*)::int AS cnt FROM ${this._tbl} ${whereSql}`, params);
    const total    = Number(cntRes?.rows?.[0]?.cnt || 0);
    const offset   = (page - 1) * pageSize;
    const listRes  = await this._client.query(
      `SELECT * FROM ${this._tbl} ${whereSql} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset],
    );
    return { items: (listRes?.rows || []).map((r) => this._rowToException(r)), total, page, page_size: pageSize };
  }

  async save(exception) {
    await this._client.query(
      `INSERT INTO ${this._tbl}
         (id,invoice_id,payment_id,exception_type,status,reason,approved_by,rejected_by,resolved_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET
         status=EXCLUDED.status, reason=EXCLUDED.reason,
         approved_by=EXCLUDED.approved_by, rejected_by=EXCLUDED.rejected_by,
         resolved_at=EXCLUDED.resolved_at`,
      [exception.exceptionId, exception.invoiceId,
       exception.paymentId || null, exception.exceptionType,
       exception.status,
       exception.reason     || null,
       exception.approvedBy || null, exception.rejectedBy || null,
       exception.resolvedAt || null, exception.createdAt],
    );
    return exception;
  }

  _rowToException(row) {
    return new BillingException({
      exceptionId:   row.id,
      invoiceId:     row.invoice_id,
      paymentId:     row.payment_id    || null,
      exceptionType: row.exception_type,
      status:        row.status,
      reason:        row.reason        || null,
      approvedBy:    row.approved_by   || null,
      rejectedBy:    row.rejected_by   || null,
      resolvedAt:    row.resolved_at   || null,
      createdAt:     row.created_at,
    });
  }
}

module.exports = {
  PostgresInvoiceRepository,
  PostgresPaymentRepository,
  PostgresBillingExceptionRepository,
};
