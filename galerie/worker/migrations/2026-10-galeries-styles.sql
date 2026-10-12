-- Migration : styles de galerie (presentation.js) — style, polices, texte
-- d'accompagnement, en-tête photo ou vidéo, style par défaut du compte.
-- À appliquer une seule fois.

ALTER TABLE galleries ADD COLUMN theme TEXT NOT NULL DEFAULT '';
ALTER TABLE galleries ADD COLUMN title_font TEXT NOT NULL DEFAULT '';
ALTER TABLE galleries ADD COLUMN body_font TEXT NOT NULL DEFAULT '';
ALTER TABLE galleries ADD COLUMN intro TEXT NOT NULL DEFAULT '';
ALTER TABLE galleries ADD COLUMN cover_photo_id TEXT NOT NULL DEFAULT '';
ALTER TABLE galleries ADD COLUMN header_video TEXT NOT NULL DEFAULT '';
ALTER TABLE photographers ADD COLUMN default_theme TEXT NOT NULL DEFAULT '';
