-- Migration : plusieurs tarifs par formule de séance, selon le nombre de
-- photos (booking.js). À appliquer une seule fois.

ALTER TABLE booking_offers ADD COLUMN tiers TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN photos INTEGER;
ALTER TABLE bookings ADD COLUMN tier_label TEXT NOT NULL DEFAULT '';
