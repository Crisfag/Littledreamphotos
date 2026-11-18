-- Migration : newsletter Holypixx (voir worker/src/newsletter.js), avec
-- consentement explicite et langue. À appliquer une seule fois.

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  email      TEXT PRIMARY KEY,
  lang       TEXT NOT NULL DEFAULT 'fr',     -- fr, en, nl
  source     TEXT NOT NULL DEFAULT '',       -- admin, home-nl…
  consent_at INTEGER NOT NULL,               -- case cochée (RGPD)
  created_at INTEGER NOT NULL
);
