'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveBillingRepositories,
} = require('../../server/createServer');
const { InMemoryInvoiceRepository } = require('../../../domains/billing/src/infrastructure/InMemoryInvoiceRepository');
const { PostgresInvoiceRepository } = require('../../../domains/billing/src/infrastructure/PostgresBillingRepository');

let SQLiteInvoiceRepository;
try {
  ({ SQLiteInvoiceRepository } = require('../../../domains/billing/src/infrastructure/SQLiteBillingRepository'));
} catch {
  SQLiteInvoiceRepository = null;
}

test('[billing repository routing] sqlite 선택 시 SQLiteInvoiceRepository를 반환한다', () => {
  if (!SQLiteInvoiceRepository) {
    return;
  }

  const { invoiceRepo } = resolveBillingRepositories({
    dbType: 'sqlite',
    sqliteDbPath: ':memory:',
  });

  assert.ok(invoiceRepo instanceof SQLiteInvoiceRepository);
});

test('[billing repository routing] postgres 선택 시 PostgresInvoiceRepository를 반환한다', () => {
  const fakeClient = { query: async () => ({ rows: [], rowCount: 0 }) };
  const { invoiceRepo } = resolveBillingRepositories({
    dbType: 'postgres',
    postgresClient: fakeClient,
  });

  assert.ok(invoiceRepo instanceof PostgresInvoiceRepository);
});

test('[billing repository routing] postgres 미구성 client는 명시적 오류를 던진다', async () => {
  const { invoiceRepo } = resolveBillingRepositories({
    dbType: 'postgres',
  });

  await assert.rejects(
    () => invoiceRepo.findById('invoice-missing'),
    (error) => {
      assert.equal(error.code, 'POSTGRES_CLIENT_NOT_CONFIGURED');
      return true;
    },
  );
});

test('[billing repository routing] inmemory 선택 시 InMemoryInvoiceRepository를 반환한다', () => {
  const { invoiceRepo } = resolveBillingRepositories({
    dbType: 'inmemory',
  });

  assert.ok(invoiceRepo instanceof InMemoryInvoiceRepository);
});

test('[billing repository routing] 지원하지 않는 DB_TYPE은 InMemory로 폴백한다', () => {
  const { invoiceRepo } = resolveBillingRepositories({ dbType: 'mongo' });
  assert.ok(invoiceRepo instanceof InMemoryInvoiceRepository);
});
