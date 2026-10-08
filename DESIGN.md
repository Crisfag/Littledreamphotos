---
name: Holypixx
description: Galeries clients protégées pour photographes : montrez vos photos, gardez-les.
colors:
  accent: "#3b3bf6"
  accent-deep: "#2626d4"
  accent-soft: "#ededff"
  night-accent: "#b9b9ff"
  paper: "#ffffff"
  mist: "#f6f6f9"
  mist-2: "#eeeef4"
  ink: "#0b0b10"
  ink-2: "#2f2f3a"
  muted: "#62626f"
  ink-soft: "#8a8a98"
  line: "#e6e6ee"
  line-2: "#d6d6e2"
  night: "#0a0a12"
  night-2: "#13131e"
  night-3: "#1c1c2b"
  night-line: "#2a2a3d"
  night-text: "#ecebf5"
  night-muted: "#a3a3ba"
  ok: "#16a34a"
  warn: "#e5a50a"
  alert: "#e5484d"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(3rem, 7.4vw, 5.6rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2.1rem, 4.4vw, 3.5rem)"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  price:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "2.8rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "\"tnum\""
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.06rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(1.04rem, 1.3vw, 1.14rem)"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "\"ss01\", \"cv11\""
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 500
    lineHeight: 1.35
  mono:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.84rem"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "\"tnum\""
rounded:
  paper: "6px"
  inset: "8px"
  control: "10px"
  control-lg: "12px"
  float: "14px"
  window: "16px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 4vw, 40px)"
  container: "1200px"
  chapter: "clamp(80px, 11vw, 140px)"
  chapter-head: "clamp(44px, 6vw, 72px)"
  split: "clamp(32px, 5vw, 72px)"
  grid: "16px"
  row: "20px"
  card: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
    textColor: "{colors.paper}"
  button-lg:
    rounded: "{rounded.control-lg}"
    padding: "0 26px"
    height: "52px"
  button-sm:
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "38px"
  button-quiet:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.mist-2}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-light:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.night}"
    rounded: "{rounded.control-lg}"
    padding: "0 26px"
    height: "52px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.inset}"
    padding: "0 14px"
    height: "34px"
  nav-link:
    textColor: "{colors.muted}"
    rounded: "{rounded.inset}"
    padding: "8px 12px"
  nav-link-hover:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "34px"
  badge-soft:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-deep}"
    rounded: "{rounded.pill}"
    padding: "3px 12px"
  window:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.window}"
  window-bar:
    backgroundColor: "{colors.mist}"
    height: "44px"
    padding: "0 16px"
  note:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.float}"
    padding: "12px 16px 12px 12px"
  panel:
    backgroundColor: "{colors.mist}"
    rounded: "{rounded.window}"
    padding: "24px"
  plan-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.window}"
    padding: "28px"
  plan-card-featured:
    backgroundColor: "{colors.night}"
    textColor: "{colors.night-muted}"
    rounded: "{rounded.window}"
    padding: "28px"
  lab-toggle:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.night-muted}"
    rounded: "{rounded.float}"
    padding: "18px 20px"
  lab-toggle-hover:
    backgroundColor: "{colors.night-3}"
  shop-ticket:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    rounded: "{rounded.float}"
    padding: "18px"
    width: "300px"
---

# Design System: Holypixx

> Portée. Ce document décrit le système visuel **marketing** de la marque, tel qu'il est livré sur la page d'accueil publique (`galerie/web/index.html`, `home.css`, `home.js`). L'interface photographe (admin), la galerie client et l'espace famille scolaire ont leur propre style, plus ancien, qui n'a pas été relu pour ce document : aucun jeton ci-dessous ne les décrit. Toute nouvelle page publique (tarifs, fonctionnalités, légal, scolaire) part de ce système.

## Overview

**Creative North Star: "La vitrine sous verre"**

