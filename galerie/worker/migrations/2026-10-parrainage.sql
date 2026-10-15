-- Parrainage entre photographes (voir src/referral.js). Une instruction par
-- requête si on passe par l'API D1.
ALTER TABLE photographers ADD COLUMN referral_code TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_photographers_referral_code ON photographers(referral_code) WHERE referral_code != '';
CREATE TABLE IF NOT EXISTS referrals (
  filleul_id           TEXT PRIMARY KEY,
  parrain_id           TEXT NOT NULL,
  created_at           INTEGER NOT NULL,
  converted_at         INTEGER,
  filleul_credit_cents INTEGER NOT NULL DEFAULT 0,
  filleul_txn_id       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_referrals_parrain ON referrals(parrain_id, converted_at);
CREATE TABLE IF NOT EXISTS referral_rewards (
  parrain_id    TEXT NOT NULL,
  card          INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting',
  created_at    INTEGER NOT NULL,
  granted_at    INTEGER,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  stripe_txn_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (parrain_id, card)
);
