# Holypixx

Galeries de visionnage protégées pour photographes : le client voit ses
photos avec un mot de passe, sans pouvoir les télécharger — et si une image
fuite malgré tout, on sait de quelle galerie elle vient.

---

## Ce que ça fait, et ce que ça ne fait pas

Commençons par là, parce que tout le reste en découle.

**La capture d'écran ne peut pas être bloquée dans un navigateur.** C'est le
système d'exploitation qui capture l'écran ; aucun JavaScript n'a autorité
là-dessus. Même le DRM matériel de Netflix n'obtient un écran noir que sur
certains couples navigateur/système — et un téléphone braqué sur l'écran gagne
toujours. Quiconque vend une « galerie anti-capture » sur le web se trompe ou
vous trompe.

Ce projet vise donc autre chose : **rendre le vol peu rentable et traçable.**

| | Résultat |
|---|---|
| Télécharger le fichier | **Empêché.** Les photos sont découpées en tuiles réassemblées dans un canvas : aucune URL ne renvoie une image entière, « enregistrer l'image sous » ne propose rien, un aspirateur de site ne trouve rien. |
| Capture d'écran | **Non empêchée** — impossible. Découragée (voile au moindre changement de focus, presse-papiers remplacé) et consignée au journal. |
| Qualité du butin | **Inexploitable.** 1600 px de large, filigranés : bon pour un écran, sans valeur pour un tirage. |
| Filigrane retiré par IA | **Coûteux.** Trame dense traversant tout le sujet, visages compris : l'IA doit reconstruire ce qu'elle ne voit pas, et ça se remarque. |
| Retrouver l'origine d'une fuite | **Oui.** Empreinte invisible propre à chaque galerie, lisible après capture d'écran, recadrage, redimensionnement, noir et blanc ou ré-encodage JPEG. |

La dernière ligne est le vrai changement : on passe de « j'espère que personne
ne vole » à « je sais de quelle galerie ça vient », ce qui est exploitable
juridiquement.

---

## Comment c'est fait

```
galerie/
├── worker/     API sur Cloudflare Workers (authentification, tuiles, journaux)
├── tools/      Outils photographe : ligne de commande, interface web, détection de fuite
└── web/        Page vue par le client
```

Deux façons d'envoyer une galerie, au choix — elles utilisent exactement le
même code de traitement (`tools/lib/pipeline.mjs`) et produisent des tuiles
identiques :

- **`prepare.mjs`**, en ligne de commande — pratique pour scripter ou traiter
  un gros lot d'un coup.
- **`admin-server.mjs`**, une interface web locale — glisser-déposer,
  suivi de progression par photo, tableau de bord des galeries, journal
  d'accès. Tourne sur votre machine (`http://127.0.0.1:4000`) : c'est elle qui
  a besoin de sharp pour traiter les images, donc elle ne peut pas être
  hébergée sur Cloudflare comme le reste. Le navigateur ne voit jamais le
  jeton d'administration ni la clé forensique — seul ce serveur local les
  porte.

Un déploiement par photographe. C'est gratuit dans les offres d'entrée de
Cloudflare, vos photos restent sur votre compte, et ça évite une base de
données partagée entre confrères.

### Ce qui se passe à la préparation

1. Réduction à 1600 px et suppression des métadonnées (EXIF, GPS).
2. **Empreinte invisible** gravée dans les pixels : ±3 niveaux de luminance en
   damier sur des blocs de 16 px, selon un motif dérivé de votre clé secrète.
   Invisible (PSNR ≈ 37 dB), et sans la clé on ne sait pas où elle est — donc
   pas comment l'effacer.
3. **Filigrane visible** en trame diagonale, tracé sombre et clair superposés
   pour rester lisible sur une robe blanche comme sur un fond noir.
4. Découpage en deux niveaux (vignette 500 px, plein écran 1600 px) et envoi
   tuile par tuile.

