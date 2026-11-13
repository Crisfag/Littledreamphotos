-- Modèles de contrat (contracts.js) : plusieurs jeux de conditions par
-- studio (« Séance grossesse », « Mariage »…), avec un acompte suggéré en %,
-- et le modèle proposé par chaque formule de séance (booking.js).
-- À appliquer une seule fois, AVANT npm run deploy :
--   npx wrangler d1 execute galerie-protegee --remote --file=migrations/2026-11-modeles-contrat.sql

CREATE TABLE IF NOT EXISTS contract_templates (
  id              TEXT PRIMARY KEY,           -- ctt_…
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  terms           TEXT NOT NULL,
  deposit_percent INTEGER NOT NULL DEFAULT 0, -- acompte suggéré, en % du prix (0 = aucun)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_templates_photographer ON contract_templates(photographer_id, name);
ALTER TABLE booking_offers ADD COLUMN contract_template_id TEXT NOT NULL DEFAULT '';