Une page blanche et nette, de l'encre presque noire, un seul bleu outremer pour agir. Les photos sont montrées en grand, mais toujours derrière une vitre : celle d'une fenêtre produit arrondie, d'un filigrane, d'un ticket posé dessus. La page ne promet pas la protection, elle la fait voir et tester ; un chapitre sombre, le seul de la page avec la conclusion et le pied de page, sert de salle d'essai où l'on active les couches de protection une à une.

Le registre est celui du SaaS haut de gamme classique (barre de finition : Pixieset, Stripe, Linear/Framer) : densité calme, grands chapitres aérés, titres serrés en Geist 600, texte en Geist 400 à 17 px, filets d'un pixel plutôt que des cartes. Le produit se démontre par des objets d'interface reconstitués (fenêtre de galerie, notifications, ticket de prix, fiche scolaire), jamais par des pictogrammes en grille. Le mouvement est unique et signifiant : les photos d'ouverture se recomposent tuile par tuile une seule fois, comme elles arrivent dans une vraie galerie Holypixx.

L'imagerie est exclusivement celle de la fondatrice (Little Dream Photos) : famille, naissance, maternité, portrait d'enfant, en lumière chaude. Ces tons dorés et rouges sont la seule chaleur de la page ; l'interface autour reste froide et neutre pour les laisser parler.

**Key Characteristics:**
- Blanc net, encre `#0b0b10`, un seul accent outremer réservé à l'action et à l'état actif.
- Un chapitre sombre (nuit) pour la protection, repris en conclusion, en pied de page et sur la formule Pro.
- Geist en deux graisses utiles (600 titres, 400 texte, 500 commandes) ; Geist Mono pour codes, empreintes, tailles de fichiers et montants de ticket.
- Fenêtres produit arrondies 16 px aux ombres longues et froides ; tout le reste est plat, tenu par des filets.
- Photos réelles de la fondatrice, en grand, dont une bande pleine largeur dans la section Vente.
- Icônes SVG au trait 1,5, une seule famille.

## Colors

Un blanc froid à peine violacé, des encres et des gris de la même famille (teinte ~286°), un outremer franc pour agir et une nuit bleutée pour protéger.

### Primary
- **Outremer franc** (`accent`) : bouton principal, liens d'appel de chapitre, icônes des listes, repères numérotés posés sur les photos, coches des formules, pastille « Bientôt ». C'est la couleur de l'action et de l'état actif, rien d'autre.
- **Outremer profond** (`accent-deep`) : survol du bouton principal ; texte des badges sur fond `accent-soft`.
- **Voile outremer** (`accent-soft`) : fond des badges (« Formule Pro », « 2 mois offerts », « Bientôt disponible »), des pastilles d'icône des notifications et des coches de formule.
- **Pervenche de nuit** (`night-accent`) : la contrepartie de l'accent sur fond nuit : lien d'appel du chapitre protection, état « Visible » des couches du labo, trame de l'empreinte, coches de la formule Pro, sélection de texte. L'outremer plein reste réservé au bouton principal même sur fond nuit.

