'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { CreateInvoiceUseCase }      = require('../../src/application/CreateInvoiceUseCase');
const { InMemoryInvoiceRepository } = require('../../src/infrastructure/InMemoryInvoiceRepository');

describe('CreateInvoiceUseCase', () => {
  const makeUseCase = () => {
    const repo      = new InMemoryInvoiceRepository();
    const published = [];
    const useCase   = new CreateInvoiceUseCase(repo, e => published.push(e));
    return { repo, useCase, published };
  };

  const admin = { permissions: ['billing.write'], userId: 'user-1' };

  test('billing.write 권한으로 DRAFT 인보이스 생성 성공', async () => {
    const { repo, useCase } = makeUseCase();
    const invoice = await useCase.execute({ customerId: 'cust-1' }, admin);
    assert.equal(invoice.status.equals('DRAFT'), true);
    assert.ok(invoice.invoiceId);
    assert.equal(repo.size(), 1);
  });

  test('InvoiceCreated 이벤트를 발행한다', async () => {
    const { useCase, published } = makeUseCase();
    await useCase.execute({ customerId: 'cust-1' }, admin);
    assert.equal(published.length, 1);
    assert.equal(published[0].event_type, 'InvoiceCreated');
  });

  test('billing.write 없으면 FORBIDDEN', async () => {
    const { useCase } = makeUseCase();
    await assert.rejects(
      () => useCase.execute({ customerId: 'cust-1' }, { permissions: ['billing.read'] }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('customerId 없으면 VALIDATION_ERROR', async () => {
    const { useCase } = makeUseCase();
    await assert.rejects(
      () => useCase.execute({ customerId: '' }, admin),
      err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; }
    );
  });
});
