-- Migration : liste d'attente « Holypixx in English » (page /en/, voir
-- worker/src/waitlist.js). À appliquer une seule fois.

CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,
  country    TEXT NOT NULL DEFAULT '',
  specialty  TEXT NOT NULL DEFAULT '',
  lang       TEXT NOT NULL DEFAULT 'en',
  created_at INTEGER NOT NULL
);
