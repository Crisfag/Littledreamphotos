-- Suivi d'une séance, de la réservation à la livraison (booking.js) :
-- contrat envoyé depuis la réservation (et relancé), liste récapitulative
-- de la formule (tenues, ambiance, à prévoir) envoyée au client, galerie
-- associée et envoyée par e-mail (lien et mot de passe).
-- À appliquer une seule fois, AVANT npm run deploy :
--   npx wrangler d1 execute galerie-protegee --remote --file=migrations/2026-11-suivi-seance.sql

ALTER TABLE booking_offers ADD COLUMN prep TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN contract_id TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN contract_reminded_at INTEGER;
ALTER TABLE bookings ADD COLUMN prep_sent_at INTEGER;
ALTER TABLE bookings ADD COLUMN gallery_id TEXT NOT NULL DEFAULT '';
ALTER TABLE galleries ADD COLUMN invite_sent_at INTEGER;
