-- Migration : pack « toutes les photos de l'enfant » (schoolshop.js).
-- À appliquer une seule fois.

ALTER TABLE school_order_lines ADD COLUMN pack_size INTEGER NOT NULL DEFAULT 0;
