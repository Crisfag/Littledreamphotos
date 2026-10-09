# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Photographes professionnels indépendants et petits studios (portrait, famille, maternité, naissance, mariage), en Belgique et en France d'abord. Ils livrent des séances à des particuliers et veulent montrer leurs photos sans les voir circuler gratuitement, laisser le client choisir, et vendre suppléments et tirages sans gestion. Deuxième public : les photographes scolaires (écoles, crèches, clubs sportifs).

Visiteurs secondaires : les clients des photographes (galerie privée) et les familles (espace famille du module scolaire) ; ils ne s'abonnent pas.

## Product Purpose

Holypixx est une plateforme de galeries clients protégées : le photographe importe une séance, le client reçoit un lien et un mot de passe, choisit et annote ses photos, paie ses suppléments et commande ses tirages ; le photographe livre ensuite les fichiers HD. Le succès : un photographe qui crée son compte, livre sa première galerie et passe à une formule payante.

## Positioning

Protection honnête et traçable plutôt que promesse impossible : photos découpées en tuiles et jamais téléchargeables pendant la sélection, filigrane dense, empreinte invisible propre à chaque galerie (retrouve la galerie d'origine d'une image qui circule), alerte e-mail quand une capture est tentée. Le tout réuni avec la vente (suppléments, boutique de tirages livrés par le labo, campagnes) dans un seul outil, conçu par une photographe.

## Operating Context

- Interface photographe (tableau de bord, hébergé séparément) ; page galerie client ; page portfolio ; espace famille scolaire (`/ecole`).
- Paiements par Stripe Connect sur le compte du photographe ; frais de paiement retenus 2 % + 0,30 € par vente, aucune commission (formule Scolaire : 4,5 % sur les ventes scolaires, frais bancaires compris).
- Tirages de la boutique : laboratoire Prodigi ; photos scolaires : laboratoire BePhoto (Belgique), intégration en cours.
- Inscription et connexion se font sur l'admin (`https://holypixx-admin.onrender.com/`, `#/inscription`).

## Capabilities and Constraints

- Formules (prix TTC, sans engagement, essai 10 jours sur les payantes) :
  - Découverte : gratuit, 3 galeries actives, 5 Go.
  - Essentiel : 15 €/mois ou 150 €/an ; 25 galeries, 200 Go ; boutique de tirages, suppléments en ligne.
  - Pro : 29 €/mois ou 290 €/an ; galeries illimitées, 1 To ; adresse à son nom (votre-studio.holypixx.com), tout inclus.
  - Offre Fondateurs (places limitées, compteur via `GET /api/public/plans`) : Essentiel 12 € et Pro 24 € par mois la première année.
  - Module scolaire lancé le 9 octobre 2026 (`SCHOOL_LAUNCHED = "1"`), modèle hybride :
    - Scolaire : sans abonnement, 5 % des ventes scolaires, frais bancaires compris.
    - Essentiel et Pro : le module inclus, à 5 % des ventes scolaires.
    - Studio : 490 €/an, annuel seulement ; tout Pro + scolaire sans commission ; Fondateurs 440 € la 1re année, 30 places.
    - Raison : la photo scolaire est saisonnière, un mensuel serait pris le temps d'une campagne puis résilié ; Studio devient avantageux pour le photographe au-delà d'environ 25 000 € de ventes scolaires par an.
- Fonctionnalités en ligne : galeries protégées (tuiles, filigrane, empreinte, alerte de capture), sélection et coups de cœur, codes couleur et repères annotés, validation de la sélection, relances automatiques J-7/J-2, forfait et suppléments payés en ligne avec facture PDF, boutique de tirages (Prodigi), campagnes de vente (promotions, paniers retrouvés, relances), tableau de bord des ventes, livraison des fichiers HD, musique d'ambiance, trois mises en page, mot de passe et expiration, sous-domaine à son nom (Pro), portfolio avec formulaire de contact.
- Module scolaire : établissements, années et classes ; import et regroupement automatique des photos par enfant ; fiches parents avec QR et code d'accès ; espace famille (frères et sœurs réunis) ; gamme de pochettes et planches avec aperçu de la photo de l'enfant ; panier unique et paiement en ligne ; livraison groupée à l'école puis à domicile ; rappels aux familles ; lots d'envoi au labo BePhoto.
- Site statique (HTML/CSS/JS sans framework) publié sur Cloudflare Pages depuis `galerie/web` ; polices via Google Fonts.

## Brand Commitments

- Nom : Holypixx. Domaine www.holypixx.com. Langue : français (vouvoiement).
- Ton : franc et précis ; pas de promesse impossible (« une capture d'écran ne s'empêche pas, elle se rend inutile et se trace »).
- Fondatrice : Christine, photographe (studio Little Dream Photos).
- Page d'accueil : la fondatrice a choisi le registre « SaaS haut de gamme classique », exécuté au niveau de finition de Pixieset, Stripe et Linear/Framer (octobre 2026).

## Evidence on Hand

- Photos de la fondatrice, utilisables sur le site : `images/` (famille, maternité, naissance, portrait, portrait-enfant…) ; sélection exportée pour la page d'accueil dans `galerie/web/assets/home/`.
- Aucun témoignage, aucun chiffre d'usage, aucune presse : ne pas en inventer.

## Product Principles

1. Dire la vérité sur la protection : ce qui est empêché, ce qui est rendu inutile, ce qui est tracé.
2. Le photographe garde la main et la marge : ses prix, son compte Stripe, son nom.
3. Rien à apprendre pour le client : un lien, un mot de passe, aucun compte.
4. Automatiser la gestion (relances, factures, labo) pour laisser le photographe photographier.

## Accessibility & Inclusion

Pages publiques en français, lisibles sur téléphone (clients et familles y arrivent par lien ou QR code) ; respect de prefers-reduced-motion.
