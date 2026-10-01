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
| Capture d'écran | **Non empêchée** — impossible. Découragée (voile au moindre changement de focus, presse-papiers remplacé) et consignée au journal. Pour les raccourcis de capture sans ambiguïté (Impr. écran, capture clavier macOS), le photographe reçoit en plus un **e-mail immédiat avec la référence de la photo affichée**. |
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
   pour rester lisible sur une robe blanche comme sur un fond noir. Deux
   lignes alternent dans la trame : studio + client, et un rappel explicite
   du droit d'auteur (« Retirer ce filigrane par IA est une violation du
   droit d'auteur ») — lisible par un assistant IA généraliste à qui l'on
   demanderait de l'effacer, et une preuve que quiconque a retouché l'image
   l'a vu.
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

Pour aller plus loin que le texte, la visionneuse propose aussi un **code
couleur** à trois valeurs — vert *validée*, jaune *à retoucher*, rouge *à
écarter* — indépendant du coup de cœur (c'est le cœur, et lui seul, qui
compte pour le forfait), et des **repères annotés** : le client touche la
photo à l'endroit précis à signaler, un repère numéroté s'y pose, et il
écrit en une ligne ce qu'il attend (« retirer ce reflet », « adoucir ici »).
Pas de dessin libre : un point et une note se relisent sans ambiguïté sur
n'importe quel écran, puisque les positions sont relatives à la photo. Le
photographe retrouve tout cela sur la fiche de la galerie, repères posés
sur la photo en grand.

Quand son choix est fait, le client le dit d'un clic : **« Valider ma
sélection »**, en tête de galerie. Le photographe reçoit aussitôt un e-mail
avec le nombre de photos choisies et le supplément éventuel, la fiche de la
galerie affiche la date de validation, et les relances automatiques
s'arrêtent. Le client peut encore changer d'avis et valider à nouveau
(l'e-mail n'est pas renvoyé plus d'une fois par heure).

**Relances automatiques** : tant que la sélection n'est pas validée, une
passe quotidienne sur le Worker (déclencheur planifié, 08:00 UTC) envoie au
client un rappel à 7 jours puis à 2 jours de l'expiration de sa galerie
(s'il a un e-mail renseigné, avec le lien pour y revenir), et au
photographe un rappel à 2 jours. Chaque relance ne part qu'une fois, une
galerie sans date d'expiration n'en déclenche jamais, et le photographe
peut tout désactiver dans Paramètres. La propriétaire peut lancer la passe
à la demande depuis l'onglet Admin.

### Comptes photographes

La plateforme est pensée pour plusieurs photographes, chacun avec son propre
compte (e-mail + mot de passe). Chaque compte ne voit, ne modifie et ne peut
même deviner l'existence que de ses propres galeries — jamais celles d'un
autre photographe. C'est vérifié explicitement par les tests (voir *Fiabilité
mesurée*), pas seulement supposé par construction.

Un compte se crée en libre-service, directement depuis l'écran de connexion
de l'interface web (« Créer un compte ») — pas besoin de terminal ni de
script pour commencer. `signup.mjs` reste utile pour scripter une création
de compte (mise en place automatisée, tests), mais n'est plus la seule voie.

Mot de passe de compte oublié ? Le lien « Mot de passe oublié ? » de l'écran
de connexion envoie un e-mail (via Resend) avec un lien de réinitialisation
valable trente minutes, à usage unique. Comme pour la connexion, la même
réponse générique est renvoyée que le compte existe ou non — impossible de
confirmer l'existence d'un compte par ce biais. (Ceci concerne le compte du
photographe ; le mot de passe d'une galerie, lui, se régénère directement
depuis son tableau de bord, voir plus loin.)

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

Pour l'onglet Admin (vue d'ensemble de toute la plateforme — voir plus bas),
renseignez aussi `OWNER_EMAIL` dans `wrangler.toml` avec l'adresse du compte
photographe qui doit y avoir accès (jamais un secret : elle ne fait que
désigner quel compte a ce droit, chaque route `/api/owner/*` revérifiant
elle-même l'identité de l'appelant côté serveur). Sans cette variable,
l'onglet reste simplement invisible pour tout le monde.

Pour les relances automatiques (voir plus bas), `PUBLIC_SITE_ORIGIN` doit
pointer vers le site qui héberge `galerie.html` (le lien « Revoir ma
galerie » des e-mails en dépend), et le déclencheur planifié déclaré sous
`[triggers]` est créé au déploiement — rien d'autre à faire côté Cloudflare.
Sans `RESEND_API_KEY`, la passe quotidienne tourne mais n'envoie rien.

### 2. La page client

Copiez `web/galerie.html`, `web/gallery.css` et `web/gallery.js` à la racine de
votre site, et renseignez l'adresse du Worker dans `galerie.html` :

```js
window.GALERIE_CONFIG = {
  api: "https://galerie-protegee.votre-sous-domaine.workers.dev",
  clipboardGuard: true,   // remplace le presse-papiers après une capture
};
```

