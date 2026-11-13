-- Lumi, l'assistante de l'espace photographe (assistant.js) : nombre de
-- questions posées par photographe et par jour (limite quotidienne). Rien
-- d'autre n'est enregistré : la conversation reste dans le navigateur.
-- À appliquer une seule fois, AVANT npm run deploy :
--   npx wrangler d1 execute galerie-protegee --remote --file=migrations/2026-11-assistant.sql

CREATE TABLE IF NOT EXISTS assistant_usage (
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  day             TEXT NOT NULL,              -- AAAA-MM-JJ (UTC)
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (photographer_id, day)
);
