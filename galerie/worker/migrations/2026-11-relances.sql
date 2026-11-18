-- Migration : relances automatiques, campagnes e-mail, consentement et
-- adresse d'envoi du studio (voir worker/src/mailing.js, automations.js,
-- broadcasts.js). À appliquer une seule fois.

-- Consentement marketing et désinscription, client par client.
ALTER TABLE clients ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN consent_at INTEGER;
ALTER TABLE clients ADD COLUMN consent_source TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN unsubscribed_at INTEGER;
ALTER TABLE clients ADD COLUMN lang TEXT NOT NULL DEFAULT '';

-- Réglages des relances : interrupteur, délai, textes personnalisés (JSON
-- { fr: {subject, body}, en: …, nl: … }), valeur libre (lien d'avis Google…).
CREATE TABLE IF NOT EXISTS automation_settings (
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  delay_days      INTEGER,
  value           TEXT NOT NULL DEFAULT '',
  texts           TEXT NOT NULL DEFAULT '',
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (photographer_id, key)
);

-- Campagnes e-mail du photographe vers ses clients.
CREATE TABLE IF NOT EXISTS broadcasts (
  id               TEXT PRIMARY KEY,           -- cmp_…
  photographer_id  TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  name             TEXT NOT NULL DEFAULT '',
  template         TEXT NOT NULL DEFAULT '',
  texts            TEXT NOT NULL DEFAULT '',   -- JSON { fr: {subject, body}, en: …, nl: … }
  cta              TEXT NOT NULL DEFAULT 'booking', -- booking | gallery | url | none
  cta_url          TEXT NOT NULL DEFAULT '',
  cta_label        TEXT NOT NULL DEFAULT '',
  print_promo      INTEGER NOT NULL DEFAULT 0, -- remise tirages (%) sur ses galeries ouvertes
  promo_days       INTEGER NOT NULL DEFAULT 7,
  segment          TEXT NOT NULL DEFAULT '{}', -- JSON (types de séance, tags, langues, inactivité, dépense)
  status           TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | sent
  scheduled_at     INTEGER,
  started_at       INTEGER,
  sent_at          INTEGER,
  recipients       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_photographer ON broadcasts(photographer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_broadcasts_due ON broadcasts(status, scheduled_at);

-- Journal des e-mails de relance et de campagne : un par destinataire,
-- jeton de désinscription et de suivi des clics. sent_at NULL : en file.
CREATE TABLE IF NOT EXISTS email_sends (
  id               TEXT PRIMARY KEY,           -- snd_…
  photographer_id  TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  client_email     TEXT NOT NULL,
  kind             TEXT NOT NULL,              -- auto:<clé> | campaign
  ref_id           TEXT NOT NULL DEFAULT '',   -- campagne, galerie…
  lang             TEXT NOT NULL DEFAULT 'fr',
  subject          TEXT NOT NULL DEFAULT '',
  token            TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'queued', -- queued | sent | skipped | failed
  created_at       INTEGER NOT NULL,
  sent_at          INTEGER,
  clicked_at       INTEGER,
  clicks           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_email_sends_photographer ON email_sends(photographer_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_email_sends_ref ON email_sends(ref_id, status);
CREATE INDEX IF NOT EXISTS idx_email_sends_client ON email_sends(photographer_id, client_email, sent_at);

-- Adresse d'envoi au nom du studio (domaine vérifié chez Resend).
CREATE TABLE IF NOT EXISTS sender_domains (
  photographer_id  TEXT PRIMARY KEY REFERENCES photographers(id) ON DELETE CASCADE,
  domain           TEXT NOT NULL,
  local_part       TEXT NOT NULL DEFAULT 'bonjour',
  resend_id        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | verified | failed
  records          TEXT NOT NULL DEFAULT '[]',
  checked_at       INTEGER,
  verified_at      INTEGER,
  created_at       INTEGER NOT NULL
);
