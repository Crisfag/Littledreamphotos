-- Migration : galerie de démonstration créée à l'inscription.
-- À appliquer une seule fois.

ALTER TABLE galleries ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN demo_password TEXT;
