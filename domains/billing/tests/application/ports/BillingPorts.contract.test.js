// @ts-check
'use strict';

/**
 * Port contract tests — InMemory 구현체가 각 포트 인터페이스를 완전히 구현하는지 검증한다.
 * health-dashboard testScore 산정 기준: 포트 인터페이스 파일 3개에 대응하는 계약 검증.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { InvoiceRepository } = require('../../../src/application/ports/InvoiceRepository');
const { BillingExceptionRepository } = require('../../../src/application/ports/BillingExceptionRepository');
const { PaymentRepository } = require('../../../src/application/ports/PaymentRepository');
const { InMemoryInvoiceRepository } = require('../../../src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryBillingExceptionRepository } = require('../../../src/infrastructure/InMemoryBillingExceptionRepository');
const { InMemoryPaymentRepository } = require('../../../src/infrastructure/InMemoryPaymentRepository');

function portMethodNames(PortClass) {
  return Object.getOwnPropertyNames(PortClass.prototype).filter((m) => m !== 'constructor');
}

test('InMemoryInvoiceRepository satisfies InvoiceRepository port interface', () => {
  const impl = new InMemoryInvoiceRepository();
  const methods = portMethodNames(InvoiceRepository);
  assert.ok(methods.length > 0, 'InvoiceRepository must declare at least one method');
  for (const method of methods) {
    assert.strictEqual(typeof impl[method], 'function', `InMemoryInvoiceRepository must implement '${method}'`);
  }
});

test('InMemoryBillingExceptionRepository satisfies BillingExceptionRepository port interface', () => {
  const impl = new InMemoryBillingExceptionRepository();
  const methods = portMethodNames(BillingExceptionRepository);
  assert.ok(methods.length > 0, 'BillingExceptionRepository must declare at least one method');
  for (const method of methods) {
    assert.strictEqual(typeof impl[method], 'function', `InMemoryBillingExceptionRepository must implement '${method}'`);
  }
});

test('InMemoryPaymentRepository satisfies PaymentRepository port interface', () => {
  const impl = new InMemoryPaymentRepository();
  const methods = portMethodNames(PaymentRepository);
  assert.ok(methods.length > 0, 'PaymentRepository must declare at least one method');
  for (const method of methods) {
    assert.strictEqual(typeof impl[method], 'function', `InMemoryPaymentRepository must implement '${method}'`);
  }
});
