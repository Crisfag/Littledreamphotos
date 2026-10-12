-- Migration : prestations illustrées et enregistrées (booking.js) — image,
-- « compris dans votre forfait », conseil vestimentaire, et réglages de
-- prestation réutilisables. À appliquer une seule fois.

ALTER TABLE booking_offers ADD COLUMN included TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_offers ADD COLUMN dress_code TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_offers ADD COLUMN image_id TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN included TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN dress_code TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS booking_templates (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  data            TEXT NOT NULL,
  image_id        TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_templates_photographer ON booking_templates(photographer_id, title);
