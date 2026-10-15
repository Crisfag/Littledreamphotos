-- Migration : galerie client en anglais (langue choisie par galerie) et
-- livraison des tirages hors d'Europe (forfait de port distinct, fermé tant
-- que le photographe ne l'a pas renseigné). À appliquer une seule fois.

ALTER TABLE galleries ADD COLUMN language TEXT NOT NULL DEFAULT 'fr';
ALTER TABLE photographers ADD COLUMN shop_shipping_world_cents INTEGER;
