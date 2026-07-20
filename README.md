# Little Dream Photography — Nouveau site

Site vitrine moderne et interactif pour **Little Dream Photography** (photographe
maternité · naissance · famille · smash the cake · portrait · formations, Belgique).

Construit en **HTML / CSS / JavaScript purs** — aucun outil de build, aucune
dépendance à installer. Il suffit d'ouvrir `index.html`.

## 📁 Contenu

```
.
├── index.html      # Structure de toutes les sections
├── style.css       # Design (doux & épuré) + responsive + animations
├── script.js       # Menu mobile, galerie filtrable, lightbox, carrousel, formulaire
├── images/         # Déposez ici vos vraies photos
└── README.md       # Ce fichier
```

## ✨ Fonctionnalités

- **Hero** plein écran animé avec appels à l'action
- **Prestations** en cartes (maternité, naissance, famille, smash the cake, portrait, formations)
- **Galerie filtrable** par thème avec **lightbox** (clic pour agrandir, flèches ←/→, Échap pour fermer)
- **Section À propos** avec statistiques
- **Formations** mises en avant
- **Carrousel de témoignages** automatique
- **FAQ** dépliable
- **Formulaire de réservation** avec validation en direct
- **Animations au défilement**, menu mobile, navigation fluide
- 100 % **responsive** (mobile, tablette, desktop) et accessible au clavier

## 🖼️ Remplacer les images de démonstration

Le site utilise pour l'instant de jolis dégradés de couleur en guise de photos.
Pour mettre vos vraies images :

1. Déposez vos photos dans le dossier `images/` (ex. `maternite-1.jpg`).
2. Dans `index.html`, sur l'élément concerné, ajoutez un attribut `style`
   pointant vers votre image. Par exemple pour une carte de prestation :

   ```html
   <div class="card-media" data-label="Maternité"
        style="background-image:url('images/maternite-1.jpg')"></div>
   ```

   Et pour une vignette de galerie :

   ```html
   <figure class="g-item tall" data-cat="maternite" data-label="Maternité"
           style="background-image:url('images/galerie-1.jpg')" ...></figure>
   ```

3. (Optionnel) Supprimez l'étiquette de catégorie affichée en bas des visuels en
   retirant l'attribut `data-label`, ou laissez-la comme légende.

> Astuce : privilégiez des images optimisées (largeur ~1600 px, format `.jpg` ou
> `.webp`, < 300 Ko) pour un site rapide.

## ✉️ Activer l'envoi du formulaire

Le formulaire affiche un message de confirmation mais n'envoie pas encore d'email
(pas de backend). Pour recevoir les demandes, branchez un service gratuit, au choix :

- **Netlify Forms** : ajoutez `netlify` sur la balise `<form>` — rien d'autre à coder si le site est hébergé sur Netlify.
- **Formspree** : mettez `action="https://formspree.io/f/VOTRE_ID"` et `method="POST"` sur le `<form>`.
- **EmailJS** : envoi côté client via leur SDK.

Pensez aussi à remplacer l'adresse `contact@littledreamphotos.com` dans
`index.html` par votre vraie adresse.

## 🚀 Déploiement

- **Netlify / Vercel** : glissez-déposez ce dossier, ou pointez le répertoire de
  publication vers `littledreamphotos/`.
- **GitHub Pages** : activez Pages sur la branche et le dossier.
- **Test local** : ouvrez simplement `index.html` dans votre navigateur, ou lancez
  `python3 -m http.server` dans ce dossier puis visitez `http://localhost:8000`.

---

*Réalisé avec ❤️ — n'hésitez pas à me demander des ajustements de couleurs, de
textes ou l'ajout de nouvelles sections.*
