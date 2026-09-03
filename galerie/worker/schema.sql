-- Schéma D1 (SQLite) — une base par photographe, un déploiement par photographe.

CREATE TABLE IF NOT EXISTS galleries (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  client_name    TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  watermark_text TEXT NOT NULL DEFAULT '',
  expires_at     INTEGER,              -- epoch secondes ; NULL = pas d'expiration
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id           TEXT PRIMARY KEY,
  gallery_id   TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  cols         INTEGER NOT NULL,        -- grille du niveau plein écran
  rows         INTEGER NOT NULL,
  preview_width  INTEGER NOT NULL DEFAULT 0,  -- niveau vignette (grille 2 × 2)
  preview_height INTEGER NOT NULL DEFAULT 0,
  forensic_id  TEXT NOT NULL DEFAULT '', -- empreinte invisible gravée dans les pixels
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_gallery ON photos(gallery_id, position);

CREATE TABLE IF NOT EXISTS access_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_id TEXT NOT NULL,
  viewer_id  TEXT NOT NULL DEFAULT '',
  event      TEXT NOT NULL,   -- login, login_failed, view, capture_suspected, blur, print
  detail     TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ts         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_gallery ON access_log(gallery_id, ts);
