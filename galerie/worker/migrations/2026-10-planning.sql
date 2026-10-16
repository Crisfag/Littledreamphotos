-- Migration : onglet Planning (tâches perso et tâches faites).
-- À appliquer une seule fois.

-- Planning du photographe (planning.js) : tâches et rendez-vous ajoutés à
-- la main (date facultative, heure facultative, client facultatif), et
-- tâches calculées (sélection à retoucher, galerie à créer, client à
-- recontacter) marquées « faites ».
CREATE TABLE IF NOT EXISTS planning_items (
  id              TEXT PRIMARY KEY,           -- pli_…
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  date            TEXT NOT NULL DEFAULT '',   -- AAAA-MM-JJ, vide : sans date
  time            TEXT NOT NULL DEFAULT '',   -- HH:MM, vide : journée
  note            TEXT NOT NULL DEFAULT '',
  client_email    TEXT NOT NULL DEFAULT '',
  done_at         INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planning_items_photographer ON planning_items(photographer_id, date);

CREATE TABLE IF NOT EXISTS planning_done (
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  item_key        TEXT NOT NULL,              -- sel:{galerie}, gal:{réservation}, cld:{date}:{AAAA-MM-JJ}
  done_at         INTEGER NOT NULL,
  PRIMARY KEY (photographer_id, item_key)
);
