-- Migration : mesure du parcours d'inscription (funnel.js).
-- À appliquer une seule fois.

ALTER TABLE photographers ADD COLUMN signup_page TEXT NOT NULL DEFAULT '';
ALTER TABLE photographers ADD COLUMN signup_source TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS funnel_daily (
  day    TEXT NOT NULL,                 -- AAAA-MM-JJ (UTC)
  step   TEXT NOT NULL,                 -- visit, signup_click, signup_view
  page   TEXT NOT NULL DEFAULT '',      -- accueil, mariage, contrat…
  source TEXT NOT NULL DEFAULT '',      -- direct, google, instagram…
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, step, page, source)
);