L'original haute définition ne quitte jamais votre disque.

### Ce qui se passe côté client

Mot de passe → jeton de session signé, valable deux heures → les tuiles ne
partent qu'avec ce jeton, sans jamais être mises en cache. Les photos sont
peintes dans un `<canvas>`, jamais dans une balise `<img>`.

Le client peut aussi **marquer ses coups de cœur** — un cœur sur chaque
vignette et dans la visionneuse, une case « afficher uniquement ma sélection »
pour ne revoir que celles-là. C'est la vraie raison d'envoyer une galerie de
visionnage : le client choisit, vous ne retouchez et ne livrez que ce qu'il a
choisi. La sélection est partagée entre tous ceux qui ont le mot de passe
(le couple, la famille) plutôt que liée à un compte individuel, et elle
survit à une reconnexion — elle est enregistrée côté Worker, pas dans le
navigateur.

Et **laisser une remarque photo par photo** — « celle-ci plutôt en noir et
blanc », « peut-on la recadrer un peu ? » — depuis la visionneuse, sauvegardée
automatiquement pendant la frappe (pas de bouton « valider » à chercher).

### Comptes photographes

La plateforme est pensée pour plusieurs photographes, chacun avec son propre
compte (e-mail + mot de passe). Chaque compte ne voit, ne modifie et ne peut
même deviner l'existence que de ses propres galeries — jamais celles d'un
autre photographe. C'est vérifié explicitement par les tests (voir *Fiabilité
mesurée*), pas seulement supposé par construction.

Aujourd'hui, la préparation des photos (traitement, filigrane, envoi) se fait
encore depuis l'ordinateur du photographe : `admin-server.mjs`, où chaque
photographe se connecte avec son propre compte depuis le navigateur (comme
il le ferait sur un vrai site), ou `prepare.mjs` en ligne de commande, qui
utilise ce même compte via `GALERIE_EMAIL`/`GALERIE_PASSWORD`. Le compte est
donc déjà celui qui servira le jour où cette interface sera hébergée en
ligne plutôt que lancée à la main (voir *Ce qu'il reste à faire*).

---

## Installation

### 1. Le Worker

```bash
cd worker
npm install
npx wrangler login

npx wrangler d1 create galerie-protegee     # recopiez l'identifiant dans wrangler.toml
npx wrangler r2 bucket create galerie-tuiles
npm run db:init

# Clés de signature des sessions : comptes photographes, et sessions client
# d'une galerie. Deux clés distinctes, pour qu'un jeton de l'une ne puisse
# jamais être rejoué comme jeton de l'autre.
npx wrangler secret put AUTH_SECRET         # openssl rand -hex 32
npx wrangler secret put TOKEN_SECRET        # openssl rand -hex 32

npm run deploy
```

Renseignez ensuite dans `wrangler.toml` la variable `ALLOWED_ORIGINS` avec
l'adresse du site qui héberge la page galerie, puis redéployez.

### 2. La page client

Copiez `web/galerie.html`, `web/gallery.css` et `web/gallery.js` à la racine de
votre site, et renseignez l'adresse du Worker dans `galerie.html` :

```js
window.GALERIE_CONFIG = {
  api: "https://galerie-protegee.votre-sous-domaine.workers.dev",
  clipboardGuard: true,   // remplace le presse-papiers après une capture
};
```

### 3. Les outils

```bash
cd tools
npm install

export GALERIE_API=https://galerie-protegee.votre-sous-domaine.workers.dev

# Créez votre compte photographe une seule fois :
node signup.mjs --email vous@exemple.com --password "un-mot-de-passe-solide" --studio "Mon Studio"

# GALERIE_EMAIL / GALERIE_PASSWORD : uniquement pour la ligne de commande
# (prepare.mjs, detect.mjs), qui n'a pas de navigateur pour se connecter.
export GALERIE_EMAIL=vous@exemple.com
export GALERIE_PASSWORD=…
export GALERIE_FORENSIC_KEY=$(openssl rand -hex 32)

# Optionnel : adresse publique de web/galerie.html, pour que l'interface
# affiche un lien complet à donner au client plutôt qu'un simple « ?g=… ».
export GALERIE_SITE=https://www.littledreamphotos.com/galerie.html
```

> **`admin-server.mjs` n'a besoin ni de `GALERIE_EMAIL` ni de
> `GALERIE_PASSWORD`** : chaque photographe se connecte depuis le
> formulaire, dans le navigateur, avec son propre compte.

> **La clé forensique se génère une fois et ne change jamais.** Sans elle,
> aucune fuite passée n'est traçable. Conservez-la comme un mot de passe
> maître, hors du dépôt.

---

## Utilisation

### Interface web (recommandé pour l'usage courant)

```bash
node admin-server.mjs
# → http://127.0.0.1:4000
```

Contrairement aux autres réglages, aucun compte n'est à configurer ici par
variable d'environnement : chaque photographe se connecte depuis la page,
avec l'e-mail et le mot de passe créés via `signup.mjs`, et ne voit que ses
propres galeries. C'est ce qui rend cette même interface utilisable telle
quelle si elle est un jour hébergée pour plusieurs photographes — l'usage
local sur `127.0.0.1` n'est qu'un cas particulier, pas un système à part.

- **Nouvelle galerie** : titre, client, mot de passe (généré si laissé vide),
  date d'expiration. Le mot de passe n'est affiché qu'une seule fois, à la
  création — notez-le tout de suite. Perdu ? La fiche de la galerie propose
  d'en générer un nouveau (l'ancien cesse aussitôt de fonctionner) : il n'est
  jamais stocké autrement qu'en empreinte à sens unique, donc pas de
  « récupération » possible, seulement une rotation.
