-- Migration : réservation en ligne (booking.js). Sans effet si déjà appliquée.
--   npx wrangler d1 execute galerie-protegee --remote --file=migrations/2026-10-reservations.sql

-- =====================================================================
-- Réservation en ligne (voir booking.js) : formules de séance proposées
-- sur le mini-site, créneaux ouverts par le photographe, et réservations
-- des clients (acompte réglé par Stripe sur le compte du photographe).
-- Nouvelles tables : il suffit de relancer ce fichier sur une base
-- existante (npm run db:init), tout est en « IF NOT EXISTS ».
-- =====================================================================

CREATE TABLE IF NOT EXISTS booking_offers (
  id              TEXT PRIMARY KEY,           -- bko_…
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  duration_min    INTEGER NOT NULL,
  price_cents     INTEGER NOT NULL DEFAULT 0, -- prix de la séance (indicatif, réglé avec le photographe)
  deposit_cents   INTEGER NOT NULL DEFAULT 0, -- acompte payé en ligne à la réservation (0 = sans acompte)
  location        TEXT NOT NULL DEFAULT '',
  active          INTEGER NOT NULL DEFAULT 1,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_offers_photographer ON booking_offers(photographer_id, position);

CREATE TABLE IF NOT EXISTS booking_slots (
  id              TEXT PRIMARY KEY,           -- bks_…
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  offer_id        TEXT NOT NULL REFERENCES booking_offers(id) ON DELETE CASCADE,
  starts_at       INTEGER NOT NULL,           -- epoch secondes (UTC)
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_slots_offer ON booking_slots(offer_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_booking_slots_photographer ON booking_slots(photographer_id, starts_at);

-- Une réservation garde une copie de la formule et de l'horaire : elle reste
-- lisible même si la formule ou le créneau sont modifiés ensuite.
-- status : pending (paiement de l'acompte en cours, créneau bloqué jusqu'à
-- hold_until) | confirmed | cancelled | expired (paiement abandonné) |
-- conflict (acompte payé après expiration, créneau repris entre-temps : à
-- rembourser par le photographe).
CREATE TABLE IF NOT EXISTS bookings (
  id                TEXT PRIMARY KEY,         -- bkg_…
  photographer_id   TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  slot_id           TEXT NOT NULL,
  offer_id          TEXT NOT NULL,
  offer_title       TEXT NOT NULL,
  location          TEXT NOT NULL DEFAULT '',
  starts_at         INTEGER NOT NULL,
  duration_min      INTEGER NOT NULL,
  price_cents       INTEGER NOT NULL DEFAULT 0,
  deposit_cents     INTEGER NOT NULL DEFAULT 0,
  fee_cents         INTEGER NOT NULL DEFAULT 0,
  client_name       TEXT NOT NULL,
  client_email      TEXT NOT NULL,
  client_phone      TEXT NOT NULL DEFAULT '',
  message           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL,
  hold_until        INTEGER,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
  paid_at           INTEGER,
  cancelled_at      INTEGER,
  reminded_at       INTEGER,
  ip_hash           TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL
);
-- Un créneau ne peut porter qu'une réservation en cours ou confirmée : deux
-- clients qui valident en même temps, le second est refusé par la base.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot_active ON bookings(slot_id) WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_bookings_photographer ON bookings(photographer_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings(stripe_session_id);
