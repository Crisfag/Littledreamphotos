-- Textes d'accompagnement enregistrés par le photographe, à réutiliser
-- d'une galerie à l'autre (introtexts.js).
CREATE TABLE IF NOT EXISTS intro_texts (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  used_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intro_texts_photographer ON intro_texts(photographer_id, used_at);