- **Glisser-déposer** des photos sur la page de la galerie : chacune est
  traitée (réduction, empreinte, filigrane, découpage) et envoyée avec une
  barre de progression individuelle. Plusieurs photos partent en parallèle.
  Les vignettes affichées sont les vraies tuiles servies au client — pas un
  aperçu généré à part.
- **Sélection et remarques du client** visibles sur chaque vignette (cœur et
  pastille 💬, survolable pour lire la remarque) et sur le tableau de bord
  (badges ♥ N et 💬 N sur la carte de la galerie). Un bouton « Copier les
  notes du client » colle dans le presse-papiers la liste des photos
  choisies et commentées, par numéro (voir *Retrouver l'origine d'une fuite*
  pour la même convention).
- **Journal d'accès** intégré à la fiche de chaque galerie, coups de cœur et
  remarques compris.
- **Suppression** d'une photo isolée ou de la galerie entière, avec
  confirmation.

Ce serveur n'écoute que sur `127.0.0.1` : il n'est joignable que depuis votre
propre machine, jamais depuis le réseau.

### Ligne de commande (pour scripter, ou traiter un gros lot)

```bash
node prepare.mjs \
  --slug dupont-mai --title "Séance famille Dupont" \
  --client "Famille Dupont" --password "un-mot-de-passe-solide" \
  --expires 2026-12-31 \
  ~/photos/dupont/*.jpg
```

Le client reçoit `https://votre-site.com/galerie.html?g=dupont-mai` et le mot de
passe. Un fichier `galerie-dupont-mai.json` est écrit en local : c'est le
registre des empreintes, à garder.

### Vérifier avant d'envoyer

```bash
node prepare.mjs --slug essai --client "Famille Dupont" --dry-run ~/photos/*.jpg
node preview-server.mjs --slug essai
# → http://localhost:8787/galerie.html?g=essai  (mot de passe : apercu)
```

Réglez `--opacity` (0,06 à 0,20) jusqu'à trouver votre équilibre entre discrétion
et protection. C'est le seul arbitrage esthétique du projet.

