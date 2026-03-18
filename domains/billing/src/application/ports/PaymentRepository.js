// @ts-check
'use strict';

/** @typedef {import('../../domain/entities/Payment').Payment} Payment */
/** @typedef {{ invoiceId?: string, status?: string, page?: number, pageSize?: number }} PaymentQuery */

class PaymentRepository {
  /**
   * @param {string} _paymentId
   * @returns {Promise<Payment|null>}
   */
  async findById(_paymentId) { throw new Error('Not implemented'); }

  /**
   * @param {PaymentQuery} [_query]
   * @returns {Promise<{items: Payment[], total: number, page?: number, page_size?: number}>}
   */
  async findAll({ invoiceId: _i, status: _s, page: _p, pageSize: _ps } = {}) { throw new Error('Not implemented'); }

  /**
   * @param {Payment} _payment
   * @returns {Promise<Payment>}
   */
  async save(_payment) { throw new Error('Not implemented'); }
}

module.exports = { PaymentRepository };
