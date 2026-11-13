-- Créneaux privés (booking.js) : un créneau réservé à un client, absent du
-- mini-site, réservable seulement par le lien secret envoyé par le
-- photographe (?creneau=<private_token>). Nom et e-mail du client invité
-- pré-remplissent le formulaire de réservation.
ALTER TABLE booking_slots ADD COLUMN private_token TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_slots ADD COLUMN private_name TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_slots ADD COLUMN private_email TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_booking_slots_private ON booking_slots(private_token);
