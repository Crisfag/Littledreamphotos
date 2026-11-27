-- API BePhoto de novembre 2026 (schoollab.js, bephoto.js) : connexion par
-- clé d'API, envoi d'un lot en plan d'opérations (enveloppe par enfant,
-- adresse de livraison, prix à confirmer), mode de livraison retenu.
ALTER TABLE photographers ADD COLUMN bephoto_key_enc TEXT NOT NULL DEFAULT '';
ALTER TABLE school_lab_batches ADD COLUMN lab_state TEXT NOT NULL DEFAULT '';
ALTER TABLE school_lab_batches ADD COLUMN lab_shipping TEXT NOT NULL DEFAULT '';
