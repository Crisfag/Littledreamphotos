-- Options payantes cochées par le client (options.js) et relance des
-- suppléments non réglés (unpaidreminders.js).
CREATE TABLE IF NOT EXISTS gallery_options (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price_cents     INTEGER NOT NULL,
  per_unit        INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gallery_options_photographer ON gallery_options(photographer_id, position);
CREATE TABLE IF NOT EXISTS gallery_option_choices (
  id               TEXT PRIMARY KEY,
  gallery_id       TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  option_id        TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  label            TEXT NOT NULL DEFAULT '',
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  payment_id       TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  paid_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_option_choices_gallery ON gallery_option_choices(gallery_id, payment_id);
ALTER TABLE galleries ADD COLUMN options_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN options_json TEXT NOT NULL DEFAULT '';
ALTER TABLE photographers ADD COLUMN unpaid_reminders_enabled INTEGER NOT NULL DEFAULT 1;