`web/index.html` (+ `web/home.css`) est la page d'accueil marketing du
produit : présentation du concept, fonctionnement en quatre étapes, liste des
fonctionnalités et section sécurité, avec dans le menu les liens Connexion /
Créer un compte vers l'interface d'administration. Renseignez l'adresse de
cette interface dans `index.html` :

```js
window.HOME_CONFIG = {
  adminUrl: "https://votre-interface-admin.example.com/",
};
```

C'est une page statique sans dépendance au Worker : elle se déploie avec les
mêmes outils que `galerie.html` (Cloudflare Pages, ou tout hébergement
statique).

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

Le tableau de bord s'organise en trois onglets, chacun avec son propre lien
(rechargeable, partageable dans l'historique du navigateur) :

- **Galeries** — la liste des séances en cours, et la fiche de chacune.
- **Facturation** — statut Stripe Connect, suppléments encore dus et
  historique des factures émises, toutes galeries confondues.
- **Paramètres** — tout ce qui concerne le compte plutôt qu'une galerie en
  particulier : nom du studio, présentation par défaut des futures galeries,
  coordonnées fiscales, adresse e-mail et mot de passe de connexion.

#### Onglet Galeries

- **Bandeau de compteurs**, en aperçu au-dessus de la liste : galeries
  créées, ventes effectuées (suppléments réglés en ligne) et leur montant,
  suppléments en ordre (déjà réglés) et suppléments en attente (dus mais pas
  encore réglés — mis en évidence dès qu'il y en a). Purement informatif,
  toutes galeries confondues ; un coup d'œil sur l'activité du compte avant
  même d'en ouvrir une.
- **Nouvelle galerie** : titre, client, mot de passe (généré si laissé vide),
  date d'expiration. Le mot de passe n'est affiché qu'une seule fois, à la
  création — notez-le tout de suite. Perdu ? La fiche de la galerie propose
  d'en générer un nouveau (l'ancien cesse aussitôt de fonctionner) : il n'est
  jamais stocké autrement qu'en empreinte à sens unique, donc pas de
  « récupération » possible, seulement une rotation.
- **Arrière-plan de l'écran de mot de passe** : une couleur parmi une
  palette prédéfinie, une couleur personnalisée, ou une image importée par
  le photographe. Jamais une photo de la galerie elle-même — cet écran
  s'affiche avant que le client ait prouvé quoi que ce soit, donc rien qui y
  apparaît ne doit être une livraison protégée.
- **Mise en page de la galerie**, à choisir selon le type de séance : une
  section dédiée sur la fiche de chaque galerie propose *Grille* (vignettes
  régulières, le réglage historique — idéal pour parcourir beaucoup de
  photos), *Mosaïque* (colonnes façon presse, chaque photo garde son propre
  format — pratique quand portraits et paysages se mélangent) ou
  *Défilement* (une photo à la fois, en grand — rendu éditorial, pour
  raconter une séance plutôt que la survoler). Purement visuel : les trois
  rendus s'appuient sur les mêmes tuiles, protégées de la même façon.
- **Musique d'ambiance** : un MP3 (15 Mo maximum) importé depuis la fiche
  de la galerie, stocké à côté des tuiles et servi au client avec lecture
  progressive. Côté client, un bouton « Lancer la musique » apparaît dans
  l'en-tête dès qu'une piste existe ; en mise en page *Défilement* la lecture
  démarre d'elle-même quand le navigateur l'autorise, et le choix du client
  (coupée ou non) est retenu le temps de sa visite. Une galerie sans piste
  ne montre rien de plus qu'avant.
- **Forfait et suppléments** : le nombre de photos déjà payées par le
  client (optionnel — sans forfait défini, aucun supplément n'est jamais
  calculé) et le prix de chaque photo au-delà. Le supplément se calcule
  automatiquement à partir des coups de cœur du client, visible aussi bien
  sur sa page (« 3 / 2 photos incluses — +1 supplément (15,00 €) ») que sur
  la fiche de la galerie et la liste (badge 💶). Une fois le compte Stripe du
  photographe actif, le client peut régler ce supplément en ligne directement
  depuis sa galerie ; sinon le photographe règle ça de son côté.
- **Glisser-déposer** des photos sur la page de la galerie : chacune est
  traitée (réduction, empreinte, filigrane, découpage) et envoyée avec une
  barre de progression individuelle. Plusieurs photos partent en parallèle.
  Les vignettes affichées sont les vraies tuiles servies au client — pas un
  aperçu généré à part.
- **Sélection et remarques du client** visibles sur chaque vignette (cœur et
  pastille 💬, survolable pour lire la remarque) et sur le tableau de bord
  (badges ♥ N et 💬 N sur la carte de la galerie). Une case « Afficher
  uniquement la sélection du client (N) » filtre la grille de la fiche
  galerie pour ne garder que les photos choisies — pratique dès que la
  séance compte beaucoup de photos. Un bouton « Copier les notes du
  client » colle dans le presse-papiers la liste des photos choisies et
  commentées, par numéro (voir *Retrouver l'origine d'une fuite* pour la
  même convention), codes couleur et repères compris.
- **Codes couleur et repères annotés du client** : pastille verte, jaune ou
  rouge sur la vignette, compteur 📍 N de repères, et une légende qui résume
  la galerie (« 3 validées · 1 à retoucher · 2 à écarter »). Un clic sur une
  vignette ouvre la photo en grand avec les repères numérotés posés dessus
  et leurs notes listées en dessous — ce que le client a voulu dire se lit
  d'un coup d'œil, à l'endroit exact où il l'a dit.
- **Journal d'accès** intégré à la fiche de chaque galerie, coups de cœur et
  remarques compris.
- **Sélection validée** : badge « ✓ Validée » sur la carte de la galerie et
  date de validation sur sa fiche ; tant que le client n'a pas validé, la
  fiche rappelle où en sont les relances automatiques.
- **Suppression** d'une photo isolée ou de la galerie entière, avec
  confirmation.

#### Onglet Facturation

Propre au compte, pas à une galerie particulière — regroupe tout ce qui
touche à l'argent, toutes galeries confondues :

- **Paiement en ligne** : connexion d'un compte Stripe (Stripe Connect,
  comptes « Express ») pour recevoir directement le règlement des
  suppléments. Voir *Paiement en ligne des suppléments* plus bas pour la
  configuration côté Stripe.