### Retrouver l'origine d'une fuite

```bash
node detect.mjs capture-trouvee-sur-instagram.jpg
```

```
── capture-trouvee-sur-instagram.jpg
   ORIGINE IDENTIFIÉE
   galerie   : Séance famille Dupont (dupont-mai)
   client    : Famille Dupont
   photo     : pho_5FFKZm-mXjzI (n° 1)
   fiabilité : signal/bruit 5.63, 32/32 bits concordants
```

### Consulter le journal d'accès

```bash
TOKEN=$(curl -s -X POST "$GALERIE_API/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"email\":\"$GALERIE_EMAIL\",\"password\":\"$GALERIE_PASSWORD\"}" | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" \
  "$GALERIE_API/api/admin/galleries/dupont-mai/log"
```

Connexions, tentatives ratées, photos ouvertes, captures suspectées. Les
adresses IP ne sont jamais stockées en clair, seulement une empreinte salée.
La même chose est visible directement sur la fiche de la galerie dans
l'interface web.

---

## Fiabilité mesurée

Tout est vérifiable en relançant les tests (`tools/tests/`).

**Empreinte invisible** — 77 photos réelles confrontées à 2 000 empreintes émises :

| | photos marquées | photos vierges |
|---|---|---|
| signal/bruit | 5,58 au minimum | 1,63 au maximum |
| bits concordants | 32/32 partout | 30/32 au maximum |

Les seuils de décision (2,5 et 31/32) sont placés dans cet écart, volontairement
près du haut : **un faux positif accuserait un client à tort**, ce qui est bien
plus grave qu'une fuite non attribuée.

Survit à : JPEG qualité 45, capture d'écran redimensionnée de 75 % à 140 %,
recadrage à 60 %, passage en noir et blanc, luminosité +10 %.

Ne survit pas à : une photo de l'écran prise au téléphone (rotation et
perspective), un recadrage très serré, une image republiée en dessous de
600 px. `detect.mjs` affiche alors les mesures brutes plutôt que de conclure.

**Filigrane visible** — force et couverture mesurées par plage tonale sur les
mêmes 77 photos, parce qu'un filigrane d'une seule couleur s'effondre sur les
photos claires :

| plage | force | couverture |
|---|---|---|
| ombres | 9,8 à 14,6 niveaux | 7,6 à 15,3 % |
| tons moyens | 7,4 à 8,2 niveaux | 7,9 à 15,3 % |
| hautes lumières | 10,1 à 14,5 niveaux | 6,8 à 15,1 % |

**Interface client** — 15 vérifications dans un vrai navigateur : recomposition
des tuiles, refus du mauvais mot de passe, absence de toute balise `<img>`,
neutralisation du menu contextuel et de la copie, voile sur « Impr. écran » et
sur perte de focus, consignation au journal.

**API du Worker** — 91 vérifications contre le vrai moteur Cloudflare (D1 et R2
émulés localement par `wrangler dev`) : comptes photographes (inscription,
connexion, session), cloisonnement strict entre comptes (un photographe ne
peut ni lister, ni lire, ni modifier, ni même deviner l'existence des
galeries, photos et tuiles d'un autre compte), création et cloisonnement des
galeries d'un même compte, authentification client, expiration, limitation
des tentatives de mot de passe, suppression en cascade (galerie et photo
isolée), sélection et commentaire posés et retirés, régénération du mot de
passe d'une galerie (l'ancien cesse aussitôt de fonctionner), journal sans
IP en clair.

**Interface d'administration** — 18 vérifications dans un vrai navigateur,
contre le vrai Worker local : connexion depuis le formulaire (pas de session
présupposée), création d'une galerie, régénération de son mot de passe,
glisser-déposer de photos avec suivi de progression, vraies vignettes
affichées, suppression d'une photo et d'une galerie, déconnexion qui tient
après un rechargement de page — et un second compte, connecté dans un
second contexte navigateur, qui ne voit jamais les galeries du premier dans
son propre tableau de bord.

