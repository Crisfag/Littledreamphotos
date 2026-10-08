---
version: 1
slug: "galerie-web-index-html"
primary_target: "galerie/web/index.html"
related_targets: ["galerie/web/home.css"]
---

# Page d'accueil Holypixx

Scope : page d'accueil publique (galerie/web/index.html, home.css). Mode : Persuade.
Audience : photographes indépendants (portrait, famille, naissance, mariage), BE/FR, souvent sur ordinateur le soir après la retouche, parfois sur téléphone depuis un lien.
Action : « Créer mon compte » (gratuit, sans carte), puis essai 10 jours des formules payantes.
Preuve : démonstration du produit (pas de témoignages, aucun chiffre inventé). Photos réelles de la fondatrice.
Contraintes : module scolaire présenté « Bientôt », sans prix Scolaire/Studio ; offre Fondateurs dynamique (/api/public/plans) ; liens admin (#/inscription) ; JSON-LD et métadonnées gardés.

## Direction contract

THESIS: « Montrez vos photos. Gardez-les. » La page démontre la protection au lieu de la promettre ; elle refuse le collage de cartes icône + titre + texte du SaaS générique.
OWN-WORLD: blanc net, encre presque noire, un bleu outremer franc (#3b3bf6) pour l'action et l'état actif, un chapitre sombre pour la protection ; Geist (titres serrés 600, texte 400), Geist Mono pour codes, prix et empreintes ; filets fins, fenêtres produit arrondies 16 px aux ombres longues ; icônes SVG au trait 1,5 ; les photos de la fondatrice en grand.
STORY: comprendre en une vue ce qu'est Holypixx, croire à la protection en la testant soi-même, voir le client choisir puis acheter, découvrir le scolaire à venir, choisir sa formule.
FIRST VIEWPORT: titre à gauche (2 lignes, ~5rem), sous-titre, bouton « Créer mon compte — gratuit » + « Voir les tarifs », réassurance en une ligne ; sous le titre, une grande fenêtre de galerie client qui se recompose tuile par tuile, avec notifications flottantes (capture tentée, sélection validée, commande).
FORM: canon « SaaS haut de gamme » choisi par l'utilisatrice (sortie standard), barre Pixieset / Stripe / Linear-Framer ; tirage dégradé, seed 61e523c6. Interaction signature : le labo de protection « Essayez de la capturer » (filigrane, empreinte révélée, capture simulée → alerte et origine retrouvée). Mouvement : recomposition en tuiles, une seule fois.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
