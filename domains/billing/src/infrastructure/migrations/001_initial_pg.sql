-- Billing Domain — PostgreSQL Schema
-- Version: 001 — initial PostgreSQL adapter baseline
-- WP: WP-S18-004

CREATE TABLE IF NOT EXISTS billing_invoices (
  id          TEXT    NOT NULL PRIMARY KEY,
  customer_id TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'DRAFT',
  amount      NUMERIC NOT NULL DEFAULT 0,
  currency    TEXT    NOT NULL DEFAULT 'KRW',
  due_date    TEXT    NULL,
  notes       TEXT    NULL,
  paid_at     TEXT    NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS billing_invoice_items (
  id         TEXT    NOT NULL PRIMARY KEY,
  invoice_id TEXT    NOT NULL REFERENCES billing_invoices(id),
  li_id      TEXT    NOT NULL,
  li_desc    TEXT    NOT NULL,
  li_qty     INTEGER NOT NULL DEFAULT 1,
  li_up_amt  NUMERIC NOT NULL,
  li_up_cur  TEXT    NOT NULL DEFAULT 'KRW',
  li_amt     NUMERIC NOT NULL,
  li_cur     TEXT    NOT NULL DEFAULT 'KRW'
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_customer ON billing_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status   ON billing_invoices(status);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_due      ON billing_invoices(due_date)
  WHERE due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_payments (
  id                    TEXT    NOT NULL PRIMARY KEY,
  invoice_id            TEXT    NOT NULL REFERENCES billing_invoices(id),
  status                TEXT    NOT NULL DEFAULT 'PENDING',
  amount                NUMERIC NOT NULL DEFAULT 0,
  currency              TEXT    NOT NULL DEFAULT 'KRW',
  synced_at             TEXT    NULL,
  mismatch_delta_amount NUMERIC NULL,
  mismatch_delta_cur    TEXT    NULL,
  created_at            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_invoice ON billing_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status  ON billing_payments(status);

CREATE TABLE IF NOT EXISTS billing_exceptions (
  id             TEXT NOT NULL PRIMARY KEY,
  invoice_id     TEXT NOT NULL,
  payment_id     TEXT NULL,
  exception_type TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'OPEN',
  reason         TEXT NULL,
  approved_by    TEXT NULL,
  rejected_by    TEXT NULL,
  resolved_at    TEXT NULL,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_exceptions_type   ON billing_exceptions(exception_type);
CREATE INDEX IF NOT EXISTS idx_billing_exceptions_status ON billing_exceptions(status);

CREATE TABLE IF NOT EXISTS billing_outbox (
  id           TEXT    NOT NULL PRIMARY KEY,
  event_type   TEXT    NOT NULL,
  aggregate_id TEXT    NOT NULL,
  payload      JSONB   NOT NULL,
  created_at   TEXT    NOT NULL,
  delivered    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_billing_outbox_pending ON billing_outbox(delivered, created_at)
  WHERE delivered = FALSE;
