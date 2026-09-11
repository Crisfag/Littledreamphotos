-- Schéma D1 (SQLite) — une base partagée par toute la plateforme : chaque
-- photographe a un compte, et ne voit que ses propres galeries.

CREATE TABLE IF NOT EXISTS photographers (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  studio_name    TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS galleries (
  id                     TEXT PRIMARY KEY,
  photographer_id        TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  slug                   TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  client_name            TEXT NOT NULL DEFAULT '',
  password_hash          TEXT NOT NULL,
  password_salt          TEXT NOT NULL,
  watermark_text         TEXT NOT NULL DEFAULT '',
  expires_at             INTEGER,              -- epoch secondes ; NULL = pas d'expiration
  -- Arrière-plan de l'écran de mot de passe client : 'color' (défaut, palette
  -- de la marque) ou 'image' (photo importée par le photographe — jamais une
  -- des photos protégées de la galerie, pour ne rien exposer avant
  -- authentification). L'image elle-même vit dans R2 sous backgrounds/{id}.jpg.
  login_background_type  TEXT NOT NULL DEFAULT 'color',
  login_background_color TEXT NOT NULL DEFAULT '',
  created_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_galleries_photographer ON galleries(photographer_id, created_at);

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
  selected     INTEGER NOT NULL DEFAULT 0,  -- coup de cœur du client (0/1)
  selected_at  INTEGER,                     -- epoch secondes ; NULL = pas sélectionnée
  comment      TEXT NOT NULL DEFAULT '',    -- note laissée par le client sur cette photo
  comment_at   INTEGER,                     -- epoch secondes ; NULL = pas de commentaire
  created_at   INTEGER NOT NULL
);

-- Si une base existe déjà (galeries déjà envoyées) sans ces colonnes :
--   ALTER TABLE photos ADD COLUMN selected INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE photos ADD COLUMN selected_at INTEGER;
--   ALTER TABLE photos ADD COLUMN comment TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photos ADD COLUMN comment_at INTEGER;

-- Migration vers les comptes photographes (bases créées avant cette
-- fonctionnalité, où `galleries` n'a pas encore `photographer_id`) :
--   1. Créer la table :
--        CREATE TABLE IF NOT EXISTS photographers (
--          id             TEXT PRIMARY KEY,
--          email          TEXT NOT NULL UNIQUE,
--          password_hash  TEXT NOT NULL,
--          password_salt  TEXT NOT NULL,
--          studio_name    TEXT NOT NULL DEFAULT '',
--          created_at     INTEGER NOT NULL
--        );
--   2. Créer votre propre compte via POST /api/auth/signup (voir README),
--      noter l'identifiant `id` renvoyé (ex. pho_XXXXXXXX).
--   3. Ajouter la colonne, puis rattacher toutes les galeries existantes à
--      ce compte (elle est NOT NULL, donc les deux étapes suivantes doivent
--      s'enchaîner sans qu'une galerie reste orpheline) :
--        ALTER TABLE galleries ADD COLUMN photographer_id TEXT REFERENCES photographers(id);
--        UPDATE galleries SET photographer_id = '<id renvoyé à l'étape 2>';
--   4. CREATE INDEX IF NOT EXISTS idx_galleries_photographer ON galleries(photographer_id, created_at);
--   5. CREATE TABLE IF NOT EXISTS auth_log ( ... ) -- voir plus bas, même définition
--      CREATE INDEX IF NOT EXISTS idx_auth_log ON auth_log(email_hash, ts);
-- (SQLite/D1 ne sait pas ajouter une contrainte NOT NULL après coup sur une
-- colonne existante : elle reste nullable en pratique, mais le Worker refuse
-- déjà toute galerie sans photographer_id via les requêtes applicatives.)

-- Migration vers l'arrière-plan personnalisable (bases créées avant) :
--   ALTER TABLE galleries ADD COLUMN login_background_type TEXT NOT NULL DEFAULT 'color';
--   ALTER TABLE galleries ADD COLUMN login_background_color TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_photos_gallery ON photos(gallery_id, position);

CREATE TABLE IF NOT EXISTS access_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_id TEXT NOT NULL,
  viewer_id  TEXT NOT NULL DEFAULT '',
  event      TEXT NOT NULL,   -- login, login_failed, view, select, deselect, comment, capture_suspected, blur, print
  detail     TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ts         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_gallery ON access_log(gallery_id, ts);

-- Tentatives de connexion aux comptes photographes (distinct de access_log,
-- qui journalise les visites des galeries clients). email_hash et ip_hash
-- sont des empreintes salées, jamais l'adresse ou l'IP en clair.
CREATE TABLE IF NOT EXISTS auth_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL DEFAULT '',
  event      TEXT NOT NULL,   -- login, login_failed
  ip_hash    TEXT NOT NULL DEFAULT '',
  ts         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_log ON auth_log(email_hash, ts);
