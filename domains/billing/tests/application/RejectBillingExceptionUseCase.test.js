'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { RejectBillingExceptionUseCase }         = require('../../src/application/RejectBillingExceptionUseCase');
const { InMemoryBillingExceptionRepository }    = require('../../src/infrastructure/InMemoryBillingExceptionRepository');
const { BillingException }                      = require('../../src/domain/entities/BillingException');

const ADMIN_CALLER = { permissions: ['billing.admin'], userId: 'admin-1' };
const WRITE_CALLER = { permissions: ['billing.write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeSetup() {
  const repo     = new InMemoryBillingExceptionRepository();
  const events   = [];
  const rejectUC = new RejectBillingExceptionUseCase(repo, e => events.push(e));
  return { repo, events, rejectUC };
}

async function seedException(repo, opts = {}) {
  const exc = BillingException.create({
    exceptionId:   opts.exceptionId   || 'exc-1',
    invoiceId:     opts.invoiceId     || 'inv-1',
    exceptionType: opts.exceptionType || 'DISPUTED',
  });
  await repo.save(exc);
  return exc;
}

describe('RejectBillingExceptionUseCase', () => {
  test('정상 거부 → status=REJECTED, 이벤트 발행', async () => {
    const { repo, events, rejectUC } = makeSetup();
    await seedException(repo);
    const result = await rejectUC.execute({ exceptionId: 'exc-1', reason: '부적합 사유' }, ADMIN_CALLER);
    assert.equal(result.status, 'REJECTED');
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'BillingExceptionRejected');
    assert.equal(events[0].payload.reason, '부적합 사유');
  });

  test('권한 없음 (NO_PERM) → FORBIDDEN', async () => {
    const { repo, rejectUC } = makeSetup();
    await seedException(repo);
    await assert.rejects(() => rejectUC.execute({ exceptionId: 'exc-1', reason: '사유' }, NO_PERM), { code: 'FORBIDDEN' });
  });

  test('billing.write만으로는 불가 (billing.admin 필요)', async () => {
    const { repo, rejectUC } = makeSetup();
    await seedException(repo);
    await assert.rejects(() => rejectUC.execute({ exceptionId: 'exc-1', reason: '사유' }, WRITE_CALLER), { code: 'FORBIDDEN' });
  });

  test('reason 누락 → VALIDATION_ERROR', async () => {
    const { repo, rejectUC } = makeSetup();
    await seedException(repo);
    await assert.rejects(() => rejectUC.execute({ exceptionId: 'exc-1' }, ADMIN_CALLER), { code: 'VALIDATION_ERROR' });
  });

  test('존재하지 않는 exceptionId → NOT_FOUND', async () => {
    const { rejectUC } = makeSetup();
    await assert.rejects(() => rejectUC.execute({ exceptionId: 'nonexistent', reason: '사유' }, ADMIN_CALLER), { code: 'NOT_FOUND' });
  });

  test('correlationId가 이벤트 페이로드에 포함됨', async () => {
    const { repo, events, rejectUC } = makeSetup();
    await seedException(repo);
    await rejectUC.execute({ exceptionId: 'exc-1', reason: '사유', correlationId: 'corr-999' }, ADMIN_CALLER);
    assert.equal(events[0].correlation_id, 'corr-999');
  });
});
