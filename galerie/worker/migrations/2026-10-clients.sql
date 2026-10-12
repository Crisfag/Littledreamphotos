-- Migration : fiches clients et dates à retenir (clients.js). Sans effet si déjà appliquée.

-- =====================================================================
-- Fiches clients (voir clients.js). Une fiche par e-mail et par
-- photographe ; elle complète ce que Holypixx sait déjà (galeries,
-- réservations, contrats, paiements) par le téléphone, les notes et les
-- dates à retenir, dont le rappel part au photographe trois semaines avant.
-- =====================================================================

CREATE TABLE IF NOT EXISTS clients (
  id              TEXT PRIMARY KEY,           -- cli_…
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,              -- en minuscules
  name            TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (photographer_id, email)
);

-- kind : birthday (date de naissance) | wedding (date du mariage) | other.
-- notified_year : année de la dernière occurrence déjà rappelée.
CREATE TABLE IF NOT EXISTS client_dates (
  id              TEXT PRIMARY KEY,           -- cld_…
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  client_email    TEXT NOT NULL,
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'other',
  date            TEXT NOT NULL,              -- AAAA-MM-JJ
  remind          INTEGER NOT NULL DEFAULT 1,
  notified_year   INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_dates_client ON client_dates(photographer_id, client_email);
CREATE INDEX IF NOT EXISTS idx_client_dates_remind ON client_dates(remind);
