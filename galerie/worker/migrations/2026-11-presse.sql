-- Salle de presse : galeries d'événement partagées avec le commanditaire,
-- l'artiste ou son management, les médias et les sponsors, chacun avec sa
-- licence. Une salle de presse est une galerie de type 'press' (voir
-- worker/src/press.js) : elle réutilise l'envoi des photos, les aperçus en
-- tuiles filigranées et l'empreinte invisible.

-- Réglages de l'événement (un par galerie de type 'press').
CREATE TABLE IF NOT EXISTS press_events (
  gallery_id         TEXT PRIMARY KEY REFERENCES galleries(id) ON DELETE CASCADE,
  photographer_id    TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  event_date         TEXT NOT NULL DEFAULT '',      -- AAAA-MM-JJ
  venue              TEXT NOT NULL DEFAULT '',
  city               TEXT NOT NULL DEFAULT '',
  organiser          TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  -- Crédit imposé, écrit dans chaque fichier livré (ex. « Studio X / Festival Y »).
  credit_line        TEXT NOT NULL DEFAULT '',
  -- Validation des photos par le commanditaire ou l'artiste avant diffusion (0/1).
  approval_required  INTEGER NOT NULL DEFAULT 1,
  -- Heure avant laquelle médias et sponsors ne voient rien (epoch secondes).
  embargo_at         INTEGER,
  -- Demandes d'accréditation ouvertes sur la page publique de l'événement (0/1).
  accreditation_open INTEGER NOT NULL DEFAULT 0,
  -- Refus de l'entraînement d'IA écrit dans les fichiers (0/1).
  ai_reservation     INTEGER NOT NULL DEFAULT 1,
  review_opened_at   INTEGER,                      -- validation ouverte au commanditaire
  published_at       INTEGER,                      -- ouvert aux médias et sponsors
  closed_at          INTEGER,                      -- plus aucun téléchargement
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_press_events_photographer ON press_events(photographer_id);

-- Une ligne par photo d'une salle de presse : légendes, droit à l'image,
-- validation, et la « carte » de l'en-tête JPEG du fichier HD, calculée à
-- l'envoi, qui permet d'y écrire crédit et licence au téléchargement sans
-- relire le fichier (voir worker/src/pressfile.js).
CREATE TABLE IF NOT EXISTS press_photos (
  photo_id      TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  gallery_id    TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  headline      TEXT NOT NULL DEFAULT '',
  caption       TEXT NOT NULL DEFAULT '',
  byline        TEXT NOT NULL DEFAULT '',
  keywords      TEXT NOT NULL DEFAULT '',
  -- Droit à l'image : unknown, none (personne d'identifiable), release
  -- (autorisation signée), editorial (usage éditorial seulement), minor.
  people        TEXT NOT NULL DEFAULT 'unknown',
  -- Sponsors ou thèmes, séparés par des virgules (filtre des destinataires).
  tags          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  decided_by    TEXT NOT NULL DEFAULT '',         -- 'studio' ou id du destinataire
  decided_at    INTEGER,
  note          TEXT NOT NULL DEFAULT '',          -- motif d'un refus
  -- Fichier haute définition (R2 : {galleryId}/{photoId}/hd).
  hd_name       TEXT NOT NULL DEFAULT '',
  hd_size       INTEGER NOT NULL DEFAULT 0,
  hd_type       TEXT NOT NULL DEFAULT '',
  -- Carte de l'en-tête JPEG : fin de la zone d'en-tête relue au téléchargement,
  -- CRC-32 de tout ce qui suit, position d'insertion du XMP et segments XMP
  -- d'origine à retirer (JSON [[début, fin], …]).
  head_end      INTEGER NOT NULL DEFAULT 0,
  tail_crc      INTEGER NOT NULL DEFAULT 0,
  insert_at     INTEGER NOT NULL DEFAULT 0,
  strip         TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_press_photos_gallery ON press_photos(gallery_id, status);

-- Modèles de licence du studio, versionnés : modifier un modèle crée une
-- nouvelle version (même `family`), l'ancienne reste telle qu'acceptée.
CREATE TABLE IF NOT EXISTS press_licence_templates (
  id               TEXT PRIMARY KEY,
  family           TEXT NOT NULL,
  photographer_id  TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL DEFAULT 1,
  kind             TEXT NOT NULL,                  -- editorial, communication, advertising
  name             TEXT NOT NULL,
  -- Usages permis (JSON : ["print","web","social","tv","advertising",…]).
  usages           TEXT NOT NULL DEFAULT '[]',
  territory        TEXT NOT NULL DEFAULT 'world',  -- world, europe, benelux, belgium, france, netherlands
  duration_months  INTEGER NOT NULL DEFAULT 0,     -- 0 = sans limite de durée
  exclusive        INTEGER NOT NULL DEFAULT 0,
  price_cents      INTEGER NOT NULL DEFAULT 0,     -- prix indicatif, 0 = inclus
  extra_fr         TEXT NOT NULL DEFAULT '',       -- clause libre du studio
  extra_en         TEXT NOT NULL DEFAULT '',
  extra_nl         TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  superseded_at    INTEGER                         -- remplacée par une version plus récente
);
CREATE INDEX IF NOT EXISTS idx_press_tpl_photographer ON press_licence_templates(photographer_id, family);

-- Destinataires d'une salle de presse (et demandes d'accréditation).
CREATE TABLE IF NOT EXISTS press_recipients (
  id               TEXT PRIMARY KEY,
  gallery_id       TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  photographer_id  TEXT NOT NULL,
  role             TEXT NOT NULL,                  -- client, validator, press, sponsor, partner
  name             TEXT NOT NULL DEFAULT '',
  organisation     TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL DEFAULT '',
  lang             TEXT NOT NULL DEFAULT 'fr',
  template_family  TEXT NOT NULL DEFAULT '',       -- licence proposée
  tag_filter       TEXT NOT NULL DEFAULT '',       -- ne voit que ces photos (sponsors)
  press_card       TEXT NOT NULL DEFAULT '',
  message          TEXT NOT NULL DEFAULT '',       -- mot joint à une demande d'accréditation
  -- active ; pending / refused pour une demande d'accréditation.
  status           TEXT NOT NULL DEFAULT 'active',
  source           TEXT NOT NULL DEFAULT 'studio', -- studio, accreditation
  ip_hash          TEXT NOT NULL DEFAULT '',
  invited_at       INTEGER,
  last_seen_at     INTEGER,
  revoked_at       INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_press_recipients_gallery ON press_recipients(gallery_id, status);

-- Licences acceptées : jamais modifiées ni supprimées (preuve). Le texte exact
-- accepté est conservé, avec son empreinte SHA-256.
CREATE TABLE IF NOT EXISTS press_licences (
  id             TEXT PRIMARY KEY,
  gallery_id     TEXT NOT NULL,
  photographer_id TEXT NOT NULL,
  recipient_id   TEXT NOT NULL,
  template_id    TEXT NOT NULL,
  kind           TEXT NOT NULL,
  lang           TEXT NOT NULL,
  text           TEXT NOT NULL,
  text_sha256    TEXT NOT NULL,
  signer_name    TEXT NOT NULL,
  signer_email   TEXT NOT NULL DEFAULT '',
  organisation   TEXT NOT NULL DEFAULT '',
  ip_hash        TEXT NOT NULL DEFAULT '',
  user_agent     TEXT NOT NULL DEFAULT '',
  expires_at     INTEGER,
  accepted_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_press_licences_recipient ON press_licences(recipient_id, accepted_at);
CREATE INDEX IF NOT EXISTS idx_press_licences_gallery ON press_licences(gallery_id, accepted_at);

-- Journal des téléchargements : une ligne par photo téléchargée.
CREATE TABLE IF NOT EXISTS press_downloads (
  id            TEXT PRIMARY KEY,
  gallery_id    TEXT NOT NULL,
  recipient_id  TEXT NOT NULL,
  photo_id      TEXT NOT NULL,
  licence_id    TEXT NOT NULL,
  batch         TEXT NOT NULL DEFAULT '',          -- même valeur pour un ZIP
  bytes         INTEGER NOT NULL DEFAULT 0,
  ip_hash       TEXT NOT NULL DEFAULT '',
  ts            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_press_downloads_gallery ON press_downloads(gallery_id, ts);
CREATE INDEX IF NOT EXISTS idx_press_downloads_recipient ON press_downloads(recipient_id, ts);
