'use strict';

/**
 * Stage E 적대적 검증 — Billing Domain
 * B 리뷰 기준으로 가장 위험한 경계 케이스와 취약 경로를 검증한다.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { Invoice }                            = require('../../src/domain/entities/Invoice');
const { BillingException }                   = require('../../src/domain/entities/BillingException');
const { BillingDomainService }               = require('../../src/domain/services/BillingDomainService');
const { ApproveBillingExceptionUseCase }     = require('../../src/application/ApproveBillingExceptionUseCase');
const { TransitionInvoiceStatusUseCase }     = require('../../src/application/TransitionInvoiceStatusUseCase');
const { InMemoryInvoiceRepository }          = require('../../src/infrastructure/InMemoryInvoiceRepository');
const { InMemoryBillingExceptionRepository } = require('../../src/infrastructure/InMemoryBillingExceptionRepository');
const { Money }                              = require('../../src/domain/value-objects/Money');

// ── 1. INV-B001: 합계 불변조건 우회 시도 ─────────────────────────────────────
describe('[Stage E] INV-B001: total 불변조건 우회 불가', () => {
  test('total 필드는 getter-only — setter가 없다', () => {
    let inv = Invoice.create({ invoiceId: 'inv-x', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 2, unitPrice: new Money(500, 'KRW') });
    assert.equal(inv.total.amount, 1000);
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inv), 'total');
    assert.equal(typeof desc.set, 'undefined');
  });

  test('lineItems 배열은 동결되어 외부 변형이 거부된다 (Object.freeze)', () => {
    let inv = Invoice.create({ invoiceId: 'inv-x', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(300, 'KRW') });
    const arr = inv.lineItems;
    // frozen 배열에 push → TypeError (object is not extensible)
    assert.throws(
      () => arr.push({ lineItemId: 'li-fake', description: 'fake' }),
      err => typeof err === 'object'   // TypeError
    );
    // total은 여전히 300 (동결이 올바르게 동작함을 재확인)
    assert.equal(inv.total.amount, 300);
  });
});

// ── 2. INV-B002: terminal 상태 탈출 시도 ─────────────────────────────────────
describe('[Stage E] INV-B002: terminal 상태에서 전이 시도', () => {
  test('PAID 인보이스에서 PENDING으로 되돌리기 불가', async () => {
    const repo = new InMemoryInvoiceRepository();
    let inv = Invoice.create({ invoiceId: 'inv-paid', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('PAID');
    await repo.save(inv);

    const useCase = new TransitionInvoiceStatusUseCase(repo);
    await assert.rejects(
      () => useCase.execute({ invoiceId: 'inv-paid', newStatus: 'PENDING' }, { permissions: ['billing.write'] }),
      /INV-B002/
    );
  });

  test('CANCELLED 인보이스에서 PENDING으로 되돌리기 불가', async () => {
    const repo = new InMemoryInvoiceRepository();
    let inv = Invoice.create({ invoiceId: 'inv-can', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('CANCELLED');
    await repo.save(inv);

    const useCase = new TransitionInvoiceStatusUseCase(repo);
    await assert.rejects(
      () => useCase.execute({ invoiceId: 'inv-can', newStatus: 'PENDING' }, { permissions: ['billing.write'] }),
      /INV-B002/
    );
  });
});

// ── 3. INV-B005: 관리자 승인 없이 DISPUTED→PAID 우회 시도 ─────────────────────
describe('[Stage E] INV-B005: 관리자 승인 우회 불가', () => {
  test('TransitionInvoiceStatusUseCase로 DISPUTED→PAID 시도하면 FORBIDDEN', async () => {
    const repo = new InMemoryInvoiceRepository();
    let inv = Invoice.create({ invoiceId: 'inv-d', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
    await repo.save(inv);

    const useCase = new TransitionInvoiceStatusUseCase(repo);
    await assert.rejects(
      () => useCase.execute({ invoiceId: 'inv-d', newStatus: 'PAID' }, { permissions: ['billing.write'] }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('도메인 서비스: hasAdminApproval=false이면 INV-B005 오류', () => {
    let inv = Invoice.create({ invoiceId: 'inv-d', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
    const svc = new BillingDomainService();
    assert.throws(() => svc.canTransitionDisputedToPaid(inv, false), /INV-B005/);
  });

  test('billing.admin 없는 사용자의 ApproveBillingExceptionUseCase 호출 → FORBIDDEN', async () => {
    const invoiceRepo   = new InMemoryInvoiceRepository();
    const exceptionRepo = new InMemoryBillingExceptionRepository();
    const approveUC     = new ApproveBillingExceptionUseCase(invoiceRepo, exceptionRepo);

    await assert.rejects(
      () => approveUC.execute({ exceptionId: 'exc-1', reason: '우회 시도' }, { permissions: ['billing.write'] }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });
});

// ── 4. INV-B004: 0/음수 금액 주입 시도 ───────────────────────────────────────
describe('[Stage E] INV-B004: 라인 항목 음수/0 금액 거부', () => {
  for (const [label, amount] of [['0원', 0], ['음수', -1], ['-999', -999]]) {
    test(`unitPrice ${label}이면 거부`, () => {
      const inv = Invoice.create({ invoiceId: 'inv-x', customerId: 'cust-1' });
      assert.throws(
        () => inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(amount, 'KRW') }),
        /INV-B004/
      );
    });
  }
});

// ── 5. 동시성: 동일 예외 이중 승인 시도 ─────────────────────────────────────
describe('[Stage E] 이중 승인 방어', () => {
  test('이미 APPROVED된 예외 항목에 재승인 시도하면 오류', () => {
    const exc      = BillingException.create({ exceptionId: 'exc-1', invoiceId: 'inv-1', exceptionType: 'DISPUTED' });
    const approved = exc.approve({ approvedBy: 'admin-1', reason: '1차 승인' });
    assert.throws(() => approved.approve({ approvedBy: 'admin-2', reason: '2차 시도' }), /INV-B005/);
  });

  test('병렬 승인 시도 — 두 번째 승인은 CONFLICT, 이벤트는 1번만 발행', async () => {
    const invoiceRepo   = new InMemoryInvoiceRepository();
    const exceptionRepo = new InMemoryBillingExceptionRepository();
    const events        = [];
    const approveUC     = new ApproveBillingExceptionUseCase(invoiceRepo, exceptionRepo, e => events.push(e));

    let inv = Invoice.create({ invoiceId: 'inv-p', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('DISPUTED');
    await invoiceRepo.save(inv);

    const exc = BillingException.create({ exceptionId: 'exc-p', invoiceId: 'inv-p', exceptionType: 'DISPUTED' });
    await exceptionRepo.save(exc);

    const admin = { permissions: ['billing.admin'], userId: 'admin-1' };

    await approveUC.execute({ exceptionId: 'exc-p', reason: '1차 승인' }, admin);

    await assert.rejects(
      () => approveUC.execute({ exceptionId: 'exc-p', reason: '2차 시도' }, admin),
      err => { assert.equal(err.code, 'CONFLICT'); return true; }
    );

    assert.equal(events.length, 1, '이벤트는 1번만 발행됨');
  });
});

// ── 6. INV-B003: PAID 인보이스 삭제 시도 ────────────────────────────────────
describe('[Stage E] INV-B003: PAID 인보이스 삭제 불가', () => {
  test('PAID 인보이스 delete 시도하면 CONFLICT', async () => {
    const repo = new InMemoryInvoiceRepository();
    let inv = Invoice.create({ invoiceId: 'inv-paid', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING').transitionTo('PAID');
    await repo.save(inv);

    await assert.rejects(
      () => repo.delete('inv-paid'),
      err => { assert.equal(err.code, 'CONFLICT'); return true; }
    );
  });
});

// ── 7. GAP-B001: DISPUTED 아닌 인보이스에 approve 시 CONFLICT 코드 ───────────
describe('[Stage E] GAP-B001: 비-DISPUTED 인보이스 approve 오류 코드 검증', () => {
  const admin = { permissions: ['billing.admin'], userId: 'admin-1' };

  const makeSetup = async (finalStatus) => {
    const invoiceRepo   = new InMemoryInvoiceRepository();
    const exceptionRepo = new InMemoryBillingExceptionRepository();
    const approveUC     = new ApproveBillingExceptionUseCase(invoiceRepo, exceptionRepo);

    let inv = Invoice.create({ invoiceId: 'inv-1', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(100, 'KRW') });
    inv = inv.transitionTo('PENDING');
    if (finalStatus === 'PAID')      inv = inv.transitionTo('PAID');
    if (finalStatus === 'CANCELLED') inv = inv.transitionTo('CANCELLED');
    await invoiceRepo.save(inv);

    const exc = BillingException.create({ exceptionId: 'exc-1', invoiceId: 'inv-1', exceptionType: 'DISPUTED' });
    await exceptionRepo.save(exc);
    return { approveUC };
  };

  for (const status of ['PAID', 'CANCELLED', 'PENDING']) {
    test(`${status} 인보이스에 approve 시도 → CONFLICT (not 500)`, async () => {
      const { approveUC } = await makeSetup(status);
      await assert.rejects(
        () => approveUC.execute({ exceptionId: 'exc-1', reason: '테스트' }, admin),
        err => { assert.equal(err.code, 'CONFLICT'); return true; }
      );
    });
  }
});

// ── 8. GAP-B002: 단일통화 제약 검증 ─────────────────────────────────────────
describe('[Stage E] GAP-B002: 단일통화 제약 — 빈 인보이스 total 통화', () => {
  test('빈 인보이스 total은 KRW 0 (단일통화 전제)', () => {
    const inv = Invoice.create({ invoiceId: 'inv-x', customerId: 'cust-1' });
    assert.equal(inv.total.amount, 0);
    assert.equal(inv.total.currency, 'KRW');  // 단일통화 제약
  });

  test('라인 항목 통화와 total 통화가 일치한다', () => {
    let inv = Invoice.create({ invoiceId: 'inv-x', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 2, unitPrice: new Money(500, 'KRW') });
    assert.equal(inv.total.currency, 'KRW');
    assert.equal(inv.total.amount, 1000);
  });

  test('혼합 통화 라인 항목은 add()에서 오류 — 단일통화 전제 유지', () => {
    let inv = Invoice.create({ invoiceId: 'inv-x', customerId: 'cust-1' });
    inv = inv.addLineItem({ lineItemId: 'li-1', description: 'A', quantity: 1, unitPrice: new Money(500, 'KRW') });
    // 두 번째 항목을 USD로 추가하면 addLineItem 내부 Money.add()에서 Currency mismatch
    // (실제로는 addLineItem 시에는 오류 없음 - 각 item.amount를 각각 저장하기 때문)
    // total getter에서 reduce 시 mismatch 발생
    inv = inv.addLineItem({ lineItemId: 'li-2', description: 'B', quantity: 1, unitPrice: new Money(10, 'USD') });
    assert.throws(() => inv.total, /Currency mismatch/);
  });
});
