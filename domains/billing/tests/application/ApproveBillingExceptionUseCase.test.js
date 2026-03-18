'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ApproveBillingExceptionUseCase }     = require('../../src/application/ApproveBillingExceptionUseCase');
const { InMemoryInvoiceRepository }          = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryBillingExceptionRepository } = require('../../src/infrastructure/InMemoryBillingExceptionRepository');
const { Invoice }                            = require('../../src/domain/entities/Invoice');
const { BillingException }                   = require('../../src/domain/entities/BillingException');
const { Money }                              = require('../../src/domain/value-objects/Money');

const makeDisputedInvoice = async (invoiceRepo) => {
  let inv = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
  inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(1000, 'KRW') });
  inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
  await invoiceRepo.save(inv);
  return inv;
};

const makeException = async (exceptionRepo, invoiceId) => {
  const exc = BillingException.create({ exceptionId: 'exc-1', invoiceId, exceptionType: 'DISPUTED' });
  await exceptionRepo.save(exc);
  return exc;
};

describe('ApproveBillingExceptionUseCase (INV-B005)', () => {
  const adminCaller = { permissions: ['billing.admin'], userId: 'admin-1' };

  const makeUseCase = () => {
    const invoiceRepo   = new InMemoryInvoiceRepository();
    const exceptionRepo = new InMemoryBillingExceptionRepository();
    const published     = [];
    const useCase       = new ApproveBillingExceptionUseCase(invoiceRepo, exceptionRepo, e => published.push(e));
    return { invoiceRepo, exceptionRepo, useCase, published };
  };

  test('billing.admin으로 DISPUTED→PAID 전이 성공', async () => {
    const { invoiceRepo, exceptionRepo, useCase } = makeUseCase();
    await makeDisputedInvoice(invoiceRepo);
    await makeException(exceptionRepo, 'inv-1');

    const result = await useCase.execute({ exceptionId: 'exc-1', reason: '검토 후 승인' }, adminCaller);
    assert.equal(result.status, 'APPROVED');

    const inv = await invoiceRepo.findById('inv-1');
    assert.equal(inv.status.equals('PAID'), true);
  });

  test('BillingExceptionApproved 이벤트 발행', async () => {
    const { invoiceRepo, exceptionRepo, useCase, published } = makeUseCase();
    await makeDisputedInvoice(invoiceRepo);
    await makeException(exceptionRepo, 'inv-1');

    await useCase.execute({ exceptionId: 'exc-1', reason: '승인' }, adminCaller);
    assert.equal(published.length, 1);
    assert.equal(published[0].event_type, 'BillingExceptionApproved');
    assert.equal(published[0].payload.approved_by, 'admin-1');
  });

  test('INV-B005: billing.admin 없으면 FORBIDDEN', async () => {
    const { invoiceRepo, exceptionRepo, useCase } = makeUseCase();
    await makeDisputedInvoice(invoiceRepo);
    await makeException(exceptionRepo, 'inv-1');

    await assert.rejects(
      () => useCase.execute({ exceptionId: 'exc-1', reason: '승인' }, { permissions: ['billing.write'] }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('reason 없으면 VALIDATION_ERROR', async () => {
    const { invoiceRepo, exceptionRepo, useCase } = makeUseCase();
    await makeDisputedInvoice(invoiceRepo);
    await makeException(exceptionRepo, 'inv-1');

    await assert.rejects(
      () => useCase.execute({ exceptionId: 'exc-1', reason: '' }, adminCaller),
      err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; }
    );
  });

  test('이미 처리된 예외는 CONFLICT', async () => {
    const { invoiceRepo, exceptionRepo, useCase } = makeUseCase();
    await makeDisputedInvoice(invoiceRepo);
    const exc      = await makeException(exceptionRepo, 'inv-1');
    const approved = exc.approve({ approvedBy: 'admin-0', reason: '선승인' });
    await exceptionRepo.save(approved);

    await assert.rejects(
      () => useCase.execute({ exceptionId: 'exc-1', reason: '재승인 시도' }, adminCaller),
      err => { assert.equal(err.code, 'CONFLICT'); return true; }
    );
  });

  test('INV-B002: DISPUTED가 아닌 인보이스에 연결된 예외 승인 시 오류', async () => {
    const { invoiceRepo, exceptionRepo, useCase } = makeUseCase();
    let inv = Invoice.create({ invoiceId: 'inv-2', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(500, 'KRW') });
    inv = inv.transitionTo('PENDING');
    await invoiceRepo.save(inv);
    const exc = BillingException.create({ exceptionId: 'exc-2', invoiceId: 'inv-2', exceptionType: 'MISMATCH' });
    await exceptionRepo.save(exc);

    await assert.rejects(
      () => useCase.execute({ exceptionId: 'exc-2', reason: '처리' }, adminCaller)
    );
  });
});
