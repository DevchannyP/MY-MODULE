// @ts-check
'use strict';

/** @typedef {import('../../domain/entities/BillingException').BillingException} BillingException */
/** @typedef {{ exceptionType?: string, status?: string, page?: number, pageSize?: number }} BillingExceptionQuery */

class BillingExceptionRepository {
  /**
   * @param {string} _exceptionId
   * @returns {Promise<BillingException|null>}
   */
  async findById(_exceptionId) { throw new Error('Not implemented'); }

  /**
   * @param {BillingExceptionQuery} [_query]
   * @returns {Promise<{items: BillingException[], total: number, page?: number, page_size?: number}>}
   */
  async findAll({ exceptionType: _t, status: _s, page: _p, pageSize: _ps } = {}) { throw new Error('Not implemented'); }

  /**
   * @param {BillingException} _billingException
   * @returns {Promise<BillingException>}
   */
  async save(_billingException) { throw new Error('Not implemented'); }
}

module.exports = { BillingExceptionRepository };