**Sélection client** — 15 vérifications dans un vrai navigateur, contre le
vrai Worker local (galerie créée par le test lui-même, nettoyée à la fin) :
coup de cœur posé depuis la grille et depuis la visionneuse, compteur à jour,
filtre « ma sélection » qui masque sans retélécharger et borne la navigation
de la visionneuse, sélection qui survit à une reconnexion complète, cohérence
entre ce que voit le client et ce que lit l'administration.

**Commentaires client** — 16 vérifications dans un vrai navigateur, même
principe (galerie autonome, nettoyée à la fin) : remarque laissée depuis la
visionneuse, sauvegarde automatique après un court délai de frappe, texte en
cours de saisie jamais perdu si on change de photo avant que ce délai
s'écoule, remarque effacée qui retire bien sa pastille, cohérence avec ce que
lit l'administration.

```bash
cd tools
node tests/forensic.test.mjs 1600     # robustesse de l'empreinte
node tests/watermark.test.mjs         # lisibilité du filigrane visible
node tests/calibration.mjs            # seuils de détection (≈ 6 min)
node tests/viewer.test.mjs            # interface cliente, serveur d'aperçu lancé
node tests/admin.test.mjs             # interface d'administration, admin-server.mjs lancé
node tests/selection.test.mjs         # sélection client, autonome (crée sa propre galerie)
node tests/comments.test.mjs          # commentaires client, autonome (crée sa propre galerie)

cd ../worker
npx wrangler dev --local --port 8788  # dans un autre terminal
BASE=http://127.0.0.1:8788 node tests/api.test.mjs
```

---

## Ce qu'il reste à faire

- **Héberger l'admin pour de vrai** — l'interface elle-même est déjà prête
  pour plusieurs photographes : chacun se connecte depuis le navigateur avec
  son propre compte (cookie de session, pas de jeton partagé), et
  `tools/Dockerfile` construit une image prête à déployer (voir son en-tête
  pour `docker build`/`docker run`). Ce qui manque : un hébergeur qui fait
  tourner ce conteneur en continu (Fly.io, Railway, Render… — pas Cloudflare
  Workers, qui ne sait pas exécuter `sharp`) et une adresse publique, pour
  qu'un photographe puisse s'en servir sans installer Node ni ouvrir un
  terminal. Le Dockerfile n'a pas pu être testé en conditions réelles depuis
  cet environnement (pas de démon Docker disponible ici) — à vérifier avec
  un vrai `docker build` avant de déployer.
- **Site public + inscription en libre-service** — page de présentation,
  création de compte sans intervention manuelle.
- **Volet légal** — conditions d'utilisation et politique de confidentialité
  avant d'ouvrir à des photographes tiers : dès qu'on héberge les photos de
  clients d'un autre photographe, on devient responsable de données
  personnelles de tiers (RGPD).
- **Application mobile** — la seule voie qui bloque réellement la capture
  d'écran (`FLAG_SECURE` sur Android, détection sur iOS). À mettre en face du
  fait qu'il faut alors convaincre le client d'installer une application.
- **Empreinte résistante à la photo d'écran** — demande de corriger la
  perspective avant lecture.

---

## Le volet non technique

Il fait la moitié du travail, et il ne coûte rien à mettre en place :

- **Dites-le.** La page prévient le client que ses photos portent une marque
  invisible. La dissuasion ne fonctionne que si elle est connue — et c'est la
  seule façon loyale de tracer des images.
- **Écrivez-le au contrat.** Une clause qui rappelle que les épreuves de
  visionnage ne sont ni diffusables ni publiables, et que chaque galerie est
  identifiable.
- **Livrez vite les fichiers définitifs.** La plupart des captures d'écran sont
  faites par des clients impatients de montrer leurs photos, pas par des
  voleurs. Un lien de téléchargement rapide supprime le motif.
