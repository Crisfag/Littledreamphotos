-- Suppléments réglés en espèces ou par virement (offlinepay.js).
ALTER TABLE photographers ADD COLUMN offline_cash INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photographers ADD COLUMN offline_cash_address TEXT NOT NULL DEFAULT '';
ALTER TABLE photographers ADD COLUMN offline_transfer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'card';
