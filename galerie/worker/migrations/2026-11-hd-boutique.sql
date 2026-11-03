-- Photos HD livrées reliées à leur épreuve : galerie et boutique de tirages
-- passent sur la retouche (delivery.js).
ALTER TABLE photos ADD COLUMN delivery_file_id TEXT NOT NULL DEFAULT '';
