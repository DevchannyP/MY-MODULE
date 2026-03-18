'use strict';

/**
 * Money value object
 * INV-B004: amount > 0 (라인 항목 금액은 양수여야 한다)
 */
class Money {
  constructor(amount, currency) {
    if (typeof amount !== 'number' || !isFinite(amount)) {
      throw new Error('Money amount must be a finite number');
    }
    if (typeof currency !== 'string' || currency.length !== 3) {
      throw new Error('Money currency must be a 3-character string (e.g. KRW)');
    }
    this._amount = amount;
    this._currency = currency.toUpperCase();
    Object.freeze(this);
  }

  get amount() { return this._amount; }
  get currency() { return this._currency; }

  /** 양수 여부 검사 (INV-B004 적용 지점) */
  isPositive() {
    return this._amount > 0;
  }

  add(other) {
    this._assertSameCurrency(other);
    return new Money(this._amount + other.amount, this._currency);
  }

  subtract(other) {
    this._assertSameCurrency(other);
    return new Money(this._amount - other.amount, this._currency);
  }

  equals(other) {
    if (!(other instanceof Money)) return false;
    return this._amount === other.amount && this._currency === other.currency;
  }

  /** 두 금액의 차이 (항상 양수) */
  delta(other) {
    this._assertSameCurrency(other);
    return new Money(Math.abs(this._amount - other.amount), this._currency);
  }

  _assertSameCurrency(other) {
    if (!(other instanceof Money)) throw new Error('Expected a Money instance');
    if (this._currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this._currency} vs ${other.currency}`);
    }
  }

  toJSON() {
    return { amount: this._amount, currency: this._currency };
  }

  static fromJSON({ amount, currency }) {
    return new Money(amount, currency);
  }

  static zero(currency) {
    return new Money(0, currency);
  }
}

module.exports = { Money };
