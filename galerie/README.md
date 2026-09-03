# Galerie protégée

Galeries de visionnage pour photographes : le client voit ses photos avec un
mot de passe, sans pouvoir les télécharger — et si une image fuite malgré
tout, on sait de quelle galerie elle vient.

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

# Jeton d'administration et clé de signature des sessions
npx wrangler secret put ADMIN_TOKEN         # openssl rand -hex 32
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
export GALERIE_ADMIN_TOKEN=…
export GALERIE_FORENSIC_KEY=$(openssl rand -hex 32)

# Optionnel : adresse publique de web/galerie.html, pour que l'interface
# affiche un lien complet à donner au client plutôt qu'un simple « ?g=… ».
export GALERIE_SITE=https://www.littledreamphotos.com/galerie.html
```

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

- **Nouvelle galerie** : titre, client, mot de passe (généré si laissé vide),
  date d'expiration. Le mot de passe n'est affiché qu'une seule fois, à la
  création — notez-le tout de suite.
- **Glisser-déposer** des photos sur la page de la galerie : chacune est
  traitée (réduction, empreinte, filigrane, découpage) et envoyée avec une
  barre de progression individuelle. Plusieurs photos partent en parallèle.
  Les vignettes affichées sont les vraies tuiles servies au client — pas un
  aperçu généré à part.
- **Journal d'accès** intégré à la fiche de chaque galerie.
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
curl -H "Authorization: Bearer $GALERIE_ADMIN_TOKEN" \
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

**API du Worker** — 46 vérifications contre le vrai moteur Cloudflare (D1 et R2
émulés localement par `wrangler dev`) : création et cloisonnement des galeries,
authentification, expiration, limitation des tentatives de mot de passe,
suppression en cascade (galerie et photo isolée), journal sans IP en clair.

**Interface d'administration** — 13 vérifications dans un vrai navigateur,
contre le vrai Worker local : création d'une galerie, glisser-déposer de
photos avec suivi de progression, vraies vignettes affichées, suppression
d'une photo et d'une galerie. Vérifié à la main au-delà de la suite
automatisée : un parcours client complet (mauvais mot de passe, connexion,
ouverture d'une photo) apparaît correctement dans le journal affiché côté
administration.

```bash
cd tools
node tests/forensic.test.mjs 1600     # robustesse de l'empreinte
node tests/watermark.test.mjs         # lisibilité du filigrane visible
node tests/calibration.mjs            # seuils de détection (≈ 6 min)
node tests/viewer.test.mjs            # interface cliente, serveur d'aperçu lancé
node tests/admin.test.mjs             # interface d'administration, admin-server.mjs lancé

cd ../worker
npx wrangler dev --local --port 8788  # dans un autre terminal
BASE=http://127.0.0.1:8788 node tests/api.test.mjs
```

---

## Ce qu'il reste à faire

- **Sélection des photos par le client** — coup de cœur, commentaires : c'est
  la vraie raison pour laquelle on envoie une galerie de visionnage.
- **Hébergement de l'interface d'administration** — elle tourne aujourd'hui
  sur la machine du photographe (nécessaire pour sharp). Packagée en
  application de bureau, ou déportée sur un petit service qui fait tourner
  sharp pour de vrai (un conteneur, pas Cloudflare Workers), elle deviendrait
  utilisable par quelqu'un qui n'ouvre jamais un terminal.
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
