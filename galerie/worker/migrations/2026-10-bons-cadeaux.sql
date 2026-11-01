-- Bons cadeaux vendus depuis le mini-site (giftcards.js).
CREATE TABLE IF NOT EXISTS gift_settings (
  photographer_id TEXT PRIMARY KEY REFERENCES photographers(id) ON DELETE CASCADE,
  enabled         INTEGER NOT NULL DEFAULT 0,
  min_cents       INTEGER NOT NULL DEFAULT 5000,
  validity_months INTEGER NOT NULL DEFAULT 12,
  terms           TEXT NOT NULL DEFAULT '',
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_cards (
  id                TEXT PRIMARY KEY,
  photographer_id   TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  code              TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending',
  source            TEXT NOT NULL DEFAULT 'online',
  amount_cents      INTEGER NOT NULL,
  fee_cents         INTEGER NOT NULL DEFAULT 0,
  offer_id          TEXT NOT NULL DEFAULT '',
  offer_title       TEXT NOT NULL DEFAULT '',
  offer_description TEXT NOT NULL DEFAULT '',
  duration_min      INTEGER,
  tier_label        TEXT NOT NULL DEFAULT '',
  tier_photos       INTEGER,
  included          TEXT NOT NULL DEFAULT '',
  image_id          TEXT NOT NULL DEFAULT '',
  from_name         TEXT NOT NULL DEFAULT '',
  to_name           TEXT NOT NULL DEFAULT '',
  message           TEXT NOT NULL DEFAULT '',
  buyer_email       TEXT NOT NULL DEFAULT '',
  recipient_email   TEXT NOT NULL DEFAULT '',
  terms             TEXT NOT NULL DEFAULT '',
  valid_until       INTEGER NOT NULL,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
  paid_at           INTEGER,
  redeemed_at       INTEGER,
  redeemed_note     TEXT NOT NULL DEFAULT '',
  cancelled_at      INTEGER,
  ip_hash           TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gift_cards_photographer ON gift_cards(photographer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gift_cards_ip ON gift_cards(ip_hash, created_at);
