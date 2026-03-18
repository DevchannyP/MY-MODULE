'use strict';

// 인메모리 구현체 — Invoice/InvoiceStatus/Money 타입은 런타임에서 직접 사용하지 않고
// 저장된 엔티티 인스턴스 그대로 반환한다. JSDoc 타입 힌트용 주석만 유지.
// @type {import('../domain/entities/Invoice').Invoice}

/**
 * InMemoryInvoiceRepository — 테스트·개발용 인메모리 구현체
 * INV-B003: PAID 인보이스 삭제 시 오류 발생
 */
class InMemoryInvoiceRepository {
  constructor() {
    this._store = new Map();
  }

  async findById(invoiceId) {
    return this._store.get(invoiceId) || null;
  }

  async findAll({ status, customerId, amountMin, amountMax, dueFrom, dueTo, page = 1, pageSize = 20 } = {}) {
    let items = Array.from(this._store.values());

    if (status)     items = items.filter(i => i.status.equals(status));
    if (customerId) items = items.filter(i => i.customerId === customerId);
    if (amountMin !== undefined) items = items.filter(i => i.total.amount >= amountMin);
    if (amountMax !== undefined) items = items.filter(i => i.total.amount <= amountMax);
    if (dueFrom)    items = items.filter(i => i.dueDate && i.dueDate >= dueFrom);
    if (dueTo)      items = items.filter(i => i.dueDate && i.dueDate <= dueTo);

    const total  = items.length;
    const offset = (page - 1) * pageSize;
    const paged  = items.slice(offset, offset + pageSize);

    return { items: paged, total, page, page_size: pageSize };
  }

  async save(invoice) {
    this._store.set(invoice.invoiceId, invoice);
    return invoice;
  }

  async delete(invoiceId) {
    const invoice = this._store.get(invoiceId);
    if (!invoice) throw Object.assign(new Error(`Invoice not found: ${invoiceId}`), { code: 'NOT_FOUND' });
    if (invoice.status.equals('PAID')) {
      throw Object.assign(new Error('INV-B003: PAID 인보이스는 삭제할 수 없다'), { code: 'CONFLICT' });
    }
    this._store.delete(invoiceId);
  }

  /** 테스트 헬퍼 */
  clear() { this._store.clear(); }
  size()  { return this._store.size; }
}

module.exports = { InMemoryInvoiceRepository };
