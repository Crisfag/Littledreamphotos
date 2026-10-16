-- Migration : vraie date de séance dans les devis et contrats (sélecteur),
-- pour les placer dans le planning. À appliquer une seule fois.

ALTER TABLE contracts ADD COLUMN session_day TEXT NOT NULL DEFAULT '';
ALTER TABLE contracts ADD COLUMN session_time TEXT NOT NULL DEFAULT '';