- **Suppléments dus** : la liste des galeries où le client a sélectionné
  plus de photos que son forfait, avec le montant total à régler — un lien
  sur chaque ligne ramène directement à la fiche de la galerie concernée.
- **Historique des factures** : toutes les factures émises (toutes galeries
  confondues), avec un lien vers chaque PDF et l'adresse à laquelle elle a
  été envoyée. Une facture PDF est émise automatiquement dès qu'un
  supplément est réglé en ligne — numérotée en continu par année (ex.
  2026-0001), avec TVA belge (21 %) si un numéro de TVA est renseigné dans
  les Paramètres, ou mention d'exonération (régime de la franchise) sinon.

#### Onglet Paramètres

Tout ce qui concerne le compte plutôt qu'une galerie en particulier :

- **Studio** : le nom affiché dans la barre du tableau de bord et sur le
  filigrane des photos.
- **Votre identité** (prénom, nom) : jamais affichée à vos clients,
  contrairement au nom de studio — facultative, sert uniquement à vous
  identifier sur l'onglet Admin (voir plus bas) si vous êtes la propriétaire
  de la plateforme.
- **Présentation par défaut** : la mise en page (*Grille*, *Mosaïque* ou
  *Défilement* — voir plus haut) proposée à la création d'une nouvelle
  galerie. Une simple valeur de départ, jamais imposée : chaque galerie reste
  modifiable au cas par cas depuis sa propre fiche, comme avant.
- **Coordonnées fiscales** : raison sociale, adresse et n° de TVA à faire
  figurer sur les factures émises pour vos clients (voir l'onglet
  Facturation).
