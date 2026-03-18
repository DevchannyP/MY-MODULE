'use strict';

class InMemoryBillingExceptionRepository {
  constructor() { this._store = new Map(); }

  async findById(exceptionId) { return this._store.get(exceptionId) || null; }

  async findAll({ exceptionType, status, page = 1, pageSize = 20 } = {}) {
    let items = Array.from(this._store.values());
    if (exceptionType) items = items.filter(e => e.exceptionType === exceptionType);
    if (status)        items = items.filter(e => e.status === status);

    const total = items.length;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);
    return { items: paged, total, page, page_size: pageSize };
  }

  async save(exception) { this._store.set(exception.exceptionId, exception); return exception; }
  clear() { this._store.clear(); }
}

module.exports = { InMemoryBillingExceptionRepository };
