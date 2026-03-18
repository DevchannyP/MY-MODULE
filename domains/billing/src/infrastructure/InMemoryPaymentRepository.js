'use strict';

class InMemoryPaymentRepository {
  constructor() { this._store = new Map(); }

  async findById(paymentId) { return this._store.get(paymentId) || null; }

  async findAll({ invoiceId, status, page = 1, pageSize = 20 } = {}) {
    let items = Array.from(this._store.values());
    if (invoiceId) items = items.filter(p => p.invoiceId === invoiceId);
    if (status)    items = items.filter(p => p.status === status);

    const total  = items.length;
    const paged  = items.slice((page - 1) * pageSize, page * pageSize);
    return { items: paged, total, page, page_size: pageSize };
  }

  async save(payment) { this._store.set(payment.paymentId, payment); return payment; }
  clear() { this._store.clear(); }
}

module.exports = { InMemoryPaymentRepository };
