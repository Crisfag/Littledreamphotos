-- Schéma D1 (SQLite) — une base partagée par toute la plateforme : chaque
-- photographe a un compte, et ne voit que ses propres galeries.

CREATE TABLE IF NOT EXISTS photographers (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  studio_name    TEXT NOT NULL DEFAULT '',
  -- Identité de la personne (jamais affichée au client, contrairement au nom
  -- de studio) — sert à la page propriétaire (voir owner.js) pour identifier
  -- qui est derrière chaque compte. Facultatif, jamais exigé à l'inscription :
  -- les comptes créés avant cette fonctionnalité restent vides tant que le
  -- photographe ne les renseigne pas depuis Paramètres.
  first_name     TEXT NOT NULL DEFAULT '',
  last_name      TEXT NOT NULL DEFAULT '',
  -- Acceptation des conditions d'utilisation et de la politique de
  -- confidentialité à l'inscription (epoch secondes) et version des textes.
  terms_accepted_at INTEGER,
  terms_version  TEXT NOT NULL DEFAULT '',
  -- Abonnement Holypixx (voir worker/src/subscription.js) : formule
  -- souscrite (free, essentiel, pro), statut Stripe de l'abonnement, fin de
  -- la période en cours, résiliation programmée, identifiants Stripe.
  plan           TEXT NOT NULL DEFAULT 'free',
  plan_status    TEXT NOT NULL DEFAULT '',
  plan_renews_at INTEGER,
  plan_cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id     TEXT NOT NULL DEFAULT '',
  stripe_subscription_id TEXT NOT NULL DEFAULT '',
  plan_interval  TEXT NOT NULL DEFAULT '',   -- 'month' ou 'year' (facturation de l'abonnement)
  trial_used_at  INTEGER,                    -- essai gratuit consommé (une fois par compte)
  founder_at     INTEGER,                    -- place prise dans l'offre Fondateurs
  plan_started_at INTEGER,                   -- début de l'abonnement en cours (start_date Stripe)
  last_login_at  INTEGER,                    -- dernière connexion au tableau de bord
  founder_plan   TEXT NOT NULL DEFAULT '',   -- formule souscrite au prix Fondateurs (offre galeries ou Studio)
  -- Paiement en ligne des suppléments (Stripe Connect, comptes « Express ») :
  -- chaque photographe connecte son propre compte, l'argent lui arrive
  -- directement, jamais via un compte pivot. stripe_charges_enabled reflète
  -- l'état réel côté Stripe (mis à jour par le webhook account.updated, ou
  -- relu manuellement) : un identifiant seul ne veut pas dire que
  -- l'inscription est terminée.
  stripe_account_id       TEXT NOT NULL DEFAULT '',
  stripe_charges_enabled  INTEGER NOT NULL DEFAULT 0,
  -- Mentions à faire figurer sur les factures — jamais déduites d'ailleurs
  -- (le nom de studio sert à l'affichage, pas à la facturation).
  billing_company_name    TEXT NOT NULL DEFAULT '',
  billing_address         TEXT NOT NULL DEFAULT '',
  billing_vat_number      TEXT NOT NULL DEFAULT '',
  -- Numérotation des factures : continue et sans trou par photographe, en
  -- séries annuelles (ex. 2026-0001) — remise à zéro dès le premier
  -- règlement d'une nouvelle année civile, jamais en cours d'année.
  invoice_counter_year    INTEGER NOT NULL DEFAULT 0,
  invoice_counter         INTEGER NOT NULL DEFAULT 0,
  -- Mise en page proposée par défaut à la création d'une nouvelle galerie
  -- (le photographe peut toujours la changer au cas par cas ensuite — une
  -- valeur de départ, jamais imposée). Le filigrane, lui, se déduit déjà du
  -- nom de studio ci-dessus (voir admin-server.mjs, brandFor) : pas besoin
  -- d'un réglage séparé qui ferait doublon.
  default_layout          TEXT NOT NULL DEFAULT 'grille',
  -- Relances automatiques (client à J-7 et J-2 de l'expiration, photographe
  -- à J-2) tant que la sélection n'est pas validée. 1 = actives (défaut).
  reminders_enabled INTEGER NOT NULL DEFAULT 1,
  -- Sous-domaine du studio (ex. « julie » pour julie.holypixx.com) : les
  -- liens de galerie envoyés aux clients portent alors l'adresse du studio.
  -- Vide = pas de sous-domaine (liens sur le site principal). Unique entre
  -- comptes quand renseigné (voir l'index partiel ci-dessous) ; les noms
  -- réservés (www, api, admin…) sont refusés côté Worker (studio.js).
  subdomain      TEXT NOT NULL DEFAULT '',
  -- Boutique de tirages (Prodigi) : clé d'API du compte Prodigi DU
  -- photographe (c'est lui qui est facturé par le labo), chiffrée avec une
  -- clé dérivée d'AUTH_SECRET — jamais renvoyée en clair, ni au client ni à
  -- l'admin. Environnement « sandbox » (tests, rien n'est imprimé) ou
  -- « live ». Frais de port forfaitaires facturés au client, en centimes.
  prodigi_api_key_enc  TEXT NOT NULL DEFAULT '',
  prodigi_environment  TEXT NOT NULL DEFAULT 'sandbox',
  shop_shipping_cents  INTEGER NOT NULL DEFAULT 0,
  -- Compte BePhoto du photographe (labo des photos scolaires, schoollab.js) :
  -- l'API ne connaît que l'e-mail et le mot de passe du compte, chiffré
  -- comme la clé Prodigi ; le jeton de session obtenu est gardé (chiffré)
  -- pour ne pas se reconnecter à chaque appel.
  bephoto_email        TEXT NOT NULL DEFAULT '',
  bephoto_password_enc TEXT NOT NULL DEFAULT '',
  bephoto_token_enc    TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_photographers_subdomain
  ON photographers(subdomain) WHERE subdomain != '';

CREATE TABLE IF NOT EXISTS galleries (
  id                     TEXT PRIMARY KEY,
  photographer_id        TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  slug                   TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  client_name            TEXT NOT NULL DEFAULT '',
  -- Facultatif : sert uniquement à envoyer sa facture après un règlement de
  -- supplément — jamais utilisé pour se connecter (toujours le mot de passe).
  client_email           TEXT NOT NULL DEFAULT '',
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
  -- Mise en page proposée au client : 'grille' (vignettes régulières, défaut),
  -- 'mosaique' (colonnes façon presse, chaque photo garde son format) ou
  -- 'defilement' (une photo à la fois, en grand). Purement visuel — ne change
  -- rien au niveau de tuile chargé ni à la protection des images.
  layout                 TEXT NOT NULL DEFAULT 'grille',
  -- Forfait : nombre de photos incluses dans ce que le client a déjà payé.
  -- NULL = pas de forfait défini (comportement d'avant cette fonctionnalité :
  -- aucun supplément calculé, quel que soit le nombre de coups de cœur).
  included_photos        INTEGER,
  -- Prix d'une photo au-delà du forfait, en centimes (évite les erreurs
  -- d'arrondi d'un flottant, et c'est l'unité qu'utilisera le paiement en
  -- ligne le jour où il sera branché). 0 tant que le photographe n'a rien
  -- réglé.
  extra_photo_price_cents INTEGER NOT NULL DEFAULT 0,
  -- Musique d'ambiance importée par le photographe (nom du fichier d'origine,
  -- juste pour l'affichage) ; vide = aucune. Le fichier lui-même vit dans R2
  -- sous music/{id}.mp3. Jouée côté client en mise en page « défilement »,
  -- proposée en pause dans les autres — jamais imposée.
  music_name             TEXT NOT NULL DEFAULT '',
  -- Ou bien une piste de la bibliothèque commune (music_tracks.id), ou bien
  -- un lien Spotify / Deezer / SoundCloud / YouTube déjà converti en adresse
  -- de lecteur intégré officiel. Une seule source à la fois : choisir l'une
  -- vide les deux autres (voir worker/src/music.js).
  music_track_id         TEXT NOT NULL DEFAULT '',
  music_embed            TEXT NOT NULL DEFAULT '',
  -- Livraison des photos définitives (fichiers dans R2 sous
  -- {galleryId}/delivery/{fileId}, liste dans delivery_files) : ouverte au
  -- client ou non, quand, et quand il a été prévenu par e-mail.
  delivery_open          INTEGER NOT NULL DEFAULT 0,
  delivery_opened_at     INTEGER,
  delivery_notified_at   INTEGER,
  -- Promotion sur les tirages : remise en % (0 = aucune), date de fin, et
  -- quand elle a été annoncée au client par e-mail (voir campaigns.js).
  promo_percent          INTEGER NOT NULL DEFAULT 0,
  promo_ends_at          INTEGER,
  promo_sent_at          INTEGER,
  -- Moment où le client a cliqué « Valider ma sélection » (epoch secondes) ;
  -- NULL tant qu'il ne l'a pas fait. Arrête les relances automatiques.
  selection_done_at      INTEGER,
  -- Boutique de tirages ouverte au client sur cette galerie (0/1). Les
  -- photos importées tant qu'elle est ouverte gardent un fichier
  -- d'impression (R2, originals/{photoId}.jpg), jamais servi au client.
  shop_enabled           INTEGER NOT NULL DEFAULT 0,
  -- 'client' (galerie classique) ou 'school' : galerie protégée qui porte
  -- les photos d'un groupe scolaire (school_groups.gallery_id), jamais
  -- listée avec les galeries classiques ni comptée dans leur quota.
  kind                   TEXT NOT NULL DEFAULT 'client',
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
  tag          TEXT NOT NULL DEFAULT '',    -- code couleur posé par le client : '' | green | yellow | red
  marks        TEXT NOT NULL DEFAULT '[]',  -- repères annotés : JSON [{x, y, note}], x/y entre 0 et 1
  has_original INTEGER NOT NULL DEFAULT 0,  -- 1 = fichier d'impression en R2 (originals/{id}.jpg)
  original_bytes INTEGER NOT NULL DEFAULT 0, -- taille de ce fichier (espace de stockage, voir storage.js)
  -- Photo de groupe scolaire (voir school.js) : heure de prise de vue (ms,
  -- EXIF, à l'heure de l'appareil), nom du fichier d'origine, enfant auquel
  -- elle appartient (school_children.id, '' = à trier) et rôle ('' ou
  -- 'group' pour la photo de classe, vue par toutes les familles du groupe).
  taken_at     INTEGER,
  source_name  TEXT NOT NULL DEFAULT '',
  child_id     TEXT NOT NULL DEFAULT '',
  school_role  TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- Migration vers la mesure de l'espace de stockage (bases créées avant) :
--   ALTER TABLE photos ADD COLUMN original_bytes INTEGER NOT NULL DEFAULT 0;

-- Si une base existe déjà (galeries déjà envoyées) sans ces colonnes :
--   ALTER TABLE photos ADD COLUMN selected INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE photos ADD COLUMN selected_at INTEGER;
--   ALTER TABLE photos ADD COLUMN comment TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photos ADD COLUMN comment_at INTEGER;
--   ALTER TABLE photos ADD COLUMN tag TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photos ADD COLUMN marks TEXT NOT NULL DEFAULT '[]';

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

-- Migration vers la mise en page personnalisable (bases créées avant) :
--   ALTER TABLE galleries ADD COLUMN layout TEXT NOT NULL DEFAULT 'grille';

-- Migration vers le forfait et les suppléments (bases créées avant) :
--   ALTER TABLE galleries ADD COLUMN included_photos INTEGER;
--   ALTER TABLE galleries ADD COLUMN extra_photo_price_cents INTEGER NOT NULL DEFAULT 0;

-- Migration vers Stripe Connect et le profil de facturation (bases créées avant) :
--   ALTER TABLE photographers ADD COLUMN stripe_account_id TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN stripe_charges_enabled INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE photographers ADD COLUMN billing_company_name TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN billing_address TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN billing_vat_number TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_photos_gallery ON photos(gallery_id, position);

CREATE TABLE IF NOT EXISTS access_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_id TEXT NOT NULL,
  viewer_id  TEXT NOT NULL DEFAULT '',
  event      TEXT NOT NULL,   -- login, login_failed, view, select, deselect, comment, tag, mark, validate, capture_suspected, blur, print
  detail     TEXT NOT NULL DEFAULT '',
  -- Photo affichée au moment de l'évènement (capture_suspected, print,
  -- devtools) : permet d'alerter le photographe sur LA photo concernée,
  -- pas seulement « une capture a eu lieu ». Vide si aucune photo n'était
  -- ouverte en plein écran (ex. capture depuis la grille de vignettes).
  photo_id   TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ts         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_gallery ON access_log(gallery_id, ts);

-- Migration vers la référence de photo sur les évènements de capture
-- (bases créées avant cette fonctionnalité) :
--   ALTER TABLE access_log ADD COLUMN photo_id TEXT NOT NULL DEFAULT '';

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

-- Réinitialisation du mot de passe d'un compte photographe (celui de
-- connexion à l'interface, pas celui d'une galerie — qui se régénère déjà
-- directement depuis le tableau de bord). token_hash est une empreinte, la
-- valeur brute part uniquement dans le lien envoyé par e-mail.
CREATE TABLE IF NOT EXISTS password_resets (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_photographer ON password_resets(photographer_id, created_at);

-- Migration (bases créées avant cette fonctionnalité) :
--   CREATE TABLE IF NOT EXISTS password_resets (
--     id              TEXT PRIMARY KEY,
--     photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
--     token_hash      TEXT NOT NULL UNIQUE,
--     expires_at      INTEGER NOT NULL,
--     used_at         INTEGER,
--     created_at      INTEGER NOT NULL
--   );
--   CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
--   CREATE INDEX IF NOT EXISTS idx_password_resets_photographer ON password_resets(photographer_id, created_at);

-- Règlement en ligne des suppléments (Stripe Checkout, paiement direct sur le
-- compte Connect du photographe). Une ligne par session de paiement créée —
-- « pending » tant que le client n'a pas terminé, « paid » une fois confirmé
-- par le webhook Stripe (jamais par le simple retour du navigateur, qui peut
-- mentir ou ne jamais arriver). extra_count fige le nombre de suppléments
-- couverts par CE règlement : la somme des lignes « paid » d'une galerie dit
-- combien ont déjà été payés, pour ne jamais faire payer deux fois la même
-- photo si le client en sélectionne encore plus ensuite.
CREATE TABLE IF NOT EXISTS payments (
  id                          TEXT PRIMARY KEY,
  gallery_id                  TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  stripe_checkout_session_id  TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id    TEXT NOT NULL DEFAULT '',
  extra_count                 INTEGER NOT NULL,
  amount_cents                INTEGER NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'pending', -- pending, paid
  -- 'supplement' (photos au-delà du forfait) ou 'print' (commande de
  -- tirages, détaillée dans print_orders). extra_count vaut 0 pour 'print' :
  -- une commande de tirages ne change jamais le décompte des suppléments.
  kind                        TEXT NOT NULL DEFAULT 'supplement',
  -- Frais de paiement retenus sur la vente (application_fee_amount Stripe)
  -- pour couvrir les frais Stripe payés par la plateforme (voir fees.js).
  -- Le photographe reçoit amount_cents - fee_cents.
  fee_cents                   INTEGER NOT NULL DEFAULT 0,
  created_at                  INTEGER NOT NULL,
  paid_at                     INTEGER
);

-- Migration vers les frais de paiement refacturés (bases créées avant) :
--   ALTER TABLE payments ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_payments_gallery ON payments(gallery_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(stripe_checkout_session_id);

-- Migration vers le règlement en ligne des suppléments (bases créées avant) :
--   CREATE TABLE IF NOT EXISTS payments (
--     id                          TEXT PRIMARY KEY,
--     gallery_id                  TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
--     stripe_checkout_session_id  TEXT NOT NULL UNIQUE,
--     stripe_payment_intent_id    TEXT NOT NULL DEFAULT '',
--     extra_count                 INTEGER NOT NULL,
--     amount_cents                INTEGER NOT NULL,
--     status                      TEXT NOT NULL DEFAULT 'pending',
--     created_at                  INTEGER NOT NULL,
--     paid_at                     INTEGER
--   );
--   CREATE INDEX IF NOT EXISTS idx_payments_gallery ON payments(gallery_id, status);
--   CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(stripe_checkout_session_id);

-- Migration vers l'e-mail client et la numérotation des factures (bases créées avant) :
--   ALTER TABLE galleries ADD COLUMN client_email TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN invoice_counter_year INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE photographers ADD COLUMN invoice_counter INTEGER NOT NULL DEFAULT 0;

-- Facture émise automatiquement dès qu'un paiement passe à "paid" (voir
-- billing.js). Toujours un seul montant total (TTC) : reprend exactement
-- amount_cents du paiement réglé, jamais recalculé. Les colonnes seller_*
-- sont un instantané des coordonnées de facturation du photographe AU
-- MOMENT de l'émission — une facture déjà émise ne doit jamais changer si le
-- photographe modifie ensuite son profil. vat_rate_percent à 0 signifie
-- régime de la franchise (aucun numéro de TVA renseigné à l'émission) :
-- vat_amount_cents vaut alors 0 et net_amount_cents == amount_cents. Le PDF
-- lui-même vit dans R2, sous invoices/{id}.pdf.
CREATE TABLE IF NOT EXISTS invoices (
  id                   TEXT PRIMARY KEY,
  photographer_id      TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  gallery_id           TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  payment_id           TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  number               TEXT NOT NULL,
  issued_at            INTEGER NOT NULL,
  amount_cents         INTEGER NOT NULL,
  vat_rate_percent     INTEGER NOT NULL DEFAULT 0,
  vat_amount_cents     INTEGER NOT NULL DEFAULT 0,
  net_amount_cents     INTEGER NOT NULL,
  client_name          TEXT NOT NULL DEFAULT '',
  seller_company_name  TEXT NOT NULL DEFAULT '',
  seller_address       TEXT NOT NULL DEFAULT '',
  seller_vat_number    TEXT NOT NULL DEFAULT '',
  emailed_to           TEXT NOT NULL DEFAULT '',
  created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_photographer ON invoices(photographer_id, number);

-- Migration (bases créées avant cette fonctionnalité) :
--   CREATE TABLE IF NOT EXISTS invoices (
--     id                   TEXT PRIMARY KEY,
--     photographer_id      TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
--     gallery_id           TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
--     payment_id           TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
--     number               TEXT NOT NULL,
--     issued_at            INTEGER NOT NULL,
--     amount_cents         INTEGER NOT NULL,
--     vat_rate_percent     INTEGER NOT NULL DEFAULT 0,
--     vat_amount_cents     INTEGER NOT NULL DEFAULT 0,
--     net_amount_cents     INTEGER NOT NULL,
--     client_name          TEXT NOT NULL DEFAULT '',
--     seller_company_name  TEXT NOT NULL DEFAULT '',
--     seller_address       TEXT NOT NULL DEFAULT '',
--     seller_vat_number    TEXT NOT NULL DEFAULT '',
--     emailed_to           TEXT NOT NULL DEFAULT '',
--     created_at           INTEGER NOT NULL
--   );
--   CREATE INDEX IF NOT EXISTS idx_invoices_photographer ON invoices(photographer_id, number);

-- Migration vers le tableau de bord réorganisé (compte, présentation par
-- défaut) — bases créées avant :
--   ALTER TABLE photographers ADD COLUMN default_layout TEXT NOT NULL DEFAULT 'grille';

-- Changement d'adresse e-mail du compte : jamais immédiat, toujours confirmé
-- par un lien envoyé sur la NOUVELLE adresse (même logique que
-- password_resets) — ça évite qu'une session volée suffise à détourner
-- silencieusement les notifications d'un compte. new_email est en clair (on
-- en a besoin pour l'appliquer une fois confirmé) ; token_hash est une
-- empreinte, comme partout ailleurs.
CREATE TABLE IF NOT EXISTS email_changes (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  new_email       TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_changes_token ON email_changes(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_changes_photographer ON email_changes(photographer_id, created_at);

-- Migration (bases créées avant cette fonctionnalité) :
--   CREATE TABLE IF NOT EXISTS email_changes (
--     id              TEXT PRIMARY KEY,
--     photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
--     new_email       TEXT NOT NULL,
--     token_hash      TEXT NOT NULL UNIQUE,
--     expires_at      INTEGER NOT NULL,
--     used_at         INTEGER,
--     created_at      INTEGER NOT NULL
--   );
--   CREATE INDEX IF NOT EXISTS idx_email_changes_token ON email_changes(token_hash);
--   CREATE INDEX IF NOT EXISTS idx_email_changes_photographer ON email_changes(photographer_id, created_at);

-- Migration vers la page propriétaire (prénom/nom des comptes) — bases créées avant :
--   ALTER TABLE photographers ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN last_name TEXT NOT NULL DEFAULT '';

-- Migration vers la musique d'ambiance (bases créées avant) :
--   ALTER TABLE galleries ADD COLUMN music_name TEXT NOT NULL DEFAULT '';
--   ALTER TABLE galleries ADD COLUMN selection_done_at INTEGER;
--   ALTER TABLE photographers ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 1;
--   ALTER TABLE photographers ADD COLUMN subdomain TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN prodigi_api_key_enc TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN prodigi_environment TEXT NOT NULL DEFAULT 'sandbox';
--   ALTER TABLE photographers ADD COLUMN shop_shipping_cents INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE galleries ADD COLUMN shop_enabled INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE photos ADD COLUMN has_original INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'supplement';
--   puis les tables print_products et print_orders (fin de ce fichier).
--   ALTER TABLE print_products ADD COLUMN catalog_ref TEXT NOT NULL DEFAULT '';
--   ALTER TABLE print_products ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE print_products ADD COLUMN ship_cost_cents INTEGER NOT NULL DEFAULT 0;
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_photographers_subdomain ON photographers(subdomain) WHERE subdomain != '';
--   ALTER TABLE galleries ADD COLUMN music_track_id TEXT NOT NULL DEFAULT '';
--   ALTER TABLE galleries ADD COLUMN music_embed TEXT NOT NULL DEFAULT '';
--   puis la table music_tracks (fin de ce fichier).
--   ALTER TABLE galleries ADD COLUMN delivery_open INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE galleries ADD COLUMN delivery_opened_at INTEGER;
--   ALTER TABLE galleries ADD COLUMN delivery_notified_at INTEGER;
--   puis la table delivery_files (fin de ce fichier).
--   ALTER TABLE photographers ADD COLUMN terms_accepted_at INTEGER;
--   ALTER TABLE photographers ADD COLUMN terms_version TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
--   ALTER TABLE photographers ADD COLUMN plan_status TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN plan_renews_at INTEGER;
--   ALTER TABLE photographers ADD COLUMN plan_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE photographers ADD COLUMN stripe_customer_id TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN stripe_subscription_id TEXT NOT NULL DEFAULT '';
-- Migration vers la formule annuelle, l'essai et l'offre Fondateurs :
--   ALTER TABLE photographers ADD COLUMN plan_interval TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN trial_used_at INTEGER;
--   ALTER TABLE photographers ADD COLUMN founder_at INTEGER;
--   ALTER TABLE photographers ADD COLUMN plan_started_at INTEGER;
--   ALTER TABLE photographers ADD COLUMN last_login_at INTEGER;
--   ALTER TABLE photographers ADD COLUMN founder_plan TEXT NOT NULL DEFAULT '';
--   ALTER TABLE galleries ADD COLUMN promo_percent INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE galleries ADD COLUMN promo_ends_at INTEGER;
--   ALTER TABLE galleries ADD COLUMN promo_sent_at INTEGER;
--   puis la table print_carts (fin de ce fichier).

-- Relances déjà envoyées, pour ne jamais relancer deux fois pour la même
-- échéance : une ligne par galerie et par type (client_j7, client_j2,
-- photographer_j2). Alimentée par le déclencheur planifié (voir
-- worker/src/reminders.js) ; purgée avec la galerie.
CREATE TABLE IF NOT EXISTS reminders_sent (
  gallery_id TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (gallery_id, kind)
);

-- Boutique de tirages : catalogue propre à chaque photographe. `sku` et
-- `attributes` (JSON) sont ceux du catalogue Prodigi ; `price_cents` est le
-- prix TTC payé par le client (la marge du photographe = ce prix moins le
-- coût facturé par Prodigi, que l'admin permet d'estimer par un devis).
CREATE TABLE IF NOT EXISTS print_products (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  sku             TEXT NOT NULL,
  attributes      TEXT NOT NULL DEFAULT '{}',
  price_cents     INTEGER NOT NULL,
  -- Produit choisi dans le catalogue intégré (printCatalogue.js) :
  -- « produit|format|option », vide pour une référence saisie à la main.
  catalog_ref     TEXT NOT NULL DEFAULT '',
  -- Dernier coût connu chez Prodigi (produit seul, et livraison pour une
  -- unité), en centimes — pour afficher la marge sans redemander un devis.
  cost_cents      INTEGER NOT NULL DEFAULT 0,
  ship_cost_cents INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_print_products_photographer ON print_products(photographer_id, position);

-- Commandes de tirages. Le paiement passe par `payments` (kind = 'print') :
-- même session Stripe, même webhook, même facture que les suppléments. Les
-- lignes commandées sont figées en JSON au moment de la commande (libellé,
-- SKU, prix) : changer ensuite le catalogue ne modifie jamais une commande.
-- status : pending_payment, paid, submitted, in_production, shipped,
--          cancelled, failed (envoi au labo refusé — à relancer depuis l'admin).
CREATE TABLE IF NOT EXISTS print_orders (
  id                 TEXT PRIMARY KEY,
  gallery_id         TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  photographer_id    TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  payment_id         TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending_payment',
  items              TEXT NOT NULL,
  recipient          TEXT NOT NULL,
  client_email       TEXT NOT NULL,
  items_cents        INTEGER NOT NULL,
  shipping_cents     INTEGER NOT NULL,
  total_cents        INTEGER NOT NULL,
  prodigi_order_id   TEXT NOT NULL DEFAULT '',
  prodigi_stage      TEXT NOT NULL DEFAULT '',
  tracking_url       TEXT NOT NULL DEFAULT '',
  error              TEXT NOT NULL DEFAULT '',
  submit_attempts    INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  paid_at            INTEGER,
  submitted_at       INTEGER,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_print_orders_gallery ON print_orders(gallery_id, created_at);
CREATE INDEX IF NOT EXISTS idx_print_orders_photographer ON print_orders(photographer_id, created_at);

-- Bibliothèque musicale commune : morceaux libres de droits ajoutés par la
-- propriétaire de la plateforme (onglet Admin), que chaque photographe peut
-- choisir pour ses galeries. Le fichier vit dans R2 sous
-- library/music/{id}.mp3 ; `credit` est la mention exigée par la licence
-- (ex. « Kevin MacLeod — CC BY 4.0 »), affichée discrètement au client.
CREATE TABLE IF NOT EXISTS music_tracks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL DEFAULT '',
  mood        TEXT NOT NULL DEFAULT '',
  credit      TEXT NOT NULL DEFAULT '',
  duration_s  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Photos définitives livrées au client (haute définition, sans filigrane).
-- `crc32` est calculé à l'envoi par l'outil d'administration : il permet au
-- Worker de fabriquer le ZIP de téléchargement au fil de l'eau, sans relire
-- les fichiers (voir worker/src/delivery.js).
CREATE TABLE IF NOT EXISTS delivery_files (
  id           TEXT PRIMARY KEY,
  gallery_id   TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  crc32        INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_files_gallery ON delivery_files(gallery_id, position);

-- Panier de tirages du client, enregistré côté serveur (une ligne par
-- galerie) : retrouvé sur un autre appareil, et rappelé par e-mail s'il est
-- laissé 24 h sans commande (reminded_at, remis à zéro quand il change).
CREATE TABLE IF NOT EXISTS print_carts (
  gallery_id  TEXT PRIMARY KEY REFERENCES galleries(id) ON DELETE CASCADE,
  lines       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  reminded_at INTEGER
);

-- Mini-site portfolio du photographe (voir worker/src/portfolio.js) : une
-- ligne par compte. `handle` est l'identifiant de l'adresse publique
-- (www.holypixx.com/portfolio.html?s=<handle>) ; les photos de vitrine
-- vivent dans R2 sous portfolio/{photographer_id}/{id}.webp.
CREATE TABLE IF NOT EXISTS portfolios (
  photographer_id TEXT PRIMARY KEY REFERENCES photographers(id) ON DELETE CASCADE,
  handle          TEXT NOT NULL UNIQUE,
  published       INTEGER NOT NULL DEFAULT 0,
  headline        TEXT NOT NULL DEFAULT '',
  bio             TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  services        TEXT NOT NULL DEFAULT '[]',
  phone           TEXT NOT NULL DEFAULT '',
  instagram       TEXT NOT NULL DEFAULT '',
  website         TEXT NOT NULL DEFAULT '',
  contact_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_photos (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  bytes           INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portfolio_photos ON portfolio_photos(photographer_id, position);

-- Messages reçus par le formulaire de contact du portfolio, conservés un an.
-- ip_hash (empreinte salée, jamais l'IP) sert seulement à plafonner les envois.
CREATE TABLE IF NOT EXISTS portfolio_messages (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  event_date      TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL,
  ip_hash         TEXT NOT NULL,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portfolio_messages ON portfolio_messages(photographer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_messages_ip ON portfolio_messages(ip_hash, created_at);

-- Module photo de groupe (écoles, crèches, clubs sportifs) : voir school.js.
-- Un établissement se crée une fois ; chaque année (ou saison) reprend ses
-- groupes (classes, sections, équipes). Les enfants et leurs photos se
-- rattachent aux groupes.
CREATE TABLE IF NOT EXISTS schools (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'ecole',   -- ecole, creche, club
  name            TEXT NOT NULL,
  address         TEXT NOT NULL DEFAULT '',
  contact_name    TEXT NOT NULL DEFAULT '',
  contact_email   TEXT NOT NULL DEFAULT '',
  contact_phone   TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schools_photographer ON schools(photographer_id, created_at);

CREATE TABLE IF NOT EXISTS school_years (
  id             TEXT PRIMARY KEY,
  school_id      TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,                    -- « 2026-2027 »
  -- Commande groupée (livrée à l'établissement) jusqu'à order_deadline, puis
  -- commande à domicile jusqu'à late_deadline (epoch secondes, NULL = non fixée).
  order_deadline INTEGER,
  late_deadline  INTEGER,
  status         TEXT NOT NULL DEFAULT 'draft',    -- draft, open, closed, archived
  -- Frais de port d'une commande livrée à domicile (après la commande
  -- groupée), en centimes.
  home_shipping_cents INTEGER NOT NULL DEFAULT 0,
  -- Rappels par e-mail aux familles sans commande (schoolreminders.js),
  -- 7 et 2 jours avant la date limite : 1 oui, 0 non.
  family_reminders INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_years_school ON school_years(school_id, created_at);

CREATE TABLE IF NOT EXISTS school_groups (
  id         TEXT PRIMARY KEY,
  year_id    TEXT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                        -- « P3 », « Section des grands », « U9 »
  leader     TEXT NOT NULL DEFAULT '',             -- enseignant, puéricultrice, entraîneur
  sort       INTEGER NOT NULL DEFAULT 0,
  -- Galerie protégée (kind = 'school') qui porte les photos du groupe,
  -- créée au premier import ; '' tant qu'aucune photo n'a été envoyée.
  gallery_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_groups_year ON school_groups(year_id, sort);

-- Enfants d'un groupe, nés du regroupement des photos par rafale : un
-- numéro d'ordre (« Enfant 7 ») et un prénom facultatif — la fiche parent
-- porte le portrait, le nom n'est jamais exigé.
CREATE TABLE IF NOT EXISTS school_children (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES school_groups(id) ON DELETE CASCADE,
  number     INTEGER NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  -- Code d'accès de la famille (fiche parent) : 8 caractères sans
  -- ambiguïté (ni 0/O ni 1/I), unique sur la plateforme ; '' tant que les
  -- fiches n'ont pas été préparées. Stable une fois attribué.
  access_code TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_children_group ON school_children(group_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_children_code ON school_children(access_code) WHERE access_code != '';

-- Migration (bases créées avant le module) : les CREATE TABLE ci-dessus,
-- plus :
--   ALTER TABLE photographers ADD COLUMN founder_plan TEXT NOT NULL DEFAULT '';
--   ALTER TABLE galleries ADD COLUMN kind TEXT NOT NULL DEFAULT 'client';
--   ALTER TABLE school_groups ADD COLUMN gallery_id TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photos ADD COLUMN taken_at INTEGER;
--   ALTER TABLE photos ADD COLUMN source_name TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photos ADD COLUMN child_id TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photos ADD COLUMN school_role TEXT NOT NULL DEFAULT '';
--   ALTER TABLE school_children ADD COLUMN access_code TEXT NOT NULL DEFAULT '';
--   ALTER TABLE school_years ADD COLUMN home_shipping_cents INTEGER NOT NULL DEFAULT 0;

-- Espace famille (family.js, page ecole.html) : une famille = une adresse
-- e-mail ; ses enfants y sont rattachés par le code de leur fiche. Pas de
-- mot de passe : le code ouvre l'accès, un lien de connexion envoyé par
-- e-mail permet de revenir (family_links : empreinte du jeton, une demi-
-- heure, usage unique).
CREATE TABLE IF NOT EXISTS families (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  reminders_off INTEGER NOT NULL DEFAULT 0  -- 1 : ne veut plus de rappels de commande
);

CREATE TABLE IF NOT EXISTS family_children (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id  TEXT NOT NULL REFERENCES school_children(id) ON DELETE CASCADE,
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id)
);
CREATE INDEX IF NOT EXISTS idx_family_children_child ON family_children(child_id);

CREATE TABLE IF NOT EXISTS family_links (
  token_hash TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_links_family ON family_links(family_id, created_at);

-- Commande des familles (schoolshop.js) : la gamme et les prix d'une année
-- (pochettes, tirages, fichiers numériques ; sur un portrait ou sur la
-- photo de groupe), puis les commandes payées par Stripe (charge de
-- destination vers le photographe), une ligne par article.
CREATE TABLE IF NOT EXISTS school_products (
  id          TEXT PRIMARY KEY,
  year_id     TEXT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'pochette',   -- pochette, tirage, numerique
  scope       TEXT NOT NULL DEFAULT 'portrait',   -- portrait, group
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',           -- contenu d'une pochette, format…
  price_cents INTEGER NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  -- Ce que le labo imprime pour un exemplaire : JSON
  -- [{ idproduct, idpaper, quantity, label }] (produits BePhoto). Vide = pas
  -- encore composé (ou fichier numérique, rien à imprimer).
  lab_items   TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_products_year ON school_products(year_id, sort);

CREATE TABLE IF NOT EXISTS school_orders (
  id                TEXT PRIMARY KEY,
  year_id           TEXT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  family_id         TEXT NOT NULL,
  email             TEXT NOT NULL,
  delivery          TEXT NOT NULL DEFAULT 'school',  -- school, home
  shipping_cents    INTEGER NOT NULL DEFAULT 0,
  amount_cents      INTEGER NOT NULL,
  fee_cents         INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending, paid
  shipping_name     TEXT NOT NULL DEFAULT '',
  shipping_address  TEXT NOT NULL DEFAULT '',        -- JSON (adresse Stripe), commande à domicile
  stripe_session_id TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,
  paid_at           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_school_orders_year ON school_orders(year_id, status);
CREATE INDEX IF NOT EXISTS idx_school_orders_family ON school_orders(family_id, created_at);
CREATE INDEX IF NOT EXISTS idx_school_orders_session ON school_orders(stripe_session_id);

CREATE TABLE IF NOT EXISTS school_order_lines (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES school_orders(id) ON DELETE CASCADE,
  child_id    TEXT NOT NULL,
  group_id    TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  photo_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,           -- nom du produit au moment de la commande
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  quantity    INTEGER NOT NULL,
  batch_id    TEXT NOT NULL DEFAULT ''  -- lot d'envoi au labo ('' = pas encore parti)
);
CREATE INDEX IF NOT EXISTS idx_school_order_lines_order ON school_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_school_order_lines_group ON school_order_lines(group_id);
CREATE INDEX IF NOT EXISTS idx_school_order_lines_batch ON school_order_lines(batch_id);

-- Lots d'envoi au labo (schoollab.js) : le photographe regroupe les articles
-- payés pas encore partis, une ou deux fois pendant la vente (conseil du
-- labo), soit pour l'établissement, soit pour les envois à domicile. Un
-- article n'appartient qu'à un lot : il ne part jamais deux fois. Envoi à
-- BePhoto pas à pas (lab_cursor = lignes déjà transmises), pour rester sous
-- les limites d'un appel et reprendre après une coupure.
CREATE TABLE IF NOT EXISTS school_lab_batches (
  id               TEXT PRIMARY KEY,
  year_id          TEXT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  number           INTEGER NOT NULL,
  delivery         TEXT NOT NULL DEFAULT 'school',  -- school, home
  status           TEXT NOT NULL DEFAULT 'ready',   -- ready, sending, sent
  lab              TEXT NOT NULL DEFAULT '',        -- '' (fichier envoyé à la main), bephoto
  lab_order_id     TEXT NOT NULL DEFAULT '',
  lab_items        TEXT NOT NULL DEFAULT '',        -- JSON figé au début de l'envoi
  lab_cursor       INTEGER NOT NULL DEFAULT 0,
  lab_total        TEXT NOT NULL DEFAULT '',        -- total annoncé par le labo
  error            TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  sent_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_school_lab_batches_year ON school_lab_batches(year_id, number);
-- Migration (base existante) :
--   ALTER TABLE photographers ADD COLUMN bephoto_email TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN bephoto_password_enc TEXT NOT NULL DEFAULT '';
--   ALTER TABLE photographers ADD COLUMN bephoto_token_enc TEXT NOT NULL DEFAULT '';
--   ALTER TABLE school_products ADD COLUMN lab_items TEXT NOT NULL DEFAULT '';
--   ALTER TABLE school_order_lines ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';

-- Rappels de commande envoyés aux familles (schoolreminders.js) : une ligne
-- par année, famille et rappel (j7, j2, late2) ; jamais deux fois le même.
CREATE TABLE IF NOT EXISTS school_reminders (
  year_id   TEXT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  kind      TEXT NOT NULL,
  sent_at   INTEGER NOT NULL,
  PRIMARY KEY (year_id, family_id, kind)
);
-- Migration (base existante) :
--   ALTER TABLE school_years ADD COLUMN family_reminders INTEGER NOT NULL DEFAULT 1;
--   ALTER TABLE families ADD COLUMN reminders_off INTEGER NOT NULL DEFAULT 0;
