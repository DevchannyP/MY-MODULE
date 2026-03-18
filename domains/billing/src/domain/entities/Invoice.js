// @ts-check
'use strict';

const { InvoiceStatus } = require('../value-objects/InvoiceStatus');
const { Money }         = require('../value-objects/Money');

/**
 * @typedef {{
 *   lineItemId: string,
 *   description: string,
 *   quantity: number,
 *   unitPrice: import('../value-objects/Money').Money,
 *   amount: import('../value-objects/Money').Money,
 * }} InvoiceLineItem
 */
/**
 * @typedef {{
 *   invoiceId: string,
 *   customerId: string,
 *   status: string|import('../value-objects/InvoiceStatus').InvoiceStatus,
 *   lineItems?: InvoiceLineItem[],
 *   dueDate?: string|null,
 *   notes?: string|null,
 *   createdAt: string,
 *   updatedAt: string,
 * }} InvoiceSnapshot
 */
/**
 * @typedef {{
 *   invoiceId: string,
 *   customerId: string,
 *   dueDate?: string|null,
 *   notes?: string|null,
 * }} CreateInvoiceInput
 */

/**
 * Invoice Entity — 정산관리 핵심 집계 루트
 *
 * 불변조건:
 *   INV-B001: total = sum(lineItems[i].amount)
 *   INV-B002: 허용된 상태 전이만 가능
 *   INV-B003: PAID 인보이스 삭제 불가 (Repository 계층에서도 검사)
 *   INV-B004: lineItem.amount > 0
 */
class Invoice {
  /**
   * @param {InvoiceSnapshot} param0
   */
  constructor({ invoiceId, customerId, status, lineItems, dueDate, notes, createdAt, updatedAt }) {
    this.invoiceId  = invoiceId;
    this.customerId = customerId;
    this.status     = status instanceof InvoiceStatus ? status : InvoiceStatus.of(status);
    // 외부 변형 방어: 복사 후 동결
    this.lineItems  = Object.freeze([...(lineItems || [])]);
    this.dueDate    = dueDate || null;
    this.notes      = notes   || null;
    this.createdAt  = createdAt;
    this.updatedAt  = updatedAt;
  }

  /**
   * INV-B001: 합계 계산 (라인 항목의 합이 언제나 total)
   * total은 저장된 필드가 아니라 계산값이다.
   */
  get total() {
    if (this.lineItems.length === 0) return Money.zero('KRW');
    return this.lineItems.reduce(
      (acc, item) => acc.add(item.amount),
      Money.zero(this.lineItems[0].amount.currency)
    );
  }

  /**
   * INV-B001 검증 헬퍼.
   * 외부에서 선언된 total과 계산된 total을 비교할 때 사용한다.
   * @param {import('../value-objects/Money').Money} declaredTotal
   * @returns {boolean}
   */
  isTotalValid(declaredTotal) {
    return this.total.equals(declaredTotal);
  }

  /**
   * 라인 항목 추가 (DRAFT 상태에서만 허용)
   * INV-B004: amount > 0 검사
   * @param {{ lineItemId: string, description: string, quantity: number, unitPrice: import('../value-objects/Money').Money }} param0
   * @returns {Invoice}
   */
  addLineItem({ lineItemId, description, quantity, unitPrice }) {
    if (!this.status.equals('DRAFT')) {
      throw new Error('INV-B002: 라인 항목은 DRAFT 상태에서만 추가할 수 있다');
    }
    if (!(unitPrice instanceof Money)) throw new Error('unitPrice must be a Money instance');
    if (!unitPrice.isPositive()) {
      throw new Error('INV-B004: 라인 항목 단가는 0 초과여야 한다');
    }
    if (typeof quantity !== 'number' || quantity < 1) {
      throw new Error('quantity must be >= 1');
    }

    const amount = new Money(unitPrice.amount * quantity, unitPrice.currency);
    const item   = { lineItemId, description, quantity, unitPrice, amount };
    return new Invoice({
      ...this._snapshot(),
      lineItems: [...this.lineItems, item],
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * INV-B002: 상태 전이
   * DISPUTED→PAID는 서비스 계층에서 관리자 승인을 먼저 검사해야 한다.
   * @param {string|import('../value-objects/InvoiceStatus').InvoiceStatus} nextStatus
   * @returns {Invoice}
   */
  transitionTo(nextStatus) {
    const next = nextStatus instanceof InvoiceStatus ? nextStatus : InvoiceStatus.of(nextStatus);
    if (!this.status.canTransitionTo(next)) {
      throw new Error(
        `INV-B002: ${this.status.value} → ${next.value} 전이는 허용되지 않는다`
      );
    }
    return new Invoice({
      ...this._snapshot(),
      status:    next,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * @returns {InvoiceSnapshot}
   */
  _snapshot() {
    return {
      invoiceId:  this.invoiceId,
      customerId: this.customerId,
      status:     this.status,
      lineItems:  this.lineItems,
      dueDate:    this.dueDate,
      notes:      this.notes,
      createdAt:  this.createdAt,
      updatedAt:  this.updatedAt,
    };
  }

  /**
   * @returns {object}
   */
  toJSON() {
    return {
      invoice_id:            this.invoiceId,
      customer_id:           this.customerId,
      status:                this.status.toJSON(),
      total:                 this.total.toJSON(),
      total_invariant_valid: true,   // by construction — total is always computed
      line_items:            this.lineItems.map(li => ({
        line_item_id: li.lineItemId,
        description:  li.description,
        quantity:     li.quantity,
        unit_price:   li.unitPrice.toJSON(),
        amount:       li.amount.toJSON(),
      })),
      due_date:   this.dueDate,
      notes:      this.notes,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
    };
  }

  /**
   * 팩토리: 신규 인보이스 생성 (항상 DRAFT)
   * @param {CreateInvoiceInput} param0
   * @returns {Invoice}
   */
  static create({ invoiceId, customerId, dueDate, notes }) {
    if (!customerId) throw new Error('customerId is required');
    const now = new Date().toISOString();
    return new Invoice({
      invoiceId,
      customerId,
      status:    InvoiceStatus.DRAFT,
      lineItems: [],
      dueDate:   dueDate || null,
      notes:     notes   || null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

module.exports = { Invoice };
