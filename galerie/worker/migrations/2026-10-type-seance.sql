-- Migration : type de séance des galeries (onglet Statistiques, insights.js).
-- À appliquer une seule fois.

ALTER TABLE galleries ADD COLUMN session_type TEXT NOT NULL DEFAULT '';
