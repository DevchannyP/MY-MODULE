'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TransitionInvoiceStatusUseCase } = require('../../src/application/TransitionInvoiceStatusUseCase');
const { InMemoryInvoiceRepository }      = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { Invoice }                        = require('../../src/domain/entities/Invoice');
const { Money }                          = require('../../src/domain/value-objects/Money');

describe('TransitionInvoiceStatusUseCase', () => {
  const writer = { permissions: ['billing.write'], userId: 'user-1' };

  const makeSetup = async () => {
    const repo      = new InMemoryInvoiceRepository();
    const published = [];
    const useCase   = new TransitionInvoiceStatusUseCase(repo, e => published.push(e));
    const inv       = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
    await repo.save(inv);
    return { repo, useCase, published };
  };

  test('DRAFT → PENDING 전이 성공', async () => {
    const { useCase } = await makeSetup();
    const result = await useCase.execute({ invoiceId: 'inv-1', newStatus: 'PENDING' }, writer);
    assert.equal(result.status.equals('PENDING'), true);
  });

  test('InvoiceStatusChanged 이벤트 발행', async () => {
    const { useCase, published } = await makeSetup();
    await useCase.execute({ invoiceId: 'inv-1', newStatus: 'PENDING' }, writer);
    assert.equal(published[0].event_type, 'InvoiceStatusChanged');
    assert.equal(published[0].payload.from_status, 'DRAFT');
    assert.equal(published[0].payload.to_status, 'PENDING');
  });

  test('INV-B005: DISPUTED→PAID는 이 유스케이스에서 FORBIDDEN', async () => {
    const { repo, useCase } = await makeSetup();
    let inv = Invoice.create({ invoiceId: 'inv-d', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
    await repo.save(inv);

    await assert.rejects(
      () => useCase.execute({ invoiceId: 'inv-d', newStatus: 'PAID' }, writer),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('billing.write 없으면 FORBIDDEN', async () => {
    const { useCase } = await makeSetup();
    await assert.rejects(
      () => useCase.execute({ invoiceId: 'inv-1', newStatus: 'PENDING' }, { permissions: ['billing.read'] }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('존재하지 않는 invoiceId면 NOT_FOUND', async () => {
    const { useCase } = await makeSetup();
    await assert.rejects(
      () => useCase.execute({ invoiceId: 'no-such', newStatus: 'PENDING' }, writer),
      err => { assert.equal(err.code, 'NOT_FOUND'); return true; }
    );
  });

  test('INV-B002: 허용되지 않는 전이는 도메인에서 오류', async () => {
    const { useCase } = await makeSetup();
    await assert.rejects(
      () => useCase.execute({ invoiceId: 'inv-1', newStatus: 'PAID' }, writer),
      /INV-B002/
    );
  });
});
