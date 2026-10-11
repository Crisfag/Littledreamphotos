-- Migration : devis et contrats signés en ligne (contracts.js). Sans effet si déjà appliquée.
--   npx wrangler d1 execute galerie-protegee --remote --file=migrations/2026-10-contrats.sql

-- =====================================================================
-- Devis et contrats signés en ligne (voir contracts.js). Chaque contrat
-- fige les coordonnées du studio et le texte signé ; `token` est le lien
-- secret envoyé au client. status : draft | sent | viewed | signed (signé,
-- acompte éventuel pas encore réglé) | paid | declined | cancelled.
-- =====================================================================

CREATE TABLE IF NOT EXISTS contracts (
  id               TEXT PRIMARY KEY,          -- ctr_…
  photographer_id  TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  number           TEXT NOT NULL,             -- 2026-001, par photographe
  status           TEXT NOT NULL,
  studio_name      TEXT NOT NULL,
  studio_email     TEXT NOT NULL DEFAULT '',
  seller_name      TEXT NOT NULL DEFAULT '',
  seller_address   TEXT NOT NULL DEFAULT '',
  seller_vat       TEXT NOT NULL DEFAULT '',
  client_name      TEXT NOT NULL,
  client_email     TEXT NOT NULL,
  title            TEXT NOT NULL,
  session_date     TEXT NOT NULL DEFAULT '',
  lines            TEXT NOT NULL DEFAULT '[]', -- JSON [{label, amountCents}]
  total_cents      INTEGER NOT NULL DEFAULT 0,
  deposit_cents    INTEGER NOT NULL DEFAULT 0,
  deposit_fee_cents INTEGER NOT NULL DEFAULT 0,
  terms            TEXT NOT NULL DEFAULT '',
  valid_until      INTEGER,
  sent_at          INTEGER,
  viewed_at        INTEGER,
  signed_at        INTEGER,
  signer_name      TEXT NOT NULL DEFAULT '',
  signer_ip_hash   TEXT NOT NULL DEFAULT '',
  signer_agent     TEXT NOT NULL DEFAULT '',
  document_hash    TEXT NOT NULL DEFAULT '',  -- SHA-256 du contenu signé
  declined_at      INTEGER,
  decline_reason   TEXT NOT NULL DEFAULT '',
  stripe_session_id TEXT NOT NULL DEFAULT '',
  stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
  paid_at          INTEGER,
  pdf_key          TEXT NOT NULL DEFAULT '',  -- PDF signé dans R2 (TILES, contracts/{id}.pdf)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contracts_photographer ON contracts(photographer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contracts_session ON contracts(stripe_session_id);

-- Conditions par défaut de chaque studio (reprises dans chaque nouveau devis).
CREATE TABLE IF NOT EXISTS contract_settings (
  photographer_id TEXT PRIMARY KEY REFERENCES photographers(id) ON DELETE CASCADE,
  terms           TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);