### Neutral
- **Papier** (`paper`) : fond de page, fenêtres produit, cartes de formule, notifications.
- **Brume** (`mist`) : chapitres teintés (Vente, Tarifs), barre de fenêtre, panneaux du trio, bouton discret, survol de navigation.
- **Brume appuyée** (`mist-2`) : survol du bouton discret, fond des photos avant chargement, tuiles de recomposition.
- **Encre** (`ink`) : titres, marque, texte fort, bouton noir des maquettes (« Valider ma sélection »), état actif du sélecteur mensuel/annuel.
- **Encre douce** (`ink-2`) : texte courant et ledes.
- **Gris d'appoint** (`muted`) : textes secondaires, descriptions de liste, liens de navigation au repos, notes de bas de bloc.
- **Gris de seconde ligne** (`ink-soft`) : uniquement la seconde ligne des titres à deux temps (voir la règle du titre d'une seule encre). Contraste ~3,4:1 sur papier : réservé aux tailles de titre.
- **Filet** (`line`) et **filet appuyé** (`line-2`) : séparateurs de listes, bordures intérieures des cartes, contour du bouton outline ; `line-2` sur fond brume.
- **Nuit** (`night`, `night-2`, `night-3`) : fond du chapitre protection, de la conclusion, du pied de page et de la formule Pro ; `night-2` pour les commandes du labo, `night-3` pour leur survol.
- **Filet de nuit** (`night-line`), **texte de nuit** (`night-text`), **gris de nuit** (`night-muted`) : la même grammaire filet / titre / texte, transposée sur fond sombre.

### Statut (fonctionnel)
- **Vert validé** (`ok`), **ambre à retoucher** (`warn`), **rouge coup de cœur / alerte** (`alert`) : les codes couleur réels du produit (validée, à retoucher, à écarter), le cœur, le cadenas de l'adresse sécurisée, la marge positive du ticket. Ils n'apparaissent que dans des objets produit.

### Named Rules
**La règle de la voix unique.** L'outremer marque ce qui agit ou ce qui est actif : boutons, liens d'appel, repères, coches, icônes de liste. Jamais en aplat décoratif, jamais en dégradé, jamais en couleur de titre.

**La règle de la nuit qui protège.** Le fond nuit est réservé au chapitre protection, à la formule Pro et au serre-livres final (conclusion + pied de page). Une nouvelle section ne passe pas en sombre pour « varier le rythme ».

**La règle des statuts réels.** Vert, ambre et rouge ne servent qu'à montrer des états du produit (sélection, alerte de capture, marge). Pas d'accent décoratif secondaire.

## Typography

**Display Font:** Geist (repli ui-sans-serif, system-ui, Segoe UI)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono (repli ui-monospace, SF Mono, Menlo)

**Character:** Une seule famille grotesque, géométrique et nette, serrée en titre (approche négative jusqu'à -0,04em) et ouverte en texte ; sa version mono porte tout ce qui est code, empreinte ou montant, comme sur une facture.

### Hierarchy
- **Display** (600, `clamp(3rem, 7.4vw, 5.6rem)`, interligne 0,98, -0,04em) : le titre d'ouverture seul, sur deux ou trois lignes.
- **Headline** (600, `clamp(2.1rem, 4.4vw, 3.5rem)`, interligne 1,04, -0,03em) : un par chapitre, phrase complète avec point final. Les engagements utilisent une variante réduite (`clamp(1.5rem, 2.4vw, 2rem)`).
- **Price** (600, 2,8rem, interligne 1, -0,04em, chiffres tabulaires) : montants des formules.
- **Title** (600, 1,06rem, interligne 1,35, -0,01em) : titres de liste, de panneau, de carte (jusqu'à 1,25rem pour les formules).
- **Lede** (400, `clamp(1.04rem, 1.3vw, 1.14rem)`, interligne 1,6, max 62ch ; 46ch dans l'ouverture) : le paragraphe sous chaque titre de chapitre.
- **Body** (400, 17 px, 16 px sous 640 px, interligne 1,6, jeux `ss01` et `cv11`) : texte courant ; descriptions secondaires à ~0,96rem en `muted`, max 46 à 68ch.
- **Label** (500, 0,84 à 0,94rem) : boutons, puces, notifications, navigation. Jamais en capitales, jamais espacé.
- **Mono** (Geist Mono 400/500, chiffres tabulaires) : empreinte (`HPX · 7F3A-21C9`), codes d'accès, tailles de fichiers, montants du ticket.

### Named Rules
**La règle du titre d'une seule encre.** Les titres sont d'une seule couleur, l'encre. Deux exceptions seulement, le chapitre protection et les tarifs, portent une seconde ligne en gris doux (`ink-soft`, ou son équivalent nuit) : un énoncé, puis sa nuance. Pas de mot coloré en accent, pas de texte en dégradé.

**La règle de l'entrée directe.** Un chapitre s'ouvre sur son titre. Pas de surtitre en petites capitales espacées au-dessus.

**La règle du chiffre aligné.** Tout chiffre comparé ou facturé (prix, tailles, codes) est en chiffres tabulaires ; ceux qui imitent une pièce produit (ticket, fichiers, empreinte, code) passent en Geist Mono.

## Layout

Conteneur centré de 1 200 px au plus, avec une gouttière fluide de 16 à 40 px (`gutter`). La page est une suite de **chapitres** à grand souffle vertical (`chapter`, 80 à 140 px), alternant papier, brume (Vente, Tarifs) et nuit (Protection), plus une teinte lavande très claire réservée au chapitre scolaire « bientôt ». Chaque chapitre ouvre sur un bloc titre + lede de 820 px au plus, aligné à gauche (centré seulement pour les tarifs), suivi de 44 à 72 px d'air.

Grammaires de composition récurrentes :
- **Ouverture en deux colonnes** (1,15fr / 1fr, alignées en bas) : titre à gauche, lede + boutons + réassurance à droite, puis la grande fenêtre de galerie pleine largeur du conteneur, flanquée de notifications qui débordent de ses bords.
- **Duo** (1,25fr / 1fr) : un grand visuel produit face à une liste à filets (icône 22 px + titre + description, 20 px de rythme).
- **Bande pleine largeur** : la photo de la fondatrice sort du conteneur et occupe toute la largeur de l'écran (380 à 700 px de haut) ; le ticket de prix se pose dessus, aligné à droite sur le bord du conteneur. Sous la bande, les faits en deux colonnes à filet supérieur.
- **Trio** de panneaux (1,1fr / 1fr / 1fr, 16 px d'écart), chacun ouvert par une vignette produit de 132 px.
- **Questions** : titre collant à gauche (0,9fr), accordéon à filets à droite (1,4fr).

Points de rupture : 1 080 px (engagements et trio sur deux colonnes), 900 px (navigation repliée en menu, toutes les compositions à une colonne, formules empilées sur 520 px), 640 px (galerie de démonstration en 2 colonnes, notifications remises dans le flux, ticket de prix pleine largeur sous la photo), 480 px (boutons de l'ouverture pleine largeur).

## Elevation & Depth

Hybride : la page est plate et tenue par des filets d'un pixel et des aplats tonaux (papier, brume, nuit) ; seuls les **objets produit** reçoivent de l'ombre, longue, à étalement négatif, teintée d'un encre bleu-nuit (`rgba(20, 20, 60, …)`), comme posés au-dessus de la page. Les cartes de formule et les panneaux restent à plat avec un contour intérieur d'un pixel.

### Shadow Vocabulary
- **Fenêtre** (`box-shadow: 0 40px 80px -32px rgba(20,20,60,.35), 0 12px 28px -12px rgba(20,20,60,.18)`, plus un contour `0 0 0 1px rgba(20,20,60,.08)`) : fenêtre de galerie, photo annotée, planche scolaire.
- **Flottant** (`box-shadow: 0 18px 40px -16px rgba(20,20,60,.35), 0 4px 10px -4px rgba(20,20,60,.12)`, plus un contour `0 0 0 1px rgba(20,20,60,.06)`) : notifications, ticket de prix, étiquettes d'annotation, fiche scolaire, message éphémère.
- **Formule mise en avant** (`box-shadow: 0 30px 60px -30px rgba(20,20,60,.6)`) : la carte Pro seule.
- **Bouton accent** (`box-shadow: 0 1px 0 rgba(255,255,255,.25) inset, 0 1px 2px rgba(11,11,16,.16), 0 8px 18px -10px rgba(11,11,16,.45)`) : un liseré clair en haut et une ombre d'encre neutre.
- **Repère sur photo** (`box-shadow: 0 0 0 2px #fff, 0 4px 10px rgba(11,11,16,.3)`) : pastilles numérotées posées sur une image.

### Named Rules
**La règle des objets qui flottent.** L'ombre signale un objet produit reconstitué (fenêtre, notification, ticket, fiche). Une section, un panneau ou une liste n'en porte jamais ; ils se séparent par un filet ou un changement de fond.

**La règle de l'ombre neutre sous l'accent.** Les boutons outremer portent une ombre d'encre neutre, jamais un halo coloré de l'accent.

## Shapes

Des coins doux et hiérarchisés par taille d'objet : 16 px pour les fenêtres, photos de démonstration, panneaux et formules (`window`) ; 14 px pour ce qui flotte ou se presse (notifications, ticket, commandes du labo, `float`) ; 12 et 10 px pour les commandes (`control-lg`, `control`) ; 8 px pour les vignettes de galerie, liens de navigation et petits boutons noirs (`inset`) ; pilule pour les puces et badges (`pill`). Les objets imprimés du scolaire (fiche parent, planche) gardent des coins presque vifs (6 et 4 px) et une légère rotation (-2,5° et 2°) : ce sont des papiers, pas des écrans. Les pastilles de statut, de repère et de code couleur sont des cercles parfaits. Les contours sont des `box-shadow` intérieurs d'un pixel plutôt que des `border`, pour ne pas décaler la géométrie.

## Components

### Buttons
- **Shape :** coins doux (10 px ; 12 px en grande taille), hauteur minimale 44 px (38 px compact, 52 px grande taille), libellé Geist 500, icône 20 px à 10 px d'écart.
- **Primary :** outremer plein, texte blanc, ombre d'encre neutre ; c'est l'action « Créer mon compte » partout.
- **Hover / Focus :** passage à l'outremer profond et montée de 1 px en 0,2 s (`cubic-bezier(.16,1,.3,1)`) ; enfoncement `scale(.99)` à l'appui ; focus clavier par un contour outremer de 2 px décalé de 3 px.
- **Discret :** fond brume, texte encre ; s'appuie en brume appuyée au survol (« Voir les tarifs »).
- **Outline :** papier avec contour intérieur `line-2`, qui passe à l'encre au survol ; formules Découverte et Essentiel.
- **Clair :** blanc sur nuit, seul bouton du chapitre protection (« Simuler une capture d'écran »).
- **Lien d'appel :** texte outremer 500 suivi d'une flèche qui glisse de 4 px au survol ; ferme les chapitres.

### Chips
- **Style :** puces pilule de 34 px, contour intérieur `line`, texte `ink-2`, icône 14 px (« 12 coups de cœur », « Musique ») ; badges pilule sur voile outremer, texte outremer profond (« Formule Pro », « 2 mois offerts », « Bientôt disponible » avec point de 7 px).
- **State :** le sélecteur mensuel/annuel est un rail blanc à contour, dont l'option active passe en encre pleine, texte blanc.

### Cards / Containers
- **Corner Style :** 16 px.
- **Background :** papier (formules), brume (panneaux du trio), nuit (formule Pro).
- **Shadow Strategy :** à plat, contour intérieur d'un pixel ; seule la formule Pro porte l'ombre longue (voir Elevation & Depth).
- **Border :** `line` en contour intérieur ; listes de coches séparées du haut de carte par un filet.
- **Internal Padding :** 28 px (formules), 24 px (panneaux).

### Navigation
- **Style :** barre collante de 68 px, blanc à 96 %, marque (carré outremer de 30 px à coins de 8 px portant un H au trait + « Holypixx » 600) à gauche, liens en `muted` 0,94rem, « Connexion » en encre et bouton principal compact à droite.
- **States :** lien au survol en encre sur fond brume ; un filet `line` apparaît sous la barre dès 8 px de défilement.
- **Mobile :** sous 900 px, bouton menu de 44 px ; les liens se déplient en liste pleine largeur à filets, texte encre 1,05rem ; Échap referme et rend le focus.

### Fenêtre produit (signature)
Une reconstitution fidèle de la galerie client : barre brume de 44 px avec trois points gris et une adresse `votre-studio.holypixx.com` dans une pastille blanche au cadenas vert, titre de séance, puces, bouton noir « Valider ma sélection », puis une mosaïque de photos (1,55fr + 3 colonnes, 10 px d'écart, coins 8 px) couvertes d'un filigrane « © Votre studio » incliné à -24°, avec cœurs, pastilles de statut et repère numéroté. À l'ouverture, chaque photo se recompose en 16 tuiles qui s'effacent en 0,55 s dans un ordre pseudo-aléatoire stable (38 ms entre tuiles, 90 ms entre photos), une seule fois.

### Notification flottante (signature)
Carte blanche à coins 14 px et ombre flottante, pastille d'icône 36 px à coins 10 px (voile outremer, ambre clair pour une alerte, vert clair pour une validation), titre en encre 600 et détail en `muted`. Elles entrent l'une après l'autre (opacité + 10 px de montée en 0,6 s, 650 ms d'écart après 900 ms) et débordent volontairement de la fenêtre ; sous 640 px, elles rentrent dans le flux sous la fenêtre.

### Labo de protection (signature)
Sur fond nuit : une photo 4:5 à coins 16 px et, à côté, des commandes empilées (fond `night-2`, contour `night-line`, coins 14 px) qui activent chacune une couche : tuiles (grille blanche, léger flou), filigrane, empreinte (trame pervenche en `screen` et code mono). L'état actif passe en contour indigo et pastille pervenche « Visible ». La capture simulée déclenche un flash blanc de 0,5 s, floute la photo, puis fait monter deux cartes blanches (e-mail au photographe, origine retrouvée).

### Ticket de prix (signature)
Carte blanche de 300 px à coins 14 px et ombre flottante, posée sur la bande photo pleine largeur : titre du tirage, lignes coût / marge (en vert) / prix client en mono tabulaire, total au-dessus d'un filet, note « Exemple de prix ». Sous 640 px, il passe sous la photo en pleine largeur, remonté de 56 px sur son bord.

## Do's and Don'ts

### Do:
- **Do** réserver l'outremer `#3b3bf6` à l'action et à l'état actif ; sur fond nuit, utiliser la pervenche `#b9b9ff` pour les états et liens, en gardant le bouton principal outremer.
- **Do** démontrer chaque fonction par un objet d'interface reconstitué (fenêtre, notification, ticket, fiche) plutôt que par une carte icône + titre + texte.
- **Do** montrer les photos de la fondatrice en grand, avec le filigrane de démonstration quand elles figurent dans une galerie client.
- **Do** séparer par des filets d'un pixel (`line`, `line-2` sur brume, `night-line` sur nuit) et par l'alternance papier / brume / nuit.
- **Do** donner aux objets produit l'ombre longue et froide `rgba(20,20,60,…)` et laisser tout le reste à plat.
- **Do** composer prix, codes, empreintes et tailles de fichiers en chiffres tabulaires, en Geist Mono pour les pièces de produit.
- **Do** jouer la recomposition en tuiles une seule fois, avec la courbe `cubic-bezier(.16,1,.3,1)`, et tout couper sous `prefers-reduced-motion`.
- **Do** utiliser les icônes SVG maison au trait 1,5, une seule famille, 20 à 22 px.

### Don't:
- **Don't** colorer un mot de titre en accent ni utiliser de texte en dégradé ; seule la seconde ligne grise des chapitres protection et tarifs est admise.
- **Don't** poser de surtitre en capitales espacées au-dessus d'un titre de chapitre.
- **Don't** donner un halo coloré aux boutons outremer ; leur ombre reste une ombre d'encre neutre.
- **Don't** passer une section en fond nuit en dehors de la protection, de la formule Pro et du serre-livres final.
- **Don't** utiliser de photo de banque d'images ou générée ; la page ne montre que les photos de la fondatrice.
- **Don't** utiliser vert, ambre ou rouge comme couleurs d'ambiance ; ce sont des statuts du produit.
- **Don't** présenter un module à venir comme un module ouvert : il se signale par le badge « Bientôt disponible », sans grille de prix, et le chapitre scolaire garde sa teinte lavande claire tant que le module n'est pas lancé.