- **Adresse e-mail** : redemande le mot de passe actuel, et ne prend jamais
  effet immédiatement — un lien de confirmation est envoyé à la *nouvelle*
  adresse (jamais l'ancienne), valable trente minutes, à usage unique.
  Ouvrir ce lien est ce qui applique réellement le changement. Cette
  confirmation par lien, comme pour la réinitialisation de mot de passe,
  empêche qu'un jeton de session volé suffise à lui seul à rediriger
  silencieusement les notifications futures du compte (dont les prochaines
  réinitialisations de mot de passe) vers une adresse contrôlée par un
  attaquant.
- **Mot de passe** : changement directement depuis le tableau de bord,
  sans passer par « Mot de passe oublié ? ». Redemande lui aussi le mot de
  passe actuel — un jeton de session volé ne doit jamais, à lui seul,
  suffire à changer le mot de passe du compte.

#### Onglet Admin (réservé à la propriétaire de la plateforme)

Invisible pour tout le monde sauf un seul compte, celui dont l'adresse
e-mail correspond à `OWNER_EMAIL` (variable du Worker, voir
`wrangler.toml` — jamais un secret puisqu'elle ne fait que désigner QUEL
compte a ce droit, jamais l'accorder par elle-même). Chaque route
`/api/owner/*` revérifie elle-même, côté serveur, que l'appelant correspond
bien à cette adresse — `isOwner` dans le profil renvoyé au client n'est
qu'un indicateur d'affichage pour savoir s'il faut montrer l'onglet, jamais
une autorisation en soi. Un compte ordinaire qui devinerait ces URL se
verrait toujours refuser l'accès (403).

Vue d'ensemble de **toute la plateforme**, tous comptes et galeries
confondus — à ne pas confondre avec les compteurs de l'onglet Galeries, qui
restent propres à chaque photographe :

- **Compteurs plateforme** : nombre de photographes inscrits, de galeries
  créées, de photos envoyées, de ventes effectuées et leur montant total,
  suppléments en ordre et en attente — même calcul que les compteurs par
  compte, simplement sans filtrer par photographe.
- **Inscriptions par mois** : un simple décompte des nouveaux comptes,
  douze derniers mois, pour voir la croissance d'un coup d'œil.
- **Comptes photographes** : la liste complète — prénom, nom, studio,
  e-mail, date d'inscription, nombre de galeries et de photos, statut
  Stripe. Jamais les mots de passe, bien sûr, ni rien que vous n'ayez pas
  déjà le droit de voir sur votre propre compte.
- **Trafic du site et sources de visiteurs** : ce Worker ne suit pas le
  trafic du site marketing (ce n'est pas son rôle) — l'onglet explique
  comment brancher **Cloudflare Web Analytics**, gratuit et déjà disponible
  puisque le site est hébergé chez Cloudflare, plutôt que d'inventer un
  système de suivi maison qui referait moins bien ce qui existe déjà. Le
  référencement (mots-clés, position sur Google…) suit la même logique avec
  **Google Search Console**, à connecter séparément avec votre propre
  compte Google.

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

En ligne de commande :

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

Ou directement depuis l'interface web : bouton **« 🔍 Vérifier une photo »**
dans la barre du tableau de bord (pas besoin de savoir à l'avance de quelle
galerie l'image pourrait venir). Le fichier est analysé localement par
`admin-server.mjs` — comparé aux empreintes de vos propres galeries
uniquement, jamais envoyé ni conservé au-delà de cette vérification.

### Consulter le journal d'accès

```bash
TOKEN=$(curl -s -X POST "$GALERIE_API/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"email\":\"$GALERIE_EMAIL\",\"password\":\"$GALERIE_PASSWORD\"}" | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" \
  "$GALERIE_API/api/admin/galleries/dupont-mai/log"
```

Connexions, tentatives ratées, photos ouvertes, captures suspectées — avec,
quand une photo était ouverte en plein écran au moment de la capture, sa
référence (« Photo n° 7 »). Les adresses IP ne sont jamais stockées en
clair, seulement une empreinte salée. La même chose est visible directement
sur la fiche de la galerie dans l'interface web.

### Alerte e-mail sur capture d'écran

Quand un client déclenche un signal de capture, le Worker envoie un e-mail
au photographe via [Resend](https://resend.com), avec le titre de la
galerie et la référence de la photo affichée à ce moment. Trois signaux
déclenchent cet e-mail :

- la touche « Impr. écran » sous Windows ;
- `Cmd+Maj+3/4/5` sous macOS — sauf que ce raccourci est intercepté par le
  système *avant* d'atteindre le navigateur (comme `Cmd+Espace`) : le
  navigateur ne le voit jamais passer comme un raccourci clavier ;
- c'est pourquoi, sur macOS, le vrai signal utilisé est indirect : une
  **absence très brève** (moins de 1,5 s) de la fenêtre ou de l'onglet —
  l'éclair d'une capture ressemble à ça, un vrai changement d'application
  dure plus longtemps. Un changement de fenêtre plus long, lui, ne
  déclenche jamais l'e-mail (juste une trace dans le journal) : ce serait
  trop de faux positifs pour un simple coup d'œil à un autre onglet.

Pas plus d'un e-mail toutes les deux minutes par galerie, pour éviter une
rafale si plusieurs signaux se déclenchent d'affilée.

C'est entièrement optionnel : sans les secrets ci-dessous, tout continue de
fonctionner normalement, la capture reste simplement consignée dans le
journal sans e-mail.

```bash
cd worker
npx wrangler secret put RESEND_API_KEY   # clé API Resend
npx wrangler secret put RESEND_FROM      # adresse d'expédition vérifiée sur Resend, ex. "Holypixx <alertes@votredomaine.com>"
```

`ADMIN_URL` (dans `wrangler.toml`, pas un secret) est l'adresse de
l'interface d'administration, insérée en lien dans l'e-mail.

### Paiement en ligne des suppléments (Stripe Connect)

Chaque photographe connecte son propre compte [Stripe](https://stripe.com)
(comptes « Express », [Stripe Connect](https://stripe.com/connect)) depuis
l'onglet Facturation du tableau de bord, et renseigne ses coordonnées de
facturation (raison sociale, adresse, n° de TVA) depuis l'onglet Paramètres.
Le règlement d'un
supplément passe par une **charge de destination** (`transfer_data.destination`) :
la session de paiement est créée sur la plateforme, qui règle les frais
Stripe, puis le montant est automatiquement transféré au photographe —
toujours 100 %, sans commission de plateforme. (Les charges directes,
utilisées au tout début de cette fonctionnalité, ne sont plus autorisées par
Stripe pour les nouvelles plateformes Connect — voir Dashboard Stripe →
Santé → Indicateurs si ce message réapparaît un jour.)

Une fois le compte Stripe actif, le client voit un bouton « Régler le
supplément » dans sa galerie dès qu'il a sélectionné plus de photos que son
forfait n'en inclut. Il est redirigé vers une page de paiement Stripe
hébergée (carte, Apple Pay, PayPal — tous proposés par une même intégration,
sans configuration séparée), puis ramené à sa galerie. Le montant réglé est
toujours celui **réellement dû à cet instant** : un supplément déjà payé
n'est jamais recompté si le client sélectionne encore d'autres photos par la
suite. Le tableau de bord affiche l'historique des paiements de chaque
galerie (date, nombre de suppléments, montant, statut, lien vers la facture).

Dès que le webhook confirme le paiement, une facture PDF est générée
automatiquement (numérotation continue par photographe, en séries annuelles :
2026-0001, 2026-0002, …) et rangée dans R2. Si le photographe a renseigné un
numéro de TVA (onglet Paramètres), la TVA belge à 21 % est calculée sur le
montant déjà encaissé (TTC) ; sinon la facture porte la mention d'exonération
du régime de la franchise. Le client la télécharge directement depuis sa
galerie (bouton « Télécharger ma facture ») et la reçoit aussi par e-mail
(pièce jointe, via Resend) si un e-mail a été renseigné pour cette galerie à
la création. **La mention légale d'exonération de TVA (`invoices.js`,
fonction `buildInvoicePdf`) a été rédigée du mieux possible mais mérite
d'être relue par une comptable avant un usage à grande échelle** — ce n'est
pas un domaine où je peux garantir l'exactitude réglementaire à 100 %.

Préalable côté Stripe, avant de configurer quoi que ce soit ici :
**Connect doit être activé** sur le compte Stripe qui servira de plateforme
(Dashboard Stripe → Paramètres → Connect).

```bash
cd worker
npx wrangler secret put STRIPE_SECRET_KEY               # clé secrète Stripe (sk_live_… ou sk_test_… en développement)
npx wrangler secret put STRIPE_WEBHOOK_SECRET           # signature du webhook « Comptes connectés » (whsec_…)
npx wrangler secret put STRIPE_WEBHOOK_SECRET_PLATFORM  # signature du webhook « Votre compte » (whsec_…)
```

Les deux évènements utilisés n'ont pas la même origine, donc **deux points
de terminaison Stripe distincts** sont nécessaires, tous les deux vers la
même URL (`https://<votre-worker>.workers.dev/api/stripe/webhook`) — le
Worker essaie chaque secret configuré tour à tour pour vérifier la
signature, peu importe lequel des deux a réellement livré l'évènement :

1. Un premier point de terminaison, périmètre **Comptes connectés** (ce sont
   les comptes Stripe des photographes), écoutant `account.updated` (état de
   l'inscription Connect) — sa clé de signature va dans `STRIPE_WEBHOOK_SECRET`.
2. Un second, périmètre **Votre compte** (la plateforme elle-même, puisque
   les sessions de paiement des suppléments y sont créées — charge de
   destination), écoutant `checkout.session.completed` — sa clé va dans
   `STRIPE_WEBHOOK_SECRET_PLATFORM`.

Attention à ne pas confondre `account.updated` avec les évènements
« Accounts v2 » regroupés sous `v2.core.account.updated` (chercher dans
l'onglet « Tous les évènements » plutôt que la recherche par défaut).

Sans ces secrets, l'écran « Facturation » et le bouton de règlement
affichent un message clair plutôt que d'échouer silencieusement — rien
d'autre n'est affecté.

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
| ombres | 9,9 à 14,5 niveaux | 8,9 à 16,2 % |
| tons moyens | 7,5 à 8,3 niveaux | 9,3 à 16,9 % |
| hautes lumières | 10,0 à 14,5 niveaux | 6,3 à 15,7 % |

**Interface client** — 15 vérifications dans un vrai navigateur : recomposition
des tuiles, refus du mauvais mot de passe, absence de toute balise `<img>`,
neutralisation du menu contextuel et de la copie, voile sur « Impr. écran » et
sur perte de focus, consignation au journal.

**API du Worker** — 246 vérifications contre le vrai moteur Cloudflare (D1 et R2
émulés localement par `wrangler dev`) : comptes photographes (inscription,
connexion, session, mot de passe oublié — même réponse générique qu'un
compte existe ou non), cloisonnement strict entre comptes (un photographe ne
peut ni lister, ni lire, ni modifier, ni même deviner l'existence des
galeries, photos et tuiles d'un autre compte), création et cloisonnement des
galeries d'un même compte, authentification client, expiration, limitation
des tentatives de mot de passe, suppression en cascade (galerie et photo
isolée), sélection et commentaire posés et retirés, code couleur et repères
annotés (valeurs et positions hors bornes refusées, au plus 12 repères par
photo, notes nettoyées et bornées, relus côté administration et à la
reconnexion du client, consignés au journal), régénération du mot de
passe d'une galerie (l'ancien cesse aussitôt de fonctionner), arrière-plan
personnalisé de l'écran de connexion (couleur ou image, cloisonné par
compte, et une galerie inconnue ne se distingue jamais d'une galerie sans
arrière-plan personnalisé), mise en page de la galerie (grille par défaut,
cloisonnée par compte, valeur inconnue refusée, transmise telle quelle au
client à la connexion), forfait et suppléments (aucun forfait par défaut,
supplément calculé à partir des coups de cœur du client et recalculé après
modification, cloisonné par compte, valeurs invalides refusées), Stripe
Connect et facturation (aucun compte connecté par défaut, connexion refusée
proprement quand la plateforme n'est pas configurée, statut jamais recontacté
Stripe sans compte connecté, coordonnées de facturation cloisonnées par
compte, webhook refusé sans configuration), règlement en ligne d'un
supplément (refusé sans session, refusé proprement quand le photographe n'a
pas encore activé Stripe, refusé quand la galerie n'a aucun forfait défini),
e-mail client (accepté et relu, mal formé refusé à la création), téléchargement
de facture (refusé sans session, identifiant inconnu refusé côté admin comme
côté galerie cliente), référence de photo sur un évènement de capture
(un identifiant inconnu n'est jamais enregistré), journal sans IP en clair.
Paramètres du compte : nom du studio modifiable (vide refusé), présentation
par défaut modifiable (valeur inconnue refusée) et bien héritée par les
nouvelles galeries créées ensuite, changement de mot de passe et changement
d'adresse e-mail exigeant tous deux le mot de passe **actuel** — refusés avec
un 400, jamais un 401, pour qu'une simple faute de frappe ne déconnecte
jamais la session en cours (un bug réel, introduit puis corrigé pendant ce
développement — voir ce test), ancien mot de passe rejeté et nouveau
fonctionnel après un changement réussi, nouvelle adresse refusée si mal
formée, déjà prise par un autre compte ou égale à l'adresse actuelle,
adresse du compte inchangée tant que le lien de confirmation n'a pas été
ouvert, lien de confirmation absent ou invalide refusé (le jeton lui-même,
comme pour la réinitialisation de mot de passe, ne transite jamais par
l'API), facturation agrégée (liste vide par défaut, jamais les factures
d'un autre compte). Compteurs globaux (galeries créées, ventes et montant,
suppléments en ordre et en attente), testés en différentiel plutôt qu'en
valeur absolue : créer une galerie incrémente aussitôt le compteur de
galeries sans toucher aux ventes ni aux suppléments, un supplément non réglé
n'apparaît que dans « en attente » — jamais « en ordre » —, invisible chez
un autre compte, et supprimer la galerie ramène tout à l'état de départ.
Prénom/nom du compte (facultatifs, vides par défaut, bien relus une fois
enregistrés). Page Admin : un compte ordinaire se voit toujours refuser les
routes `/api/owner/*` (403, ou 401 sans session du tout) — y compris un
second compte, pour confirmer que ce n'est pas un cas particulier du
premier —, le compte dont l'e-mail correspond à `OWNER_EMAIL` s'y voit
reconnaître `isOwner`, peut lire les compteurs plateforme et la liste
complète des comptes (avec le prénom/nom de chacun, jamais leur mot de
passe). Musique d'ambiance : dépôt refusé depuis un autre compte, piste
annoncée au client à la connexion puis servie octet pour octet en
`audio/mpeg`, lecture progressive par morceaux (`Range` → 206), retrait
refusé depuis un autre compte, et plus rien de servi ni d'annoncé une fois
la piste retirée. « Valider ma sélection » : refusé sans jeton, horodaté et
e-mail au photographe à la première validation mais pas à une seconde dans
l'heure, relu sur la fiche, dans la liste, au journal et à la reconnexion
du client. Relances automatiques (passe lancée par la propriétaire, refusée
à un compte ordinaire) : première relance client à J-5, seconde relance
client et relance photographe à J-1, rien sans e-mail client, sans date
d'expiration ou une fois la sélection validée, jamais deux fois la même
relance d'une passe à l'autre, plus rien pour un compte qui a désactivé les
relances.
Le trajet complet de réinitialisation de mot de passe (jeton reçu par
e-mail → nouveau mot de passe → ancien mot de passe rejeté → lien à usage
unique) est vérifié manuellement plutôt qu'automatiquement : le jeton ne
transite jamais par l'API, seulement par l'e-mail, et l'y exposer pour les
tests reviendrait à affaiblir la sécurité qu'il apporte.

**Alertes e-mail** — 30 vérifications sans réseau ni `wrangler dev`
(`buildCaptureAlertEmail`, `buildPasswordResetEmail`,
`buildEmailChangeConfirmationEmail` et les trois bâtisseurs de relances et
de sélection validée sont des fonctions pures) : sujet et
corps référençant la bonne galerie et la bonne photo, message générique
quand aucune photo n'est identifiée, raisons connues traduites en texte
lisible, lien et durée de validité présents dans l'e-mail de réinitialisation
comme dans celui de confirmation d'un changement d'adresse (envoyé
exclusivement à la nouvelle adresse), et surtout échappement HTML du nom de
studio, du titre de galerie et du nom de client — autant de champs saisis
par le photographe, jamais dignes de confiance tels quels dans un e-mail.
Relances : échéance en jours (« demain » à J-1), coups de cœur déjà posés
ou invitation à choisir, lien vers la galerie présent dans le HTML et le
texte — ou aucun bouton du tout sans adresse publique configurée —, e-mail
de sélection validée avec nombre de photos et supplément dû.

**Décision des relances** — 11 vérifications sans réseau ni D1
(`remindersDue` est une fonction pure) : rien à 10 jours, première relance
client de J-7 à J-3, seconde relance client et relance photographe à J-2 et
J-1, plus rien une fois expirée, seule la relance photographe sans e-mail
client, jamais deux fois la même relance, pas de rattrapage d'une relance
manquée le jour d'une autre, et lien de galerie construit (slug encodé)
seulement si `PUBLIC_SITE_ORIGIN` est renseigné.

**Signature de webhook Stripe et sessions de paiement** — 16 vérifications
sans réseau (fetch intercepté, jamais appelé pour de vrai) :
`verifyStripeSignature` est une fonction pure — signature valide acceptée,
mauvais secret refusé, corps modifié après signature refusé, évènement trop
ancien (rejeu) refusé, en-tête absent ou malformé refusé sans exception ;
et l'encodage exact des appels Stripe — la session de paiement d'un
supplément est bien créée sur la plateforme et non sur le compte du
photographe (charge de destination, `transfer_data.destination` correctement
adressé), `managed_payments` désactivé (incompatible avec ce schéma), le
tableau `line_items` et les métadonnées imbriquées correctement indexés,
aucun `payment_method_types` ni `automatic_payment_methods` imposé (réservé
aux PaymentIntents), et la création d'un compte Connect qui ne porte jamais
l'en-tête d'une charge directe.

**Facturation automatique** — 9 vérifications sans réseau ni D1
(`computeVat` et `buildInvoicePdf` sont des fonctions pures) : aucune TVA
calculée en régime de la franchise (pas de numéro de TVA), taux belge à 21 %
appliqué sinon, HT + TVA se recomposant exactement au centime près en TTC
même sur un montant qui ne se divise pas rond, et un vrai PDF valide généré
aussi bien avec des coordonnées complètes qu'avec des champs vides.

**Interface d'administration** — 87 vérifications dans un vrai navigateur,
contre le vrai Worker local : demande de lien de réinitialisation de mot de
passe (message générique affiché), création de compte et connexion depuis
le formulaire (pas de session présupposée), barre d'onglets Galeries /
Facturation / Paramètres visible avec l'onglet Galeries actif par défaut,
bandeau de compteurs affiché dès l'arrivée et tout à zéro pour un compte
tout neuf (aucune tuile en alerte ni en succès), création d'une galerie,
régénération de son mot de passe,
choix d'une couleur ou d'une image pour l'écran de connexion client, choix
d'une mise en page pour la galerie, réglage d'un forfait de photos incluses,
sélection du client retrouvée sur sa vignette (cœur) et filtrable en un
clic, historique des paiements affiché sur la fiche galerie une fois un
règlement confirmé (date, nombre de suppléments, montant, statut « Réglé »,
numéro et adresse d'envoi de la facture émise, lien de téléchargement), et
le bandeau de compteurs qui reflète aussitôt ce règlement (ventes, montant,
suppléments « en ordre » en évidence, aucun « en attente » puisque le
forfait a été relevé au-dessus de la sélection du client), glisser-déposer
de photos avec suivi de progression, vraies vignettes affichées, suppression
d'une photo, navigation vers l'écran « Vérifier une photo » et retour à la
liste. Onglet Facturation : bouton de connexion
Stripe proposé, résumé des suppléments dus, la facture émise plus haut bien
présente dans l'historique agrégé, et un clic sur sa ligne ramène à la bonne
galerie. Onglet Paramètres : nom du studio modifié aussitôt reflété dans la
barre supérieure, présentation par défaut choisie et relue après
rechargement, coordonnées fiscales enregistrées et relues après
rechargement, mauvais mot de passe actuel rejeté **sans déconnecter la
session en cours** (le bug corrigé pendant ce développement — voir
*Fiabilité mesurée* côté API), changement de mot de passe réussi avec le mot
de passe actuel, demande de changement d'e-mail rejetée avec un mauvais mot
de passe puis acceptée avec le bon (message de confirmation affiché, rien
changé tout de suite), prénom/nom saisis à l'inscription bien relus puis
modifiables, persistant après rechargement. Puis suppression de la galerie,
déconnexion qui tient après un rechargement de page, et reconnexion avec le
mot de passe modifié en cours de test — et un second compte, connecté dans
un second contexte navigateur, qui ne voit jamais les galeries du premier
dans son propre tableau de bord, ni l'onglet Admin (masqué par défaut pour
tout compte qui n'est pas la propriétaire). Page Admin, elle, testée dans
un troisième contexte navigateur connecté avec le compte dont l'e-mail
correspond à `OWNER_EMAIL` : onglet visible et accessible (avec son propre
lien dans l'URL), compteurs plateforme affichés, le compte créé plus tôt
dans ce test apparaît dans la liste complète avec son prénom et son nom, et
la section trafic explique comment brancher Cloudflare Web Analytics.
Musique d'ambiance sur la fiche galerie : « aucune musique » au départ,
import d'un MP3 qui devient la piste actuelle, refus d'un fichier qui n'en
est pas un (la piste existante est conservée), retrait après confirmation.
Codes couleur et repères posés par le client (via l'API, comme le ferait sa
page) : pastille jaune et compteur de repères sur la vignette, légende de
la galerie, photo ouverte en grand avec le repère dessus, sa note listée et
le code couleur rappelé, fermeture de la fiche. Sélection validée : fiche
qui rappelle d'abord que rien n'est validé, puis date de validation après
le clic du client (via l'API), badge « Validée » sur la carte ; case des
relances automatiques cochée par défaut dans Paramètres, décochée et relue
après rechargement ; passe de relances lancée depuis l'onglet Admin par la
propriétaire, avec son résumé.

**Vérifier une photo (empreinte invisible)** — 8 vérifications contre le vrai
Worker local : une image reconstituée tuile par tuile — exactement comme le
client la voit, pas le fichier d'origine — est reconnue, avec la bonne
galerie et la bonne photo ; une image jamais envoyée n'est jamais présentée
comme une correspondance ; un second compte ne peut jamais identifier une
photo d'un autre (l'outil ne corrèle qu'avec les empreintes du compte
connecté) ; refusé sans session.

**Sélection client** — 18 vérifications dans un vrai navigateur, contre le
vrai Worker local (galerie créée par le test lui-même, nettoyée à la fin) :
coup de cœur posé depuis la grille et depuis la visionneuse, compteur à jour,
filtre « ma sélection » qui masque sans retélécharger et borne la navigation
de la visionneuse, sélection qui survit à une reconnexion complète, cohérence
entre ce que voit le client et ce que lit l'administration, bouton
« Valider ma sélection » proposé dès qu'il y a des coups de cœur, validation
confirmée à l'écran avec sa date et enregistrée côté Worker.

**Commentaires client** — 16 vérifications dans un vrai navigateur, même
principe (galerie autonome, nettoyée à la fin) : remarque laissée depuis la
visionneuse, sauvegarde automatique après un court délai de frappe, texte en
cours de saisie jamais perdu si on change de photo avant que ce délai
s'écoule, remarque effacée qui retire bien sa pastille, cohérence avec ce que
lit l'administration.

**Codes couleur et repères client** — 22 vérifications dans un vrai
navigateur, même principe (galerie autonome, nettoyée à la fin) : couleur
posée, retirée en re-cliquant dessus, remplacée par une autre ; mode
« placer un repère » qui pose un point là où le client touche la photo
(position relative vérifiée au centre, à 5 % près) et ouvre aussitôt la
note ; note relue en cliquant sur le repère ; « Annuler » qui conserve un
repère existant mais retire un repère tout juste posé sans rien envoyer ;
pastille et compteur dans la grille ; tout retrouvé après une reconnexion
complète ; suppression répercutée côté Worker.

```bash
cd tools
node tests/forensic.test.mjs 1600     # robustesse de l'empreinte
node tests/watermark.test.mjs         # lisibilité du filigrane visible
node tests/calibration.mjs            # seuils de détection (≈ 6 min)
node tests/viewer.test.mjs            # interface cliente, serveur d'aperçu lancé
node tests/admin.test.mjs             # interface d'administration, admin-server.mjs lancé
node tests/detect.test.mjs            # vérifier une photo, autonome (crée ses propres comptes)
node tests/selection.test.mjs         # sélection client, autonome (crée sa propre galerie)
node tests/comments.test.mjs          # commentaires client, autonome (crée sa propre galerie)
node tests/marks.test.mjs             # codes couleur + repères client, autonome (crée sa propre galerie)

cd ../worker
node tests/notify.test.mjs            # e-mails (alerte de capture, relances…), sans réseau
node tests/reminders.test.mjs         # décision des relances automatiques, sans réseau
node tests/stripe.test.mjs            # signature de webhook + encodage des sessions Stripe, sans réseau
node tests/invoices.test.mjs          # calcul de TVA + génération du PDF de facture, sans réseau
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
