// @ts-check
'use strict';

/** @typedef {import('../../domain/entities/Invoice').Invoice} Invoice */
/** @typedef {{ status?: string, customerId?: string, amountMin?: number, amountMax?: number, dueFrom?: string, dueTo?: string, page?: number, pageSize?: number }} InvoiceQuery */

/**
 * InvoiceRepository Port (인터페이스 선언)
 * 도메인 코어는 이 인터페이스만 알고, 구현체(DB/In-Memory)는 모른다.
 */
class InvoiceRepository {
  /**
   * @param {string} _invoiceId
   * @returns {Promise<Invoice|null>}
   */
  async findById(_invoiceId) { throw new Error('Not implemented'); }

  /**
   * @param {InvoiceQuery} [_query]
   * @returns {Promise<{items: Invoice[], total: number, page?: number, page_size?: number}>}
   */
  async findAll({ status: _s, customerId: _c, amountMin: _min, amountMax: _max, dueFrom: _df, dueTo: _dt, page: _p, pageSize: _ps } = {}) {
    throw new Error('Not implemented');
  }

  /**
   * @param {Invoice} _invoice
   * @returns {Promise<Invoice>}
   */
  async save(_invoice) { throw new Error('Not implemented'); }

  /**
   * INV-B003: PAID 인보이스 삭제 불가 — 구현체는 이 규칙을 강제해야 한다.
   * @param {string} _invoiceId
   * @returns {Promise<void>}
   */
  async delete(_invoiceId) { throw new Error('Not implemented'); }
}

module.exports = { InvoiceRepository };
