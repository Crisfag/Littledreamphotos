-- Facturation libre, échéanciers et relances de paiement (clientinvoices.js),
-- tags des fiches clients (clients.js), IBAN imprimé sur les factures.
ALTER TABLE clients ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE photographers ADD COLUMN billing_iban TEXT NOT NULL DEFAULT '';
ALTER TABLE contracts ADD COLUMN deposit_reminded INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS client_invoices (
  id               TEXT PRIMARY KEY,
  photographer_id  TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL DEFAULT 'invoice',
  number           TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft',
  credit_of        TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'manual',
  source_id        TEXT NOT NULL DEFAULT '',
  client_name      TEXT NOT NULL DEFAULT '',
  client_email     TEXT NOT NULL DEFAULT '',
  client_address   TEXT NOT NULL DEFAULT '',
  client_vat       TEXT NOT NULL DEFAULT '',
  title            TEXT NOT NULL DEFAULT '',
  lines            TEXT NOT NULL DEFAULT '[]',
  schedule         TEXT NOT NULL DEFAULT '[]',
  net_cents        INTEGER NOT NULL DEFAULT 0,
  vat_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  seller_name      TEXT NOT NULL DEFAULT '',
  seller_address   TEXT NOT NULL DEFAULT '',
  seller_vat       TEXT NOT NULL DEFAULT '',
  seller_iban      TEXT NOT NULL DEFAULT '',
  reminders        INTEGER NOT NULL DEFAULT 1,
  issued_at        INTEGER,
  paid_at          INTEGER,
  viewed_at        INTEGER,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_invoices_photographer ON client_invoices(photographer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_invoices_session ON client_invoices(stripe_session_id);
