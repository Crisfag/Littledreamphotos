-- Migration : espace photographe en anglais (langue choisie par compte).
-- À appliquer une seule fois.

ALTER TABLE photographers ADD COLUMN ui_language TEXT NOT NULL DEFAULT 'fr';
