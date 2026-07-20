# Little Dream Photography — Site

Site vitrine moderne et interactif pour **Little Dream Photography** (photographe
maternité · naissance · famille · smash the cake · portrait · formations, Belgique).

Construit en **HTML / CSS / JavaScript purs** — aucun outil de build, aucune
dépendance à installer.

## 📁 Contenu

```
.
├── index.html      # Accueil : slideshow → mon histoire → prestations → témoignages → contact
├── portfolio.html  # Portfolios filtrables par thème (avec lightbox)
├── tarifs.html     # Formules & tarifs + formations
├── style.css       # Design (doux & épuré) + responsive + animations
├── script.js       # Slideshow, menu déroulant, filtres, lightbox, carrousel, formulaire
├── images/         # Déposez ici vos vraies photos
└── README.md       # Ce fichier
```

## ✨ Fonctionnalités

- **Accueil épuré** dans l'ordre demandé : en-tête en **slideshow** animé → *Mon histoire* → *Prestations* → *Témoignages* → *Contact*
- **Menu déroulant navigable** (sous-menus Prestations & Portfolios) — survol sur ordinateur, accordéon sur mobile
- **Portfolios filtrables** par thème avec **lightbox** (les liens du menu, ex. `portfolio.html#famille`, ouvrent directement le bon filtre)
- **Page Tarifs modernisée** : formules en cartes, formule mise en avant, section Formations
- **Carrousel de témoignages**, **formulaire de réservation** avec validation, **animations au défilement**
- 100 % **responsive** (mobile, tablette, desktop) et accessible au clavier

## 🖼️ Ajouter vos vraies photos

Le site utilise pour l'instant de jolis dégradés de couleur en guise de photos.
Déposez vos images dans `images/`, puis :

### Le slideshow d'accueil (`index.html`)
Sur chaque `<div class="hero-slide" ...>`, ajoutez un `style` :
```html
<div class="hero-slide is-active" style="background-image:url('images/hero-1.jpg')"></div>
<div class="hero-slide"           style="background-image:url('images/hero-2.jpg')"></div>
```
Ajoutez ou retirez des `hero-slide` : le nombre de puces s'adapte tout seul.

### Cartes de prestations & vignettes de galerie
Même principe, sur les éléments `.card-media` (accueil) et `.g-item` (portfolio) :
```html
<a class="card-media" href="portfolio.html#maternite"
   style="background-image:url('images/maternite.jpg')"></a>

<figure class="g-item tall" data-cat="maternite"
        style="background-image:url('images/galerie-1.jpg')" ...></figure>
```

> Astuce : images optimisées (largeur ~1600 px, `.jpg`/`.webp`, < 300 Ko) pour un site rapide.

## 💶 Renseigner les tarifs

Dans `tarifs.html`, remplacez chaque **« Sur devis »** par votre vrai prix
(ex. `195 €`), et ajustez les durées / le nombre de photos / le contenu des
formules. Un bloc de commentaire en haut du fichier le rappelle.

## ✉️ Activer l'envoi du formulaire

Le formulaire affiche un message de confirmation mais n'envoie pas encore d'email
(pas de backend). Branchez un service gratuit :

- **Netlify Forms** : ajoutez l'attribut `netlify` sur la balise `<form>`.
- **Formspree** : `action="https://formspree.io/f/VOTRE_ID"` et `method="POST"`.
- **EmailJS** : envoi côté client via leur SDK.

Pensez aussi à remplacer l'adresse `contact@littledreamphotos.com` par la vôtre.

## 🚀 Déploiement

- **GitHub Pages** : *Settings → Pages → Source : `main` / `root`*.
- **Netlify / Vercel** : « Import from Git », aucun réglage de build (site statique).
- **Test local** : `python3 -m http.server` dans ce dossier → `http://localhost:8000`.

---

*Réalisé avec ❤️ — demandez-moi tout ajustement de couleurs, textes ou sections.*
