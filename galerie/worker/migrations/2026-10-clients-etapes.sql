-- Migration : étapes d'un bébé, séances de saison, temps forts du studio et
-- délai de rappel réglable (clients.js). À appliquer une seule fois.

ALTER TABLE client_dates ADD COLUMN lead_days INTEGER;
ALTER TABLE client_dates ADD COLUMN plan TEXT NOT NULL DEFAULT '';
ALTER TABLE client_dates ADD COLUMN approx INTEGER NOT NULL DEFAULT 0;
