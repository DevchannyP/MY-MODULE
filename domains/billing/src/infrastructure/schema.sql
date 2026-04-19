-- Billing Domain — SQLite Schema
-- Benchmark: Hexagonal Architecture (Cockburn), Flyway migration conventions
-- Version: 001 — initial

CREATE TABLE IF NOT EXISTS billing_invoices (
  id           TEXT    NOT NULL PRIMARY KEY,   -- invoice-{timestamp}-{counter}
  customer_id  TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'DRAFT',
  amount       REAL    NOT NULL DEFAULT 0,
  currency     TEXT    NOT NULL DEFAULT 'KRW',
  due_date     TEXT    NULL,                   -- ISO 8601 date or null
  notes        TEXT    NULL,
  paid_at      TEXT    NULL,                   -- ISO 8601 datetime or null
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1
);

-- Line items (denormalized per invoice for fast restore)
CREATE TABLE IF NOT EXISTS billing_invoice_items (
  id           TEXT    NOT NULL PRIMARY KEY,   -- {invoiceId}:{lineItemId}
  invoice_id   TEXT    NOT NULL,
  li_id        TEXT    NOT NULL,               -- lineItemId
  li_desc      TEXT    NOT NULL,               -- description
  li_qty       INTEGER NOT NULL DEFAULT 1,     -- quantity
  li_up_amt    REAL    NOT NULL,               -- unitPrice.amount
  li_up_cur    TEXT    NOT NULL DEFAULT 'KRW', -- unitPrice.currency
  li_amt       REAL    NOT NULL,               -- amount.amount
  li_cur       TEXT    NOT NULL DEFAULT 'KRW', -- amount.currency
  FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_customer ON billing_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status   ON billing_invoices(status);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_due      ON billing_invoices(due_date)
  WHERE due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_payments (
  id                    TEXT    NOT NULL PRIMARY KEY,
  invoice_id            TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'PENDING',
  amount                REAL    NOT NULL DEFAULT 0,
  currency              TEXT    NOT NULL DEFAULT 'KRW',
  synced_at             TEXT    NULL,
  mismatch_delta_amount REAL    NULL,
  mismatch_delta_cur    TEXT    NULL,
  created_at            TEXT    NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_invoice ON billing_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status  ON billing_payments(status);

CREATE TABLE IF NOT EXISTS billing_exceptions (
  id             TEXT    NOT NULL PRIMARY KEY,
  invoice_id     TEXT    NOT NULL,
  payment_id     TEXT    NULL,
  exception_type TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'OPEN',
  reason         TEXT    NULL,
  approved_by    TEXT    NULL,
  rejected_by    TEXT    NULL,
  resolved_at    TEXT    NULL,
  created_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_exceptions_type   ON billing_exceptions(exception_type);
CREATE INDEX IF NOT EXISTS idx_billing_exceptions_status ON billing_exceptions(status);

-- Domain event outbox (Transactional Outbox Pattern)
CREATE TABLE IF NOT EXISTS billing_outbox (
  id           TEXT    NOT NULL PRIMARY KEY,
  event_type   TEXT    NOT NULL,
  aggregate_id TEXT    NOT NULL,
  payload      TEXT    NOT NULL,               -- JSON CloudEvents envelope
  created_at   TEXT    NOT NULL,
  delivered    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_billing_outbox_pending ON billing_outbox(delivered, created_at)
  WHERE delivered = 0;
