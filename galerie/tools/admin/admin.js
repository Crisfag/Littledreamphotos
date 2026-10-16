/* =====================================================================
   Interface d'administration — logique client
   Parle uniquement à ce serveur local (même origine, /local/…), qui
   porte les secrets et fait tourner sharp. Aucun jeton n'atteint jamais
   ce fichier.
   ===================================================================== */

(function () {
  "use strict";

  var UPLOAD_CONCURRENCY = 3;
  var EVENT_LABELS = {
    login: "Connexion",
    login_failed: "Mot de passe erroné",
    login_expired: "Tentative après expiration",
    view: "Photo ouverte",
    select: "Coup de cœur",
    deselect: "Coup de cœur retiré",
    comment: "Remarque laissée",
    tag: "Code couleur posé",
    mark: "Repères annotés",
    validate: "Sélection validée par le client",
    capture_suspected: "Capture suspectée",
    blur: "Photo floutée",
    print: "Tentative d'impression",
    devtools: "Outils de développement ouverts",
  };

  var BACKGROUND_PRESETS = [
    { color: "", label: "Défaut" },
    { color: "#e5dbd0", label: "Sable" },
    { color: "#b98a7a", label: "Rose" },
    { color: "#dce3e0", label: "Sauge" },
    { color: "#e3dce8", label: "Lavande" },
    { color: "#3a332e", label: "Charbon" },
  ];

  var LAYOUT_OPTIONS = [
    { value: "grille", label: "Grille", hint: "Vignettes régulières — pour parcourir beaucoup de photos rapidement." },
    { value: "mosaique", label: "Mosaïque", hint: "Colonnes façon presse, chaque photo garde son format — portraits et paysages mélangés." },
    { value: "defilement", label: "Défilement", hint: "Une photo à la fois, en grand — effet éditorial, pour une séance à raconter." },
    { value: "recit", label: "Récit", hint: "Comme un livre photo : paysages en grand, portraits par deux, des respirations — idéal pour un mariage." },
  ];

  // Styles de galerie (palette et polices de l'aperçu ; la page cliente
  // applique les mêmes dans gallery.css et gallery.js, data-theme).
  var GALLERY_STYLES = [
    { key: "classique", label: "Classique", ideal: "Toutes les séances", bg: "#fdfbf8", head: "linear-gradient(180deg, #f7f2ec, #fdfbf8)", ink: "#2b2521", muted: "#7c716a", accent: "#b98a7a", tile: "#efe6db", radius: 6, fonts: ["cormorant", "jost"] },
    { key: "doux", label: "Doux", ideal: "Naissance, bébé, famille", bg: "#fffaf8", head: "radial-gradient(90% 120% at 50% 0%, #f9e3de, #fffaf8 70%)", ink: "#3b2f2c", muted: "#8c7b76", accent: "#c99a92", tile: "#f5e4df", radius: 12, fonts: ["cormorant", "nunito"] },
    { key: "architectural", label: "Architectural", ideal: "Portrait, entreprise, architecture", bg: "#ffffff", head: "#ffffff", ink: "#0e0e0e", muted: "#6b6b6b", accent: "#111111", tile: "#e4e4e2", radius: 0, fonts: ["josefin", "worksans"] },
    { key: "moderne", label: "Moderne", ideal: "Lifestyle, événement, marque", bg: "#f7f7f5", head: "#f7f7f5", ink: "#141414", muted: "#6e6e69", accent: "#2f5d50", tile: "#e3e3de", radius: 5, fonts: ["manrope", "manrope"] },
    { key: "nuit", label: "Nuit", ideal: "Boudoir, soirée, concert", bg: "#111110", head: "linear-gradient(180deg, #1d1b19, #111110)", ink: "#f3ede4", muted: "#9a9086", accent: "#c8a46e", tile: "#2a2724", radius: 3, fonts: ["cormorant", "jost"] },
    { key: "editorial", label: "Éditorial", ideal: "Mariage, reportage", bg: "#faf8f4", head: "#faf8f4", ink: "#191714", muted: "#7a7368", accent: "#8a7356", tile: "#e6dfd3", radius: 1, fonts: ["bodoni", "karla"] },
    { key: "romantique", label: "Romantique", ideal: "Mariage, fiançailles, couple", bg: "#fffdfb", head: "radial-gradient(80% 120% at 50% 0%, #f7e9df, #fffdfb 72%)", ink: "#2e2622", muted: "#8a7d72", accent: "#b8916b", tile: "#f0e2d7", radius: 5, fonts: ["greatvibes", "lora"] },
    { key: "boheme", label: "Bohème", ideal: "Grossesse, famille en extérieur", bg: "#f8f3ec", head: "linear-gradient(180deg, #efe3d3, #f8f3ec)", ink: "#2f271f", muted: "#857766", accent: "#b4694a", tile: "#e6d8c5", radius: 3, fonts: ["fraunces", "karla"] },
    { key: "galerie", label: "Galerie d'art", ideal: "Portfolio, fine art, mode", bg: "#ffffff", head: "#ffffff", ink: "#111111", muted: "#8a8a8a", accent: "#3c3c3c", tile: "#ededed", radius: 0, fonts: ["marcellus", "worksans"] },
  ];
  // [famille, paramètres Google Fonts, repli, catégorie]
  var GALLERY_FONTS = {
    cormorant: ["Cormorant Garamond", "Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500", "Georgia, serif", "serif"],
    playfair: ["Playfair Display", "Playfair+Display:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif", "serif"],
    bodoni: ["Bodoni Moda", "Bodoni+Moda:ital,wght@0,400;0,500;0,600;1,400", "Didot, Georgia, serif", "serif"],
    fraunces: ["Fraunces", "Fraunces:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif", "serif"],
    dmserif: ["DM Serif Display", "DM+Serif+Display:ital@0;1", "Georgia, serif", "serif"],
    marcellus: ["Marcellus", "Marcellus", "Georgia, serif", "serif"],
    italiana: ["Italiana", "Italiana", "Georgia, serif", "serif"],
    josefin: ["Josefin Sans", "Josefin+Sans:ital,wght@0,300;0,400;0,600;1,400", "sans-serif", "sans"],
    manrope: ["Manrope", "Manrope:wght@300;400;500;600;700", "sans-serif", "sans"],
    montserrat: ["Montserrat", "Montserrat:ital,wght@0,300;0,400;0,500;0,600;1,400", "sans-serif", "sans"],
    syne: ["Syne", "Syne:wght@400;500;600;700", "sans-serif", "sans"],
    greatvibes: ["Great Vibes", "Great+Vibes", "cursive", "script"],
    parisienne: ["Parisienne", "Parisienne", "cursive", "script"],
    jost: ["Jost", "Jost:ital,wght@0,300;0,400;0,500;1,300;1,400", "sans-serif", "sans"],
    nunito: ["Nunito Sans", "Nunito+Sans:ital,wght@0,300;0,400;0,600;1,400", "sans-serif", "sans"],
    worksans: ["Work Sans", "Work+Sans:ital,wght@0,300;0,400;0,500;1,400", "sans-serif", "sans"],
    karla: ["Karla", "Karla:ital,wght@0,300;0,400;0,500;1,400", "sans-serif", "sans"],
    lato: ["Lato", "Lato:ital,wght@0,300;0,400;0,700;1,400", "sans-serif", "sans"],
    inter: ["Inter", "Inter:wght@300;400;500;600", "sans-serif", "sans"],
    lora: ["Lora", "Lora:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif", "serif"],
    ebgaramond: ["EB Garamond", "EB+Garamond:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif", "serif"],
  };
  var TITLE_FONT_KEYS = ["cormorant", "playfair", "bodoni", "fraunces", "dmserif", "marcellus", "italiana", "josefin", "manrope", "montserrat", "syne", "greatvibes", "parisienne"];
  var BODY_FONT_KEYS = ["jost", "nunito", "worksans", "manrope", "karla", "lato", "inter", "lora", "ebgaramond", "montserrat"];

  var state = { view: "list", galleries: [], current: null, config: { previewCols: 2, previewRows: 2 } };
  var el = {
    view: document.getElementById("ad-view"),
    toast: document.getElementById("ad-toast"),
    login: document.getElementById("ad-login"),
    app: document.getElementById("ad-app"),
    account: document.getElementById("ad-current-account"),
    tabs: document.getElementById("ad-tabs"),
    tabOwner: document.getElementById("ad-tab-owner"),
    tabSchool: document.getElementById("ad-tab-school"),
  };

  /* ---------- Langue de l'espace photographe (français / anglais) ---------- */
  // Choisie à l'inscription (?lang=en depuis la page anglaise), modifiable
  // dans Paramètres ; avant connexion : bouton English / Français, puis la
  // dernière langue utilisée dans ce navigateur. L("…", "…") rend le texte
  // dans la langue en cours. Les sections pas encore traduites (réservation,
  // contrats, clients, ventes, portfolio, scolaire) restent en français,
  // avec un bandeau qui le dit.

  var LANG = "fr";
  var LANG_KEY = "holypixx-admin-lang";

  function L(fr, en) {
    return LANG === "en" ? en : fr;
  }

  function locale() {
    return LANG === "en" ? "en-GB" : "fr-BE";
  }

  function initialLanguage() {
    var match = /[?&]lang=(en|fr)\b/.exec(location.search + "&" + location.hash);
    if (match) return match[1];
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "fr") return saved;
    } catch (err) { /* navigation privée */ }
    // Français par défaut, même si le navigateur est en anglais : l'anglais
    // se choisit (page anglaise ?lang=en, bouton « English », Paramètres),
    // pour qu'aucun compte ne naisse en anglais sans qu'on l'ait voulu.
    return "fr";
  }

  // Textes des constantes ci-dessus, en anglais (le français reste la valeur
  // d'origine, gardée à côté pour pouvoir revenir en arrière).
  var EVENT_LABELS_EN = {
    login: "Sign-in", login_failed: "Wrong password", login_expired: "Attempt after expiry", view: "Photo opened",
    select: "Favourite", deselect: "Favourite removed", comment: "Note left", tag: "Colour code set", mark: "Annotated markers",
    validate: "Selection confirmed by the client", capture_suspected: "Screenshot suspected", blur: "Photo blurred",
    print: "Print attempt", devtools: "Developer tools opened",
  };
  var BACKGROUND_PRESETS_EN = ["Default", "Sand", "Rose", "Sage", "Lavender", "Charcoal"];
  var LAYOUT_OPTIONS_EN = {
    grille: ["Grid", "Regular thumbnails — to browse many photos quickly."],
    mosaique: ["Mosaic", "Press-style columns, each photo keeps its shape — portraits and landscapes mixed."],
    defilement: ["Scroll", "One photo at a time, large — an editorial feel, for a session that tells a story."],
    recit: ["Story", "Like a photo book: big landscapes, portraits in pairs, breathing space — ideal for a wedding."],
  };
  var GALLERY_STYLES_EN = {
    classique: ["Classic", "Every session"], doux: ["Soft", "Newborn, baby, family"],
    architectural: ["Architectural", "Portrait, corporate, architecture"], moderne: ["Modern", "Lifestyle, events, brands"],
    nuit: ["Night", "Boudoir, party, concert"], editorial: ["Editorial", "Wedding, documentary"],
    romantique: ["Romantic", "Wedding, engagement, couple"], boheme: ["Boho", "Maternity, outdoor family"],
    galerie: ["Art gallery", "Portfolio, fine art, fashion"],
  };

  function swapTexts() {
    Object.keys(EVENT_LABELS).forEach(function (key) {
      if (!swapTexts.events) swapTexts.events = Object.assign({}, EVENT_LABELS);
      EVENT_LABELS[key] = LANG === "en" ? EVENT_LABELS_EN[key] || swapTexts.events[key] : swapTexts.events[key];
    });
    BACKGROUND_PRESETS.forEach(function (p, i) {
      if (p.labelFr === undefined) p.labelFr = p.label;
      p.label = LANG === "en" ? BACKGROUND_PRESETS_EN[i] : p.labelFr;
    });
    LAYOUT_OPTIONS.forEach(function (o) {
      if (o.labelFr === undefined) { o.labelFr = o.label; o.hintFr = o.hint; }
      var en = LAYOUT_OPTIONS_EN[o.value];
      o.label = LANG === "en" && en ? en[0] : o.labelFr;
      o.hint = LANG === "en" && en ? en[1] : o.hintFr;
    });
    GALLERY_STYLES.forEach(function (st) {
      if (st.labelFr === undefined) { st.labelFr = st.label; st.idealFr = st.ideal; }
      var en = GALLERY_STYLES_EN[st.key];
      st.label = LANG === "en" && en ? en[0] : st.labelFr;
      st.ideal = LANG === "en" && en ? en[1] : st.idealFr;
    });
  }

  // Textes fixes de index.html : data-en, data-en-html, data-en-label,
  // data-en-title, data-en-placeholder (le français d'origine est gardé
  // dans data-fr-*, pour revenir en arrière sans recharger).
  function applyStaticLanguage() {
    var pairs = [["data-en", null], ["data-en-html", "html"], ["data-en-label", "aria-label"], ["data-en-title", "title"], ["data-en-placeholder", "placeholder"]];
    pairs.forEach(function (pair) {
      document.querySelectorAll("[" + pair[0] + "]").forEach(function (node) {
        var frKey = pair[0].replace("data-en", "data-fr");
        if (!node.hasAttribute(frKey)) {
          node.setAttribute(frKey, pair[1] === null ? node.textContent : pair[1] === "html" ? node.innerHTML : node.getAttribute(pair[1]) || "");
        }
        var value = LANG === "en" ? node.getAttribute(pair[0]) : node.getAttribute(frKey);
        if (pair[1] === null) node.textContent = value;
        else if (pair[1] === "html") node.innerHTML = value;
        else node.setAttribute(pair[1], value);
      });
    });
    var switcher = document.getElementById("ad-lang-switch");
    if (switcher) {
      switcher.textContent = LANG === "en" ? "Français" : "English";
      switcher.setAttribute("lang", LANG === "en" ? "fr" : "en");
    }
    document.title = L("Espace photographe — Holypixx", "Photographer dashboard — Holypixx");
  }

  function setLanguage(lang, remember) {
    LANG = lang === "en" ? "en" : "fr";
    document.documentElement.lang = LANG;
    swapTexts();
    applyStaticLanguage();
    if (remember) {
      try { localStorage.setItem(LANG_KEY, LANG); } catch (err) { /* navigation privée */ }
    }
  }

  // Messages d'erreur du serveur (rédigés en français) : leur traduction
  // quand elle est connue ; sinon le message d'origine, plus précis qu'un
  // message générique.
  var SERVER_EN = {
    "Adresse de retour invalide": "Invalid return URL",
    "Adresse e-mail invalide": "Invalid email address",
    "Ambiance inconnue": "Unknown mood",
    "Au moins 3 caractères": "At least 3 characters",
    "Aucun abonnement à gérer": "No subscription to manage",
    "Aucun fichier reçu": "No file received",
    "Aucune livraison": "No delivery",
    "Aucune musique": "No music",
    "C'est déjà votre adresse actuelle": "That is already your current address",
    "C'est un lien raccourci : ouvrez-le dans votre navigateur, puis copiez l'adresse complète qui s'affiche.": "This is a short link: open it in your browser, then copy the full address that appears.",
    "Ce lien n'est pas valide": "This link is not valid",
    "Ce nom est réservé": "This name is reserved",
    "Ce slug est déjà utilisé": "This link name is already taken",
    "Ce sous-domaine est déjà pris": "This subdomain is already taken",
    "Cette adresse est déjà utilisée par un autre compte": "This address is already used by another account",
    "Cette commande a déjà été transmise au laboratoire": "This order has already been sent to the lab",
    "Cette formule n'est pas encore ouverte.": "This plan is not open yet.",
    "Cette formule s'active sans paiement, depuis l'onglet Abonnement.": "This plan is activated without payment, from the Subscription tab.",
    "Cette photo n'est pas dans la galerie": "This photo is not in the gallery",
    "Cette session de paiement ne vous appartient pas": "This payment session does not belong to you",
    "Clé Prodigi invalide": "Invalid Prodigi key",
    "Clé forensique non configurée sur ce serveur": "Forensic key not configured on this server",
    "Code de parrainage inconnu": "Unknown referral code",
    "Collez le lien d'un morceau ou d'une playlist": "Paste the link of a track or a playlist",
    "Commande introuvable": "Order not found",
    "Compte introuvable": "Account not found",
    "Couleur invalide (format #rrggbb)": "Invalid colour (#rrggbb format)",
    "Date d'expiration illisible": "Unreadable expiry date",
    "Dimensions invalides": "Invalid dimensions",
    "Déposez d'abord les photos à livrer": "Upload the photos to deliver first",
    "E-mail du client invalide": "Invalid client email",
    "E-mail et mot de passe requis": "Email and password required",
    "E-mail ou mot de passe incorrect": "Incorrect email or password",
    "Empreinte CRC-32 manquante (envoyez le fichier depuis l'interface d'administration)": "Missing CRC-32 checksum (upload the file from the dashboard)",
    "Enregistrez d'abord votre clé Prodigi": "Save your Prodigi key first",
    "Erreur interne": "Internal error",
    "Facture introuvable": "Invoice not found",
    "Fichier d'impression introuvable": "Print file not found",
    "Fichier d'impression trop volumineux": "Print file too large",
    "Fichier indisponible": "File unavailable",
    "Fichier introuvable": "File not found",
    "Fichier trop volumineux": "File too large",
    "Fichier trop volumineux (15 Mo maximum)": "File too large (15 MB maximum)",
    "Fichier trop volumineux (80 Mo maximum)": "File too large (80 MB maximum)",
    "Fichier vide": "Empty file",
    "Format introuvable": "Product not found",
    "Formats acceptés : JPEG, PNG, TIFF, WebP, HEIC": "Accepted formats: JPEG, PNG, TIFF, WebP, HEIC",
    "Formule inconnue": "Unknown plan",
    "Frais de port hors Europe invalides": "Invalid shipping cost outside Europe",
    "Frais de port invalides": "Invalid shipping cost",
    "Galerie introuvable": "Gallery not found",
    "Identifiant de photo déjà utilisé": "Photo ID already used",
    "Identifiant de photo invalide": "Invalid photo ID",
    "Image illisible (JPEG, PNG ou WebP attendu)": "Unreadable image (JPEG, PNG or WebP expected)",
    "Image introuvable": "Image not found",
    "Image trop lourde (40 Mo maximum)": "Image too large (40 MB maximum)",
    "Interdit": "Forbidden",
    "Introuvable": "Not found",
    "La boutique de tirages n'est pas ouverte sur cette galerie": "The print shop is not open on this gallery",
    "Langue inconnue": "Unknown language",
    "Le compte propriétaire a déjà toutes les fonctionnalités.": "The owner account already has every feature.",
    "Le libellé est requis": "A label is required",
    "Le nom du studio est requis": "Studio name is required",
    "Le paiement des abonnements n'est pas encore configuré sur la plateforme.": "Subscription payments are not configured on the platform yet.",
    "Le paiement en ligne n'est pas encore activé": "Online payment is not enabled yet",
    "Le paiement en ligne n'est pas encore configuré sur cette plateforme": "Online payment is not configured on this platform yet",
    "Le titre est requis": "A title is required",
    "Lettres minuscules, chiffres et tirets seulement (30 caractères maximum, sans tiret au début ni à la fin)": "Lowercase letters, digits and hyphens only (30 characters maximum, no hyphen at the start or end)",
    "Lien Deezer non reconnu : copiez le lien d'un titre, d'un album ou d'une playlist.": "Deezer link not recognised: copy the link of a track, an album or a playlist.",
    "Lien SoundCloud non reconnu : copiez le lien d'un morceau ou d'une playlist.": "SoundCloud link not recognised: copy the link of a track or a playlist.",
    "Lien Spotify non reconnu : copiez le lien d'un titre, d'un album ou d'une playlist (Partager → Copier le lien).": "Spotify link not recognised: copy the link of a track, an album or a playlist (Share → Copy link).",
    "Lien Vimeo non reconnu : copiez le lien de la vidéo.": "Vimeo link not recognised: copy the link of the video.",
    "Lien YouTube non reconnu : copiez le lien d'une vidéo ou d'une playlist.": "YouTube link not recognised: copy the link of a video or a playlist.",
    "Lien YouTube non reconnu : copiez le lien de la vidéo (Partager → Copier le lien).": "YouTube link not recognised: copy the link of the video (Share → Copy link).",
    "Lien et mot de passe requis": "Link and password required",
    "Lien invalide": "Invalid link",
    "Lien invalide ou expiré": "Invalid or expired link",
    "Lien de confirmation invalide ou expiré.": "Invalid or expired confirmation link.",
    "Livraison trop volumineuse (4 Go maximum par galerie)": "Delivery too large (4 GB maximum per gallery)",
    "Merci d'accepter les conditions d'utilisation et la politique de confidentialité": "Please accept the terms of use and the privacy policy",
    "Mise en page inconnue": "Unknown layout",
    "Morceau inconnu": "Unknown track",
    "Morceau introuvable dans la bibliothèque": "Track not found in the library",
    "Mot de passe actuel incorrect": "Current password is incorrect",
    "Mot de passe incorrect": "Incorrect password",
    "Mot de passe trop court (10 caractères minimum)": "Password too short (10 characters minimum)",
    "Mot de passe trop court (8 caractères minimum)": "Password too short (8 characters minimum)",
    "Nombre de photos incluses invalide": "Invalid number of included photos",
    "Non connecté": "Not signed in",
    "Nouveau mot de passe trop court (10 caractères minimum)": "New password too short (10 characters minimum)",
    "Options (attributs) invalides": "Invalid options (attributes)",
    "Options (attributs) invalides : un objet JSON est attendu": "Invalid options (attributes): a JSON object is expected",
    "Pays de livraison non proposé": "Shipping country not offered",
    "Photo introuvable": "Photo not found",
    "Photo trop lourde (40 Mo maximum)": "Photo too large (40 MB maximum)",
    "Police de texte inconnue": "Unknown body font",
    "Police de titre inconnue": "Unknown title font",
    "Prix du supplément invalide": "Invalid extra photo price",
    "Prix invalide": "Invalid price",
    "Produit inconnu": "Unknown product",
    "Requête invalide": "Invalid request",
    "Référence (SKU) Prodigi invalide": "Invalid Prodigi SKU",
    "Session invalide": "Invalid session",
    "Session invalide ou expirée": "Invalid or expired session",
    "Seul le format MP3 est accepté": "Only MP3 files are accepted",
    "Seuls les liens Spotify, Deezer, SoundCloud et YouTube sont acceptés.": "Only Spotify, Deezer, SoundCloud and YouTube links are accepted.",
    "Seuls les liens YouTube et Vimeo sont acceptés pour la vidéo d'en-tête.": "Only YouTube and Vimeo links are accepted for the header video.",
    "Si un compte existe avec cette adresse, un lien vient d'être envoyé.": "If an account exists with this address, a link has just been sent.",
    "Slug invalide (minuscules, chiffres et tirets, 2 à 61 caractères)": "Invalid link name (lowercase letters, digits and hyphens, 2 to 61 characters)",
    "Source de musique inconnue": "Unknown music source",
    "Stripe a refusé la demande de paiement": "Stripe declined the payment request",
    "Style inconnu": "Unknown style",
    "Titre requis": "Title required",
    "Trop de tentatives. Réessayez dans quelques minutes.": "Too many attempts. Try again in a few minutes.",
    "Un compte existe déjà avec cette adresse e-mail": "An account already exists with this email address",
    "Vous avez déjà un abonnement : changez de formule depuis « Gérer mon abonnement ».": "You already have a subscription: change plan from “Manage my subscription”.",
    "Vous avez déjà un abonnement en cours : il vient d'être enregistré, rechargez la page.": "You already have an active subscription: it has just been recorded, reload the page.",
    "Vous avez un abonnement en cours : résiliez-le d'abord depuis « Gérer mon abonnement », ou passez à Studio qui comprend déjà le scolaire.": "You have an active subscription: cancel it first from “Manage my subscription”, or switch to Studio, which already includes schools.",
    "Worker injoignable": "Server unreachable",
    "Inscription refusée": "Sign-up refused",
    "Connexion refusée": "Sign-in refused",
    "Réinitialisation refusée": "Reset refused",
    "Confirmation refusée": "Confirmation refused",
    "Vous avez déjà une galerie de démonstration": "You already have a demo gallery",
    "Échec de l'analyse de l'image": "Image analysis failed",
    "Impossible de démarrer la connexion à Stripe": "Could not start the Stripe connection",
    "Impossible de générer un identifiant unique": "Could not generate a unique ID",
  };
  // Messages composés côté serveur (formule, quota, stockage).
  var FEATURE_LABELS_EN = {
    "La boutique de tirages": "The print shop",
    "Le paiement en ligne des suppléments": "Online payment for extra photos",
    "Les campagnes de vente": "Sales campaigns",
    "L'adresse à votre nom": "A gallery address in your name",
    "Le module écoles, crèches et clubs": "The schools, nurseries and clubs module",
    "La réservation en ligne": "Online booking",
    "Les devis et contrats signés en ligne": "Quotes and contracts signed online",
    "Cette fonctionnalité": "This feature",
  };
  var PLAN_LABELS_FR_EN = { "Découverte": "Free", "Essentiel": "Essentials", "Pro": "Pro", "Scolaire": "School", "Studio": "Studio", "payante": "paid" };
  function sizeEn(text) {
    return text.replace(",", ".").replace(/ To$/, " TB").replace(/ Go$/, " GB").replace(/ Mo$/, " MB");
  }
  var SERVER_EN_PATTERNS = [
    [/^(.+?) (?:est incluse|est inclus|sont inclus|sont incluses) à partir de la formule (\S+) \(onglet Abonnement\)\.$/, function (m) {
      return (FEATURE_LABELS_EN[m[1]] || m[1]) + " is included from the " + (PLAN_LABELS_FR_EN[m[2]] || m[2]) + " plan (Subscription tab).";
    }],
    [/^Votre formule (\S+) permet (\d+) galeries actives\./, function (m) {
      return "Your " + (PLAN_LABELS_FR_EN[m[1]] || m[1]) + " plan allows " + m[2] + " active galleries. Delete a gallery or let one expire, or upgrade your plan (Subscription tab).";
    }],
    [/^Votre espace de stockage est plein \((.+?) avec la formule (\S+)\)\./, function (m) {
      return "Your storage is full (" + sizeEn(m[1]) + " with the " + (PLAN_LABELS_FR_EN[m[2]] || m[2]) + " plan). Delete old galleries or deliveries, or upgrade your plan (Subscription tab).";
    }],
    [/^Au plus (\d+) formats$/, function (m) { return "At most " + m[1] + " products"; }],
    [/^(\d+) fichiers maximum par galerie$/, function (m) { return m[1] + " files maximum per gallery"; }],
    [/^Erreur HTTP (\d+)$/, function (m) { return "HTTP error " + m[1]; }],
  ];
  function serverText(message) {
    if (LANG !== "en" || !message) return message;
    if (SERVER_EN[message]) return SERVER_EN[message];
    for (var i = 0; i < SERVER_EN_PATTERNS.length; i++) {
      var m = SERVER_EN_PATTERNS[i][0].exec(message);
      if (m) return SERVER_EN_PATTERNS[i][1](m);
    }
    return message;
  }

  // Sections pas encore traduites : un bandeau le dit, en anglais.
  var UNTRANSLATED_TABS = { clients: 1, booking: 1, contracts: 1, sales: 1, portfolio: 1, school: 1, owner: 1 };

  setLanguage(initialLanguage(), false);
  var langSwitch = document.getElementById("ad-lang-switch");
  if (langSwitch) {
    langSwitch.addEventListener("click", function () {
      setLanguage(LANG === "en" ? "fr" : "en", true);
    });
  }

  /* ---------- Onglets (Galeries / Facturation / Paramètres) ---------- */
  // Purement visuel : chaque écran reste atteignable par son propre lien de
  // hachage (#/facturation, #/parametres…) — les onglets ne sont qu'un
  // raccourci qui reflète, et met à jour, ce même état.

  function setActiveTab(name) {
    stopTrackPreview();
    if (el.view) {
      if (LANG === "en" && UNTRANSLATED_TABS[name]) el.view.setAttribute("data-untranslated", "This section is still in French — its English version is on its way.");
      else el.view.removeAttribute("data-untranslated");
    }
    if (!el.tabs) return;
    el.tabs.querySelectorAll(".ad-tab").forEach(function (btn) {
      var active = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("ad-tab-active", active);
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  if (el.tabs) {
    el.tabs.addEventListener("click", function (event) {
      var btn = event.target.closest(".ad-tab");
      if (!btn) return;
      var tab = btn.getAttribute("data-tab");
      if (tab === "galleries") renderList();
      else if (tab === "planning") renderPlanning();
      else if (tab === "sales") renderSales();
      else if (tab === "booking") renderBooking();
      else if (tab === "clients") renderClients();
      else if (tab === "contracts") renderContracts();
      else if (tab === "portfolio") renderPortfolio();
      else if (tab === "billing") renderBilling();
      else if (tab === "shop") renderShop();
      else if (tab === "subscription") renderSubscription();
      else if (tab === "settings") renderSettings();
      else if (tab === "owner") renderOwner();
      else if (tab === "school") renderSchool();
    });
  }

  /* ---------- Session ---------- */

  var LOGIN_CARD_IDS = ["ad-login-card", "ad-signup-card", "ad-forgot-card", "ad-reset-card"];

  function showLoginCard(visibleId) {
    el.app.hidden = true;
    el.login.hidden = false;
    LOGIN_CARD_IDS.forEach(function (id) {
      document.getElementById(id).hidden = id !== visibleId;
    });
  }

  function showLogin() {
    // Le bouton « Créer un compte » du site mène à #/inscription.
    showLoginCard(location.hash.indexOf("#/inscription") === 0 ? "ad-signup-card" : "ad-login-card");
  }

  // Lien de parrainage (holypixx.com/?parrain=CODE → #/inscription?parrain=CODE) :
  // le code est gardé dans le navigateur le temps de s'inscrire.
  var REFERRAL_KEY = "holypixx-parrain";
  function referralCode() {
    var match = /[?&]parrain=([A-Za-z0-9-]{6,20})/.exec(location.hash + "&" + location.search);
    var code = match ? match[1].toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    try {
      if (code) localStorage.setItem(REFERRAL_KEY, code);
      else code = localStorage.getItem(REFERRAL_KEY) || "";
    } catch (err) { /* navigation privée : le code de l'adresse suffit */ }
    return code;
  }
  async function showReferralBanner() {
    var code = referralCode();
    var banner = document.getElementById("ad-signup-referral");
    if (!code || !banner) return;
    try {
      var response = await fetch("/local/referral/" + encodeURIComponent(code));
      if (!response.ok) return;
      var data = await response.json();
      banner.innerHTML = L(
        "<strong>" + esc(data.studio) + "</strong> vous parraine : −" + Number(data.discountPercent) + " % sur votre mois suivant, dès votre premier paiement.",
        "<strong>" + esc(data.studio) + "</strong> referred you: " + Number(data.discountPercent) + "% off your following month, from your first payment."
      );
      banner.hidden = false;
    } catch (err) { /* sans bandeau, l'inscription garde le code */ }
  }
  showReferralBanner();

  function showApp(photographer) {
    setLanguage(photographer.uiLanguage, true);
    el.login.hidden = true;
    el.app.hidden = false;
    if (el.account) {
      el.account.textContent = (photographer.studioName || photographer.email) + L(" · Galeries protégées", " · Protected galleries");
      el.account.title = el.account.textContent;
    }
    state.isOwner = Boolean(photographer.isOwner);
    state.me = photographer;
    if (el.tabOwner) el.tabOwner.hidden = !state.isOwner;
    if (el.tabSchool) el.tabSchool.hidden = !photographer.schoolTab;
  }

  /* ---------- Requêtes ---------- */

  async function api(method, path, body) {
    var response = await fetch("/local" + path, {
      method: method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    // La session a expiré, ou a été révoquée entre-temps : plutôt que de
    // laisser chaque appelant deviner pourquoi sa requête échoue, on montre
    // l'écran de connexion directement.
    if (response.status === 401) {
      showLogin();
      throw new Error(L("Session expirée — reconnectez-vous.", "Session expired — please sign in again."));
    }
    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      /* réponse vide, sans conséquence */
    }
    if (!response.ok) {
      var message = serverText((data && data.error) || ("Erreur HTTP " + response.status));
      var error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function uploadPhoto(slug, file, position, onProgress) {
    return new Promise(function (resolve, reject) {
      var form = new FormData();
      form.append("file", file, file.name);
      form.append("position", String(position));

      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/local/galleries/" + encodeURIComponent(slug) + "/photos");
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = function () {
        var data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (err) {
          /* réponse illisible : traité ci-dessous comme une erreur */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(serverText(data && data.error) || L("Échec de l'envoi (", "Upload failed (") + xhr.status + ")"));
      };
      xhr.onerror = function () {
        reject(new Error(L("Connexion au serveur d'administration perdue", "Lost connection to the dashboard server")));
      };
      xhr.send(form);
    });
  }

  /* ---------- Utilitaires d'interface ---------- */

  function toast(message, isError) {
    el.toast.textContent = message;
    el.toast.className = "ad-toast ad-toast-visible" + (isError ? " ad-toast-error" : "");
    el.toast.hidden = false;
    clearTimeout(toast._t);
    // Un message long (mode d'emploi) reste affiché le temps d'être lu.
    toast._t = setTimeout(function () {
      el.toast.hidden = true;
    }, Math.max(4200, message.length * 60));
  }

  // Échappement générique : sûr aussi bien dans un nœud texte que dans la
  // valeur d'un attribut (guillemets compris), pour ne pas dépendre du
  // contexte à chaque site d'appel.
  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function openModal(id) {
    document.getElementById(id).hidden = false;
  }
  function closeModal(id) {
    document.getElementById(id).hidden = true;
  }

  function confirmAction(text, onConfirm) {
    document.getElementById("ad-confirm-text").textContent = text;
    openModal("ad-confirm-modal");
    var okBtn = document.getElementById("ad-confirm-ok");
    var handler = function () {
      closeModal("ad-confirm-modal");
      okBtn.removeEventListener("click", handler);
      onConfirm();
    };
    okBtn.addEventListener("click", handler);
  }

  // Échap ferme la fenêtre ouverte, comme un clic sur le fond.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    var open = document.querySelectorAll(".ad-modal-backdrop:not([hidden])");
    if (open.length) open[open.length - 1].hidden = true;
  });

  document.addEventListener("click", function (event) {
    if (event.target.matches("[data-close-modal]")) {
      var backdrop = event.target.closest(".ad-modal-backdrop");
      if (backdrop) backdrop.hidden = true;
    }
    if (event.target.matches(".ad-modal-backdrop")) event.target.hidden = true;
    var copyBtn = event.target.closest("[data-copy]");
    if (copyBtn) {
      var input = document.getElementById(copyBtn.getAttribute("data-copy"));
      navigator.clipboard.writeText(input.value).then(function () {
        toast(L("Copié dans le presse-papiers.", "Copied to the clipboard."));
      }).catch(function () {
        input.select();
        toast(L("Sélectionné — copiez avec Ctrl/Cmd + C.", "Selected — copy with Ctrl/Cmd + C."));
      });
    }
  });

  /* ---------- Vue : liste des galeries ---------- */

  function galleryStatus(gallery) {
    if (gallery.expires_at && gallery.expires_at * 1000 < Date.now()) {
      return { label: L("Expirée", "Expired"), cls: "ad-badge-expired" };
    }
    if (gallery.expires_at) {
      return { label: L("Expire le ", "Expires on ") + formatDate(gallery.expires_at), cls: "ad-badge-soon" };
    }
    return { label: L("Sans expiration", "No expiry"), cls: "" };
  }

  function openCreateModal() {
    var form = document.getElementById("ad-create-form");
    form.reset();
    // Style de départ : celui des paramètres, modifiable ici et ensuite.
    var preferred = (state.me && state.me.defaultTheme) || "classique";
    form.theme.innerHTML = GALLERY_STYLES.map(function (s) {
      return '<option value="' + s.key + '"' + (s.key === preferred ? " selected" : "") + ">" + esc(s.label) + " — " + esc(s.ideal.toLowerCase()) + "</option>";
    }).join("");
    // Langue du client : celle de l'espace photographe, au départ.
    form.language.value = LANG;
    document.getElementById("ad-create-error").hidden = true;
    openModal("ad-create-modal");
  }

  // Bandeau de compteurs en aperçu sur l'onglet Galeries : un coup d'œil sur
  // l'activité du compte avant même d'ouvrir une galerie. Purement affiché —
  // aucune de ces valeurs n'est modifiable ici.
  function statTile(label, value, sub, cls) {
    return (
      '<div class="ad-stat' + (cls ? " " + cls : "") + '">' +
      '<p class="ad-stat-value">' + esc(value) + "</p>" +
      '<p class="ad-stat-label">' + esc(label) + "</p>" +
      (sub ? '<p class="ad-stat-sub">' + esc(sub) + "</p>" : "") +
      "</div>"
    );
  }

  function statsHtml(stats) {
    return (
      '<div class="ad-stats">' +
      statTile(L("Galeries créées", "Galleries created"), stats.galleriesCount) +
      statTile(L("Ventes effectuées", "Sales made"), stats.salesCount) +
      statTile(L("Montant encaissé", "Amount received"), formatEuros(stats.salesAmountCents)) +
      statTile(L("Suppléments en ordre", "Extras paid"), stats.extrasPaidCount, "", stats.extrasPaidCount > 0 ? "ad-stat-success" : "") +
      statTile(
        L("Suppléments en attente", "Extras pending"),
        stats.extrasDueCount,
        stats.extrasDueCount > 0 ? formatEuros(stats.extrasDueAmountCents) + L(" à régler", " due") : "",
        stats.extrasDueCount > 0 ? "ad-stat-warn" : ""
      ) +
      "</div>"
    );
  }

  async function renderList(skipHash) {
    if (!skipHash && location.hash) history.pushState(null, "", location.pathname);
    setActiveTab("galleries");
    el.view.innerHTML = '<p class="ad-loading">' + L("Chargement des galeries…", "Loading galleries…") + "</p>";
    var data;
    try {
      data = await api("GET", "/galleries");
    } catch (err) {
      el.view.innerHTML =
        '<div class="ad-error-panel"><h2>' + L("Impossible de joindre le Worker", "Can't reach the server") + "</h2><p>" + esc(err.message) + "</p></div>";
      return;
    }
    state.galleries = data.galleries;

    // Purement informatif : un échec ici ne doit jamais empêcher de voir ou
    // gérer ses galeries, donc on se contente de masquer le bandeau plutôt
    // que de faire échouer toute la vue.
    var stats = null;
    try {
      stats = await api("GET", "/stats");
    } catch (err) {
      stats = null;
    }
    var statsBar = stats ? statsHtml(stats) : "";

    var header =
      '<div class="ad-section-header">' +
      "<h2>" + L("Vos galeries", "Your galleries") + "</h2>" +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-new-gallery">' + L("+ Nouvelle galerie", "+ New gallery") + "</button>" +
      "</div>";

    if (state.galleries.length === 0) {
      el.view.innerHTML =
        statsBar +
        header +
        '<div class="ad-empty"><h2>' + L("Aucune galerie pour le moment", "No galleries yet") + "</h2>" +
        "<p>" + L("Cliquez sur « Nouvelle galerie » pour envoyer votre première séance — ou voyez d'abord ce que vit votre client, avec une galerie de démonstration toute prête.",
          "Click “New gallery” to send your first session — or first see what your client experiences, with a ready-made demo gallery.") + "</p>" +
        '<button type="button" class="ad-btn" id="ad-start-demo">' + L("Voir une galerie de démonstration", "See a demo gallery") + "</button></div>";
      document.getElementById("ad-new-gallery").addEventListener("click", openCreateModal);
      document.getElementById("ad-start-demo").addEventListener("click", async function () {
        this.disabled = true;
        try {
          var demo = await api("POST", "/demo");
          renderDetail(demo.slug);
        } catch (err) {
          this.disabled = false;
          toast(err.message, true);
        }
      });
      return;
    }

    var rows = state.galleries.map(function (g) {
      var status = galleryStatus(g);
      return (
        '<article class="ad-card" data-slug="' + esc(g.slug) + '" tabindex="0" role="button">' +
        '<div class="ad-card-main">' +
        "<h3>" + esc(g.title) + "</h3>" +
        '<p class="ad-card-sub">' + (g.client_name ? esc(g.client_name) + " · " : "") + esc(g.slug) + "</p>" +
        "</div>" +
        '<div class="ad-card-meta">' +
        "<span>" + g.photo_count + (g.photo_count === 1 ? " photo" : " photos") + "</span>" +
        (g.selected_count > 0
          ? '<span class="ad-badge ad-badge-selected">♥ ' + g.selected_count + "</span>"
          : "") +
        (g.comment_count > 0
          ? '<span class="ad-badge ad-badge-comment">💬 ' + g.comment_count + "</span>"
          : "") +
        (g.due_extra_count > 0
          ? '<span class="ad-badge ad-badge-due">💶 ' + formatEuros(g.due_total_cents) + "</span>"
          : "") +
        (g.selection_done_at
          ? '<span class="ad-badge ad-badge-validated" title="' + L("Sélection validée le ", "Selection confirmed on ") + formatDate(g.selection_done_at) + '">' + L("✓ Validée", "✓ Confirmed") + "</span>"
          : "") +
        (g.demo ? '<span class="ad-badge ad-badge-demo">' + L("Démo", "Demo") + "</span>" : "") +
        (status.label ? '<span class="ad-badge ' + status.cls + '">' + esc(status.label) + "</span>" : "") +
        "</div>" +
        "</article>"
      );
    });

    el.view.innerHTML = statsBar + header + '<div class="ad-grid">' + rows.join("") + "</div>";
    document.getElementById("ad-new-gallery").addEventListener("click", openCreateModal);
    el.view.querySelectorAll(".ad-card").forEach(function (card) {
      var open = function () {
        renderDetail(card.getAttribute("data-slug"));
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }

  /* ---------- Vue : facturation (Stripe Connect + coordonnées) ---------- */
  // Propre au compte, pas à une galerie : paiement en ligne des suppléments
  // (chaque photographe connecte son propre compte Stripe, l'argent lui
  // arrive directement) et coordonnées à faire figurer sur les factures.

  // Frais de paiement retenus sur chaque vente : jamais une commission, le
  // seul coût du paiement (carte, virement), annoncé avant de connecter Stripe.
  function paymentFeeHintHtml(photographer) {
    var fee = photographer.paymentFee;
    if (!fee || (!fee.percent && !fee.fixedCents)) return "";
    return '<p class="ad-hint ad-fee-hint">' + L("Frais de paiement : <strong>", "Payment fees: <strong>") + esc(feeText(fee.label)) + "</strong>" +
      L(" par vente (carte bancaire et virement vers votre compte). Aucune commission Holypixx sur vos ventes.",
        " per sale (card and transfer to your account). No Holypixx commission on your sales.") + "</p>";
  }

  function stripeStatusHtml(photographer) {
    if (photographer.stripeChargesEnabled) {
      return (
        '<p class="ad-stripe-badge ad-stripe-badge-ok">' + L("✓ Compte Stripe actif", "✓ Stripe account active") + "</p>" +
        '<p class="ad-hint">' + L("Les suppléments et tirages payés par vos clients (carte, Apple Pay, Bancontact…) arrivent directement sur votre compte.",
          "Extras and prints paid by your clients (card, Apple Pay, Bancontact…) go straight to your account.") + "</p>" +
        paymentFeeHintHtml(photographer)
      );
    }
    if (photographer.stripeConnected) {
      return (
        '<p class="ad-stripe-badge">' + L("Configuration Stripe incomplète", "Stripe setup incomplete") + "</p>" +
        '<p class="ad-hint">' + L("Le compte a été créé, mais Stripe attend encore quelques informations (identité, coordonnées bancaires) avant d'activer les paiements.",
          "The account exists, but Stripe still needs some details (identity, bank account) before enabling payments.") + "</p>" +
        '<div class="ad-stripe-actions">' +
        '<button type="button" class="ad-btn ad-btn-primary" id="ad-stripe-connect">' + L("Continuer la configuration", "Continue setup") + "</button>" +
        '<button type="button" class="ad-btn" id="ad-stripe-refresh">' + L("Vérifier le statut", "Check status") + "</button>" +
        "</div>"
      );
    }
    return (
      '<p class="ad-hint">' + L("Connectez un compte Stripe pour que vos clients puissent régler leurs suppléments en ligne (carte, Apple Pay, PayPal) — l'argent arrive directement chez vous.",
        "Connect a Stripe account so your clients can pay for extras online (card, Apple Pay, PayPal) — the money goes straight to you.") + "</p>" +
      paymentFeeHintHtml(photographer) +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-stripe-connect">' + L("Connecter Stripe", "Connect Stripe") + "</button>"
    );
  }

  function invoiceRowsHtml(invoices) {
    if (!invoices.length) {
      return '<p class="ad-hint">' + L("Aucune facture émise pour l'instant — elles apparaissent ici dès qu'un client règle un supplément en ligne.",
        "No invoices yet — they appear here as soon as a client pays for extras online.") + "</p>";
    }
    var rows = invoices.map(function (inv) {
      return (
        "<tr>" +
        "<td>" + esc(formatDateTime(inv.issued_at)) + "</td>" +
        '<td><a href="/local/invoices/' + encodeURIComponent(inv.id) + '" target="_blank" rel="noopener">' + esc(inv.number) + "</a></td>" +
        '<td><button type="button" class="ad-link-btn" data-slug="' + esc(inv.gallery_slug) + '">' + esc(inv.gallery_title) + "</button></td>" +
        "<td>" + formatEuros(inv.amount_cents) + "</td>" +
        "<td>" + (inv.emailed_to ? esc(inv.emailed_to) : '<span class="ad-hint">—</span>') + "</td>" +
        "</tr>"
      );
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
      "<th>" + L("Quand", "When") + "</th><th>" + L("Facture", "Invoice") + "</th><th>" + L("Galerie", "Gallery") + "</th><th>" + L("Montant", "Amount") + "</th><th>" + L("Envoyée à", "Sent to") + "</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
  }

  // Rien n'agrège encore les suppléments dus toutes galeries confondues côté
  // Worker : la liste des galeries porte déjà due_extra_count/due_total_cents
  // par galerie (voir admin.js du Worker), il suffit de les additionner ici.
  function dueSummaryHtml(galleries) {
    var due = galleries.filter(function (g) { return g.due_extra_count > 0; });
    if (!due.length) {
      return '<p class="ad-hint">' + L("Aucun supplément en attente de règlement pour l'instant.", "No extras awaiting payment for now.") + "</p>";
    }
    var totalCents = due.reduce(function (sum, g) { return sum + g.due_total_cents; }, 0);
    var rows = due.map(function (g) {
      return (
        "<tr>" +
        '<td><button type="button" class="ad-link-btn" data-slug="' + esc(g.slug) + '">' + esc(g.title) + "</button></td>" +
        "<td>" + g.due_extra_count + (g.due_extra_count === 1 ? " photo" : " photos") + "</td>" +
        "<td>" + formatEuros(g.due_total_cents) + "</td>" +
        "</tr>"
      );
    });
    return (
      '<p class="ad-quota-due">' + formatEuros(totalCents) + L(" au total, sur " + due.length + " galerie" + (due.length > 1 ? "s" : ""),
        " in total, across " + due.length + " galler" + (due.length > 1 ? "ies" : "y")) + "</p>" +
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>' + L("Galerie", "Gallery") + "</th><th>" + L("Suppléments", "Extras") + "</th><th>" + L("Montant", "Amount") + "</th></tr></thead><tbody>" +
      rows.join("") + "</tbody></table></div>"
    );
  }

  async function renderBilling(skipHash) {
    var cameFromStripe = location.hash.indexOf("stripe=retour") !== -1 || location.hash.indexOf("stripe=repriser") !== -1;
    if (!skipHash && location.hash.indexOf("#/facturation") !== 0) history.pushState(null, "", "#/facturation");
    if (cameFromStripe) history.replaceState(null, "", "#/facturation");
    setActiveTab("billing");

    el.view.innerHTML = '<p class="ad-loading">' + L("Chargement…", "Loading…") + "</p>";
    if (cameFromStripe) {
      // Le webhook Stripe peut arriver après nous : on relit explicitement
      // plutôt que d'afficher un statut qui n'est peut-être déjà plus à jour.
      try { await api("POST", "/stripe/refresh"); } catch (err) { /* la relecture manuelle reste possible depuis l'écran */ }
    }

    var photographer, invoicesData, galleriesData;
    try {
      var me = await api("GET", "/auth/me");
      photographer = me.photographer;
      invoicesData = await api("GET", "/invoices");
      galleriesData = await api("GET", "/galleries");
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>' + L("Facturation", "Billing") + "</h2>" +
      '<p class="ad-hint">' + L("Paiement en ligne des suppléments, factures émises et montants encore dus, toutes galeries confondues.",
        "Online payment for extras, invoices issued and amounts still due, across all galleries.") + "</p>" +
      "</div></header>" +
      '<section class="ad-stripe"><div class="ad-section-header"><h3>' + L("Paiement en ligne", "Online payment") + "</h3></div>" +
      stripeStatusHtml(photographer) +
      "</section>" +
      '<section><div class="ad-section-header"><h3>' + L("Suppléments dus", "Extras due") + "</h3></div>" +
      dueSummaryHtml(galleriesData.galleries) +
      "</section>" +
      '<section><div class="ad-section-header"><h3>' + L("Historique des factures", "Invoice history") + "</h3>" +
      (invoicesData.invoices.length ? "<p class=\"ad-hint\">" + formatEuros(invoicesData.totalCents) + L(" au total", " in total") + "</p>" : "") +
      "</div>" +
      invoiceRowsHtml(invoicesData.invoices) +
      "</section>";

    el.view.querySelectorAll("[data-slug]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        renderDetail(btn.getAttribute("data-slug"));
      });
    });

    var connectBtn = document.getElementById("ad-stripe-connect");
    if (connectBtn) {
      connectBtn.addEventListener("click", async function () {
        connectBtn.disabled = true;
        connectBtn.textContent = L("Connexion…", "Connecting…");
        try {
          var result = await api("POST", "/stripe/connect");
          window.location.href = result.url;
        } catch (err) {
          toast(err.message, true);
          connectBtn.disabled = false;
          connectBtn.textContent = L("Connecter Stripe", "Connect Stripe");
        }
      });
    }
    var refreshBtn = document.getElementById("ad-stripe-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async function () {
        refreshBtn.disabled = true;
        try {
          await api("POST", "/stripe/refresh");
          renderBilling(true);
        } catch (err) {
          toast(err.message, true);
          refreshBtn.disabled = false;
        }
      });
    }
  }

  /* ---------- Vue : paramètres du compte ---------- */
  // Studio, présentation par défaut des futures galeries, coordonnées
  // fiscales, connexion (e-mail, mot de passe) — tout ce qui concerne le
  // compte lui-même plutôt qu'une galerie en particulier.

  async function renderSettings(skipHash) {
    if (!skipHash && location.hash !== "#/parametres") history.pushState(null, "", "#/parametres");
    setActiveTab("settings");
    el.view.innerHTML = '<p class="ad-loading">' + L("Chargement…", "Loading…") + "</p>";

    var data;
    try {
      data = await api("GET", "/auth/me");
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }
    var photographer = data.photographer;

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>' + L("Paramètres", "Settings") + "</h2>" +
      '<p class="ad-hint">' + L("Studio, présentation par défaut de vos futures galeries, coordonnées fiscales et connexion.",
        "Studio, default look for your future galleries, billing details and sign-in.") + "</p>" +
      "</div></header>" +

      '<section><div class="ad-section-header"><h3>' + L("Langue de l'espace photographe", "Dashboard language") + "</h3></div>" +
      '<p class="ad-hint">' + L("Votre tableau de bord et les e-mails que vous recevez. La langue vue par chaque client se règle galerie par galerie.",
        "Your dashboard and the emails you receive. The language each client sees is set gallery by gallery.") + "</p>" +
      '<label class="ad-field"><span>' + L("Langue", "Language") + '</span><select id="ad-ui-language">' +
      '<option value="fr"' + (photographer.uiLanguage !== "en" ? " selected" : "") + ">Français</option>" +
      '<option value="en"' + (photographer.uiLanguage === "en" ? " selected" : "") + ">English</option></select></label>" +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Studio</h3></div>' +
      '<form id="ad-studio-form">' +
      '<label class="ad-field"><span>' + L("Nom du studio", "Studio name") + "</span>" +
      '<input type="text" name="studioName" value="' + esc(photographer.studioName) + '" placeholder="' + L("Mon Studio", "My Studio") + '" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-studio-save">' + L("Enregistrer", "Save") + "</button>" +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>' + L("Votre identité", "Your identity") + "</h3></div>" +
      '<p class="ad-hint">' + L("Jamais affichée à vos clients — contrairement au nom du studio ci-dessus.", "Never shown to your clients — unlike the studio name above.") + "</p>" +
      '<form id="ad-name-form" class="ad-field-row">' +
      '<label class="ad-field"><span>' + L("Prénom", "First name") + "</span>" +
      '<input type="text" name="firstName" value="' + esc(photographer.firstName) + '" placeholder="' + L("Christine", "Emma") + '" /></label>' +
      '<label class="ad-field"><span>' + L("Nom", "Last name") + "</span>" +
      '<input type="text" name="lastName" value="' + esc(photographer.lastName) + '" placeholder="' + L("Fagnant", "Collins") + '" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-name-save">' + L("Enregistrer", "Save") + "</button>" +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>' + L("Présentation par défaut", "Default look") + "</h3></div>" +
      '<p class="ad-hint">' + L("Proposée à la création d'une nouvelle galerie — modifiable au cas par cas ensuite, comme pour n'importe quelle galerie déjà créée.",
        "Suggested when you create a new gallery — you can still change it gallery by gallery afterwards.") + "</p>" +
      '<div class="ad-layout-options" id="ad-default-layout-options">' +
      layoutOptionsHtml({ layout: photographer.defaultLayout }) +
      "</div>" +
      '<h4 class="ad-sc-subhead">' + L("Style par défaut", "Default style") + "</h4>" +
      '<p class="ad-hint">' + L("Survolez un style pour l'apercevoir ; il sera proposé à chaque nouvelle galerie.", "Hover a style to preview it; it will be suggested for every new gallery.") + "</p>" +
      '<div class="ad-style-cards" id="ad-default-style-cards">' + styleCardsHtml(photographer.defaultTheme || "classique", "", "") + "</div>" +
      "</section>" +

      '<section><div class="ad-section-header"><h3>' + L("Adresse de votre studio", "Your studio's address") + "</h3></div>" +
      '<p class="ad-hint">' + L("Vos clients ouvrent leurs galeries à une adresse à votre nom — <strong>votre-studio.", "Your clients open their galleries at an address in your name — <strong>your-studio.") + esc(state.config.studioDomain || "holypixx.com") + "</strong>" +
      L(" — plutôt que sur le site de la plateforme. Lettres minuscules, chiffres et tirets, 3 à 30 caractères. Laissez vide pour revenir au site principal.",
        " — rather than on the platform's site. Lowercase letters, digits and hyphens, 3 to 30 characters. Leave empty to go back to the main site.") + "</p>" +
      '<form id="ad-subdomain-form"><label class="ad-field"><span>' + L("Sous-domaine", "Subdomain") + "</span>" +
      '<div class="ad-subdomain-row"><input type="text" name="subdomain" value="' + esc(photographer.subdomain || "") + '" placeholder="' + L("votre-studio", "your-studio") + '" autocapitalize="off" autocomplete="off" spellcheck="false" maxlength="30" />' +
      '<span class="ad-subdomain-suffix">.' + esc(state.config.studioDomain || "holypixx.com") + "</span></div></label>" +
      '<p class="ad-hint" id="ad-subdomain-current">' +
      (photographer.subdomain
        ? L("Vos liens de galerie commencent par <strong>https://", "Your gallery links start with <strong>https://") + esc(photographer.subdomain) + "." + esc(state.config.studioDomain || "holypixx.com") + "/</strong>."
        : L("Aucun sous-domaine pour l'instant : vos liens pointent vers le site principal.", "No subdomain yet: your links point to the main site.")) +
      "</p>" +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-subdomain-save">' + L("Enregistrer", "Save") + "</button>" +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>' + L("Relances automatiques", "Automatic reminders") + "</h3></div>" +
      '<p class="ad-hint">' + L("Tant qu'un client n'a pas cliqué « Valider ma sélection », il reçoit un rappel à 7 jours puis à 2 jours de l'expiration de sa galerie (s'il a un e-mail renseigné), et vous en recevez un à 2 jours. Rien n'est envoyé pour une galerie sans date d'expiration.",
        "Until a client clicks “Confirm my selection”, they get a reminder 7 days and then 2 days before their gallery expires (if their email is filled in), and you get one 2 days before. Nothing is sent for a gallery with no expiry date.") + "</p>" +
      '<label class="ad-toggle"><input type="checkbox" id="ad-reminders-toggle"' + (photographer.remindersEnabled ? " checked" : "") + " />" +
      "<span>" + L("Envoyer les relances automatiques", "Send automatic reminders") + "</span></label>" +
      "</section>" +

      '<section><div class="ad-section-header"><h3>' + L("Coordonnées fiscales", "Billing details") + "</h3></div>" +
      '<p class="ad-hint">' + L("Ces informations apparaissent sur les factures émises pour vos clients.", "These details appear on the invoices issued to your clients.") + "</p>" +
      '<form id="ad-billing-form">' +
      '<label class="ad-field"><span>' + L("Raison sociale", "Company name") + "</span>" +
      '<input type="text" name="companyName" value="' + esc(photographer.billingCompanyName) + '" placeholder="Little Dream Photos" /></label>' +
      '<label class="ad-field"><span>' + L("Adresse", "Address") + "</span>" +
      '<textarea name="address" rows="3" placeholder="' + L("Rue…, code postal, ville, pays", "Street…, postcode, city, country") + '">' + esc(photographer.billingAddress) + "</textarea></label>" +
      '<label class="ad-field"><span>' + L("Numéro de TVA", "VAT number") + "</span>" +
      '<input type="text" name="vatNumber" value="' + esc(photographer.billingVatNumber) + '" placeholder="BE0123456789" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-billing-save">' + L("Enregistrer", "Save") + "</button>" +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>' + L("Adresse e-mail", "Email address") + "</h3></div>" +
      '<p class="ad-hint">' + L("Adresse actuelle : <strong>", "Current address: <strong>") + esc(photographer.email) + "</strong>" +
      L(". La changer nécessite de confirmer la nouvelle adresse en ouvrant le lien reçu par e-mail — rien ne change avant ça.",
        ". Changing it requires confirming the new address by opening the link sent by email — nothing changes before that.") + "</p>" +
      '<form id="ad-email-form">' +
      '<label class="ad-field"><span>' + L("Nouvelle adresse", "New address") + "</span>" +
      '<input type="email" name="newEmail" required autocomplete="username" /></label>' +
      '<label class="ad-field"><span>' + L("Mot de passe actuel", "Current password") + "</span>" +
      '<input type="password" name="password" required autocomplete="current-password" /></label>' +
      '<p class="ad-error" id="ad-email-error" hidden></p>' +
      '<p class="ad-hint" id="ad-email-message" hidden></p>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-email-save">' + L("Envoyer le lien de confirmation", "Send the confirmation link") + "</button>" +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>' + L("Mot de passe", "Password") + "</h3></div>" +
      '<form id="ad-password-change-form">' +
      '<label class="ad-field"><span>' + L("Mot de passe actuel", "Current password") + "</span>" +
      '<input type="password" name="currentPassword" required autocomplete="current-password" /></label>' +
      '<label class="ad-field"><span>' + L("Nouveau mot de passe <em>(10 caractères minimum)</em>", "New password <em>(at least 10 characters)</em>") + "</span>" +
      '<input type="password" name="newPassword" required minlength="10" autocomplete="new-password" /></label>' +
      '<p class="ad-error" id="ad-password-change-error" hidden></p>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-password-change-save">' + L("Changer le mot de passe", "Change password") + "</button>" +
      "</form></section>" +

      '<section class="ad-mydata"><div class="ad-section-header"><h3>' + L("Mes données", "My data") + "</h3></div>" +
      '<p class="ad-hint">' + L("Toutes les données de votre compte (galeries, sélections de vos clients, paiements, commandes, journaux) dans un fichier, conformément au RGPD. Voir la ",
        "All your account data (galleries, your clients' selections, payments, orders, logs) in one file, as required by the GDPR. See the ") +
      '<a href="https://www.holypixx.com/confidentialite.html" target="_blank" rel="noopener">' + L("politique de confidentialité", "privacy policy (in French)") + "</a>.</p>" +
      '<a class="ad-btn" href="/local/account/export" download>' + L("Exporter mes données", "Export my data") + "</a>" +
      '<details class="ad-danger-zone"><summary>' + L("Supprimer mon compte", "Delete my account") + "</summary>" +
      '<p class="ad-hint">' + L("Suppression <strong>définitive et immédiate</strong> de votre compte, de toutes vos galeries, photos, fichiers livrés et des données de vos clients. Téléchargez d'abord vos factures et l'export ci-dessus : rien ne pourra être récupéré. Pensez aussi à déconnecter Stripe et Prodigi de leur côté si vous ne les utilisez plus.",
        "<strong>Permanent and immediate</strong> deletion of your account, all your galleries, photos, delivered files and your clients' data. Download your invoices and the export above first: nothing can be recovered. Also remember to disconnect Stripe and Prodigi on their side if you no longer use them.") + "</p>" +
      '<form id="ad-delete-account-form">' +
      '<label class="ad-field"><span>' + L("Mot de passe", "Password") + '</span><input type="password" name="password" required autocomplete="current-password" /></label>' +
      '<label class="ad-field"><span>' + L("Tapez SUPPRIMER pour confirmer", "Type DELETE to confirm") + '</span><input type="text" name="confirm" required autocomplete="off" /></label>' +
      '<p class="ad-error" id="ad-delete-account-error" hidden></p>' +
      '<button type="submit" class="ad-btn ad-btn-danger" id="ad-delete-account-submit">' + L("Supprimer définitivement mon compte", "Permanently delete my account") + "</button>" +
      "</form></details></section>";

    document.getElementById("ad-ui-language").addEventListener("change", async function (event) {
      var select = event.target;
      try {
        var result = await api("POST", "/account/language", { language: select.value });
        if (state.me) state.me.uiLanguage = result.language;
        setLanguage(result.language, true);
        if (el.account && state.me) el.account.textContent = el.account.title = (state.me.studioName || state.me.email) + L(" · Galeries protégées", " · Protected galleries");
        renderSettings(true);
        toast(L("Langue enregistrée.", "Language saved."));
      } catch (err) {
        toast(err.message, true);
      }
    });

    document.getElementById("ad-delete-account-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var errorBox = document.getElementById("ad-delete-account-error");
      errorBox.hidden = true;
      if (form.confirm.value.trim() !== L("SUPPRIMER", "DELETE")) {
        errorBox.textContent = L("Tapez SUPPRIMER en majuscules pour confirmer.", "Type DELETE in capitals to confirm.");
        errorBox.hidden = false;
        return;
      }
      var btn = document.getElementById("ad-delete-account-submit");
      btn.disabled = true;
      try {
        var result = await api("POST", "/account/delete", { password: form.password.value, confirm: "SUPPRIMER" });
        toast(L("Compte supprimé (" + result.deletedGalleries + " galerie" + (result.deletedGalleries > 1 ? "s" : "") + "). Au revoir !",
          "Account deleted (" + result.deletedGalleries + " galler" + (result.deletedGalleries === 1 ? "y" : "ies") + "). Goodbye!"));
        showLogin();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        btn.disabled = false;
      }
    });

    document.getElementById("ad-studio-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var btn = document.getElementById("ad-studio-save");
      btn.disabled = true;
      try {
        var studioName = form.studioName.value.trim();
        await api("POST", "/account", { studioName: studioName });
        toast(L("Nom du studio enregistré.", "Studio name saved."));
        if (el.account) el.account.textContent = el.account.title = (studioName || photographer.email) + L(" · Galeries protégées", " · Protected galleries");
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("ad-name-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var btn = document.getElementById("ad-name-save");
      btn.disabled = true;
      try {
        await api("POST", "/account/name", {
          firstName: form.firstName.value.trim(),
          lastName: form.lastName.value.trim(),
        });
        toast(L("Identité enregistrée.", "Identity saved."));
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("ad-subdomain-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var btn = document.getElementById("ad-subdomain-save");
      btn.disabled = true;
      try {
        var result = await api("POST", "/account/subdomain", { subdomain: form.subdomain.value.trim().toLowerCase() });
        toast(result.subdomain ? L("Adresse du studio enregistrée.", "Studio address saved.") : L("Sous-domaine retiré.", "Subdomain removed."));
        renderSettings(true);
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("ad-reminders-toggle").addEventListener("change", async function (event) {
      var box = event.target;
      try {
        await api("POST", "/account/reminders", { enabled: box.checked });
        toast(box.checked ? L("Relances automatiques activées.", "Automatic reminders on.") : L("Relances automatiques désactivées.", "Automatic reminders off."));
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message, true);
      }
    });

    var defaultStyles = document.getElementById("ad-default-style-cards");
    loadPreviewFonts();
    var hideDefaultPreview = bindStylePreview(defaultStyles, function () {
      return { studio: photographer.studioName || "", title: "Léa & Tom", client: "", intro: "", photos: [] };
    });
    defaultStyles.addEventListener("click", async function (e) {
      var card = e.target.closest(".ad-style-card");
      if (!card || card.classList.contains("ad-style-card-active")) return;
      hideDefaultPreview();
      try {
        await api("POST", "/account/defaults", { defaultTheme: card.getAttribute("data-style") });
        if (state.me) state.me.defaultTheme = card.getAttribute("data-style");
        toast(L("Style par défaut : ", "Default style: ") + galleryStyleOf(card.getAttribute("data-style")).label + ".");
        renderSettings(true);
      } catch (err) {
        toast(err.message, true);
      }
    });

    document.getElementById("ad-default-layout-options").querySelectorAll(".ad-layout-option").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var layout = btn.getAttribute("data-layout");
        try {
          await api("POST", "/account/defaults", { defaultLayout: layout });
          toast(L("Présentation par défaut mise à jour.", "Default look updated."));
          renderSettings(true);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    document.getElementById("ad-billing-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var saveBtn = document.getElementById("ad-billing-save");
      saveBtn.disabled = true;
      try {
        await api("POST", "/billing", {
          companyName: form.companyName.value.trim(),
          address: form.address.value.trim(),
          vatNumber: form.vatNumber.value.trim(),
        });
        toast(L("Coordonnées de facturation enregistrées.", "Billing details saved."));
      } catch (err) {
        toast(err.message, true);
      } finally {
        saveBtn.disabled = false;
      }
    });

    document.getElementById("ad-email-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var errorBox = document.getElementById("ad-email-error");
      var messageBox = document.getElementById("ad-email-message");
      var btn = document.getElementById("ad-email-save");
      errorBox.hidden = true;
      messageBox.hidden = true;
      btn.disabled = true;
      btn.textContent = L("Envoi…", "Sending…");
      try {
        var newEmail = form.newEmail.value.trim();
        await api("POST", "/account/email", { newEmail: newEmail, password: form.password.value });
        messageBox.textContent = L("Un lien de confirmation a été envoyé à " + newEmail + ". Ouvrez-le pour finaliser le changement — rien ne change avant ça.",
          "A confirmation link was sent to " + newEmail + ". Open it to complete the change — nothing changes before that.");
        messageBox.hidden = false;
        form.reset();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = L("Envoyer le lien de confirmation", "Send the confirmation link");
      }
    });

    document.getElementById("ad-password-change-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var errorBox = document.getElementById("ad-password-change-error");
      var btn = document.getElementById("ad-password-change-save");
      errorBox.hidden = true;
      btn.disabled = true;
      try {
        await api("POST", "/account/password", {
          currentPassword: form.currentPassword.value,
          newPassword: form.newPassword.value,
        });
        toast(L("Mot de passe changé.", "Password changed."));
        form.reset();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- Vue : Admin (toutes galeries et tous comptes confondus) ---------- */
  // Onglet masqué pour tout le monde sauf la propriétaire (voir showApp) —
  // et même masqué, ce n'est qu'un confort d'affichage : chaque appel
  // /owner/* est revérifié côté serveur (voir worker/src/owner.js), jamais
  // sur la seule foi de ce qui est affiché ici.

  /* ---------- Abonnement Holypixx ---------- */
  // Formule du photographe (Découverte gratuite, Essentiel, Pro), payée
  // chaque mois par Stripe Billing. Souscrire passe par une page de paiement
  // Stripe ; changer de formule, de carte ou résilier, par le portail Stripe.

  function euros(cents) {
    return formatEuros(cents).replace(",00", "").replace(/\.00$/, "");
  }

  // Formules en anglais (nom et accroche), d'après leur clé.
  var PLANS_EN = {
    free: ["Free", "To try it: 3 active galleries, full protection, proofing, HD delivery."],
    essentiel: ["Essentials", "25 active galleries, the print shop and extras paid online."],
    pro: ["Pro", "Unlimited galleries, online booking and contracts, sales campaigns, and galleries in your name (your-studio.holypixx.com)."],
    scolaire: ["School", "For photographers who only do school photos: you only pay on what you sell."],
    studio: ["Studio", "Everything in Pro, plus schools, nurseries and clubs, with no commission."],
  };
  function planLabel(plan) {
    return LANG === "en" && PLANS_EN[plan.key] ? PLANS_EN[plan.key][0] : plan.label;
  }
  function planPitch(plan) {
    return LANG === "en" && PLANS_EN[plan.key] ? PLANS_EN[plan.key][1] : plan.pitch;
  }

  // Prix affiché d'une formule (HTML) : mensuel ou annuel, et prix
  // Fondateurs barrant le prix normal quand l'offre s'applique.
  function planPriceHtml(plan, interval, founder) {
    if (plan.noSubscription) {
      return L("Sans abonnement", "No subscription") + '<span class="ad-plan-price-note">' + esc(L(String(plan.schoolFeePercent).replace(".", ",") + " %", plan.schoolFeePercent + "%")) +
        L(" sur les ventes scolaires, frais bancaires compris", " of school sales, bank fees included") + "</span>";
    }
    if (!plan.priceCents) return L("Gratuit", "Free");
    // Studio : paiement annuel seulement (la photo scolaire est saisonnière).
    if (plan.yearlyOnly) {
      if (founder && plan.founderYearlyCents) {
        return "<s>" + esc(euros(plan.yearlyCents)) + "</s> " + esc(euros(plan.founderYearlyCents)) + L(" / an", " / year") +
          '<span class="ad-plan-price-note">' + L("la 1re année, puis ", "the first year, then ") + esc(euros(plan.yearlyCents)) + L(" / an", " / year") + "</span>";
      }
      return esc(euros(plan.yearlyCents)) + L(" / an", " / year") +
        '<span class="ad-plan-price-note">' + L("soit ", "that's ") + esc(euros(Math.round(plan.yearlyCents / 12))) + L(" / mois, paiement annuel", " / month, paid yearly") + "</span>";
    }
    var yearly = interval === "year";
    var normal = yearly ? plan.yearlyCents : plan.priceCents;
    var unit = yearly ? L(" / an", " / year") : L(" / mois", " / month");
    if (founder && plan.founderCents) {
      var reduced = yearly ? plan.founderYearlyCents : plan.founderCents;
      return "<s>" + esc(euros(normal)) + "</s> " + esc(euros(reduced)) + esc(unit) +
        '<span class="ad-plan-price-note">' + L("la 1re année, puis ", "the first year, then ") + esc(euros(normal)) + esc(unit) + "</span>";
    }
    return esc(euros(normal)) + esc(unit) +
      (yearly ? '<span class="ad-plan-price-note">' + L("soit ", "that's ") + esc(euros(Math.round(normal / 12))) + L(" / mois, 2 mois offerts", " / month, 2 months free") + "</span>" : "");
  }

  // Compatibilité : prix mensuel en texte (ailleurs dans l'admin).
  function planPrice(plan) {
    return plan.priceCents ? euros(plan.priceCents) + L(" / mois", " / month") : L("Gratuit", "Free");
  }

  /* ---------- Portfolio : mini-site public du photographe ---------- */

  function portfolioPublicUrl(data) {
    return data.urls.studio && data.published ? data.urls.studio : data.urls.site;
  }

  function portfolioPhotoTile(photo, index, count) {
    return '<li class="ad-pf-photo" data-id="' + esc(photo.id) + '">' +
      '<img src="/local/portfolio/photos/' + encodeURIComponent(photo.id) + '" alt="Photo ' + (index + 1) + '" loading="lazy" />' +
      (index === 0 ? '<span class="ad-pf-cover">Couverture</span>' : "") +
      '<div class="ad-pf-actions">' +
      '<button type="button" class="ad-btn ad-btn-small" data-move="-1" aria-label="Avancer la photo ' + (index + 1) + '"' + (index === 0 ? " disabled" : "") + ">←</button>" +
      '<button type="button" class="ad-btn ad-btn-small" data-move="1" aria-label="Reculer la photo ' + (index + 1) + '"' + (index === count - 1 ? " disabled" : "") + ">→</button>" +
      '<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-remove aria-label="Retirer la photo ' + (index + 1) + '">Retirer</button>' +
      "</div></li>";
  }

  function portfolioMessageHtml(m) {
    var when = new Date(m.createdAt * 1000).toLocaleString("fr-BE", { dateStyle: "medium", timeStyle: "short" });
    return '<li class="ad-pf-message" data-id="' + esc(m.id) + '">' +
      '<div class="ad-pf-message-head"><strong>' + esc(m.name) + "</strong>" + (m.unread ? ' <span class="ad-badge">Nouveau</span>' : "") +
      '<span class="ad-hint">' + esc(when) + "</span></div>" +
      '<p class="ad-pf-message-meta"><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + "</a>" +
      (m.phone ? " · " + esc(m.phone) : "") + (m.eventDate ? " · date souhaitée : " + esc(m.eventDate) : "") + "</p>" +
      '<p class="ad-pf-message-body">' + esc(m.message) + "</p>" +
      '<button type="button" class="ad-btn ad-btn-small" data-delete-message>Supprimer</button></li>';
  }

  async function renderPortfolio(skipHash) {
    if (!skipHash && location.hash !== "#/portfolio") history.pushState(null, "", "#/portfolio");
    setActiveTab("portfolio");
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
    var data;
    try {
      data = await api("GET", "/portfolio");
    } catch (err) {
      el.view.innerHTML = '<div class="ad-error-panel"><h2>Portfolio indisponible</h2><p>' + esc(err.message) + "</p></div>";
      return;
    }
    if (location.hash !== "#/portfolio") return;
    drawPortfolio(data);
  }

  function drawPortfolio(data) {
    var url = portfolioPublicUrl(data);
    var photos = data.photos;
    var status = data.published
      ? '<p class="ad-banner">Votre portfolio est en ligne : <a href="' + esc(url) + '" target="_blank" rel="noopener" id="ad-pf-link">' + esc(url.replace(/^https?:\/\//, "")) + "</a></p>"
      : '<p class="ad-banner ad-banner-muted">' + (data.exists ? "Votre portfolio n'est pas publié : personne ne peut le voir." : "Présentez votre travail sur une page à vous : vos plus belles photos, quelques mots, et un formulaire pour vous contacter.") + "</p>";
    var unread = data.messages.filter(function (m) { return m.unread; }).length;

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Portfolio</h2>' +
      '<p class="ad-hint">Votre mini-site public, inclus dans toutes les formules' +
      (data.urls.studio ? " — avec la formule Pro, il s'affiche aussi à l'adresse de votre studio." : ".") + "</p>" +
      "</div></header>" + status +

      '<section><div class="ad-section-header"><h3>Photos <span class="ad-hint" id="ad-pf-count">' + photos.length + " / " + data.maxPhotos + "</span></h3>" +
      '<label class="ad-btn ad-btn-primary ad-pf-upload"' + (photos.length >= data.maxPhotos ? " hidden" : "") + ">Ajouter des photos" +
      '<input type="file" id="ad-pf-files" accept="image/jpeg,image/png,image/webp" multiple hidden /></label></div>' +
      '<p class="ad-hint">La première photo sert de couverture. Elles sont réduites à 2000 px et débarrassées de leurs données EXIF (appareil, lieu) avant d\'être publiées.</p>' +
      '<p class="ad-hint" id="ad-pf-progress" hidden></p>' +
      (photos.length ? '<ol class="ad-pf-photos" id="ad-pf-photos">' + photos.map(function (p, i) { return portfolioPhotoTile(p, i, photos.length); }).join("") + "</ol>"
        : '<p class="ad-hint">Aucune photo pour l\'instant : ajoutez entre 10 et 30 images qui vous ressemblent.</p>') +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Présentation</h3></div>' +
      '<form id="ad-pf-form">' +
      '<label class="ad-field"><span>Adresse du portfolio</span>' +
      '<span class="ad-pf-handle"><span class="ad-pf-handle-prefix">www.holypixx.com/portfolio.html?s=</span>' +
      '<input type="text" name="handle" value="' + esc(data.handle) + '" required maxlength="30" autocapitalize="off" spellcheck="false" /></span></label>' +
      '<label class="ad-field"><span>Accroche <em>(une phrase, sous votre nom)</em></span>' +
      '<input type="text" name="headline" value="' + esc(data.headline) + '" maxlength="120" placeholder="Photographe de mariage et de famille, en lumière naturelle" /></label>' +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Ville ou région</span><input type="text" name="city" value="' + esc(data.city) + '" maxlength="80" placeholder="Liège" /></label>' +
      '<label class="ad-field"><span>Téléphone <em>(facultatif, affiché)</em></span><input type="tel" name="phone" value="' + esc(data.phone) + '" maxlength="30" /></label>' +
      "</div>" +
      '<label class="ad-field"><span>À propos</span><textarea name="bio" rows="6" maxlength="2000" placeholder="Qui vous êtes, votre façon de travailler…">' + esc(data.bio) + "</textarea></label>" +
      '<label class="ad-field"><span>Prestations <em>(une par ligne, 8 au plus)</em></span><textarea name="services" rows="4" placeholder="Mariages&#10;Séances famille&#10;Portraits">' + esc(data.services.join("\n")) + "</textarea></label>" +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Instagram <em>(facultatif)</em></span><input type="text" name="instagram" value="' + esc(data.instagram ? "@" + data.instagram : "") + '" placeholder="@votre.studio" /></label>' +
      '<label class="ad-field"><span>Site web <em>(facultatif)</em></span><input type="text" inputmode="url" autocapitalize="off" spellcheck="false" name="website" value="' + esc(data.website) + '" placeholder="votre-site.be" /></label>' +
      "</div>" +
      '<label class="ad-check"><input type="checkbox" name="contactEnabled"' + (data.contactEnabled ? " checked" : "") + " /> Formulaire de contact (les messages arrivent par e-mail et ci-dessous)</label>" +
      '<label class="ad-check"><input type="checkbox" name="published"' + (data.published ? " checked" : "") + " /> Publier le portfolio</label>" +
      '<p class="ad-error" id="ad-pf-error" hidden></p>' +
      '<div class="ad-pf-buttons"><button type="submit" class="ad-btn ad-btn-primary" id="ad-pf-save">Enregistrer</button>' +
      (data.urls.site ? '<a class="ad-btn" href="' + esc(url) + '" target="_blank" rel="noopener">Voir la page</a>' : "") + "</div>" +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>Messages reçus' + (unread ? ' <span class="ad-badge">' + unread + " nouveau" + (unread > 1 ? "x" : "") + "</span>" : "") + "</h3></div>" +
      (data.messages.length ? '<ul class="ad-pf-messages">' + data.messages.map(portfolioMessageHtml).join("") + "</ul>"
        : '<p class="ad-hint">Aucun message pour l\'instant. Ils sont conservés un an.</p>') +
      "</section>";

    wirePortfolio(data);
  }

  function wirePortfolio(data) {
    var form = document.getElementById("ad-pf-form");
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var error = document.getElementById("ad-pf-error");
      var button = document.getElementById("ad-pf-save");
      error.hidden = true;
      button.disabled = true;
      try {
        var saved = await api("PUT", "/portfolio", {
          handle: form.elements.handle.value,
          headline: form.elements.headline.value,
          city: form.elements.city.value,
          phone: form.elements.phone.value,
          bio: form.elements.bio.value,
          services: form.elements.services.value.split("\n"),
          instagram: form.elements.instagram.value,
          website: form.elements.website.value,
          contactEnabled: form.elements.contactEnabled.checked,
          published: form.elements.published.checked,
        });
        if (location.hash !== "#/portfolio") return;
        drawPortfolio(saved);
        toast(saved.published ? "Portfolio enregistré et en ligne" : "Portfolio enregistré");
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
      }
    });

    var input = document.getElementById("ad-pf-files");
    if (input) {
      input.addEventListener("change", async function () {
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) return;
        var room = data.maxPhotos - data.photos.length;
        var progress = document.getElementById("ad-pf-progress");
        var failures = [];
        if (files.length > room) {
          failures.push((files.length - room) + " photo" + (files.length - room > 1 ? "s" : "") + " au-delà de la limite de " + data.maxPhotos);
          files = files.slice(0, room);
        }
        for (var i = 0; i < files.length; i++) {
          if (!document.body.contains(progress)) return;
          progress.hidden = false;
          progress.textContent = "Envoi de la photo " + (i + 1) + " sur " + files.length + "…";
          var body = new FormData();
          body.append("file", files[i]);
          try {
            var response = await fetch("/local/portfolio/photos", { method: "POST", body: body });
            if (response.status === 401) { showLogin(); return; }
            if (!response.ok) {
              var detail = await response.json().catch(function () { return {}; });
              failures.push(files[i].name + " : " + (detail.error || "refusée"));
            }
          } catch (err) {
            failures.push(files[i].name + " : envoi interrompu");
          }
        }
        if (location.hash !== "#/portfolio") return;
        await renderPortfolio(true);
        if (failures.length) toast(failures.join(" · "), true);
        else toast(files.length > 1 ? files.length + " photos ajoutées" : "Photo ajoutée");
      });
    }

    var list = document.getElementById("ad-pf-photos");
    if (list) {
      list.addEventListener("click", async function (event) {
        var item = event.target.closest(".ad-pf-photo");
        if (!item) return;
        var id = item.getAttribute("data-id");
        var move = event.target.closest("[data-move]");
        try {
          if (move) {
            var ids = data.photos.map(function (p) { return p.id; });
            var from = ids.indexOf(id);
            var to = from + Number(move.getAttribute("data-move"));
            if (to < 0 || to >= ids.length) return;
            ids.splice(to, 0, ids.splice(from, 1)[0]);
            await api("POST", "/portfolio/order", { ids: ids });
            data.photos = ids.map(function (pid) { return data.photos.find(function (p) { return p.id === pid; }); });
            if (location.hash !== "#/portfolio") return;
            drawPortfolio(data);
            var moved = document.querySelector('.ad-pf-photo[data-id="' + id + '"] [data-move="' + move.getAttribute("data-move") + '"]');
            if (moved && !moved.disabled) moved.focus();
          } else if (event.target.closest("[data-remove]")) {
            if (!confirm("Retirer cette photo du portfolio ?")) return;
            var result = await api("DELETE", "/portfolio/photos/" + encodeURIComponent(id));
            if (location.hash !== "#/portfolio") return;
            await renderPortfolio(true);
            toast(result.unpublished ? "Photo retirée — le portfolio, vide, a été dépublié" : "Photo retirée");
          }
        } catch (err) {
          toast(err.message, true);
        }
      });
    }

    el.view.querySelectorAll("[data-delete-message]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var item = btn.closest(".ad-pf-message");
        if (!confirm("Supprimer définitivement ce message ?")) return;
        try {
          await api("DELETE", "/portfolio/messages/" + encodeURIComponent(item.getAttribute("data-id")));
          item.remove();
          toast("Message supprimé");
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  /* ---------- Ventes : tableau de bord des 12 derniers mois ---------- */
  // Graphique en colonnes empilées (suppléments en bas, tirages au-dessus),
  // dessiné en SVG à la taille réelle du conteneur : redessiné quand la
  // fenêtre change de largeur, pour garder un texte lisible sur téléphone.
  // Les couleurs ne servent qu'à identifier la série ; montants et libellés
  // restent dans les couleurs du texte, et une vue tableau donne les mêmes
  // chiffres sans graphique.

  var SALES_SERIES = [
    { key: "supplementCents", label: "Suppléments photos", color: "#1f7fa8" },
    { key: "printCents", label: "Tirages", color: "#d0603a" },
    { key: "schoolCents", label: "Photos scolaires", color: "#7d58c0", school: true },
  ];
  var salesData = null;
  var salesMode = "chart";

  // Séries affichées : la série scolaire dès qu'un établissement existe (ou
  // qu'une vente scolaire tombe dans la période).
  function salesSeries() {
    var school = salesData && (salesData.hasSchools || salesData.totals.schoolCents > 0);
    return SALES_SERIES.filter(function (s) { return !s.school || school; });
  }

  function monthTotal(m) {
    return (m.supplementCents || 0) + (m.printCents || 0) + (m.schoolCents || 0);
  }

  function formatEurosShort(cents) {
    return Math.round((cents || 0) / 100).toLocaleString("fr-BE") + " €";
  }

  function percentText(ratio) {
    return Math.round((ratio || 0) * 100) + " %";
  }

  // Graduation « ronde » (1, 2, 5 × 10ⁿ euros) pour l'axe vertical.
  function niceStep(maxCents, ticks) {
    var raw = Math.max(maxCents / 100 / ticks, 1);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var unit = [1, 2, 5, 10].find(function (m) { return m * pow >= raw; });
    return unit * pow * 100;
  }

  // Colonne dont seul le haut est arrondi (le pied reste posé sur l'axe).
  function topRoundedPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }

  function salesChartSvg(months, width) {
    var height = 260, padTop = 26, padBottom = 30, padLeft = 64, padRight = 8;
    var plotW = Math.max(width - padLeft - padRight, 120);
    var plotH = height - padTop - padBottom;
    var totals = months.map(monthTotal);
    var maxTotal = Math.max.apply(null, totals.concat([0]));
    var step = niceStep(maxTotal || 10000, 4);
    var top = Math.max(step * Math.ceil(maxTotal / step), step);
    var y = function (cents) { return padTop + plotH - (cents / top) * plotH; };
    var slot = plotW / months.length;
    var barW = Math.min(24, Math.max(8, slot * 0.6));
    var narrow = slot < 40;

    var grid = "";
    for (var v = 0; v <= top; v += step) {
      grid += '<line class="ad-chart-grid" x1="' + padLeft + '" x2="' + (padLeft + plotW) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="ad-chart-tick" x="' + (padLeft - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(formatEurosShort(v)) + "</text>";
    }

    var peak = totals.indexOf(maxTotal);
    var cols = months.map(function (m, i) {
      var cx = padLeft + slot * i + slot / 2;
      var x = cx - barW / 2;
      var shapes = "";
      var base = 0;
      var stacked = salesSeries().filter(function (s) { return m[s.key] > 0; });
      stacked.forEach(function (s, j) {
        var yTop = y(base + m[s.key]);
        var yBottom = y(base) - (j > 0 ? 2 : 0); // 2 px de fond entre deux segments
        var h = Math.max(yBottom - yTop, 1);
        shapes += j === stacked.length - 1
          ? '<path d="' + topRoundedPath(x, yTop, barW, h, 4) + '" fill="' + s.color + '"/>'
          : '<rect x="' + x + '" y="' + yTop + '" width="' + barW + '" height="' + h + '" fill="' + s.color + '"/>';
        base += m[s.key];
      });
      var parts = m.label.split(" ");
      var label = narrow ? parts[0].charAt(0).toUpperCase() : parts[0];
      var showYear = i === 0 || parts[0] === "janv.";
      var peakLabel = i === peak && maxTotal > 0
        ? '<text class="ad-chart-value" x="' + cx + '" y="' + (y(maxTotal) - 8) + '" text-anchor="middle">' + esc(formatEurosShort(maxTotal)) + "</text>"
        : "";
      return '<g class="ad-chart-col" data-index="' + i + '" tabindex="0" role="img" aria-label="' +
        esc(m.label + " : " + formatEuros(totals[i]) + " (" + m.orders + " paiement" + (m.orders > 1 ? "s" : "") + ")") + '">' +
        '<rect class="ad-chart-hit" x="' + (padLeft + slot * i) + '" y="' + padTop + '" width="' + slot + '" height="' + plotH + '"/>' +
        shapes + peakLabel +
        '<text class="ad-chart-tick" x="' + cx + '" y="' + (height - 12) + '" text-anchor="middle">' + esc(label) + "</text>" +
        (showYear && !narrow ? '<text class="ad-chart-tick ad-chart-year" x="' + cx + '" y="' + (height - 0) + '" text-anchor="middle">' + esc(parts[1]) + "</text>" : "") +
        "</g>";
    }).join("");

    return '<svg class="ad-chart-svg" width="' + width + '" height="' + (height + 4) + '" viewBox="0 0 ' + width + " " + (height + 4) + '">' +
      grid + '<line class="ad-chart-axis" x1="' + padLeft + '" x2="' + (padLeft + plotW) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
      cols + "</svg>";
  }

  function salesTableHtml(months) {
    var series = salesSeries();
    var rows = months.slice().reverse().map(function (m) {
      return "<tr><th scope=\"row\">" + esc(m.label) + "</th>" +
        series.map(function (s) { return "<td>" + esc(formatEuros(m[s.key])) + "</td>"; }).join("") +
        "<td><strong>" + esc(formatEuros(monthTotal(m))) + "</strong></td><td>" + m.orders + "</td></tr>";
    }).join("");
    var heads = { supplementCents: "Suppléments", printCents: "Tirages", schoolCents: "Scolaire" };
    return '<div class="ad-table-wrap"><table class="ad-table ad-sales-table"><thead><tr><th>Mois</th>' +
      series.map(function (s) { return "<th>" + heads[s.key] + "</th>"; }).join("") +
      "<th>Total</th><th>Paiements</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function drawSalesChart() {
    var host = document.getElementById("ad-sales-chart");
    if (!host || !salesData) return;
    if (salesMode === "table") {
      host.innerHTML = salesTableHtml(salesData.months);
      return;
    }
    host.innerHTML = salesChartSvg(salesData.months, Math.max(host.clientWidth, 280)) +
      '<div class="ad-chart-tip" id="ad-sales-tip" hidden></div>';
    var tip = document.getElementById("ad-sales-tip");
    function show(col) {
      var m = salesData.months[Number(col.getAttribute("data-index"))];
      tip.innerHTML = "<strong>" + esc(m.label) + "</strong>" +
        salesSeries().map(function (s) {
          return '<span class="ad-chart-tip-row"><i style="background:' + s.color + '"></i>' + esc(s.label) + "<b>" + esc(formatEuros(m[s.key])) + "</b></span>";
        }).join("") +
        '<span class="ad-chart-tip-row ad-chart-tip-total">Total<b>' + esc(formatEuros(monthTotal(m))) + "</b></span>" +
        '<span class="ad-chart-tip-row ad-chart-tip-muted">' + m.orders + " paiement" + (m.orders > 1 ? "s" : "") + "</span>";
      tip.hidden = false;
      // À côté de la colonne (à droite, sinon à gauche) pour ne jamais
      // masquer la colonne survolée ni ses voisines immédiates.
      var hit = col.querySelector(".ad-chart-hit").getBoundingClientRect();
      var box = host.getBoundingClientRect();
      var right = hit.right - box.left + 4;
      var left = right + tip.offsetWidth <= host.clientWidth ? right : hit.left - box.left - tip.offsetWidth - 4;
      tip.style.left = Math.max(0, left) + "px";
      tip.style.top = "8px";
      host.querySelectorAll(".ad-chart-col").forEach(function (c) { c.classList.toggle("ad-chart-col-active", c === col); });
    }
    function hide() {
      tip.hidden = true;
      host.querySelectorAll(".ad-chart-col").forEach(function (c) { c.classList.remove("ad-chart-col-active"); });
    }
    host.querySelectorAll(".ad-chart-col").forEach(function (col) {
      col.addEventListener("mouseenter", function () { show(col); });
      col.addEventListener("focus", function () { show(col); });
      col.addEventListener("click", function () { show(col); });
      col.addEventListener("blur", hide);
    });
    host.querySelector("svg").addEventListener("mouseleave", hide);
  }

  var salesResizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(salesResizeTimer);
    salesResizeTimer = setTimeout(function () {
      if (salesMode === "chart" && document.getElementById("ad-sales-chart")) drawSalesChart();
    }, 150);
  });

  function salesStatHtml(label, value, note) {
    return '<div class="ad-stat"><p class="ad-stat-value">' + esc(value) + '</p><p class="ad-stat-label">' + esc(label) + "</p>" +
      (note ? '<p class="ad-stat-sub">' + esc(note) + "</p>" : "") + "</div>";
  }

  function salesRankHtml(title, rows, empty, cells) {
    return '<section><div class="ad-section-header"><h3>' + esc(title) + "</h3></div>" +
      (rows.length ? '<ol class="ad-rank">' + rows.map(cells).join("") + "</ol>" : '<p class="ad-hint">' + esc(empty) + "</p>") +
      "</section>";
  }

  async function renderSales(skipHash) {
    if (!skipHash && location.hash !== "#/ventes") history.pushState(null, "", "#/ventes");
    setActiveTab("sales");
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
    var data;
    try {
      data = await api("GET", "/sales");
    } catch (err) {
      el.view.innerHTML = '<div class="ad-error-panel"><h2>Ventes indisponibles</h2><p>' + esc(err.message) + "</p></div>";
      return;
    }
    if (location.hash !== "#/ventes") return;
    salesData = data;
    var t = data.totals;
    var withSchool = salesSeries().length === SALES_SERIES.length;
    var margin = data.printMargin;
    var marginNote = margin.lineRevenueCents
      ? (margin.coverage < 0.999 ? "Sur " + percentText(margin.coverage) + " des tirages (coût connu), " : "") + "frais de paiement déduits, hors port"
      : "Aucun tirage vendu";

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Ventes</h2>' +
      '<p class="ad-hint">Les 12 derniers mois, paiements encaissés (suppléments photos, commandes de tirages' + (withSchool ? ", commandes scolaires des familles" : "") + "), montants TTC.</p>" +
      "</div></header>" +
      '<div class="ad-stats">' +
      salesStatHtml("Chiffre d'affaires", formatEuros(t.revenueCents),
        // Seules les catégories qui ont vendu ; « 0 € tirages » n'apprend rien.
        [[t.supplementCents, " suppléments"], [t.printCents, " tirages"], [t.schoolCents, " scolaire"]]
          .filter(function (part) { return part[0] > 0; })
          .map(function (part) { return formatEurosShort(part[0]) + part[1]; })
          .concat(t.feeCents ? [formatEuros(t.netCents) + " reçus après frais de paiement"] : [])
          .join(" · ")) +
      salesStatHtml("Paiements", String(t.orders), t.orders ? "Panier moyen " + formatEuros(t.averageOrderCents) : "") +
      salesStatHtml("Marge estimée sur les tirages", margin.lineRevenueCents ? formatEuros(margin.marginCents) : "—", marginNote) +
      salesStatHtml("Galeries qui vendent", data.conversion.galleries ? percentText(data.conversion.rate) : "—",
        data.conversion.withSales + " sur " + data.conversion.galleries + " galerie" + (data.conversion.galleries > 1 ? "s" : "") + " créée" + (data.conversion.galleries > 1 ? "s" : "") + " sur la période") +
      "</div>" +
      '<section><div class="ad-section-header"><h3>Chiffre d\'affaires par mois</h3>' +
      '<div class="ad-seg" role="group" aria-label="Affichage">' +
      '<button type="button" class="ad-seg-btn" data-sales-mode="chart">Graphique</button>' +
      '<button type="button" class="ad-seg-btn" data-sales-mode="table">Tableau</button></div></div>' +
      '<ul class="ad-legend">' + salesSeries().slice().reverse().map(function (s) {
        return '<li><i style="background:' + s.color + '"></i>' + esc(s.label) + "</li>";
      }).join("") + "</ul>" +
      (t.revenueCents ? "" : '<p class="ad-hint">Pas encore de vente sur cette période : les montants apparaîtront ici dès le premier paiement.</p>') +
      '<div class="ad-chart" id="ad-sales-chart"></div></section>' +
      '<div class="ad-sales-ranks">' +
      salesRankHtml("Formats les plus vendus", data.topProducts, "Aucun tirage vendu sur la période.", function (p) {
        return "<li><span>" + esc(p.label) + '</span><span class="ad-rank-meta">' + p.copies + " ex. · " + esc(formatEuros(p.revenueCents)) + "</span></li>";
      }) +
      salesRankHtml("Galeries qui rapportent le plus", data.topGalleries, "Aucune vente sur la période.", function (g) {
        var name = g.slug ? '<a href="#/g/' + encodeURIComponent(g.slug) + '">' + esc(g.title) + "</a>" : esc(g.title);
        return "<li><span>" + name + '</span><span class="ad-rank-meta">' + g.orders + " paiement" + (g.orders > 1 ? "s" : "") + " · " + esc(formatEuros(g.revenueCents)) + "</span></li>";
      }) +
      (withSchool
        ? salesRankHtml("Établissements qui rapportent le plus", data.topSchools || [], "Aucune commande scolaire sur la période.", function (x) {
            var name = '<a href="#/scolaire/' + encodeURIComponent(x.schoolId) + "/" + encodeURIComponent(x.yearId) + '">' + esc(x.name) + "</a>" +
              (x.yearLabel ? ' <span class="ad-rank-meta">' + esc(x.yearLabel) + "</span>" : "");
            return "<li><span>" + name + '</span><span class="ad-rank-meta">' + x.orders + " commande" + (x.orders > 1 ? "s" : "") + " · " + esc(formatEuros(x.revenueCents)) + "</span></li>";
          }) +
          salesRankHtml("Articles scolaires les plus vendus", data.topSchoolProducts || [], "Aucun article scolaire vendu sur la période.", function (p) {
            return "<li><span>" + esc(p.label) + '</span><span class="ad-rank-meta">' + p.copies + " ex. · " + esc(formatEuros(p.revenueCents)) + "</span></li>";
          })
        : "") +
      "</div>";

    el.view.querySelectorAll("[data-sales-mode]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-sales-mode") === salesMode));
      btn.addEventListener("click", function () {
        salesMode = btn.getAttribute("data-sales-mode");
        el.view.querySelectorAll("[data-sales-mode]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        drawSalesChart();
      });
    });
    drawSalesChart();
  }

  // « 5 Go », « 200 Go », « 1 To » — mêmes unités que storage.js.
  function formatStorage(bytes) {
    var n = Math.max(0, Number(bytes) || 0);
    var fmt = function (v, unit) { return v.toLocaleString(locale(), { maximumFractionDigits: v < 10 ? 1 : 0 }) + " " + unit; };
    if (n >= 1e12) return fmt(n / 1e12, L("To", "TB"));
    if (n >= 1e9) return fmt(n / 1e9, L("Go", "GB"));
    return fmt(n / 1e6, L("Mo", "MB"));
  }

  // Jauge d'espace utilisé : la couleur ne porte jamais seule l'information,
  // le texte donne toujours les chiffres.
  function storageGaugeHtml(storage) {
    if (!storage) return "";
    var unlimited = storage.quotaBytes === null;
    var ratio = unlimited ? 0 : Math.min(1, storage.usedBytes / storage.quotaBytes);
    var level = ratio >= 0.95 ? " ad-gauge-full" : ratio >= 0.8 ? " ad-gauge-warn" : "";
    var gb = function (label) { return LANG === "en" ? String(label || "").replace(/ Go$/, " GB").replace(/ Mo$/, " MB").replace(/ To$/, " TB").replace(",", ".") : label; };
    return '<div class="ad-storage"><p class="ad-hint">' + L("Stockage", "Storage") + "</p>" +
      '<p class="ad-plan-usage" id="ad-storage-text">' + esc(gb(storage.usedLabel)) + (unlimited ? L(" (illimité)", " (unlimited)") : L(" sur ", " of ") + esc(gb(storage.quotaLabel))) + "</p>" +
      (unlimited ? "" : '<div class="ad-gauge' + level + '" role="meter" aria-label="' + L("Espace de stockage utilisé", "Storage used") + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        Math.round(ratio * 100) + '"><span style="width:' + (ratio * 100).toFixed(1) + '%"></span></div>') +
      (ratio >= 0.8 && !unlimited ? '<p class="ad-hint ad-gauge-note">' + (ratio >= 1 ? L("Espace plein : les nouveaux envois sont refusés.", "Storage full: new uploads are refused.") : L("Bientôt plein.", "Almost full.")) +
        L(" Supprimez d'anciennes galeries ou livraisons, ou passez à la formule supérieure.", " Delete old galleries or deliveries, or move up a plan.") + "</p>" : "") +
      "</div>";
  }

  function planFeaturesHtml(plan, schoolOpen) {
    var items = [
      plan.maxActiveGalleries === null ? L("Galeries actives illimitées", "Unlimited active galleries") : plan.maxActiveGalleries + L(" galeries actives", " active galleries"),
      plan.storageBytes ? formatStorage(plan.storageBytes) + L(" de stockage", " of storage") : "",
      L("Protection, sélection, musique et livraison HD", "Protection, proofing, music and HD delivery"),
      (plan.features.shop ? "✓ " : "— ") + L("Boutique de tirages", "Print shop"),
      (plan.features.extras ? "✓ " : "— ") + L("Suppléments payés en ligne, factures", "Extras paid online, invoices"),
      (plan.features.campaigns ? "✓ " : "— ") + L("Campagnes de vente (promotions, relances)", "Sales campaigns (promotions, reminders)"),
      (plan.features.subdomain ? "✓ " : "— ") + L("Vos galeries à votre nom", "Galleries in your name"),
      (plan.features.booking ? "✓ " : "— ") + L("Réservation en ligne avec acompte", "Online booking with deposit"),
      (plan.features.contracts ? "✓ " : "— ") + L("Devis et contrats signés en ligne", "Quotes and contracts signed online"),
      plan.features.school && schoolOpen ? L("✓ Écoles, crèches et clubs", "✓ Schools, nurseries and clubs") + (plan.schoolFeePercent ? L(" (" + String(plan.schoolFeePercent).replace(".", ",") + " % des ventes scolaires)", " (" + plan.schoolFeePercent + "% of school sales)") : L(", sans commission", ", no commission")) : "",
    ];
    return '<ul class="ad-plan-features">' + items.filter(Boolean).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
  }

  var subscriptionInterval = "month";

  async function renderSubscription(skipHash) {
    var returned = /abonnement=(merci|annule)/.exec(location.hash);
    var returnedSession = /[?&]session_id=(cs_[A-Za-z0-9_]+)/.exec(location.hash);
    if (!skipHash && location.hash.indexOf("#/abonnement") !== 0) history.pushState(null, "", "#/abonnement");
    if (returned) history.replaceState(null, "", "#/abonnement");
    setActiveTab("subscription");
    el.view.innerHTML = '<p class="ad-loading">' + L("Chargement…", "Loading…") + "</p>";

    var data;
    try {
      data = await api("GET", "/subscription");
      // Retour de Stripe : sans attendre le webhook, on fait relire la
      // session de paiement par le serveur (qui met la formule à jour).
      if (returned && returned[1] === "merci" && data.plan.key === "free") {
        try {
          data = await api("POST", "/subscription/sync", { sessionId: returnedSession ? returnedSession[1] : "" });
        } catch (syncErr) {
          await new Promise(function (r) { setTimeout(r, 2500); });
          data = await api("GET", "/subscription");
        }
      }
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }

    var current = data.plan;
    var status = "";
    var billing = data.interval === "year" ? L("Facturation annuelle. ", "Billed yearly. ") : "";
    if (data.owner) status = L("Compte propriétaire : toutes les fonctionnalités sont incluses.", "Owner account: every feature is included.");
    else if (current.key !== "free" && data.cancelAtPeriodEnd && data.renewsAt) status = L("Résiliation programmée : votre formule reste active jusqu'au ", "Cancellation scheduled: your plan stays active until ") + formatDate(data.renewsAt) + ".";
    else if (current.key !== "free" && data.status === "past_due") status = L("Le dernier prélèvement a échoué : mettez à jour votre carte depuis « Gérer mon abonnement ».", "The last payment failed: update your card from “Manage my subscription”.");
    else if (current.key !== "free" && data.status === "trialing" && data.renewsAt) status = L("Essai gratuit jusqu'au " + formatDate(data.renewsAt) + ", puis premier prélèvement automatique (résiliable avant, sans frais).",
      "Free trial until " + formatDate(data.renewsAt) + ", then the first automatic payment (cancel before then at no cost).");
    else if (current.key !== "free" && data.renewsAt) status = billing + L("Prochain renouvellement le ", "Next renewal on ") + formatDate(data.renewsAt) + ".";
    if (data.isFounder && current.key !== "free" && !data.owner) status += L(" Tarif Fondateurs la première année.", " Founders' price for the first year.");
    var usage = current.maxActiveGalleries === null
      ? data.usage.activeGalleries + L(" galerie" + (data.usage.activeGalleries > 1 ? "s" : "") + " active" + (data.usage.activeGalleries > 1 ? "s" : ""), " active galler" + (data.usage.activeGalleries === 1 ? "y" : "ies"))
      : data.usage.activeGalleries + " / " + current.maxActiveGalleries + L(" galeries actives", " active galleries");

    var interval = data.interval === "year" && current.key !== "free" ? "year" : subscriptionInterval;
    if (!data.plans.some(function (p) { return p.yearlyCents; })) interval = "month";
    var founder = data.founderEligible && !data.owner;
    var studioFounder = data.studioFounderEligible && !data.owner;
    function planCardHtml(plan) {
        var isCurrent = plan.key === current.key;
        var action;
        if (isCurrent) {
          action = '<span class="ad-badge ad-badge-selected">' + L("✓ Votre formule", "✓ Your plan") + "</span>" +
            (plan.noSubscription && !data.owner ? ' <button type="button" class="ad-link-btn" data-scolaire="off">' + L("Revenir à Découverte", "Back to Free") + "</button>" : "");
        } else if (data.owner) action = "";
        else if (plan.noSubscription) {
          action = current.key === "free"
            ? '<button type="button" class="ad-btn ad-btn-primary" data-scolaire="on">' + L("Activer, sans abonnement", "Turn on, no subscription") + "</button>"
            : '<p class="ad-hint">' + L("Disponible une fois votre abonnement actuel résilié.", "Available once your current subscription is cancelled.") + "</p>";
        }
        else if (data.canManage) action = '<button type="button" class="ad-btn" data-portal>' + L("Changer de formule", "Change plan") + "</button>";
        else if (plan.key === "free") action = "";
        else action = '<button type="button" class="ad-btn ad-btn-primary" data-subscribe="' + esc(plan.key) + '"' + (data.stripeConfigured ? "" : " disabled") + ">" +
          (data.trialAvailable ? L("Essayer " + data.trialDays + " jours gratuitement", "Try free for " + data.trialDays + " days") : L("Choisir ", "Choose ") + esc(planLabel(plan))) + "</button>" +
          (data.trialAvailable ? '<p class="ad-hint ad-plan-trial">' + L("Aucun prélèvement pendant l'essai ; résiliable avant la fin, sans frais.", "No charge during the trial; cancel before it ends at no cost.") + "</p>" : "");
        var planFounder = plan.key === "studio" ? studioFounder && data.studioFounders && data.studioFounders.remaining > 0 : founder;
        return (
          '<article class="ad-plan' + (isCurrent ? " ad-plan-current" : "") + (plan.key === "pro" || plan.key === "studio" ? " ad-plan-featured" : "") + '">' +
          "<h3>" + esc(planLabel(plan)) + "</h3>" +
          '<p class="ad-plan-price">' + planPriceHtml(plan, interval, planFounder) + "</p>" +
          '<p class="ad-hint">' + esc(planPitch(plan)) + "</p>" +
          planFeaturesHtml(plan, data.schoolOpen) + action + "</article>"
        );
    }
    // Formules galeries, puis (si proposées) celles qui incluent les écoles,
    // crèches et clubs.
    function cardsHtml() {
      var galleries = data.plans.filter(function (p) { return !p.schoolPlan; });
      var school = data.plans.filter(function (p) { return p.schoolPlan; });
      return galleries.map(planCardHtml).join("") +
        (school.length ? '<h3 class="ad-plans-group">' + L("Avec les écoles, crèches et clubs", "With schools, nurseries and clubs") + "</h3>" + school.map(planCardHtml).join("") : "");
    }
    // Bascule annuelle seulement si le Worker connaît les prix annuels.
    var intervalSwitch = (current.key === "free" || current.key === "scolaire") && !data.owner && data.plans.some(function (p) { return p.yearlyCents; })
      ? '<div class="ad-seg ad-interval" role="group" aria-label="' + L("Période de facturation", "Billing period") + '">' +
        '<button type="button" class="ad-seg-btn" data-interval="month" aria-pressed="' + (interval === "month") + '">' + L("Mensuel", "Monthly") + "</button>" +
        '<button type="button" class="ad-seg-btn" data-interval="year" aria-pressed="' + (interval === "year") + '">' + L("Annuel · 2 mois offerts", "Yearly · 2 months free") + "</button></div>"
      : "";
    var founderBanner = founder && data.founders.remaining > 0
      ? '<p class="ad-banner ad-founders">' + L("🎉 <strong>Offre Fondateurs</strong> : plus que " + data.founders.remaining + " place" + (data.founders.remaining > 1 ? "s" : "") +
        ". Essentiel à " + esc(euros(data.plans[1].founderCents)) + " et Pro à " + esc(euros(data.plans[2].founderCents)) + " par mois pendant toute la première année, puis le prix normal.",
        "🎉 <strong>Founders' offer</strong>: only " + data.founders.remaining + " spot" + (data.founders.remaining > 1 ? "s" : "") +
        " left. Essentials at " + esc(euros(data.plans[1].founderCents)) + " and Pro at " + esc(euros(data.plans[2].founderCents)) + " a month for the whole first year, then the normal price.") + "</p>"
      : "";
    var studioPlan = data.plans.find(function (p) { return p.key === "studio"; });
    if (studioPlan && studioFounder && data.studioFounders && data.studioFounders.remaining > 0) {
      founderBanner += '<p class="ad-banner ad-founders">' + L("🎓 <strong>Fondateurs Studio</strong> : plus que " + data.studioFounders.remaining + " place" +
        (data.studioFounders.remaining > 1 ? "s" : "") + ". " + esc(euros(studioPlan.founderYearlyCents)) + " la première année au lieu de " + esc(euros(studioPlan.yearlyCents)) + ".",
        "🎓 <strong>Studio founders</strong>: only " + data.studioFounders.remaining + " spot" + (data.studioFounders.remaining > 1 ? "s" : "") + " left. " +
        esc(euros(studioPlan.founderYearlyCents)) + " the first year instead of " + esc(euros(studioPlan.yearlyCents)) + ".") + "</p>";
    }

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>' + L("Abonnement", "Subscription") + "</h2>" +
      '<p class="ad-hint">' + L("Votre formule Holypixx. Sans engagement : résiliable à tout moment, effet à la fin de la période payée.",
        "Your Holypixx plan. No commitment: cancel any time, effective at the end of the paid period.") + "</p>" +
      "</div></header>" +
      (returned ? '<p class="ad-banner' + (returned[1] === "merci" ? "" : " ad-banner-muted") + '">' +
        (returned[1] === "merci" ? L("Merci ! Votre abonnement est enregistré.", "Thank you! Your subscription is active.") : L("Paiement annulé : votre formule n'a pas changé.", "Payment cancelled: your plan hasn't changed.")) + "</p>" : "") +
      '<section class="ad-plan-summary"><div><p class="ad-hint">' + L("Formule actuelle", "Current plan") + '</p><p class="ad-plan-name">' + esc(planLabel(current)) + "</p>" +
      (status ? '<p class="ad-hint">' + esc(status) + "</p>" : "") + "</div>" +
      '<div><p class="ad-hint">' + L("Utilisation", "Usage") + '</p><p class="ad-plan-usage">' + esc(usage) + "</p></div>" +
      storageGaugeHtml(data.usage.storage) +
      (data.canManage ? '<button type="button" class="ad-btn" data-portal>' + L("Gérer mon abonnement", "Manage my subscription") + "</button>" : "") +
      "</section>" +
      (data.stripeConfigured || data.owner ? "" : '<p class="ad-hint">' + L("Le paiement des abonnements n'est pas encore ouvert sur la plateforme.", "Subscription payments aren't open on the platform yet.") + "</p>") +
      founderBanner + intervalSwitch +
      '<div class="ad-plans" id="ad-plans">' + cardsHtml() + "</div>" +
      '<section class="ad-referral" id="ad-referral" hidden></section>' +
      '<p class="ad-hint">' + L("Prix TTC. Les fichiers HD livrés et les fichiers d'impression d'une galerie expirée depuis ", "Prices include VAT. Delivered HD files and print files of a gallery that expired ") +
      ((data.usage.storage && data.usage.storage.purgeAfterExpiryDays) || 90) +
      L(" jours sont effacés automatiquement, avec un e-mail de rappel 14 jours avant ; les photos de la galerie restent. Paiement sécurisé par Stripe ; factures disponibles dans « Gérer mon abonnement ». Voir les ",
        " days ago are deleted automatically, with a reminder email 14 days before; the gallery's photos stay. Secure payment by Stripe; invoices in “Manage my subscription”. See the ") +
      '<a href="https://www.holypixx.com/conditions" target="_blank" rel="noopener">' + L("conditions d'utilisation", "terms of service (in French)") + "</a>.</p>";

    function wireSubscribe() {
      el.view.querySelectorAll("[data-subscribe]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          try {
            var result = await api("POST", "/subscription/checkout", { plan: btn.getAttribute("data-subscribe"), interval: interval });
            window.location.href = result.url;
          } catch (err) {
            toast(err.message, true);
            btn.disabled = false;
          }
        });
      });
    }
    function wireScolaire() {
      el.view.querySelectorAll("[data-scolaire]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          try {
            await api("POST", "/subscription/scolaire", { on: btn.getAttribute("data-scolaire") === "on" });
            toast(btn.getAttribute("data-scolaire") === "on" ? L("Formule Scolaire activée.", "School plan on.") : L("Retour à la formule Découverte.", "Back to the Free plan."));
            renderSubscription(true);
          } catch (err) {
            toast(err.message, true);
            btn.disabled = false;
          }
        });
      });
    }
    wireSubscribe();
    wireScolaire();
    renderReferral();
    el.view.querySelectorAll("[data-interval]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        interval = subscriptionInterval = btn.getAttribute("data-interval");
        el.view.querySelectorAll("[data-interval]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        document.getElementById("ad-plans").innerHTML = cardsHtml();
        wireSubscribe();
        wireScolaire();
      });
    });
    el.view.querySelectorAll("[data-portal]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          var result = await api("POST", "/subscription/portal", {});
          window.location.href = result.url;
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      });
    });
  }

  /* ---------- Parrainage : lien et carte de fidélité ---------- */
  // Le confrère parrainé a −50 % sur son mois suivant dès son premier
  // paiement ; chaque confrère abonné remplit une case de la carte, trois
  // cases font un mois offert (deux au plus par an). Voir worker/src/referral.js.

  async function renderReferral() {
    var box = document.getElementById("ad-referral");
    if (!box) return;
    var ref;
    try {
      ref = await api("GET", "/subscription/referral");
    } catch (err) {
      return; // le reste de l'onglet reste utilisable
    }
    if (!document.body.contains(box)) return;
    var card = ref.card;
    var stamps = "";
    for (var i = 0; i < card.perCard; i++) {
      stamps += '<span class="ad-ref-stamp' + (i < card.stamps ? " on" : "") + '">' +
        (i < card.stamps ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : "") + "</span>";
    }
    var left = card.perCard - card.stamps;
    var progress = card.stamps
      ? L("Encore " + left + " confrère" + (left > 1 ? "s" : "") + " abonné" + (left > 1 ? "s" : "") + " pour un mois offert.",
          left + " more subscribed photographer" + (left > 1 ? "s" : "") + " for a free month.")
      : L("Trois confrères abonnés, un mois offert.", "Three subscribed photographers, one free month.");
    var rewards = [];
    if (card.granted) rewards.push(L(card.granted + " mois offert" + (card.granted > 1 ? "s" : "") + (card.grantedThisYear ? " (dont " + card.grantedThisYear + " ces douze derniers mois)" : ""),
      card.granted + " free month" + (card.granted > 1 ? "s" : "") + (card.grantedThisYear ? " (" + card.grantedThisYear + " in the last twelve months)" : "")));
    if (card.waiting) {
      rewards.push(card.waiting + L(" en attente", " pending") + (card.room === 0 && card.nextFreeAt
        ? L(" : plafond de " + ref.maxPerYear + " mois par an atteint, crédité le ", ": yearly cap of " + ref.maxPerYear + " months reached, credited on ") + formatDate(card.nextFreeAt)
        : L(" : crédité dès que vous avez un abonnement payant", ": credited as soon as you have a paid subscription")));
    }
    var message = L("Je gère mes galeries clients avec Holypixx : photos protégées, sélection, tirages et réservation en ligne. " +
      "Avec mon lien, tu as −" + ref.discountPercent + " % sur ton mois suivant dès ton abonnement : ",
      "I run my client galleries with Holypixx: protected photos, proofing, prints and online booking. " +
      "With my link, you get " + ref.discountPercent + "% off your following month once you subscribe: ") + ref.link;
    var filleuls = ref.filleuls.length
      ? '<ul class="ad-ref-list">' + ref.filleuls.map(function (f) {
          return "<li><span>" + esc(f.name) + '</span><span class="ad-hint">' +
            (f.paid ? '<span class="ad-ref-ok">' + L("Abonné · case gagnée", "Subscribed · stamp earned") + "</span>"
              : L("Inscrit le ", "Signed up on ") + esc(formatDate(f.since)) + L(", pas encore abonné", ", not subscribed yet")) + "</span></li>";
        }).join("") + "</ul>"
      : '<p class="ad-hint">' + L("Aucun confrère parrainé pour l'instant.", "No referred photographers yet.") + "</p>";
    box.innerHTML =
      '<div class="ad-section-header"><h3>' + L("Parrainez un confrère", "Refer a fellow photographer") + "</h3></div>" +
      (ref.referredBy ? '<p class="ad-banner ad-banner-muted">' + L("Parrainé par <strong>", "Referred by <strong>") + esc(ref.referredBy.name) + "</strong>" + L(" : ", ": ") +
        (ref.referredBy.rewarded ? L("votre −" + ref.discountPercent + " % est déduit de votre prochaine facture", "your " + ref.discountPercent + "% off is deducted from your next invoice") + (ref.referredBy.creditCents ? " (" + esc(euros(ref.referredBy.creditCents)) + ")" : "") + "."
          : L("−" + ref.discountPercent + " % sur votre mois suivant, dès votre premier paiement.", ref.discountPercent + "% off your following month, from your first payment.")) + "</p>" : "") +
      '<div class="ad-ref-grid">' +
      '<div class="ad-ref-card" role="img" aria-label="' + L("Carte de fidélité : " + card.stamps + " case" + (card.stamps > 1 ? "s" : "") + " sur " + card.perCard,
        "Loyalty card: " + card.stamps + " stamp" + (card.stamps === 1 ? "" : "s") + " of " + card.perCard) + '">' +
      '<p class="ad-ref-card-title">' + L("Votre carte de parrain", "Your referral card") + "</p>" +
      '<div class="ad-ref-stamps">' + stamps + "</div>" +
      '<p class="ad-ref-card-gift">' + L("= 1 mois offert", "= 1 free month") + "</p>" +
      "</div>" +
      '<div class="ad-ref-side">' +
      "<p>" + esc(progress) + "</p>" +
      (rewards.length ? '<p class="ad-hint">' + esc(rewards.join(" · ")) + "</p>" : "") +
      '<p class="ad-hint">' + L("Votre confrère a −" + ref.discountPercent + " % sur son mois suivant dès son premier paiement, et vous gagnez une case. " +
        "Trois cases, un mois offert, " + ref.maxPerYear + " au plus par an. Les mois offerts sont déduits de vos prochaines factures.",
        "The photographer you refer gets " + ref.discountPercent + "% off their following month from their first payment, and you earn a stamp. " +
        "Three stamps, one free month, at most " + ref.maxPerYear + " a year. Free months are deducted from your next invoices.") + "</p>" +
      '<label class="ad-field"><span>' + L("Votre lien", "Your link") + '</span><div class="ad-copy-row"><input type="text" id="ad-ref-link" readonly value="' + esc(ref.link) + '" />' +
      '<button type="button" class="ad-btn" data-copy="ad-ref-link">' + L("Copier", "Copy") + "</button></div></label>" +
      '<label class="ad-field"><span>' + L("Message prêt à envoyer", "Ready-to-send message") + '</span><textarea id="ad-ref-message" rows="4" readonly>' + esc(message) + "</textarea></label>" +
      '<button type="button" class="ad-btn" data-copy="ad-ref-message">' + L("Copier le message", "Copy the message") + "</button>" +
      "</div></div>" +
      '<h4 class="ad-ref-heading">' + L("Vos filleuls", "Your referrals") + "</h4>" + filleuls;
    box.hidden = false;
  }

  /* ---------- Livraison des photos définitives ---------- */
  // Fichiers finaux (haute définition, sans filigrane) que le client
  // télécharge une fois la livraison ouverte. Envoyés un par un, bruts :
  // admin-server calcule leur CRC-32 (nécessaire au ZIP du Worker).

  function formatBytes(bytes) {
    var dec = function (v) { var t = v.toFixed(1); return LANG === "en" ? t : t.replace(".", ","); };
    if (bytes >= 1024 * 1024 * 1024) return dec(bytes / (1024 * 1024 * 1024)) + L(" Go", " GB");
    if (bytes >= 1024 * 1024) return dec(bytes / (1024 * 1024)) + L(" Mo", " MB");
    return Math.max(1, Math.round(bytes / 1024)) + L(" Ko", " KB");
  }

  function deliverySectionHtml(gallery) {
    var d = gallery.delivery || { open: false, files: [], totalBytes: 0 };
    var n = d.files.length;
    var status = d.open
      ? '<span class="ad-badge ad-badge-selected">' + L("✓ Livraison ouverte", "✓ Delivery open") + "</span>" + L(" depuis le ", " since ") + esc(formatDate(d.openedAt)) +
        (d.notifiedAt ? L(" · client prévenu par e-mail le ", " · client emailed on ") + esc(formatDate(d.notifiedAt)) : "")
      : '<span class="ad-hint">' + L("Pas encore ouverte : le client ne voit rien tant que vous ne l'ouvrez pas.", "Not open yet: your client sees nothing until you open it.") + "</span>";
    var rows = d.files.map(function (f) {
      return (
        '<li data-delivery-file="' + esc(f.id) + '"><span class="ad-delivery-name">' + esc(f.name) + "</span>" +
        '<span class="ad-hint">' + esc(formatBytes(f.size)) + "</span>" +
        '<button type="button" class="ad-delivery-remove" data-remove-delivery="' + esc(f.id) + '" aria-label="' + L("Retirer ", "Remove ") + esc(f.name) + '">&times;</button></li>'
      );
    }).join("");
    var notify = gallery.client_email
      ? '<label class="ad-check"><input type="checkbox" id="ad-delivery-notify" checked /> ' + L("Prévenir le client par e-mail (", "Email the client (") + esc(gallery.client_email) + ")</label>"
      : '<p class="ad-hint">' + L("Aucun e-mail client renseigné : pensez à prévenir votre client vous-même.", "No client email on file: remember to let your client know yourself.") + "</p>";
    return (
      '<section class="ad-delivery">' +
      '<div class="ad-section-header"><h3>' + L("Livraison des photos définitives", "Final photo delivery") + "</h3></div>" +
      '<p class="ad-hint">' + L("Déposez ici les photos finales, en haute définition et sans filigrane (JPEG, PNG, TIFF… 80 Mo maximum chacune). " +
        "Une fois la livraison ouverte, le client les télécharge depuis sa galerie, une par une ou toutes d'un coup (ZIP). " +
        "Ces fichiers sont effacés 90 jours après l'expiration de la galerie (e-mail de rappel 14 jours avant) : prolongez-la pour les garder.",
        "Upload the final photos here, in high resolution and without watermark (JPEG, PNG, TIFF… 80 MB max each). " +
        "Once delivery is open, your client downloads them from their gallery, one by one or all at once (ZIP). " +
        "These files are deleted 90 days after the gallery expires (reminder email 14 days before): extend it to keep them.") + "</p>" +
      '<p class="ad-delivery-status">' + status + "</p>" +
      '<div class="ad-bg-custom"><label class="ad-btn">' + L("Ajouter des photos", "Add photos") +
      '<input type="file" id="ad-delivery-input" accept="image/jpeg,image/png,image/tiff,image/webp,.heic,.tif,.tiff" multiple hidden /></label>' +
      '<span class="ad-hint" id="ad-delivery-progress">' + (n ? n + (n === 1 ? " photo" : " photos") + " · " + esc(formatBytes(d.totalBytes)) : L("Aucune photo déposée.", "No photos uploaded.")) + "</span></div>" +
      (n ? '<ul class="ad-delivery-list">' + rows + "</ul>" : "") +
      (d.open
        ? '<button type="button" class="ad-btn" id="ad-delivery-close">' + L("Fermer la livraison", "Close delivery") + "</button>"
        : (n ? notify + '<button type="button" class="ad-btn ad-btn-primary" id="ad-delivery-open">' + L("Ouvrir la livraison au client", "Open delivery to the client") + "</button>" : "")) +
      "</section>"
    );
  }

  function wireDeliverySection(slug) {
    var input = document.getElementById("ad-delivery-input");
    if (!input) return;
    input.addEventListener("change", async function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = "";
      if (!files.length) return;
      var progress = document.getElementById("ad-delivery-progress");
      var failed = [];
      for (var i = 0; i < files.length; i++) {
        progress.textContent = L("Envoi ", "Uploading ") + (i + 1) + " / " + files.length + " : " + files[i].name + "…";
        try {
          var response = await fetch("/local/galleries/" + encodeURIComponent(slug) + "/delivery/files?name=" + encodeURIComponent(files[i].name), {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: files[i],
          });
          var result = await response.json().catch(function () { return {}; });
          if (!response.ok) throw new Error(serverText(result.error) || L("Échec de l'envoi", "Upload failed"));
        } catch (err) {
          failed.push(files[i].name + " (" + err.message + ")");
        }
      }
      if (failed.length) toast(L("Non envoyées : ", "Not uploaded: ") + failed.join(", "), true);
      else toast(L(files.length + " photo" + (files.length > 1 ? "s" : "") + " ajoutée" + (files.length > 1 ? "s" : "") + " à la livraison.",
        files.length + (files.length === 1 ? " photo" : " photos") + " added to the delivery."));
      renderDetail(slug, true);
    });
    document.querySelectorAll("[data-remove-delivery]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        try {
          await api("DELETE", "/galleries/" + encodeURIComponent(slug) + "/delivery/files/" + encodeURIComponent(btn.getAttribute("data-remove-delivery")));
          renderDetail(slug, true);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    var openBtn = document.getElementById("ad-delivery-open");
    if (openBtn) {
      openBtn.addEventListener("click", function () {
        var notifyBox = document.getElementById("ad-delivery-notify");
        var notify = Boolean(notifyBox && notifyBox.checked);
        confirmAction(L("Ouvrir la livraison ? Le client pourra télécharger ces photos en haute définition, sans filigrane." + (notify ? " Il sera prévenu par e-mail." : ""),
          "Open delivery? Your client will be able to download these photos in high resolution, without watermark." + (notify ? " They'll get an email." : "")), async function () {
          try {
            var result = await api("POST", "/galleries/" + encodeURIComponent(slug) + "/delivery", { open: true, notify: notify });
            toast(result.notified ? L("Livraison ouverte, client prévenu par e-mail.", "Delivery open, client emailed.") : L("Livraison ouverte.", "Delivery open."));
            renderDetail(slug, true);
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    }
    var closeBtn = document.getElementById("ad-delivery-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", async function () {
        try {
          await api("POST", "/galleries/" + encodeURIComponent(slug) + "/delivery", { open: false });
          toast(L("Livraison fermée : le client ne peut plus télécharger.", "Delivery closed: your client can no longer download."));
          renderDetail(slug, true);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
  }

  /* ---------- Musique : bibliothèque commune ---------- */
  // Morceaux libres de droits ajoutés par la propriétaire (onglet Admin) et
  // choisis par chaque photographe pour ses galeries. L'écoute passe par un
  // seul lecteur partagé, coupé dès qu'on change d'écran.

  var trackPreview = { audio: null, id: null };
  // Mêmes clés que MUSIC_MOODS côté Worker (worker/src/music.js).
  var MUSIC_MOODS = {
    douce: "Douce", joyeuse: "Joyeuse", romantique: "Romantique", piano: "Piano",
    acoustique: "Acoustique", cinematique: "Cinématique", enfance: "Enfance",
  };
  var MUSIC_MOODS_EN = {
    douce: "Gentle", joyeuse: "Joyful", romantique: "Romantic", piano: "Piano",
    acoustique: "Acoustic", cinematique: "Cinematic", enfance: "Childhood",
  };
  function moodLabel(t) {
    return LANG === "en" ? MUSIC_MOODS_EN[t.mood] || t.moodLabel || t.mood : t.moodLabel || t.mood;
  }

  function formatDuration(seconds) {
    if (!seconds) return "";
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function reflectTrackPreview() {
    var playing = trackPreview.audio && !trackPreview.audio.paused ? trackPreview.id : null;
    document.querySelectorAll("[data-preview]").forEach(function (btn) {
      var on = btn.getAttribute("data-preview") === playing;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = on ? "❚❚" : "▶";
    });
  }

  function toggleTrackPreview(trackId) {
    if (!trackPreview.audio) {
      trackPreview.audio = new Audio();
      ["play", "pause", "ended"].forEach(function (name) { trackPreview.audio.addEventListener(name, reflectTrackPreview); });
    }
    if (trackPreview.id === trackId && !trackPreview.audio.paused) {
      trackPreview.audio.pause();
      return;
    }
    trackPreview.id = trackId;
    trackPreview.audio.src = state.config.api + "/api/music-library/" + encodeURIComponent(trackId);
    trackPreview.audio.play().catch(function () { toast(L("Lecture impossible dans ce navigateur.", "Playback isn't possible in this browser."), true); });
    reflectTrackPreview();
  }

  function stopTrackPreview() {
    if (trackPreview.audio) trackPreview.audio.pause();
  }

  // Liste de morceaux ; `mode` : "pick" (fiche galerie, bouton « Choisir »)
  // ou "manage" (onglet Admin, bouton « Retirer » et crédit affiché).
  function trackListHtml(library, mode, currentId) {
    if (!library.tracks.length) {
      return '<p class="ad-hint">' + (mode === "manage"
        ? "La bibliothèque est vide : ajoutez un premier morceau ci-dessus."
        : L("La bibliothèque est encore vide — elle se remplit depuis l'onglet Admin de la plateforme.", "The library is still empty — it fills up from the platform's Admin tab.")) + "</p>";
    }
    var moods = {};
    library.tracks.forEach(function (t) { moods[t.mood] = moodLabel(t); });
    var chips = Object.keys(moods).length > 1
      ? '<div class="ad-music-moods" role="group" aria-label="' + L("Ambiance", "Mood") + '">' +
        '<button type="button" class="ad-chip ad-chip-active" data-mood-filter="">' + L("Toutes", "All") + "</button>" +
        Object.keys(moods).map(function (m) {
          return '<button type="button" class="ad-chip" data-mood-filter="' + esc(m) + '">' + esc(moods[m]) + "</button>";
        }).join("") + "</div>"
      : "";
    var items = library.tracks.map(function (t) {
      var meta = [t.artist, moodLabel(t), formatDuration(t.durationSeconds)].filter(Boolean).map(esc).join(" · ");
      var action;
      if (mode === "manage") {
        action = '<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-remove-track="' + esc(t.id) + '">Retirer</button>';
      } else if (t.id === currentId) {
        action = '<span class="ad-badge ad-badge-selected">' + L("✓ Choisie", "✓ Chosen") + "</span>";
      } else {
        action = '<button type="button" class="ad-btn ad-btn-small" data-pick-track="' + esc(t.id) + '">' + L("Choisir", "Choose") + "</button>";
      }
      return (
        '<li class="ad-track' + (t.id === currentId ? " ad-track-current" : "") + '" data-mood="' + esc(t.mood) + '">' +
        '<button type="button" class="ad-track-play" data-preview="' + esc(t.id) + '" aria-pressed="false" aria-label="' + L("Écouter « " + esc(t.title) + " »", "Listen to “" + esc(t.title) + "”") + '">▶</button>' +
        '<div class="ad-track-info"><strong>' + esc(t.title) + "</strong><span>" + meta + "</span>" +
        (mode === "manage" && t.credit ? '<span class="ad-track-credit">Crédit : ' + esc(t.credit) + "</span>" : "") +
        "</div>" + action + "</li>"
      );
    });
    return chips + '<ul class="ad-track-list">' + items.join("") + "</ul>";
  }

  // Écoute et filtre par ambiance, communs aux deux listes.
  function wireTrackList(container) {
    container.querySelectorAll("[data-preview]").forEach(function (btn) {
      btn.addEventListener("click", function () { toggleTrackPreview(btn.getAttribute("data-preview")); });
    });
    container.querySelectorAll("[data-mood-filter]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var mood = chip.getAttribute("data-mood-filter");
        container.querySelectorAll("[data-mood-filter]").forEach(function (c) { c.classList.toggle("ad-chip-active", c === chip); });
        container.querySelectorAll(".ad-track").forEach(function (li) {
          li.hidden = Boolean(mood) && li.getAttribute("data-mood") !== mood;
        });
      });
    });
    reflectTrackPreview();
  }

  function musicSectionHtml(gallery) {
    var m = gallery.music || { source: gallery.music_name ? "file" : "none", name: gallery.music_name };
    var current;
    if (m.source === "library" && m.track) current = L("Morceau de la bibliothèque : <strong>", "Library track: <strong>") + esc(m.track.title) + "</strong>" + (m.track.artist ? " — " + esc(m.track.artist) : "");
    else if (m.source === "link") current = L("Lecteur <strong>" + esc(m.providerLabel || "intégré") + "</strong> affiché dans la galerie", "<strong>" + esc(m.providerLabel || "Embedded") + "</strong> player shown in the gallery");
    else if (m.source === "file") current = L("Fichier MP3 : <strong>", "MP3 file: <strong>") + esc(m.name) + "</strong>";
    else current = '<span class="ad-hint">' + L("Aucune musique pour cette galerie.", "No music for this gallery.") + "</span>";
    var tab = m.source === "link" ? "link" : m.source === "file" ? "file" : "library";
    var tabButton = function (key, label) {
      return '<button type="button" class="ad-music-tab' + (key === tab ? " ad-music-tab-active" : "") + '" data-music-tab="' + key + '" aria-pressed="' + (key === tab) + '">' + label + "</button>";
    };
    return (
      '<section class="ad-music">' +
      '<div class="ad-section-header"><h3>' + L("Musique d'ambiance", "Background music") + "</h3></div>" +
      '<p class="ad-hint">' + L("Lancée automatiquement en mise en page « Défilement », proposée en pause dans les autres — le client garde toujours la main.",
        "Starts automatically in the “Scroll” layout, offered paused in the others — your client always stays in control.") + "</p>" +
      '<p class="ad-music-state" id="ad-music-state">' + current + "</p>" +
      '<div class="ad-music-tabs">' +
      tabButton("library", L("Bibliothèque", "Library")) + tabButton("link", "Spotify, Deezer, YouTube…") + tabButton("file", L("Mon fichier MP3", "My MP3 file")) +
      "</div>" +
      '<div class="ad-music-pane" data-music-pane="library"' + (tab === "library" ? "" : " hidden") + ">" +
      '<p class="ad-hint">' + L("Morceaux libres de droits, utilisables sans souci pour un usage professionnel. Écoutez, puis choisissez.",
        "Royalty-free tracks, safe for professional use. Listen, then choose.") + "</p>" +
      '<div id="ad-music-library"><p class="ad-hint">' + L("Chargement de la bibliothèque…", "Loading the library…") + "</p></div>" +
      "</div>" +
      '<div class="ad-music-pane" data-music-pane="link"' + (tab === "link" ? "" : " hidden") + ">" +
      '<p class="ad-hint">' + L("Collez le lien d'un morceau ou d'une playlist (Partager → Copier le lien). Le lecteur officiel s'affiche discrètement dans la galerie et le client lance lui-même la lecture. " +
        "Avec Spotify, un client sans compte Spotify n'entend qu'un extrait de 30 secondes ; YouTube, SoundCloud et Deezer jouent le morceau en entier.",
        "Paste the link to a track or playlist (Share → Copy link). The official player sits discreetly in the gallery and your client starts it themselves. " +
        "With Spotify, a client without a Spotify account only hears a 30-second preview; YouTube, SoundCloud and Deezer play the whole track.") + "</p>" +
      '<div class="ad-music-link"><input type="url" id="ad-music-link-input" placeholder="https://open.spotify.com/playlist/…" autocomplete="off" />' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-music-link-save">' + L("Enregistrer", "Save") + "</button></div>" +
      "</div>" +
      '<div class="ad-music-pane" data-music-pane="file"' + (tab === "file" ? "" : " hidden") + ">" +
      '<p class="ad-hint">' + L("Un morceau dont vous avez les droits (MP3, 15 Mo maximum), joué en boucle.", "A track you hold the rights to (MP3, 15 MB max), played on a loop.") + "</p>" +
      '<div class="ad-bg-custom">' +
      '<label class="ad-btn">' + (m.source === "file" ? L("Remplacer le MP3", "Replace the MP3") : L("Importer un MP3", "Upload an MP3")) +
      '<input type="file" id="ad-music-file-input" accept="audio/mpeg,.mp3" hidden /></label>' +
      "</div></div>" +
      (m.source !== "none" ? '<p><button type="button" class="ad-btn" id="ad-music-remove">' + L("Retirer la musique", "Remove the music") + "</button></p>" : "") +
      "</section>"
    );
  }

  async function wireMusicSection(slug, gallery) {
    var section = document.querySelector(".ad-music");
    if (!section) return;
    section.querySelectorAll("[data-music-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-music-tab");
        section.querySelectorAll("[data-music-tab]").forEach(function (b) {
          var on = b === btn;
          b.classList.toggle("ad-music-tab-active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        section.querySelectorAll("[data-music-pane]").forEach(function (pane) { pane.hidden = pane.getAttribute("data-music-pane") !== key; });
        if (key !== "library") stopTrackPreview();
      });
    });

    async function choose(body, message) {
      try {
        await api("POST", "/galleries/" + encodeURIComponent(slug) + "/music-choice", body);
        stopTrackPreview();
        toast(message);
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
      }
    }
    document.getElementById("ad-music-link-save").addEventListener("click", function () {
      var url = document.getElementById("ad-music-link-input").value.trim();
      if (!url) return toast(L("Collez d'abord un lien.", "Paste a link first."), true);
      choose({ source: "link", url: url }, L("Lecteur enregistré : il s'affichera dans la galerie.", "Player saved: it will show in the gallery."));
    });

    var box = document.getElementById("ad-music-library");
    try {
      var library = await api("GET", "/music-library");
      if (!document.body.contains(box)) return; // fiche quittée entre-temps
      var currentId = gallery.music && gallery.music.source === "library" && gallery.music.track ? gallery.music.track.id : null;
      box.innerHTML = trackListHtml(library, "pick", currentId);
      wireTrackList(box);
      box.querySelectorAll("[data-pick-track]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          choose({ source: "library", trackId: btn.getAttribute("data-pick-track") }, L("Musique choisie pour cette galerie.", "Music chosen for this gallery."));
        });
      });
    } catch (err) {
      if (document.body.contains(box)) box.innerHTML = '<p class="ad-hint">' + L("Bibliothèque indisponible : ", "Library unavailable: ") + esc(err.message) + "</p>";
    }
  }

  // Onglet Admin : ajout et retrait de morceaux dans la bibliothèque.
  function ownerMusicSectionHtml() {
    return (
      '<section><div class="ad-section-header"><h3>Bibliothèque musicale</h3></div>' +
      '<p class="ad-hint">Les morceaux ajoutés ici sont proposés à tous les photographes pour leurs galeries. ' +
      "N'ajoutez que de la musique dont la licence autorise un usage commercial sur un site : par exemple les morceaux sous licence " +
      "<strong>CC BY</strong> (incompetech.com, freemusicarchive.org — indiquez le crédit demandé, il sera affiché discrètement au client) " +
      "ou des morceaux achetés avec une licence qui le permet.</p>" +
      '<form class="ad-music-upload" id="ad-owner-music-form">' +
      '<label class="ad-field"><span>Fichier MP3 (15 Mo max.)</span><input type="file" name="file" accept="audio/mpeg,.mp3" required /></label>' +
      '<label class="ad-field"><span>Titre</span><input type="text" name="title" maxlength="120" required /></label>' +
      '<label class="ad-field"><span>Artiste</span><input type="text" name="artist" maxlength="120" /></label>' +
      '<label class="ad-field"><span>Ambiance</span><select name="mood">' +
      Object.keys(MUSIC_MOODS).map(function (k) { return '<option value="' + esc(k) + '">' + esc(MUSIC_MOODS[k]) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="ad-field ad-field-wide"><span>Crédit / licence</span><input type="text" name="credit" maxlength="200" placeholder="Ex. « Kevin MacLeod (incompetech.com) — CC BY 4.0 »" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-owner-music-submit">Ajouter à la bibliothèque</button>' +
      "</form>" +
      '<div id="ad-owner-music-list"><p class="ad-hint">Chargement…</p></div>' +
      "</section>"
    );
  }

  function audioDuration(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var probe = new Audio();
      var settled = false;
      var done = function (value) {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(value);
      };
      probe.addEventListener("loadedmetadata", function () { done(isFinite(probe.duration) ? Math.round(probe.duration) : 0); });
      probe.addEventListener("error", function () { done(0); });
      setTimeout(function () { done(0); }, 5000);
      probe.preload = "metadata";
      probe.src = url;
    });
  }

  async function refreshOwnerMusic() {
    var box = document.getElementById("ad-owner-music-list");
    if (!box) return;
    try {
      var library = await api("GET", "/music-library");
      if (!document.body.contains(box)) return;
      box.innerHTML = trackListHtml(library, "manage", null);
      wireTrackList(box);
      box.querySelectorAll("[data-remove-track]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          confirmAction("Retirer ce morceau de la bibliothèque ? Les galeries qui l'utilisent repasseront sans musique.", async function () {
            try {
              stopTrackPreview();
              await api("DELETE", "/owner/music/" + encodeURIComponent(btn.getAttribute("data-remove-track")));
              toast("Morceau retiré.");
              refreshOwnerMusic();
            } catch (err) {
              toast(err.message, true);
            }
          });
        });
      });
    } catch (err) {
      if (document.body.contains(box)) box.innerHTML = '<p class="ad-hint">' + L("Bibliothèque indisponible : ", "Library unavailable: ") + esc(err.message) + "</p>";
    }
  }

  function wireOwnerMusic() {
    var form = document.getElementById("ad-owner-music-form");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var submit = document.getElementById("ad-owner-music-submit");
      var file = form.file.files[0];
      if (!file) return;
      submit.disabled = true;
      submit.textContent = "Envoi…";
      try {
        var data = new FormData(form);
        data.set("duration", String(await audioDuration(file)));
        var response = await fetch("/local/owner/music", { method: "POST", body: data });
        var result = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(result.error || "Échec de l'envoi");
        toast("« " + result.track.title + " » ajouté à la bibliothèque.");
        form.reset();
        refreshOwnerMusic();
      } catch (err) {
        toast(err.message, true);
      } finally {
        submit.disabled = false;
        submit.textContent = "Ajouter à la bibliothèque";
      }
    });
    refreshOwnerMusic();
  }

  function formatMonthLabel(month) {
    var parts = month.split("-");
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return date.toLocaleDateString("fr-BE", { month: "long", year: "numeric" });
  }

  function ownerStatsHtml(stats) {
    return (
      '<div class="ad-stats">' +
      statTile("Photographes inscrits", stats.photographersCount) +
      statTile("Galeries créées", stats.galleriesCount) +
      statTile("Photos envoyées", stats.photosCount) +
      statTile("Ventes effectuées", stats.salesCount) +
      statTile("Montant total encaissé", formatEuros(stats.salesAmountCents)) +
      statTile("Suppléments en ordre", stats.extrasPaidCount, "", stats.extrasPaidCount > 0 ? "ad-stat-success" : "") +
      statTile(
        "Suppléments en attente",
        stats.extrasDueCount,
        stats.extrasDueCount > 0 ? formatEuros(stats.extrasDueAmountCents) + " à régler" : "",
        stats.extrasDueCount > 0 ? "ad-stat-warn" : ""
      ) +
      "</div>"
    );
  }

  // Mode Stripe du Worker (réel / test) et secrets de webhook présents :
  // jamais la clé elle-même, seulement son mode.
  function stripeConfigHtml(stripe) {
    if (!stripe) return "";
    var modeText = {
      live: "✓ Mode réel : les paiements sont de vrais paiements.",
      test: "Mode test : aucun vrai paiement n'est encaissé (cartes de test Stripe uniquement).",
      absent: "Aucune clé Stripe configurée : les paiements en ligne sont désactivés.",
      inconnu: "Clé Stripe au format inattendu : vérifiez STRIPE_SECRET_KEY.",
    }[stripe.mode] || "";
    var line = function (ok, text) { return "<li>" + (ok ? "✓ " : "✗ ") + esc(text) + "</li>"; };
    return '<section id="ad-owner-stripe"><div class="ad-section-header"><h3>Paiements Stripe</h3>' +
      '<span class="ad-badge' + (stripe.mode === "live" ? " ad-badge-selected" : "") + '">' + (stripe.mode === "live" ? "Réel" : stripe.mode === "test" ? "Test" : "À configurer") + "</span></div>" +
      '<p class="ad-hint">' + esc(modeText) + "</p>" +
      '<ul class="ad-plan-features">' +
      line(stripe.webhookPlatform, "Secret du webhook « Votre compte » (paiements, abonnements) : STRIPE_WEBHOOK_SECRET_PLATFORM") +
      line(stripe.webhookConnect, "Secret du webhook « Comptes connectés » (état des comptes Stripe des photographes) : STRIPE_WEBHOOK_SECRET") +
      "</ul></section>";
  }

  function signupsTableHtml(signupsByMonth) {
    if (!signupsByMonth.length) return '<p class="ad-hint">Aucune inscription pour l\'instant.</p>';
    var rows = signupsByMonth.map(function (row) {
      return "<tr><td>" + esc(formatMonthLabel(row.month)) + "</td><td>" + row.count + "</td></tr>";
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>Mois</th><th>Nouveaux comptes</th></tr></thead><tbody>' +
      rows.join("") + "</tbody></table></div>"
    );
  }

  /* ---------- Admin : liste d'attente « Holypixx in English » ---------- */

  var WAITLIST_SPECIALTY = {
    wedding: "Mariage", family: "Famille", newborn: "Naissance", portrait: "Portrait",
    events: "Événementiel", school: "Scolaire", other: "Autre", "": "Non précisé",
  };

  function waitlistSectionHtml(data) {
    var head = '<section id="ad-waitlist"><div class="ad-section-header"><h3>Liste d\'attente « Holypixx in English »' +
      (data ? " (" + data.total + ")" : "") + "</h3></div>" +
      '<p class="ad-hint">Les photographes anglophones inscrits depuis <a href="https://www.holypixx.com/en/" target="_blank" rel="noopener">holypixx.com/en</a> : la demande réelle, pays par pays, avant de traduire l\'espace photographe.</p>';
    if (!data) return head + '<p class="ad-hint">Liste indisponible pour le moment.</p></section>';
    if (!data.total) return head + '<p class="ad-hint">Personne pour l\'instant.</p></section>';
    var chips = function (items, label) {
      return '<p class="ad-hint">' + items.map(function (i) { return esc(label(i)) + " · <b>" + i.count + "</b>"; }).join(" &nbsp; ") + "</p>";
    };
    var rows = data.latest.map(function (e) {
      return "<tr><td>" + esc(e.email) + "</td><td>" + esc(e.country || "—") + "</td><td>" + esc(WAITLIST_SPECIALTY[e.specialty] || e.specialty) +
        "</td><td>" + esc(shortDate(e.createdAt)) + '</td><td><button type="button" class="ad-btn ad-btn-small" data-waitlist-remove="' + esc(e.email) + '">Retirer</button></td></tr>';
    });
    return head +
      chips(data.byCountry, function (i) { return i.country || "Pays non précisé"; }) +
      chips(data.bySpecialty, function (i) { return WAITLIST_SPECIALTY[i.specialty] || i.specialty; }) +
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>E-mail</th><th>Pays</th><th>Spécialité</th><th>Inscription</th><th></th></tr></thead><tbody>' +
      rows.join("") + "</tbody></table></div></section>";
  }

  function wireWaitlist() {
    document.querySelectorAll("[data-waitlist-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var email = btn.getAttribute("data-waitlist-remove");
        confirmAction("Retirer " + email + " de la liste d'attente ? (à faire sur demande de la personne)", async function () {
          try {
            await api("DELETE", "/owner/waitlist", { email: email });
            toast("Adresse retirée de la liste d'attente.");
            renderOwner(true);
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    });
  }

  /* ---------- Admin : comptes photographes ---------- */

  function shortDate(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "short", year: "numeric" });
  }

  // « aujourd'hui », « il y a 3 j », « il y a 2 mois ».
  function sinceText(ts) {
    if (!ts) return "jamais";
    var days = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (days < 1) return "aujourd'hui";
    if (days < 60) return "il y a " + days + " j";
    return "il y a " + Math.floor(days / 30) + " mois";
  }

  var ACCOUNT_STATUS = {
    trialing: { text: "Essai", cls: "ad-acc-status-trial" },
    active: { text: "Actif", cls: "ad-acc-status-ok" },
    past_due: { text: "Paiement en retard", cls: "ad-acc-status-warn" },
    unpaid: { text: "Impayé", cls: "ad-acc-status-bad" },
    canceled: { text: "Résilié", cls: "ad-acc-status-muted" },
    incomplete: { text: "Paiement inachevé", cls: "ad-acc-status-warn" },
    incomplete_expired: { text: "Paiement abandonné", cls: "ad-acc-status-muted" },
  };

  // Catégorie d'un compte pour les filtres.
  function accountGroup(p) {
    var sub = p.subscription;
    if (p.isOwner) return "owner";
    if (sub.plan !== "free" && sub.status === "trialing") return "trial";
    if (sub.plan !== "free" && (sub.status === "active" || sub.status === "past_due")) return "paying";
    return "free";
  }

  // À surveiller : paiement en retard, résiliation programmée, ou plus
  // connecté depuis 30 jours.
  function accountNeedsAttention(p) {
    if (p.isOwner) return false;
    var sub = p.subscription;
    var idle = !p.lastLoginAt || Date.now() / 1000 - p.lastLoginAt > 30 * 86400;
    return sub.status === "past_due" || sub.status === "unpaid" || (sub.cancelAtPeriodEnd && sub.effectivePlan !== "free") || idle;
  }

  function accountRowHtml(p) {
    var sub = p.subscription;
    var name = [p.firstName, p.lastName].filter(Boolean).join(" ");
    var title = p.studioName || name || p.email;
    var who = [p.studioName && name ? name : "", p.email].filter(Boolean).join(" · ");

    var planCell;
    if (p.isOwner) {
      planCell = '<span class="ad-acc-plan ad-acc-plan-pro">Propriétaire</span>';
    } else {
      var status = ACCOUNT_STATUS[sub.status];
      var details = [];
      if (sub.plan !== "free" && sub.interval) details.push(sub.interval === "year" ? "Annuel" : "Mensuel");
      if (sub.founder) details.push("Fondateur");
      planCell =
        '<span class="ad-acc-plan ad-acc-plan-' + esc(sub.plan) + '">' + esc(sub.planLabel) + "</span>" +
        (sub.plan !== "free" && status ? ' <span class="ad-acc-status ' + status.cls + '">' + status.text + "</span>" : "") +
        (details.length ? '<span class="ad-acc-sub">' + esc(details.join(" · ")) + "</span>" : "");
    }

    var dates = [];
    if (!p.isOwner && sub.plan !== "free") {
      if (sub.startedAt) dates.push("Depuis le " + shortDate(sub.startedAt));
      if (sub.renewsAt && sub.effectivePlan !== "free") {
        if (sub.status === "trialing") dates.push("Essai jusqu'au " + shortDate(sub.renewsAt));
        else if (sub.cancelAtPeriodEnd) dates.push('<span class="ad-acc-warn">Se termine le ' + shortDate(sub.renewsAt) + "</span>");
        else dates.push((sub.interval === "year" ? "Renouvelé le " : "Prochain prélèvement le ") + shortDate(sub.renewsAt));
      }
    }

    var storage = p.storage || {};
    var pct = storage.quotaBytes ? Math.min(100, Math.round((storage.usedBytes / storage.quotaBytes) * 100)) : 0;
    var idle = !p.lastLoginAt || Date.now() / 1000 - p.lastLoginAt > 30 * 86400;

    return (
      '<tr data-group="' + accountGroup(p) + '" data-attention="' + (accountNeedsAttention(p) ? "1" : "0") + '" ' +
        'data-search="' + esc((title + " " + who).toLowerCase()) + '">' +
      '<td><span class="ad-acc-name">' + esc(title) + "</span>" +
        (who ? '<span class="ad-acc-sub">' + esc(who) + "</span>" : "") +
        '<span class="ad-acc-sub">Inscrit le ' + esc(shortDate(p.createdAt)) + "</span></td>" +
      "<td>" + planCell + "</td>" +
      "<td>" + (dates.length ? dates.map(function (d) { return '<span class="ad-acc-line">' + d + "</span>"; }).join("") : '<span class="ad-hint">—</span>') + "</td>" +
      '<td class="ad-acc-num">' + (sub.monthlyRevenueCents ? euros(sub.monthlyRevenueCents) + '<span class="ad-acc-sub">/ mois</span>' : '<span class="ad-hint">—</span>') + "</td>" +
      "<td>" + '<span class="ad-acc-line">' + p.galleriesCount + " galerie" + (p.galleriesCount > 1 ? "s" : "") + " · " + p.photosCount + " photo" + (p.photosCount > 1 ? "s" : "") + "</span>" +
        '<span class="ad-acc-sub' + (idle && !p.isOwner ? " ad-acc-warn" : "") + '">Connexion : ' + esc(sinceText(p.lastLoginAt)) + "</span></td>" +
      "<td>" + '<span class="ad-acc-line">' + esc(formatBytes(storage.usedBytes || 0)) + (storage.quotaBytes ? " / " + esc(formatBytes(storage.quotaBytes)) : "") + "</span>" +
        (storage.quotaBytes ? '<span class="ad-acc-meter"><span style="width:' + pct + '%"' + (pct >= 90 ? ' class="ad-acc-meter-full"' : "") + "></span></span>" : "") + "</td>" +
      '<td class="ad-acc-num">' + (p.salesCents ? euros(p.salesCents) : '<span class="ad-hint">—</span>') + "</td>" +
      "<td>" + (p.stripeChargesEnabled
          ? '<span class="ad-acc-status ad-acc-status-ok">Encaisse</span>'
          : p.stripeConnected ? '<span class="ad-acc-status ad-acc-status-warn">À finaliser</span>' : '<span class="ad-hint">—</span>') +
        (sub.stripeCustomerId
          ? '<a class="ad-acc-link" href="https://dashboard.stripe.com/customers/' + encodeURIComponent(sub.stripeCustomerId) + '" target="_blank" rel="noopener">Client Stripe ↗</a>'
          : "") + "</td>" +
      "</tr>"
    );
  }

  function accountsSummaryHtml(sum, photographers) {
    if (!sum) return "";
    // Même définition que le filtre « À surveiller » : retard de paiement,
    // résiliation programmée, ou plus de connexion depuis 30 jours.
    var watched = photographers.filter(accountNeedsAttention);
    var idle = watched.filter(function (p) { return !p.lastLoginAt || Date.now() / 1000 - p.lastLoginAt > 30 * 86400; }).length;
    var watchedParts = [
      sum.pastDue ? sum.pastDue + " en retard de paiement" : "",
      sum.cancelling ? sum.cancelling + " résiliation" + (sum.cancelling > 1 ? "s" : "") + " programmée" + (sum.cancelling > 1 ? "s" : "") : "",
      idle ? idle + " inactif" + (idle > 1 ? "s" : "") + " depuis 30 j" : "",
    ].filter(Boolean).join(" · ");
    return (
      '<div class="ad-stats">' +
      statTile("Abonnés payants", sum.paying, sum.accounts + " compte" + (sum.accounts > 1 ? "s" : "") + " au total", sum.paying ? "ad-stat-success" : "") +
      statTile("En essai gratuit", sum.trialing) +
      statTile("Revenu mensuel récurrent", euros(sum.monthlyRevenueCents), "annuels ramenés au mois") +
      statTile("Places Fondateurs", sum.founders + " / " + sum.foundersLimit) +
      statTile("À surveiller", watched.length, watchedParts, watched.length ? "ad-stat-warn" : "") +
      "</div>"
    );
  }

  function photographersTableHtml(photographers) {
    if (!photographers.length) return '<p class="ad-hint">Aucun compte pour l\'instant.</p>';
    // Worker pas encore redéployé : l'ancien format n'a pas ces champs.
    photographers.forEach(function (p) {
      if (!p.subscription) p.subscription = { plan: "free", planLabel: "—", effectivePlan: "free", status: "", monthlyRevenueCents: 0 };
      if (!p.storage) p.storage = { usedBytes: 0, quotaBytes: null };
    });
    var counts = { all: 0, paying: 0, trial: 0, free: 0, attention: 0 };
    photographers.forEach(function (p) {
      var g = accountGroup(p);
      counts.all += 1;
      if (counts[g] !== undefined) counts[g] += 1;
      if (accountNeedsAttention(p)) counts.attention += 1;
    });
    var filters = [["all", "Tous"], ["paying", "Payants"], ["trial", "En essai"], ["free", "Gratuits"], ["attention", "À surveiller"]];
    return (
      '<div class="ad-acc-toolbar">' +
        '<div class="ad-seg" id="ad-acc-filters" role="group" aria-label="Filtrer les comptes">' +
        filters.map(function (f, i) {
          return '<button type="button" class="ad-seg-btn" data-filter="' + f[0] + '" aria-pressed="' + (i === 0) + '">' +
            f[1] + ' <span class="ad-acc-count">' + counts[f[0]] + "</span></button>";
        }).join("") +
        "</div>" +
        '<input type="search" class="ad-acc-search" id="ad-acc-search" placeholder="Rechercher un studio, un e-mail…" aria-label="Rechercher un compte" />' +
      "</div>" +
      '<div class="ad-table-wrap"><table class="ad-table ad-acc-table" id="ad-acc-table"><thead><tr>' +
      "<th>Compte</th><th>Formule</th><th>Abonnement</th><th>Revenu</th><th>Activité</th><th>Stockage</th><th>Ventes</th><th>Stripe</th>" +
      "</tr></thead><tbody>" + photographers.map(accountRowHtml).join("") + "</tbody></table></div>" +
      '<p class="ad-hint" id="ad-acc-empty" hidden>Aucun compte ne correspond.</p>'
    );
  }

  function wireAccountsTable() {
    var table = document.getElementById("ad-acc-table");
    if (!table) return;
    var filter = "all";
    var search = document.getElementById("ad-acc-search");
    function apply() {
      var q = search.value.trim().toLowerCase();
      var shown = 0;
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        var okFilter = filter === "all" || (filter === "attention" ? tr.getAttribute("data-attention") === "1" : tr.getAttribute("data-group") === filter);
        var ok = okFilter && (!q || tr.getAttribute("data-search").indexOf(q) !== -1);
        tr.hidden = !ok;
        if (ok) shown += 1;
      });
      document.getElementById("ad-acc-empty").hidden = shown > 0;
    }
    document.getElementById("ad-acc-filters").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-filter]");
      if (!btn) return;
      filter = btn.getAttribute("data-filter");
      this.querySelectorAll("[data-filter]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      apply();
    });
    search.addEventListener("input", apply);
  }

  // Le trafic du site (visites, pages vues) et les sources de visiteurs
  // (Google, réseaux sociaux, direct…) ne sont pas suivis par ce Worker — ce
  // n'est pas son rôle, et un système maison referait moins bien ce que
  // Cloudflare Web Analytics fait déjà gratuitement pour un site déjà
  // hébergé chez Cloudflare. Tant que ce n'est pas branché, on explique
  // comment faire plutôt que d'inventer des chiffres.
  function trafficSectionHtml() {
    return (
      '<p class="ad-hint">Pas encore branché. Le trafic du site (visites, pages vues) et les sources de ' +
      'visiteurs (Google, réseaux sociaux, accès direct…) viennent de ' +
      '<strong>Cloudflare Web Analytics</strong> — gratuit, et déjà disponible sur votre compte Cloudflare ' +
      "puisque le site y est hébergé.</p>" +
      '<ol class="ad-owner-steps">' +
      '<li>Dashboard Cloudflare → <strong>Analytics &amp; Logs → Web Analytics</strong> → <strong>Add a site</strong>, ' +
      "choisissez holypixx.com.</li>" +
      "<li>Cloudflare donne une balise JavaScript à coller sur chaque page du site — transmettez-la, elle sera " +
      "intégrée au code.</li>" +
      "<li>Les statistiques (visiteurs, pages vues, pays, et les sources de trafic) apparaissent ensuite " +
      "directement dans le dashboard Cloudflare, généralement sous 24h.</li>" +
      "</ol>" +
      '<a class="ad-btn" href="https://dash.cloudflare.com/" target="_blank" rel="noopener">Ouvrir le dashboard Cloudflare →</a>' +
      '<p class="ad-hint" style="margin-top:1rem;">Pour le référencement (mots-clés, position sur Google…), ' +
      "même logique avec <strong>Google Search Console</strong> (gratuit) — à connecter séparément avec votre " +
      "propre compte Google, ça aussi je ne peux pas le faire à votre place.</p>"
    );
  }

  async function renderOwner(skipHash) {
    if (!skipHash && location.hash !== "#/proprietaire") history.pushState(null, "", "#/proprietaire");
    setActiveTab("owner");
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';

    var statsData, photographersData, waitlistData;
    try {
      statsData = await api("GET", "/owner/stats");
      photographersData = await api("GET", "/owner/photographers");
      waitlistData = await api("GET", "/owner/waitlist").catch(function () { return null; });
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Admin</h2>' +
      '<p class="ad-hint">Vue d\'ensemble de toute la plateforme, tous comptes et galeries confondus. ' +
      "Visible uniquement par vous.</p>" +
      "</div></header>" +

      ownerStatsHtml(statsData) +
      stripeConfigHtml(statsData.stripe) +

      '<section><div class="ad-section-header"><h3>Inscriptions par mois</h3></div>' +
      signupsTableHtml(statsData.signupsByMonth) +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Comptes photographes (' +
      photographersData.photographers.length + ")</h3></div>" +
      accountsSummaryHtml(photographersData.summary, photographersData.photographers) +
      photographersTableHtml(photographersData.photographers) +
      "</section>" +

      waitlistSectionHtml(waitlistData) +

      ownerMusicSectionHtml() +

      '<section><div class="ad-section-header"><h3>Relances automatiques</h3></div>' +
      '<p class="ad-hint">Une passe tourne chaque jour sur le Worker (08:00 UTC) : rappel au client à J-7 et J-2 de l\'expiration tant que sa sélection n\'est pas validée, rappel au photographe à J-2. ' +
      "Chaque relance ne part qu'une fois. Vous pouvez lancer la passe tout de suite :</p>" +
      '<button type="button" class="ad-btn" id="ad-run-reminders">Lancer les relances maintenant</button>' +
      '<p class="ad-hint" id="ad-run-reminders-result"></p>' +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Trafic du site &amp; sources de visiteurs</h3></div>' +
      trafficSectionHtml() +
      "</section>";

    wireOwnerMusic();
    wireAccountsTable();
    wireWaitlist();
    document.getElementById("ad-run-reminders").addEventListener("click", async function () {
      var btn = this;
      var out = document.getElementById("ad-run-reminders-result");
      btn.disabled = true;
      try {
        var result = await api("POST", "/owner/reminders/run");
        var n = result.sent.length;
        out.textContent =
          result.examined + " galerie" + (result.examined > 1 ? "s" : "") + " examinée" + (result.examined > 1 ? "s" : "") +
          " · " + n + " relance" + (n > 1 ? "s" : "") + " envoyée" + (n > 1 ? "s" : "") +
          (n ? " : " + result.sent.map(function (r) { return r.slug + " (" + r.kind + ")"; }).join(", ") : ".");
        toast("Passe de relances terminée.");
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- Boutique de tirages (Prodigi) ---------- */

  var ORDER_STATUS_CLS = {
    paid: "ad-badge-soon", submitted: "ad-badge-soon", in_production: "ad-badge-soon",
    shipped: "ad-badge-selected", cancelled: "ad-badge-expired", failed: "ad-badge-due",
  };

  function centsFromEuros(value) {
    var n = parseFloat(String(value || "").replace(",", "."));
    return isFinite(n) ? Math.round(n * 100) : NaN;
  }

  function eurosInput(cents) {
    return ((cents || 0) / 100).toFixed(2);
  }

  // Statut d'une commande de tirages, dans la langue de l'espace.
  var ORDER_STATUS_EN = {
    pending_payment: "Awaiting payment", paid: "Paid", submitted: "Sent to the lab", in_production: "In production",
    shipped: "Shipped", cancelled: "Cancelled", failed: "To resubmit",
  };
  function orderStatusLabel(o) {
    return LANG === "en" ? ORDER_STATUS_EN[o.status] || o.statusLabel : o.statusLabel;
  }

  // Libellé des frais de paiement (« 2 % + 0,30 € ») à l'anglaise.
  function feeText(label) {
    if (LANG !== "en") return label;
    if (label === "aucun") return "none";
    return String(label || "").replace(/(\d+(?:,\d+)?) %/g, function (m, n) { return n.replace(",", ".") + "%"; })
      .replace(/(\d+),(\d+) €/g, "€$1.$2");
  }

  function printOrdersTableHtml(orders, withGallery) {
    if (!orders || !orders.length) return '<p class="ad-hint" id="ad-print-orders-empty">' + L("Aucune commande de tirages pour l'instant.", "No print orders yet.") + "</p>";
    var rows = orders.map(function (o) {
      var count = o.lines.reduce(function (n, l) { return n + l.copies; }, 0);
      var detail = o.lines.map(function (l) { return l.copies + " × " + l.label + L(" (photo n° ", " (photo no. ") + l.photoNumber + ")"; }).join(", ");
      return (
        '<tr data-order-id="' + esc(o.id) + '">' +
        "<td>" + esc(formatDateTime(o.paidAt || o.createdAt)) + "</td>" +
        (withGallery ? '<td><button type="button" class="ad-link-btn" data-slug="' + esc(o.gallerySlug) + '">' + esc(o.galleryTitle) + "</button></td>" : "") +
        "<td>" + esc(o.recipient.name || "") + '<br /><span class="ad-hint">' + esc(o.clientEmail) + "</span></td>" +
        '<td title="' + esc(detail) + '">' + count + L(" article" + (count > 1 ? "s" : ""), count === 1 ? " item" : " items") + "</td>" +
        "<td>" + formatEuros(o.totalCents) + "</td>" +
        '<td><span class="ad-badge ' + (ORDER_STATUS_CLS[o.status] || "") + '">' + esc(orderStatusLabel(o)) + "</span>" +
        (o.error ? '<br /><span class="ad-hint ad-order-error">' + esc(o.error) + "</span>" : "") + "</td>" +
        "<td>" + (o.trackingUrl ? '<a href="' + esc(o.trackingUrl) + '" target="_blank" rel="noopener">' + L("Suivi", "Tracking") + "</a>" : "—") +
        (o.status === "failed" || o.status === "paid"
          ? ' <button type="button" class="ad-btn ad-btn-small" data-resubmit="' + esc(o.id) + '">' + L("Relancer au labo", "Resubmit to the lab") + "</button>"
          : "") +
        "</td>" +
        "</tr>"
      );
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table" id="ad-print-orders"><thead><tr>' +
      "<th>" + L("Quand", "When") + "</th>" + (withGallery ? "<th>" + L("Galerie", "Gallery") + "</th>" : "") + "<th>Client</th><th>" + L("Articles", "Items") + "</th><th>Total</th><th>" + L("Statut", "Status") + "</th><th>" + L("Expédition", "Shipping") + "</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
  }

  function wireOrderResubmit(onDone) {
    document.querySelectorAll("[data-resubmit]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          var result = await api("POST", "/print-orders/" + encodeURIComponent(btn.getAttribute("data-resubmit")) + "/submit");
          if (result.ok) toast(L("Commande transmise au laboratoire.", "Order sent to the lab."));
          else toast(L("Le laboratoire a encore refusé la commande : ", "The lab rejected the order again: ") + (result.error || L("raison inconnue", "unknown reason")), true);
          onDone();
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      });
    });
  }

  function gallerySectionShopHtml(data) {
    var photos = data.photos || [];
    var printable = photos.filter(function (p) { return Number(p.has_original) === 1; }).length;
    var on = Boolean(data.gallery.shop_enabled);
    return (
      '<section class="ad-gallery-shop"><div class="ad-section-header"><h3>' + L("Boutique de tirages", "Print shop") + "</h3></div>" +
      '<p class="ad-hint">' + L("Le client commande tirages, toiles ou cadres depuis sa galerie ; le paiement arrive sur votre compte Stripe et la commande part automatiquement au laboratoire Prodigi. Réglages et formats dans l'onglet ",
        "Your client orders prints, canvases or frames from their gallery; the payment goes to your Stripe account and the order goes to the Prodigi lab automatically. Settings and formats in the ") +
      '<button type="button" class="ad-link-btn" id="ad-goto-shop">' + L("Boutique", "Shop") + "</button>" + L(".", " tab.") + "</p>" +
      '<label class="ad-toggle"><input type="checkbox" id="ad-gallery-shop-toggle"' + (on ? " checked" : "") + " />" +
      "<span>" + L("Proposer des tirages sur cette galerie", "Offer prints on this gallery") + "</span></label>" +
      '<p class="ad-hint" id="ad-shop-printable">' + L(printable + " photo" + (printable > 1 ? "s" : "") + " sur " + photos.length + " disponible" + (printable > 1 ? "s" : "") + " en tirage. ",
        printable + " of " + photos.length + " photo" + (photos.length === 1 ? "" : "s") + " available as prints. ") +
      (on
        ? L("Les photos importées tant que la boutique est ouverte gardent un fichier d'impression en pleine définition (jamais montré au client) ; réimportez les plus anciennes pour les proposer aussi.",
          "Photos uploaded while the shop is open keep a full-resolution print file (never shown to the client); re-upload older ones to offer them too.")
        : L("Ouvrez la boutique avant d'importer les photos : seules celles importées ensuite pourront être commandées.",
          "Open the shop before uploading the photos: only those uploaded afterwards can be ordered.")) +
      "</p>" +
      (on ? promoBlockHtml(data.gallery) : "") +
      "<h4>" + L("Commandes de cette galerie", "Orders from this gallery") + "</h4>" +
      printOrdersTableHtml(data.printOrders, false) +
      "</section>"
    );
  }

  // Campagnes de vente : promotion à durée limitée et panier en cours.
  function promoBlockHtml(gallery) {
    var sales = gallery.sales || { promo: null, percents: [10, 15, 20, 25, 30, 40, 50], cart: null };
    var promo = sales.promo;
    var html = '<div class="ad-promo"><h4>' + L("Promotion sur les tirages", "Print promotion") + "</h4>";
    if (sales.enabled === false) {
      // Campagnes réservées à Pro : une promotion déjà lancée peut être arrêtée.
      html += '<p class="ad-banner ad-banner-muted">' + L("Promotions à durée limitée et relances des paniers oubliés : les campagnes de vente sont incluses dans la formule Pro. ",
        "Limited-time promotions and abandoned-cart reminders: sales campaigns are part of the Pro plan. ") +
        '<button type="button" class="ad-link-btn" data-goto-plans>' + L("Voir les formules", "See the plans") + "</button></p>";
      if (promo) html += '<div class="ad-promo-actions"><button type="button" class="ad-btn" id="ad-promo-stop">' + L("Arrêter la promotion", "Stop the promotion") + "</button></div>";
      return html + "</div>";
    }
    if (promo) {
      html += '<p class="ad-promo-on"><strong>' + L("−" + promo.percent + " %", promo.percent + "% off") + "</strong>" + L(" sur tous les tirages jusqu'au ", " all prints until ") + esc(formatDate(promo.endsAt)) +
        (promo.sentAt ? ' · <span class="ad-hint">' + L("annoncée au client le ", "announced to the client on ") + esc(formatDate(promo.sentAt)) + "</span>" : "") + "</p>" +
        '<div class="ad-promo-actions">' +
        (!promo.sentAt && gallery.client_email ? '<button type="button" class="ad-btn ad-btn-primary" id="ad-promo-send">' + L("Annoncer au client par e-mail", "Announce it to the client by email") + "</button>" : "") +
        '<button type="button" class="ad-btn" id="ad-promo-stop">' + L("Arrêter la promotion", "Stop the promotion") + "</button></div>";
    } else {
      var defaultEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      html += '<p class="ad-hint">' + L("Une remise sur tous les tirages de cette galerie, pour une durée limitée : prix barrés chez le client, remise appliquée au paiement. Jamais en dessous de votre coût labo.",
        "A discount on every print in this gallery, for a limited time: struck-through prices for the client, discount applied at payment. Never below your lab cost.") + "</p>" +
        '<div class="ad-promo-form"><label class="ad-field"><span>' + L("Remise", "Discount") + '</span><select id="ad-promo-percent">' +
        sales.percents.map(function (p) { return '<option value="' + p + '"' + (p === 20 ? " selected" : "") + ">" + L("−" + p + " %", p + "% off") + "</option>"; }).join("") +
        '</select></label><label class="ad-field"><span>' + L("Jusqu'au (inclus)", "Until (inclusive)") + '</span><input type="date" id="ad-promo-end" value="' + defaultEnd + '" /></label>' +
        '<button type="button" class="ad-btn ad-btn-primary" id="ad-promo-start">' + L("Lancer la promotion", "Start the promotion") + "</button></div>";
    }
    if (sales.cart) {
      html += '<p class="ad-hint">' + L("Panier en cours chez le client : <strong>" + sales.cart.items + " article" + (sales.cart.items > 1 ? "s" : ""),
        "Client's cart in progress: <strong>" + sales.cart.items + (sales.cart.items === 1 ? " item" : " items")) +
        "</strong>" + L(" (mis à jour le ", " (updated on ") + esc(formatDate(sales.cart.updatedAt)) + ")" +
        (sales.cart.remindedAt ? L(" · rappel envoyé le ", " · reminder sent on ") + esc(formatDate(sales.cart.remindedAt)) : L(" · un rappel partira par e-mail après 24 h sans commande", " · a reminder email goes out after 24 h without an order")) + ".</p>";
    }
    return html + "</div>";
  }

  function wirePromoBlock(slug) {
    el.view.querySelectorAll("[data-goto-plans]").forEach(function (btn) {
      btn.addEventListener("click", function () { renderSubscription(); });
    });
    var start = document.getElementById("ad-promo-start");
    if (start) {
      start.addEventListener("click", async function () {
        var day = document.getElementById("ad-promo-end").value;
        // Fin de la journée choisie, heure de Bruxelles approximée (23:59 locale).
        var endsAt = Math.floor(new Date(day + "T23:59:00").getTime() / 1000);
        try {
          await api("POST", "/galleries/" + encodeURIComponent(slug) + "/promo", {
            percent: Number(document.getElementById("ad-promo-percent").value), endsAt: endsAt,
          });
          toast(L("Promotion lancée : les prix remisés s'affichent chez le client.", "Promotion started: the discounted prices show for the client."));
          renderDetail(slug, true);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
    var stop = document.getElementById("ad-promo-stop");
    if (stop) {
      stop.addEventListener("click", async function () {
        try {
          await api("POST", "/galleries/" + encodeURIComponent(slug) + "/promo", { percent: 0 });
          toast(L("Promotion arrêtée.", "Promotion stopped."));
          renderDetail(slug, true);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
    var send = document.getElementById("ad-promo-send");
    if (send) {
      send.addEventListener("click", async function () {
        send.disabled = true;
        try {
          await api("POST", "/galleries/" + encodeURIComponent(slug) + "/promo/send");
          toast(L("Promotion annoncée au client par e-mail.", "Promotion announced to the client by email."));
          renderDetail(slug, true);
        } catch (err) {
          toast(err.message, true);
          send.disabled = false;
        }
      });
    }
  }

  // Une ligne par produit de la boutique : seul le prix et l'activation se
  // modifient ici ; référence Prodigi et options restent celles choisies
  // dans les menus (affichées seulement pour un ajout en mode avancé).
  function productRowHtml(p) {
    var cost = p.costCents || 0;
    return (
      '<tr data-product-id="' + esc(p.id) + '" data-cost="' + cost + '">' +
      "<td><strong>" + esc(p.label) + "</strong>" +
      (p.fromCatalogue ? "" : '<br /><span class="ad-hint">' + L("Réf. ", "Ref. ") + esc(p.sku) + (Object.keys(p.attributes || {}).length ? " " + esc(JSON.stringify(p.attributes)) : "") + "</span>") +
      "</td>" +
      '<td class="ad-cost-cell" id="ad-quote-' + esc(p.id) + '">' + (cost ? formatEuros(cost) : '<span class="ad-hint">' + L("à estimer", "to estimate") + "</span>") + "</td>" +
      '<td><input type="text" class="ad-input ad-input-price" data-field="price" value="' + eurosInput(p.priceCents) + '" inputmode="decimal" aria-label="' + L("Prix pour le client", "Client price") + '" /></td>' +
      '<td class="ad-margin-cell">' + (cost ? marginHtml(netMarginFor(p.priceCents, cost)) : "—") + "</td>" +
      '<td><input type="checkbox" data-field="active"' + (p.active ? " checked" : "") + ' aria-label="' + L("Proposé aux clients", "Offered to clients") + '" /></td>' +
      '<td class="ad-row-actions"><button type="button" class="ad-btn ad-btn-small" data-save-product>' + L("Enregistrer", "Save") + "</button>" +
      ' <button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-delete-product>' + L("Supprimer", "Delete") + "</button></td>" +
      "</tr>"
    );
  }

  function marginHtml(cents) {
    return '<strong class="' + (cents > 0 ? "ad-margin-ok" : "ad-order-error") + '">' + formatEuros(cents) + "</strong>";
  }

  // Frais de paiement retenus sur une vente (même règle que worker/src/fees.js),
  // pour que la marge affichée soit celle qui arrive vraiment chez le photographe.
  var shopFeeRule = null;
  function paymentFeeFor(cents) {
    var rule = shopFeeRule;
    if (!rule || cents <= 0 || (!rule.percent && !rule.fixedCents)) return 0;
    return Math.max(0, Math.min(Math.round(cents * rule.percent / 100) + rule.fixedCents, cents - 1));
  }
  function netMarginFor(priceCents, costCents) {
    return priceCents - costCents - paymentFeeFor(priceCents);
  }
  // Prix client qui laisse au moins `marginCents` net, frais de paiement
  // compris, arrondi aux 10 centimes supérieurs.
  function priceForMargin(costCents, marginCents) {
    var price = costCents + marginCents;
    while (netMarginFor(price, costCents) < marginCents) price += 1;
    return Math.ceil(price / 10) * 10;
  }

  function productsTableHtml(products) {
    if (!products.length) return '<p class="ad-hint" id="ad-shop-no-products">' + L("Aucun produit pour l'instant : ajoutez-en avec les menus ci-dessus, ou en un clic avec « Ajouter les formats suggérés ».",
      "No products yet: add some with the menus above, or in one click with “Add the suggested formats”.") + "</p>";
    var groups = {};
    var order = [];
    products.forEach(function (p) {
      if (!groups[p.category]) { groups[p.category] = []; order.push(p.category); }
      groups[p.category].push(p);
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table ad-shop-products" id="ad-shop-products"><thead><tr>' +
      "<th>" + L("Produit", "Product") + "</th><th>" + L("Coût labo", "Lab cost") + "</th><th>" + L("Prix client (€)", "Client price (€)") + "</th><th>" + L("Votre marge", "Your margin") + "</th><th>" + L("Actif", "Active") + "</th><th></th>" +
      "</tr></thead><tbody>" +
      order.map(function (category) {
        return '<tr class="ad-cat-row"><th colspan="6">' + esc(category) + "</th></tr>" + groups[category].map(productRowHtml).join("");
      }).join("") +
      "</tbody></table></div>"
    );
  }

  // Formulaire d'ajout en menus déroulants : catégorie → produit → format
  // → finition, coût réel demandé à Prodigi à chaque choix, marge saisie,
  // prix client calculé.
  function pickerHtml(catalogue, connected) {
    // Worker pas encore mis à jour (ancienne version sans catalogue) : on
    // le dit plutôt que d'afficher des menus vides.
    if (!catalogue || !catalogue.length) {
      return '<p class="ad-hint" id="ad-shop-picker">' + L("Les menus d'ajout apparaîtront dès que le serveur de la galerie (Worker) sera mis à jour.", "The add menus will appear once the gallery server (Worker) is updated.") + "</p>";
    }
    return (
      '<div class="ad-picker" id="ad-shop-picker">' +
      '<div class="ad-picker-grid">' +
      '<label class="ad-field"><span>' + L("Catégorie", "Category") + '</span><select id="ad-pick-category">' +
      catalogue.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="ad-field"><span>' + L("Produit", "Product") + '</span><select id="ad-pick-product"></select></label>' +
      '<label class="ad-field"><span>' + L("Format", "Size") + '</span><select id="ad-pick-size"></select></label>' +
      '<label class="ad-field" id="ad-pick-option-wrap"><span id="ad-pick-option-label">' + L("Finition", "Finish") + '</span><select id="ad-pick-option"></select></label>' +
      "</div>" +
      '<p class="ad-hint" id="ad-pick-description"></p>' +
      '<p class="ad-pick-cost" id="ad-pick-cost">' + (connected ? "—" : L("Enregistrez d'abord votre clé Prodigi (plus haut) pour voir le coût de chaque produit.", "Save your Prodigi key first (above) to see the cost of each product.")) + "</p>" +
      '<div class="ad-picker-price">' +
      '<label class="ad-field"><span>' + L("Votre marge (€)", "Your margin (€)") + '</span><input type="text" id="ad-pick-margin" inputmode="decimal" placeholder="' + L("Ex. 10", "e.g. 10") + '" /></label>' +
      '<div class="ad-pick-total"><span>' + L("Prix pour le client", "Client price") + '</span><strong id="ad-pick-price">—</strong></div>' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-pick-add" disabled>' + L("Ajouter à ma boutique", "Add to my shop") + "</button>" +
      "</div></div>"
    );
  }

  function wirePicker(catalogue, connected, onAdded) {
    if (!catalogue || !catalogue.length) return;
    var $ = function (id) { return document.getElementById(id); };
    var pick = { costCents: null, shipCents: 0, seq: 0, fillSeq: 0, sizes: null };
    var findCategory = function () { return catalogue.find(function (c) { return c.key === $("ad-pick-category").value; }); };
    var findProduct = function () {
      var cat = findCategory();
      return cat && cat.products.find(function (p) { return p.key === $("ad-pick-product").value; });
    };
    var options = function (list) {
      return list.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>"; }).join("");
    };

    function refreshPrice() {
      var margin = centsFromEuros($("ad-pick-margin").value);
      var ok = pick.costCents !== null && !isNaN(margin) && margin >= 0;
      $("ad-pick-price").textContent = ok ? formatEuros(priceForMargin(pick.costCents, margin)) : "—";
      $("ad-pick-add").disabled = !ok;
    }

    async function requote() {
      pick.costCents = null;
      refreshPrice();
      if (!connected || !$("ad-pick-size").value) return;
      var seq = ++pick.seq;
      var product = findProduct();
      $("ad-pick-cost").textContent = L("Demande du coût au laboratoire…", "Asking the lab for the cost…");
      try {
        var q = await api("POST", "/shop/quote-item", {
          product: product.key,
          size: $("ad-pick-size").value,
          option: product.option ? $("ad-pick-option").value : "",
          countryCode: $("ad-shop-country").value,
        });
        if (seq !== pick.seq || !$("ad-pick-cost")) return; // un autre choix a été fait entre-temps, ou l'onglet a été quitté
        if (!q.available) {
          $("ad-pick-cost").innerHTML = '<span class="ad-order-error">' + L("Indisponible chez le labo dans cette version : ", "Not available from the lab in this version: ") + esc(q.error || "") + "</span>";
          return;
        }
        pick.costCents = q.itemsCents;
        pick.shipCents = q.shippingCents;
        $("ad-pick-cost").innerHTML =
          L("Coût labo : <strong>", "Lab cost: <strong>") + formatEuros(q.itemsCents) + "</strong>" + L(" le produit", " per item") +
          ' <span class="ad-hint">(+ ' + formatEuros(q.shippingCents) + L(" de livraison pour une commande d'un article, couverte par vos frais de port)", " shipping for a one-item order, covered by your shipping fee)") + "</span>";
        if (!$("ad-pick-margin").value) $("ad-pick-margin").value = eurosInput(Math.max(500, Math.ceil(q.itemsCents / 100) * 100));
        refreshPrice();
      } catch (err) {
        if (seq === pick.seq && $("ad-pick-cost")) $("ad-pick-cost").innerHTML = '<span class="ad-order-error">' + esc(err.message) + "</span>";
      }
    }

    // Formats que Prodigi propose vraiment pour ce produit (et cette
    // livraison), demandés une fois par produit et par pays. null : on ne
    // sait pas (pas de clé, ancien Worker, panne) — tous les formats restent
    // affichés et le devis tranchera.
    var availability = {};
    function availabilityFor(product) {
      if (!connected) return Promise.resolve(null);
      var key = product.key + "|" + $("ad-shop-country").value;
      if (!availability[key]) {
        availability[key] = api("POST", "/shop/availability", { product: product.key, countryCode: $("ad-shop-country").value })
          .then(function (r) { return r && r.sizes ? r.sizes : null; })
          .catch(function () { delete availability[key]; return null; });
      }
      return availability[key];
    }

    // Options valides pour le format choisi (ex. couleurs de cadre
    // réellement fabriquées dans ce format).
    function fillOptions() {
      var product = findProduct();
      if (!product.option) return;
      var info = pick.sizes && pick.sizes[$("ad-pick-size").value];
      var allowed = info && info.allowed;
      var choices = product.option.choices.filter(function (c) {
        return !allowed || allowed.indexOf(String(c.value).toLowerCase()) !== -1;
      });
      if (!choices.length) choices = product.option.choices;
      var current = $("ad-pick-option").value;
      $("ad-pick-option").innerHTML = options(choices);
      if (choices.some(function (c) { return c.value === current; })) $("ad-pick-option").value = current;
    }

    async function fillSizesAndOptions() {
      var product = findProduct();
      var seq = ++pick.fillSeq;
      var previousSize = $("ad-pick-size").value;
      var all = product.sizes.map(function (s) { return { value: s.key, label: s.label }; });
      $("ad-pick-description").textContent = product.description || "";
      $("ad-pick-option-wrap").hidden = !product.option;
      if (product.option) {
        $("ad-pick-option-label").textContent = product.option.label;
        $("ad-pick-option").innerHTML = options(product.option.choices);
      }
      $("ad-pick-size").innerHTML = options(all);
      if (all.some(function (s) { return s.value === previousSize; })) $("ad-pick-size").value = previousSize;
      pick.sizes = null;
      if (connected) {
        pick.seq++; // annule un devis encore en route pour l'ancien choix
        pick.costCents = null;
        refreshPrice();
        $("ad-pick-cost").textContent = L("Vérification des formats proposés par le labo…", "Checking the sizes offered by the lab…");
      }
      var sizeSelect = $("ad-pick-size");
      var sizes = await availabilityFor(product);
      // Un autre produit a été choisi entre-temps, ou l'onglet a été quitté
      // (menus retirés de la page) : cette réponse ne sert plus.
      if (seq !== pick.fillSeq || !document.body.contains(sizeSelect)) return;
      pick.sizes = sizes;
      var chosen = $("ad-pick-size").value; // a pu changer pendant la vérification
      if (sizes) {
        var offered = all.filter(function (s) { return !sizes[s.value] || sizes[s.value].available; });
        $("ad-pick-size").innerHTML = options(offered);
        if (!offered.length) {
          $("ad-pick-cost").innerHTML = '<span class="ad-order-error">' + L("Le labo ne propose aucun format de ce produit pour une livraison dans ce pays.", "The lab offers no size of this product for delivery to this country.") + "</span>";
          return;
        }
      }
      if (Array.prototype.some.call($("ad-pick-size").options, function (o) { return o.value === chosen; })) {
        $("ad-pick-size").value = chosen;
      }
      fillOptions();
      requote();
    }

    function fillProducts() {
      var cat = findCategory();
      $("ad-pick-product").innerHTML = options(cat.products.map(function (p) { return { value: p.key, label: p.label }; }));
      fillSizesAndOptions();
    }

    $("ad-pick-category").addEventListener("change", fillProducts);
    $("ad-pick-product").addEventListener("change", fillSizesAndOptions);
    $("ad-pick-size").addEventListener("change", function () { fillOptions(); requote(); });
    $("ad-pick-option").addEventListener("change", requote);
    $("ad-shop-country").addEventListener("change", fillSizesAndOptions);
    $("ad-pick-margin").addEventListener("input", refreshPrice);
    $("ad-pick-add").addEventListener("click", async function () {
      var product = findProduct();
      var margin = centsFromEuros($("ad-pick-margin").value);
      this.disabled = true;
      try {
        await api("POST", "/shop/products", {
          product: product.key,
          size: $("ad-pick-size").value,
          option: product.option ? $("ad-pick-option").value : "",
          priceCents: priceForMargin(pick.costCents, margin),
          costCents: pick.costCents,
          shipCostCents: pick.shipCents,
        });
        toast(L("Produit ajouté à votre boutique.", "Product added to your shop."));
        onAdded();
      } catch (err) {
        toast(err.message, true);
        this.disabled = false;
      }
    });
    fillProducts();
  }

  async function renderShop(skipHash) {
    if (!skipHash && location.hash !== "#/boutique") history.pushState(null, "", "#/boutique");
    setActiveTab("shop");
    el.view.innerHTML = '<p class="ad-loading">' + L("Chargement…", "Loading…") + "</p>";

    var data, ordersData;
    try {
      data = await api("GET", "/shop");
      ordersData = await api("GET", "/print-orders");
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }
    var s = data.settings;
    shopFeeRule = s.paymentFee || null;
    var activeCount = data.products.filter(function (p) { return p.active; }).length;
    var check = function (ok, text) { return '<li class="' + (ok ? "ad-step-ok" : "ad-step-todo") + '">' + (ok ? "✓ " : "○ ") + text + "</li>"; };
    var countryOptions = Object.keys(data.countries).map(function (code) {
      return '<option value="' + code + '"' + (code === "BE" ? " selected" : "") + ">" + esc(data.countries[code]) + "</option>";
    }).join("");

    data.products.forEach(function (p) { if (!p.category) p.category = L("Mes produits", "My products"); });
    var maxShip = data.products.reduce(function (m, p) { return Math.max(m, p.shipCostCents || 0); }, 0);

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>' + L("Boutique de tirages", "Print shop") + "</h2>" +
      '<p class="ad-hint">' + L("Vos clients commandent tirages, toiles et cadres directement depuis leur galerie. Le paiement arrive sur votre compte Stripe, la commande part automatiquement chez <strong>Prodigi</strong>, qui imprime et expédie. Prodigi vous facture son prix ; la différence avec votre prix de vente est votre marge.",
        "Your clients order prints, canvases and frames right from their gallery. The payment goes to your Stripe account, the order goes automatically to <strong>Prodigi</strong>, which prints and ships. Prodigi bills you its price; the difference with your selling price is your margin.") + "</p>" +
      "</div></header>" +

      '<section><div class="ad-section-header"><h3>' + L("Avant d'ouvrir la boutique", "Before opening the shop") + "</h3></div>" +
      '<ul class="ad-shop-steps" id="ad-shop-steps">' +
      check(s.connected, L("Clé d'API Prodigi enregistrée", "Prodigi API key saved") + (s.connected ? " (" + esc(s.keyHint) + ", " + (s.environment === "live" ? "production" : L("mode test", "test mode")) + ")" : "")) +
      check(s.stripeReady, L("Paiement en ligne Stripe actif — ", "Stripe online payment active — ") + '<button type="button" class="ad-link-btn" id="ad-goto-billing">' + L("onglet Facturation", "Billing tab") + "</button>") +
      check(activeCount > 0, L("Au moins un format proposé (" + activeCount + " actif" + (activeCount > 1 ? "s" : "") + ")", "At least one format offered (" + activeCount + " active)")) +
      check(false, L("Puis, sur chaque galerie : « Proposer des tirages sur cette galerie »", "Then, on each gallery: “Offer prints on this gallery”")) +
      "</ul></section>" +

      '<section><div class="ad-section-header"><h3>' + L("Compte Prodigi", "Prodigi account") + "</h3></div>" +
      '<ol class="ad-owner-steps">' +
      "<li>" + L("Créez un compte gratuit sur ", "Create a free account on ") + '<a href="https://dashboard.prodigi.com/register" target="_blank" rel="noopener">dashboard.prodigi.com</a>.</li>' +
      "<li>" + L("Commencez en <strong>mode test</strong> avec la clé <em>Sandbox</em> : elle figure dans l'e-mail de bienvenue de Prodigi, ou sur le tableau de bord de test ",
        "Start in <strong>test mode</strong> with the <em>Sandbox</em> key: it's in Prodigi's welcome email, or on the test dashboard ") +
      '<a href="https://sandbox-beta-dashboard.pwinty.com" target="_blank" rel="noopener">sandbox-beta-dashboard.pwinty.com</a>' +
      L(" (mêmes identifiants) → Settings → Integrations → API. Rien n'est imprimé ni facturé.", " (same credentials) → Settings → Integrations → API. Nothing is printed or billed.") + "</li>" +
      "<li>" + L("Attention : la clé affichée sur dashboard.prodigi.com est la clé <em>Live</em>, refusée en mode test. Quand tout est prêt, ajoutez un moyen de paiement chez Prodigi, collez cette clé Live et passez en production.",
        "Careful: the key shown on dashboard.prodigi.com is the <em>Live</em> key, refused in test mode. When everything is ready, add a payment method at Prodigi, paste that Live key and switch to production.") + "</li>" +
      "</ol>" +
      '<form id="ad-shop-settings">' +
      '<label class="ad-field"><span>' + L("Clé d'API Prodigi", "Prodigi API key") + "</span>" +
      '<input type="password" name="apiKey" autocomplete="off" placeholder="' +
      (s.connected ? L("Clé enregistrée (" + esc(s.keyHint) + ") — laissez vide pour la garder", "Key saved (" + esc(s.keyHint) + ") — leave empty to keep it") : L("Collez votre clé d'API Prodigi", "Paste your Prodigi API key")) + '" /></label>' +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>' + L("Environnement", "Environment") + '</span><select name="environment">' +
      '<option value="sandbox"' + (s.environment !== "live" ? " selected" : "") + ">" + L("Test (sandbox) — rien n'est imprimé", "Test (sandbox) — nothing is printed") + "</option>" +
      '<option value="live"' + (s.environment === "live" ? " selected" : "") + ">" + L("Production — commandes réelles", "Production — real orders") + "</option>" +
      "</select></label>" +
      '<label class="ad-field"><span>' + L("Frais de port facturés au client — Europe (€)", "Shipping charged to the client — Europe (€)") + "</span>" +
      '<input type="text" name="shipping" inputmode="decimal" value="' + eurosInput(s.shippingCents) + '" /></label>' +
      "</div>" +
      '<label class="ad-field"><span>' + L("Frais de port hors d'Europe (€) <em>(laisser vide pour ne livrer qu'en Europe)</em>", "Shipping outside Europe (€) <em>(leave empty to ship within Europe only)</em>") + "</span>" +
      '<input type="text" name="shippingWorld" inputmode="decimal" placeholder="' + L("ex. 14,90", "e.g. 14.90") + '" value="' +
      (s.shippingWorldCents === null || s.shippingWorldCents === undefined ? "" : eurosInput(s.shippingWorldCents)) + '" /></label>' +
      '<p class="ad-hint">' + L("États-Unis, Canada, Australie, Nouvelle-Zélande, Japon, Singapour, Hong Kong, Corée du Sud, Émirats : Prodigi imprime sur place ou au plus près. Comparez le coût de livraison en choisissant un de ces pays ci-dessous avant de fixer ce forfait.",
        "United States, Canada, Australia, New Zealand, Japan, Singapore, Hong Kong, South Korea, UAE: Prodigi prints locally or as close as possible. Check the shipping cost by choosing one of these countries below before setting this rate.") + "</p>" +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-shop-settings-save">' + L("Enregistrer", "Save") + "</button>" +
      (s.connected ? ' <button type="button" class="ad-btn" id="ad-shop-clear-key">' + L("Retirer la clé", "Remove the key") + "</button>" : "") +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>' + L("Ajouter un produit", "Add a product") + "</h3>" +
      '<button type="button" class="ad-btn" id="ad-shop-suggested">' + L("Ajouter les formats suggérés", "Add the suggested formats") + "</button></div>" +
      '<p class="ad-hint">' + L("Choisissez dans les menus : le coût réel chez Prodigi s'affiche aussitôt, vous indiquez votre marge, le prix client se calcule tout seul. Le labo recadre la photo au format choisi.",
        "Choose from the menus: Prodigi's real cost shows right away, you enter your margin, the client price is worked out for you. The lab crops the photo to the chosen size.") + "</p>" +
      '<div class="ad-shop-quote-bar"><label>' + L("Coûts calculés pour une livraison en ", "Costs calculated for delivery to ") + '<select id="ad-shop-country">' + countryOptions + "</select></label></div>" +
      pickerHtml(data.catalogue, s.connected) +
      "</section>" +

      '<section><div class="ad-section-header"><h3>' + L("Mes produits", "My products") + "</h3>" +
      '<button type="button" class="ad-btn" id="ad-shop-quote"' + (s.connected && data.products.length ? "" : " disabled") + ">" + L("Mettre à jour les coûts labo", "Update lab costs") + "</button></div>" +
      '<p class="ad-hint">' + L("Prix TTC payé par le client. Votre marge = prix client − coût du produit chez le labo", "Price paid by the client, VAT included. Your margin = client price − the lab's product cost") +
      (s.paymentFee && s.paymentFee.label !== "aucun" ? L(" − frais de paiement (", " − payment fees (") + esc(feeText(s.paymentFee.label)) + L(", comptés comme si le produit était commandé seul)", ", counted as if the product were ordered alone)") : "") +
      L(" ; la livraison est couverte à part par vos frais de port (", "; shipping is covered separately by your shipping fee (") + formatEuros(s.shippingCents) + L(" par commande).", " per order).") +
      (maxShip ? L(" Dernier devis : le labo facture jusqu'à ", " Latest quote: the lab charges up to ") + formatEuros(maxShip) + L(" de livraison pour un article.", " shipping for one item.") : "") + "</p>" +
      productsTableHtml(data.products) +
      '<details class="ad-advanced"><summary>' + L("Mode avancé : ajouter une référence Prodigi hors catalogue", "Advanced: add a Prodigi reference outside the catalogue") + "</summary>" +
      '<p class="ad-hint">' + L("Pour un produit absent des menus : sa référence (SKU) et ses options sont celles du ", "For a product missing from the menus: its reference (SKU) and options are those of the ") +
      '<a href="https://www.prodigi.com/products/" target="_blank" rel="noopener">' + L("catalogue Prodigi", "Prodigi catalogue") + "</a>.</p>" +
      '<div class="ad-advanced-grid" id="ad-shop-new">' +
      '<label class="ad-field"><span>' + L("Libellé", "Label") + '</span><input type="text" class="ad-input" data-field="label" placeholder="' + L("Ex. Tirage 13 × 18 cm", "e.g. 5 × 7 in print") + '" maxlength="100" /></label>' +
      '<label class="ad-field"><span>' + L("Référence (SKU)", "Reference (SKU)") + '</span><input type="text" class="ad-input ad-input-mono" data-field="sku" placeholder="GLOBAL-PHO-5x7" maxlength="80" /></label>' +
      '<label class="ad-field"><span>Options (JSON)</span><input type="text" class="ad-input ad-input-mono" data-field="attributes" placeholder="{}" /></label>' +
      '<label class="ad-field"><span>' + L("Prix client (€)", "Client price (€)") + '</span><input type="text" class="ad-input ad-input-price" data-field="price" placeholder="9.00" inputmode="decimal" /></label>' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-shop-add">' + L("Ajouter", "Add") + "</button>" +
      "</div></details>" +
      "</section>" +

      '<section><div class="ad-section-header"><h3>' + L("Commandes", "Orders") + "</h3></div>" +
      printOrdersTableHtml(ordersData.orders, true) +
      "</section>";

    document.getElementById("ad-goto-billing").addEventListener("click", function () { renderBilling(); });

    document.getElementById("ad-shop-settings").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var shipping = centsFromEuros(form.shipping.value);
      if (isNaN(shipping) || shipping < 0) return toast(L("Frais de port invalides.", "Invalid shipping fee."), true);
      var shippingWorld = form.shippingWorld.value.trim() ? centsFromEuros(form.shippingWorld.value) : null;
      if (shippingWorld !== null && (isNaN(shippingWorld) || shippingWorld < 0)) return toast(L("Frais de port hors Europe invalides.", "Invalid shipping fee outside Europe."), true);
      try {
        await api("POST", "/shop/settings", {
          apiKey: form.apiKey.value.trim(),
          environment: form.environment.value,
          shippingCents: shipping,
          shippingWorldCents: shippingWorld,
        });
        toast(L("Réglages de la boutique enregistrés.", "Shop settings saved."));
        renderShop(true);
      } catch (err) {
        toast(err.message, true);
      }
    });

    var clearKey = document.getElementById("ad-shop-clear-key");
    if (clearKey) {
      clearKey.addEventListener("click", function () {
        confirmAction(L("Retirer la clé Prodigi ? La boutique sera fermée sur toutes vos galeries tant qu'aucune clé n'est enregistrée.", "Remove the Prodigi key? The shop will be closed on all your galleries until a key is saved."), async function () {
          try {
            await api("POST", "/shop/settings", { clearKey: true, environment: s.environment, shippingCents: s.shippingCents });
            toast(L("Clé Prodigi retirée.", "Prodigi key removed."));
            renderShop(true);
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    }

    document.getElementById("ad-shop-suggested").addEventListener("click", async function () {
      try {
        var result = await api("POST", "/shop/products/suggested");
        toast(result.added ? result.added + L(" format(s) ajouté(s) — vérifiez les prix.", " format(s) added — check the prices.") : L("Tous les formats suggérés sont déjà là.", "All the suggested formats are already there."));
        renderShop(true);
      } catch (err) {
        toast(err.message, true);
      }
    });

    wirePicker(data.catalogue, s.connected, function () { renderShop(true); });

    document.getElementById("ad-shop-add").addEventListener("click", async function () {
      var row = document.getElementById("ad-shop-new");
      var get = function (f) { return row.querySelector('[data-field="' + f + '"]').value.trim(); };
      try {
        var attributes;
        try {
          attributes = JSON.parse(get("attributes") || "{}");
        } catch (e) {
          throw new Error(L("Options : JSON invalide (ex. {\"finish\": \"lustre\"})", "Options: invalid JSON (e.g. {\"finish\": \"lustre\"})"));
        }
        var price = centsFromEuros(get("price"));
        if (isNaN(price)) throw new Error(L("Prix invalide.", "Invalid price."));
        await api("POST", "/shop/products", { label: get("label"), sku: get("sku"), attributes: attributes, priceCents: price });
        toast(L("Produit ajouté.", "Product added."));
        renderShop(true);
      } catch (err) {
        toast(err.message, true);
      }
    });

    var productsTable = document.getElementById("ad-shop-products");
    if (productsTable) {
      productsTable.addEventListener("input", function (event) {
        var row = event.target.closest("tr[data-product-id]");
        if (!row || event.target.getAttribute("data-field") !== "price") return;
        var cost = Number(row.getAttribute("data-cost")) || 0;
        var price = centsFromEuros(event.target.value);
        if (cost && !isNaN(price)) row.querySelector(".ad-margin-cell").innerHTML = marginHtml(netMarginFor(price, cost));
      });
      productsTable.addEventListener("click", async function (event) {
        var row = event.target.closest("tr[data-product-id]");
        if (!row) return;
        var id = row.getAttribute("data-product-id");
        if (event.target.closest("[data-save-product]")) {
          var price = centsFromEuros(row.querySelector('[data-field="price"]').value);
          if (isNaN(price)) return toast(L("Prix invalide.", "Invalid price."), true);
          try {
            await api("PUT", "/shop/products/" + encodeURIComponent(id), {
              priceCents: price,
              active: row.querySelector('[data-field="active"]').checked,
            });
            toast(L("Produit enregistré.", "Product saved."));
            renderShop(true);
          } catch (err) {
            toast(err.message, true);
          }
        }
        if (event.target.closest("[data-delete-product]")) {
          confirmAction(L("Retirer ce produit de votre boutique ? Les commandes déjà passées ne changent pas.", "Remove this product from your shop? Orders already placed don't change."), async function () {
            try {
              await api("DELETE", "/shop/products/" + encodeURIComponent(id));
              toast(L("Produit retiré.", "Product removed."));
              renderShop(true);
            } catch (err) {
              toast(err.message, true);
            }
          });
        }
      });
    }

    document.getElementById("ad-shop-quote").addEventListener("click", async function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = L("Mise à jour…", "Updating…");
      try {
        var result = await api("POST", "/shop/quote", { countryCode: document.getElementById("ad-shop-country").value });
        result.quotes.forEach(function (q) {
          var cell = document.getElementById("ad-quote-" + q.productId);
          if (!cell) return;
          var row = cell.closest("tr");
          if (q.error) {
            cell.innerHTML = '<span class="ad-order-error">' + esc(q.error) + "</span>";
            row.querySelector(".ad-margin-cell").textContent = "—";
          } else {
            row.setAttribute("data-cost", q.itemsCents);
            cell.innerHTML = formatEuros(q.itemsCents) + '<br /><span class="ad-hint">+ ' + formatEuros(q.shippingCents) + L(" livraison", " shipping") + "</span>";
            row.querySelector(".ad-margin-cell").innerHTML = marginHtml(q.marginCents);
          }
        });
        toast(L("Coûts labo mis à jour.", "Lab costs updated."));
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = L("Mettre à jour les coûts labo", "Update lab costs");
      }
    });

    wireOrderResubmit(function () { renderShop(true); });
  }

  /* ---------- Vue : vérifier une photo suspecte ---------- */
  // Compare une image retrouvée ailleurs (réseaux sociaux, un site…) aux
  // empreintes invisibles de toutes les galeries du compte, sans savoir à
  // l'avance de laquelle elle pourrait venir. Même moteur que detect.mjs en
  // ligne de commande (POST /local/detect), simplement accessible d'un clic.

  function detectResultHtml(data) {
    if (data.status === "match") {
      return (
        '<div class="ad-detect-result ad-detect-match">' +
        '<p class="ad-detect-badge ad-detect-badge-ok">' + L("✓ Origine identifiée", "✓ Source identified") + "</p>" +
        "<h3>" + esc(data.gallery.title) + "</h3>" +
        (data.gallery.clientName ? "<p>" + esc(data.gallery.clientName) + "</p>" : "") +
        '<p class="ad-hint">' + L("Photo n° ", "Photo no. ") + (data.photo.position + 1) +
        L(" · fiabilité : signal/bruit ", " · reliability: signal/noise ") + data.snr.toFixed(2) + ", " + data.matchingBits + L("/32 bits concordants", "/32 matching bits") + "</p>" +
        "</div>"
      );
    }
    if (data.status === "no-match") {
      return (
        '<div class="ad-detect-result">' +
        '<p class="ad-detect-badge">' + L("Aucune correspondance fiable", "No reliable match") + "</p>" +
        '<p class="ad-hint">' + L("Cette image ne semble pas venir de vos galeries, ou a été trop dégradée pour l'affirmer avec certitude ",
          "This image doesn't seem to come from your galleries, or is too degraded to say for sure ") +
        L("(signal/bruit ", "(signal/noise ") + data.snr.toFixed(2) + ", " + data.matchingBits + L("/32 bits — seuils : ", "/32 bits — thresholds: ") +
        data.thresholds.snr + L(" et ", " and ") + data.thresholds.bits + "/32).</p>" +
        "</div>"
      );
    }
    if (data.status === "too-small") {
      return (
        '<div class="ad-detect-result"><p class="ad-detect-badge">' + L("Image trop petite", "Image too small") + "</p>" +
        '<p class="ad-hint">' + L("Elle ne peut pas porter une empreinte lisible.", "It can't carry a readable fingerprint.") + "</p></div>"
      );
    }
    if (data.status === "no-prints") {
      return '<div class="ad-detect-result"><p class="ad-hint">' + L("Aucune de vos photos n’a encore d’empreinte enregistrée.", "None of your photos has a recorded fingerprint yet.") + "</p></div>";
    }
    return '<div class="ad-detect-result"><p class="ad-hint">' + L("Résultat inattendu.", "Unexpected result.") + "</p></div>";
  }

  function renderDetect(skipHash) {
    if (!skipHash && location.hash !== "#/detect") history.pushState(null, "", "#/detect");
    el.view.innerHTML =
      '<button type="button" class="ad-back" id="ad-detect-back">' + L("&larr; Toutes les galeries", "&larr; All galleries") + "</button>" +
      '<header class="ad-detail-header"><div><h2>' + L("Vérifier une photo", "Check a photo") + "</h2>" +
      '<p class="ad-hint">' + L("Une image retrouvée ailleurs (réseaux sociaux, un site…) vous semble provenir de l’une de vos galeries ? Déposez-la ici : elle est comparée aux empreintes invisibles de toutes vos photos, sans jamais quitter votre ordinateur.",
        "Found an image elsewhere (social media, a website…) that looks like it came from one of your galleries? Drop it here: it's compared with the invisible fingerprints of all your photos, without ever leaving your computer.") + "</p></div></header>" +
      '<section class="ad-dropzone" id="ad-detect-dropzone">' +
      "<p>" + L("<strong>Glissez une photo ici</strong>, ou", "<strong>Drag a photo here</strong>, or") + "</p>" +
      '<label class="ad-btn ad-btn-primary">' + L("Choisir un fichier", "Choose a file") + '<input type="file" id="ad-detect-file-input" accept="image/*" hidden /></label>' +
      "</section>" +
      '<div id="ad-detect-result"></div>';

    document.getElementById("ad-detect-back").addEventListener("click", function () {
      renderList();
    });

    var resultBox = document.getElementById("ad-detect-result");
    var dropzone = document.getElementById("ad-detect-dropzone");

    async function analyze(file) {
      resultBox.innerHTML = '<p class="ad-loading">' + L("Analyse en cours…", "Analysing…") + "</p>";
      var form = new FormData();
      form.append("file", file, file.name);
      try {
        var response = await fetch("/local/detect", { method: "POST", body: form });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(serverText(data.error) || L("Échec de l'analyse", "Analysis failed"));
        resultBox.innerHTML = detectResultHtml(data);
      } catch (err) {
        resultBox.innerHTML = '<div class="ad-error-panel"><h2>' + L("Analyse impossible", "Analysis not possible") + "</h2><p>" + esc(err.message) + "</p></div>";
      }
    }

    document.getElementById("ad-detect-file-input").addEventListener("change", function (event) {
      var file = event.target.files[0];
      event.target.value = "";
      if (file) analyze(file);
    });

    dropzone.addEventListener("dragover", function (event) {
      event.preventDefault();
      dropzone.classList.add("ad-dropzone-active");
    });
    dropzone.addEventListener("dragleave", function () {
      dropzone.classList.remove("ad-dropzone-active");
    });
    dropzone.addEventListener("drop", function (event) {
      event.preventDefault();
      dropzone.classList.remove("ad-dropzone-active");
      var file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) analyze(file);
    });
  }

  /* ---------- Vue : détail d'une galerie ---------- */

  // La vignette est reconstituée à partir des tuiles de niveau « aperçu »
  // (une grille 2×2 par défaut) — les mêmes tuiles que charge la galerie
  // cliente, lues ici via le serveur d'administration plutôt qu'une session
  // client. Pas de fichier « miniature » à part : une seule source de vérité.
  function isSelected(photo) {
    return Number(photo.selected) === 1;
  }

  function hasComment(photo) {
    return Boolean(photo.comment && photo.comment.trim());
  }

  var TAG_LABELS = { green: "Validée", yellow: "À retoucher", red: "À écarter" };
  var TAG_LABELS_EN = { green: "Approved", yellow: "To retouch", red: "Set aside" };
  function tagLabel(tag) {
    return (LANG === "en" ? TAG_LABELS_EN : TAG_LABELS)[tag] || "";
  }

  function marksOf(photo) {
    return Array.isArray(photo.marks) ? photo.marks : [];
  }

  function hasClientNotes(photo) {
    return isSelected(photo) || hasComment(photo) || Boolean(photo.tag) || marksOf(photo).length > 0;
  }

  // Légende des codes couleur posés par le client sur cette galerie —
  // seulement s'il en a posé au moins un.
  function tagLegendHtml(photos) {
    var counts = { green: 0, yellow: 0, red: 0 };
    photos.forEach(function (p) {
      if (counts.hasOwnProperty(p.tag)) counts[p.tag]++;
    });
    if (!counts.green && !counts.yellow && !counts.red) return "";
    return (
      '<p class="ad-tag-legend" id="ad-tag-legend">' +
      ["green", "yellow", "red"].map(function (tag) {
        return '<span class="ad-tag-legend-' + tag + '">' + counts[tag] + " " + tagLabel(tag).toLowerCase() + (LANG !== "en" && counts[tag] > 1 && tag !== "yellow" && tag !== "red" ? "s" : "") + "</span>";
      }).join("") +
      "</p>"
    );
  }

  // Photo en grand (tuiles plein écran, lues via le serveur d'administration)
  // avec les repères du client posés par-dessus et leurs notes numérotées.
  function openPhotoModal(photo) {
    var modal = document.getElementById("ad-photo-modal");
    var body = document.getElementById("ad-photo-modal-body");
    var cells = "";
    for (var row = 0; row < photo.rows; row++) {
      for (var col = 0; col < photo.cols; col++) {
        cells += '<img src="/local/tiles/' + esc(photo.id) + "/1/" + col + "/" + row + '" alt="" />';
      }
    }
    var marks = marksOf(photo);
    var pins = marks.map(function (m, i) {
      return '<span class="ad-pin" style="left:' + (Number(m.x) * 100).toFixed(2) + "%;top:" + (Number(m.y) * 100).toFixed(2) + '%" title="' + esc(m.note || "") + '"><span>' + (i + 1) + "</span></span>";
    }).join("");
    document.getElementById("ad-photo-modal-title").textContent = L("Photo n° ", "Photo no. ") + (photo.position + 1);
    body.innerHTML =
      '<div class="ad-photo-meta">' +
      (isSelected(photo) ? '<span class="ad-badge ad-badge-selected">' + L("♥ Sélectionnée", "♥ Selected") + "</span>" : "") +
      (photo.tag ? '<span class="ad-badge ad-badge-tag-' + photo.tag + '">' + tagLabel(photo.tag) + "</span>" : "") +
      "<span>" + photo.width + " × " + photo.height + "</span>" +
      "</div>" +
      '<div class="ad-photo-large" style="aspect-ratio:' + photo.width + "/" + photo.height +
      ";grid-template-columns:repeat(" + photo.cols + ",1fr);grid-template-rows:repeat(" + photo.rows + ',1fr)">' +
      cells + '<div class="ad-photo-large-pins">' + pins + "</div></div>" +
      (hasComment(photo) ? "<p><strong>" + L("Remarque :", "Note:") + "</strong> " + L("« " + esc(photo.comment.trim()) + " »", "“" + esc(photo.comment.trim()) + "”") + "</p>" : "") +
      (marks.length
        ? '<ol class="ad-photo-notes" id="ad-photo-notes">' +
          marks.map(function (m) { return "<li>" + (m.note ? esc(m.note) : "<em>" + L("Sans note", "No note") + "</em>") + "</li>"; }).join("") +
          "</ol>"
        : '<p class="ad-hint">' + L("Aucun repère posé par le client sur cette photo.", "The client placed no markers on this photo.") + "</p>");
    openModal("ad-photo-modal");
  }

  // Noms de fichiers sans extension : Lightroom retrouve ainsi aussi bien le
  // JPEG envoyé que le RAW du même nom. Un nom par photo, sans doublon.
  function lightroomNames(photos) {
    var seen = {};
    var names = [];
    photos.forEach(function (p) {
      var name = String(p.source_name || "").replace(/\.[A-Za-z0-9]{2,5}$/, "").trim();
      if (name && !seen[name]) { seen[name] = true; names.push(name); }
    });
    return names;
  }

  function photoThumb(photo) {
    var cols = state.config.previewCols || 2;
    var rows = state.config.previewRows || 2;
    var cells = "";
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        cells += '<img loading="lazy" src="/local/tiles/' + esc(photo.id) + "/0/" + col + "/" + row + '" alt="" />';
      }
    }
    var selected = isSelected(photo);
    var commented = hasComment(photo);
    var markCount = marksOf(photo).length;
    var presentation = state.current && state.current.gallery && state.current.gallery.presentation;
    var isCover = Boolean(presentation && presentation.coverPhotoId === photo.id);
    return (
      '<div class="ad-photo' + (selected ? " ad-photo-selected" : "") + '" data-photo-id="' + esc(photo.id) + '">' +
      '<div class="ad-photo-frame" title="' + esc(photo.source_name ? photo.source_name + L(" — voir en grand", " — view large") : L("Voir en grand", "View large")) + '" style="aspect-ratio:' + photo.width + "/" + photo.height +
      ";grid-template-columns:repeat(" + cols + ",1fr);grid-template-rows:repeat(" + rows + ',1fr)">' +
      cells +
      '<span class="ad-photo-dims">' + L("n° ", "no. ") + (photo.position + 1) + " · " + photo.width + "×" + photo.height + "</span>" +
      (selected ? '<span class="ad-photo-heart" title="' + L("Sélectionnée par le client", "Selected by the client") + '">♥</span>' : "") +
      (commented ? '<span class="ad-photo-comment" title="' + esc(photo.comment) + '">💬</span>' : "") +
      (photo.tag && tagLabel(photo.tag)
        ? '<span class="ad-photo-tag ad-photo-tag-' + photo.tag + '" title="' + tagLabel(photo.tag) + '"></span>'
        : "") +
      (markCount ? '<span class="ad-photo-marks" title="' + L(markCount + " repère" + (markCount > 1 ? "s" : "") + " annoté(s)", markCount + " annotated marker" + (markCount === 1 ? "" : "s")) + '">📍 ' + markCount + "</span>" : "") +
      "</div>" +
      '<button type="button" class="ad-photo-cover' + (isCover ? " ad-photo-cover-on" : "") + '" title="' + (isCover ? L("Photo de couverture", "Cover photo") : L("Choisir comme photo de couverture", "Use as cover photo")) + '" aria-label="' + (isCover ? L("Photo de couverture", "Cover photo") : L("Choisir comme photo de couverture", "Use as cover photo")) + '" aria-pressed="' + isCover + '">★</button>' +
      '<button type="button" class="ad-photo-remove" title="' + L("Supprimer cette photo", "Delete this photo") + '" aria-label="' + L("Supprimer cette photo", "Delete this photo") + '">&times;</button>' +
      "</div>"
    );
  }

  // Pour les évènements « view », « select », « deselect » et « comment », le
  // détail consigné est l'identifiant technique de la photo — on l'affiche
  // plutôt sous la forme lisible « Photo n° X » quand on peut la retrouver.
  var PHOTO_ID_EVENTS = new Set(["view", "select", "deselect", "comment", "tag", "mark"]);

  // Pour « capture_suspected », « print » et « devtools », le détail est la
  // raison technique du déclenchement, et la photo (si une était ouverte)
  // est référencée séparément par photo_id.
  var CAPTURE_EVENTS = new Set(["capture_suspected", "print", "devtools"]);
  var CAPTURE_REASON_LABELS = {
    "impr-ecran": "Touche Impr. écran",
    "capture-macos": "Raccourci de capture (macOS)",
    "enregistrer": "Tentative d'enregistrement",
    "perte-focus": "Changement de fenêtre",
    "onglet-masque": "Onglet mis en arrière-plan",
    "absence-breve": "Absence très brève (capture probable)",
  };
  // Ces raisons précises sont celles qui déclenchent une alerte par e-mail
  // au photographe (voir worker/src/viewer.js) : on le signale ici.
  var EMAIL_ALERT_REASONS = new Set(["impr-ecran", "capture-macos", "absence-breve"]);
  var CAPTURE_REASON_LABELS_EN = {
    "impr-ecran": "Print Screen key", "capture-macos": "Screenshot shortcut (macOS)", "enregistrer": "Save attempt",
    "perte-focus": "Window switch", "onglet-masque": "Tab moved to the background", "absence-breve": "Very brief absence (likely screenshot)",
  };

  function logRow(entry, photosById) {
    var label = EVENT_LABELS[entry.event] || entry.event;
    if (entry.event === "capture_suspected" && EMAIL_ALERT_REASONS.has(entry.detail)) {
      label = "🔔 " + label + L(" (e-mail envoyé)", " (email sent)");
    }
    var cls = /failed|expired|capture/.test(entry.event) ? "ad-log-warn" : "";
    var detail = entry.detail || "";
    if (PHOTO_ID_EVENTS.has(entry.event) && photosById[detail]) {
      detail = L("Photo n° ", "Photo no. ") + (photosById[detail].position + 1);
    } else if (CAPTURE_EVENTS.has(entry.event)) {
      detail = (LANG === "en" ? CAPTURE_REASON_LABELS_EN[detail] : CAPTURE_REASON_LABELS[detail]) || detail;
      if (entry.photo_id && photosById[entry.photo_id]) {
        detail += (detail ? " — " : "") + L("Photo n° ", "Photo no. ") + (photosById[entry.photo_id].position + 1);
      }
    }
    return (
      '<tr class="' + cls + '">' +
      "<td>" + esc(formatDateTime(entry.ts)) + "</td>" +
      "<td>" + esc(label) + "</td>" +
      "<td>" + esc(detail) + "</td>" +
      "</tr>"
    );
  }

  function backgroundSwatchesHtml(gallery) {
    var activeColor = gallery.login_background_type === "color" ? (gallery.login_background_color || "") : null;
    return BACKGROUND_PRESETS.map(function (preset) {
      var active = activeColor !== null && activeColor === preset.color;
      var style = preset.color ? "background:" + preset.color + ";" : "background:linear-gradient(135deg,#f7f2ec,#efe6db);";
      return (
        '<button type="button" class="ad-bg-swatch' + (active ? " ad-bg-swatch-active" : "") + '" ' +
        'data-color="' + esc(preset.color) + '" title="' + esc(preset.label) + '" style="' + style + '">' +
        '<span class="ad-bg-swatch-label">' + esc(preset.label) + "</span>" +
        "</button>"
      );
    }).join("");
  }

  function formatEuros(cents) {
    var amount = ((cents || 0) / 100).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return LANG === "en" ? "€" + amount : amount + " €";
  }

  function quotaSummaryHtml(gallery) {
    if (gallery.included_photos === null || gallery.included_photos === undefined) {
      return '<p class="ad-hint">' + L("Aucun forfait défini pour l'instant — les coups de cœur du client ne déclenchent aucun supplément.", "No package set yet — the client's favourites don't trigger any extras.") + "</p>";
    }
    var selected = gallery.selected_count || 0;
    var included = gallery.included_photos;
    var extra = gallery.extra_count || 0;
    var due = gallery.due_extra_count || 0;
    var paid = gallery.paid_extra_count || 0;
    var withinQuota = '<p class="ad-quota-count">' + selected + " / " + included + L(" photo" + (included > 1 ? "s" : "") + " incluse" + (included > 1 ? "s" : ""), (included === 1 ? " photo" : " photos") + " included") + "</p>";
    if (extra <= 0) return withinQuota;

    var html = withinQuota;
    if (due > 0) {
      html +=
        '<p class="ad-quota-due">' +
        "+" + due + L(" supplément" + (due > 1 ? "s" : ""), due === 1 ? " extra" : " extras") + " × " + formatEuros(gallery.extra_photo_price_cents) +
        " = <strong>" + formatEuros(gallery.due_total_cents) + L(" à régler", " due") + "</strong>" +
        "</p>";
    }
    if (paid > 0) {
      html +=
        '<p class="ad-quota-paid">✓ ' + paid + L(" supplément" + (paid > 1 ? "s" : "") + " déjà réglé" + (paid > 1 ? "s" : "") + " en ligne",
          (paid === 1 ? " extra" : " extras") + " already paid online") + "</p>";
    }
    return html;
  }

  function paymentsHistoryHtml(payments) {
    if (!payments || !payments.length) return "";
    var rows = payments.map(function (p) {
      var statusLabel = p.status === "paid" ? L("Réglé", "Paid") : L("En attente", "Pending");
      var statusCls = p.status === "paid" ? "ad-badge-selected" : "";
      var invoiceCell = p.invoice_id
        ? '<a href="/local/invoices/' + encodeURIComponent(p.invoice_id) + '" target="_blank" rel="noopener">' +
          esc(p.invoice_number) + "</a>" +
          (p.invoice_emailed_to ? ' <span class="ad-hint">(' + L("envoyée à ", "sent to ") + esc(p.invoice_emailed_to) + ")</span>" : "")
        : "—";
      return (
        "<tr>" +
        "<td>" + esc(formatDateTime(p.paid_at || p.created_at)) + "</td>" +
        "<td>" + (p.kind === "print" ? L("Tirages", "Prints") : p.extra_count + (p.extra_count === 1 ? " photo" : " photos")) + "</td>" +
        "<td>" + formatEuros(p.amount_cents) +
        (p.fee_cents ? '<br><span class="ad-hint">' + L("dont " + formatEuros(p.fee_cents) + " de frais de paiement", "incl. " + formatEuros(p.fee_cents) + " payment fees") + "</span>" : "") + "</td>" +
        "<td><span class=\"ad-badge " + statusCls + "\">" + statusLabel + "</span></td>" +
        "<td>" + invoiceCell + "</td>" +
        "</tr>"
      );
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
      "<th>" + L("Quand", "When") + "</th><th>" + L("Objet", "For") + "</th><th>" + L("Montant", "Amount") + "</th><th>" + L("Statut", "Status") + "</th><th>" + L("Facture", "Invoice") + "</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
  }

  /* ---------- Style de la galerie : cartes, aperçu au survol, polices ---------- */

  var previewFontsLoaded = false;
  function loadPreviewFonts() {
    if (previewFontsLoaded) return;
    previewFontsLoaded = true;
    // Une feuille par police : une police indisponible n'empêche pas les autres.
    Object.keys(GALLERY_FONTS).forEach(function (key) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=" + GALLERY_FONTS[key][1] + "&display=swap";
      document.head.appendChild(link);
    });
  }
  function fontStackOf(key) {
    var f = GALLERY_FONTS[key];
    return f ? '"' + f[0] + '", ' + f[2] : "inherit";
  }
  function galleryStyleOf(key) {
    return GALLERY_STYLES.filter(function (s) { return s.key === key; })[0] || GALLERY_STYLES[0];
  }
  // Variables CSS d'un aperçu : palette du style, polices choisies (ou celles du style).
  function styleVarsAttr(s, titleFont, bodyFont) {
    var title = GALLERY_FONTS[titleFont] ? titleFont : s.fonts[0];
    var body = GALLERY_FONTS[bodyFont] ? bodyFont : s.fonts[1];
    return ' style="' + esc([
      "--st-bg:" + s.bg, "--st-head:" + s.head, "--st-ink:" + s.ink, "--st-muted:" + s.muted,
      "--st-accent:" + s.accent, "--st-tile:" + s.tile, "--st-radius:" + s.radius + "px",
      "--st-title:" + fontStackOf(title), "--st-body:" + fontStackOf(body),
    ].join(";")) + '"' + (GALLERY_FONTS[title][3] === "script" ? " data-script" : "");
  }
  function styleMiniHtml(s, titleFont, bodyFont) {
    return '<span class="ad-style-mini ad-style-' + s.key + '"' + styleVarsAttr(s, titleFont, bodyFont) + ' aria-hidden="true">' +
      '<span class="ad-style-mini-head"><span class="ad-style-mini-eyebrow">Studio</span><span class="ad-style-mini-title">Léa &amp; Tom</span></span>' +
      '<span class="ad-style-mini-grid"><i></i><i></i><i></i><i></i><i></i><i></i></span></span>';
  }
  function styleCardsHtml(active, titleFont, bodyFont) {
    return GALLERY_STYLES.map(function (s) {
      var on = s.key === active;
      return '<button type="button" class="ad-style-card' + (on ? " ad-style-card-active" : "") + '" data-style="' + s.key + '" aria-pressed="' + on + '">' +
        styleMiniHtml(s, on ? titleFont : "", on ? bodyFont : "") +
        '<span class="ad-style-name">' + esc(s.label) + "</span>" +
        '<span class="ad-style-ideal">' + esc(s.ideal) + "</span></button>";
    }).join("");
  }
  // Petite vignette d'une photo (tuiles d'aperçu 2×2, comme la grille).
  function tileThumbHtml(photo) {
    var cols = state.config.previewCols || 2;
    var rows = state.config.previewRows || 2;
    var cells = "";
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) cells += '<img src="/local/tiles/' + esc(photo.id) + "/0/" + col + "/" + row + '" alt="" />';
    }
    return '<span class="ad-tile-thumb" style="grid-template-columns:repeat(' + cols + ",1fr);grid-template-rows:repeat(" + rows + ',1fr)">' + cells + "</span>";
  }
  function fontOptionsHtml(keys, current, styleKey, part) {
    var groups = LANG === "en" ? { serif: "Serif", sans: "Sans serif", script: "Handwritten" } : { serif: "Avec empattements", sans: "Sans empattements", script: "Manuscrites" };
    var themeFont = galleryStyleOf(styleKey).fonts[part];
    var html = '<option value="">' + L("Celle du style (", "The style's (") + esc(GALLERY_FONTS[themeFont][0]) + ")</option>";
    Object.keys(groups).forEach(function (g) {
      var inGroup = keys.filter(function (k) { return GALLERY_FONTS[k][3] === g; });
      if (!inGroup.length) return;
      html += '<optgroup label="' + groups[g] + '">' + inGroup.map(function (k) {
        return '<option value="' + k + '"' + (k === current ? " selected" : "") + ' style="font-family:' + esc(fontStackOf(k)) + '">' + esc(GALLERY_FONTS[k][0]) + "</option>";
      }).join("") + "</optgroup>";
    });
    return html;
  }

  // Fenêtre d'aperçu au survol (ou au focus clavier) d'une carte de style :
  // la galerie du client en miniature, avec ses vraies photos.
  function bindStylePreview(container, context) {
    var pop = document.getElementById("ad-style-pop");
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "ad-style-pop";
      pop.className = "ad-style-pop";
      pop.setAttribute("role", "tooltip");
      pop.hidden = true;
      document.body.appendChild(pop);
    }
    var timer = null;
    function show(card) {
      var s = galleryStyleOf(card.getAttribute("data-style"));
      var c = context();
      var photos = (c.photos || []).slice(0, 6);
      var thumbs = photos.length
        ? photos.map(function (p) { return '<span class="ad-style-pop-photo" style="aspect-ratio:' + p.width + "/" + p.height + '">' + tileThumbHtml(p) + "</span>"; }).join("")
        : "<i></i><i></i><i></i><i></i><i></i><i></i>";
      pop.innerHTML =
        '<div class="ad-style-pop-page ad-style-' + s.key + '"' + styleVarsAttr(s, c.titleFont, c.bodyFont) + ">" +
        '<div class="ad-style-pop-head">' +
        '<span class="ad-style-pop-eyebrow">' + esc(c.studio || L("Votre studio", "Your studio")) + "</span>" +
        '<span class="ad-style-pop-title">' + esc(c.title || "Léa & Tom") + "</span>" +
        (c.client ? '<span class="ad-style-pop-sub">Galerie de ' + esc(c.client) + "</span>" : "") +
        '<span class="ad-style-pop-intro">' + esc(c.intro || L("Merci pour ces beaux moments partagés. Choisissez vos photos préférées en cliquant sur le cœur.", "Thank you for these lovely moments together. Choose your favourite photos by clicking the heart.")) + "</span>" +
        "</div>" +
        '<div class="ad-style-pop-grid' + (photos.length ? "" : " ad-style-pop-grid-empty") + '">' + thumbs + "</div></div>" +
        '<p class="ad-style-pop-cap"><strong>' + esc(s.label) + "</strong>" + L(" · idéal pour ", " · ideal for ") + esc(s.ideal.toLowerCase()) + "</p>";
      pop.hidden = false;
      var r = card.getBoundingClientRect();
      var w = pop.offsetWidth;
      var h = pop.offsetHeight;
      // À droite de la carte, sinon à gauche, sinon dessous.
      var left;
      var top;
      if (r.right + 14 + w <= window.innerWidth - 8) { left = r.right + 14; top = r.top + r.height / 2 - h / 2; }
      else if (r.left - 14 - w >= 8) { left = r.left - 14 - w; top = r.top + r.height / 2 - h / 2; }
      else { left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)); top = r.bottom + 10 > window.innerHeight - h - 8 ? r.top - h - 10 : r.bottom + 10; }
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, top))) + "px";
    }
    function hide() {
      clearTimeout(timer);
      pop.hidden = true;
    }
    container.querySelectorAll(".ad-style-card").forEach(function (card) {
      card.addEventListener("mouseenter", function () { clearTimeout(timer); timer = setTimeout(function () { show(card); }, 140); });
      card.addEventListener("mouseleave", hide);
      card.addEventListener("focus", function () { show(card); });
      card.addEventListener("blur", hide);
      card.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
    });
    return hide;
  }

  function presentationSectionHtml(data) {
    var p = data.gallery.presentation || { theme: "classique", titleFont: "", bodyFont: "", intro: "", coverPhotoId: "", headerVideo: "" };
    var cover = data.photos.filter(function (x) { return x.id === p.coverPhotoId; })[0];
    var mode = p.headerVideo ? "video" : (cover ? "cover" : "none");
    return '<section class="ad-style-section" id="ad-style-section">' +
      '<div class="ad-section-header"><h3>' + L("Style de la galerie", "Gallery style") + "</h3></div>" +
      '<p class="ad-hint">' + L("Survolez un style pour le voir avec vos photos, cliquez pour l'appliquer. Votre client le découvre à sa prochaine visite.",
        "Hover a style to see it with your photos, click to apply it. Your client sees it on their next visit.") + "</p>" +
      '<div class="ad-style-cards" id="ad-style-cards">' + styleCardsHtml(p.theme, p.titleFont, p.bodyFont) + "</div>" +
      '<div class="ad-style-fonts">' +
      '<label class="ad-field"><span>' + L("Police des titres", "Heading font") + '</span><select id="ad-title-font">' + fontOptionsHtml(TITLE_FONT_KEYS, p.titleFont, p.theme, 0) + "</select></label>" +
      '<label class="ad-field"><span>' + L("Police du texte d'accompagnement", "Welcome text font") + '</span><select id="ad-body-font">' + fontOptionsHtml(BODY_FONT_KEYS, p.bodyFont, p.theme, 1) + "</select></label>" +
      '<p class="ad-style-sample" id="ad-style-sample"' + styleVarsAttr(galleryStyleOf(p.theme), p.titleFont, p.bodyFont) + ">" +
      '<span class="ad-style-sample-title">' + esc(data.gallery.title) + "</span>" +
      '<span class="ad-style-sample-body">' + esc(p.intro || L("Merci pour ces beaux moments partagés : voici vos photos.", "Thank you for these lovely moments together: here are your photos.")) + "</span></p>" +
      "</div>" +
      '<form id="ad-presentation-form" class="ad-presentation-form" novalidate>' +
      '<label class="ad-field"><span>' + L("Texte d'accompagnement <em>(facultatif, sous le titre)</em>", "Welcome text <em>(optional, under the title)</em>") + "</span>" +
      '<textarea name="intro" rows="3" maxlength="600" placeholder="' + L("Merci pour cette belle journée ! Voici vos photos : choisissez vos préférées en cliquant sur le cœur.", "Thank you for a wonderful day! Here are your photos: choose your favourites by clicking the heart.") + '">' + esc(p.intro) + "</textarea></label>" +
      '<div class="ad-style-header">' +
      '<span class="ad-style-header-title">' + L("En-tête de la galerie", "Gallery header") + "</span>" +
      '<div class="ad-seg" role="group" aria-label="' + L("En-tête de la galerie", "Gallery header") + '">' +
      '<button type="button" class="ad-seg-btn" data-header-mode="none" aria-pressed="' + (mode === "none") + '">' + L("Sans", "None") + "</button>" +
      '<button type="button" class="ad-seg-btn" data-header-mode="cover" aria-pressed="' + (mode === "cover") + '">' + L("Photo de couverture", "Cover photo") + "</button>" +
      '<button type="button" class="ad-seg-btn" data-header-mode="video" aria-pressed="' + (mode === "video") + '">' + L("Vidéo", "Video") + "</button></div>" +
      '<div class="ad-style-cover" data-header-panel="cover"' + (mode === "cover" ? "" : " hidden") + ">" +
      (cover ? '<span class="ad-style-cover-thumb" style="aspect-ratio:' + cover.width + "/" + cover.height + '">' + tileThumbHtml(cover) + "</span>" : "") +
      '<span class="ad-hint">' + (cover ? L("La photo n° " + (cover.position + 1) + " ouvre la galerie, en grand. ", "Photo no. " + (cover.position + 1) + " opens the gallery, large. ") : "") +
      L("Pour en choisir une autre, cliquez sur l'étoile ★ d'une photo ci-dessous.", "To pick another one, click the ★ star on a photo below.") +
      (data.photos.length && !cover ? L(" Sans choix, la première photo sera utilisée.", " If you don't choose, the first photo is used.") : "") + "</span></div>" +
      '<div data-header-panel="video"' + (mode === "video" ? "" : " hidden") + ">" +
      '<label class="ad-field"><span>' + L("Lien de la vidéo <em>(YouTube ou Vimeo)</em>", "Video link <em>(YouTube or Vimeo)</em>") + '</span><input name="headerVideo" inputmode="url" placeholder="' + L("https://vimeo.com/… ou https://youtu.be/…", "https://vimeo.com/… or https://youtu.be/…") + '" value="' + esc(p.headerVideo) + '" /></label>' +
      '<p class="ad-hint">' + L("Le film du mariage, la bande-annonce de la séance… en tête de galerie. Une vidéo non répertoriée fonctionne aussi.", "The wedding film, the session trailer… at the top of the gallery. An unlisted video works too.") + "</p></div>" +
      "</div>" +
      '<div class="ad-sc-actions"><button type="submit" class="ad-btn ad-btn-primary">' + L("Enregistrer le texte et l'en-tête", "Save the text and header") + "</button></div>" +
      "</form>" +
      '<div class="ad-style-header ad-language">' +
      '<span class="ad-style-header-title">' + L("Langue pour votre client", "Language for your client") + "</span>" +
      '<div class="ad-seg" role="group" aria-label="' + L("Langue pour votre client", "Language for your client") + '">' +
      '<button type="button" class="ad-seg-btn" data-language="fr" aria-pressed="' + (p.language !== "en") + '">Français</button>' +
      '<button type="button" class="ad-seg-btn" data-language="en" aria-pressed="' + (p.language === "en") + '">English</button></div>' +
      '<p class="ad-hint">' + L("La page de la galerie, les e-mails que reçoit votre client (relances, livraison, commandes de tirages), la boutique et ses factures. Votre texte d'accompagnement s'affiche tel que vous l'écrivez.",
        "The gallery page, the emails your client receives (reminders, delivery, print orders), the shop and its invoices. Your welcome text shows exactly as you write it.") + "</p>" +
      "</div></section>";
  }

  // Branche la section « Style de la galerie » d'une galerie ouverte.
  function bindPresentation(slug, data) {
    var p = data.gallery.presentation || {};
    var path = "/galleries/" + encodeURIComponent(slug) + "/presentation";
    var save = async function (fields, message) {
      try {
        await api("POST", path, fields);
        if (message) toast(message);
        return true;
      } catch (err) {
        toast(err.message, true);
        return false;
      }
    };
    loadPreviewFonts();
    var cards = document.getElementById("ad-style-cards");
    var form = document.getElementById("ad-presentation-form");
    var titleSelect = document.getElementById("ad-title-font");
    var bodySelect = document.getElementById("ad-body-font");
    var hidePreview = bindStylePreview(cards, function () {
      return {
        studio: (state.me && state.me.studioName) || "", title: data.gallery.title, client: data.gallery.client_name,
        intro: form.elements.intro.value.trim(), photos: data.photos, titleFont: titleSelect.value, bodyFont: bodySelect.value,
      };
    });
    cards.addEventListener("click", async function (e) {
      var card = e.target.closest(".ad-style-card");
      if (!card || card.classList.contains("ad-style-card-active")) return;
      hidePreview();
      var theme = card.getAttribute("data-style");
      if (await save({ theme: theme }, L("Style « " + galleryStyleOf(theme).label + " » appliqué.", "“" + galleryStyleOf(theme).label + "” style applied."))) renderDetail(slug, true);
    });
    var syncSample = function () {
      var sample = document.getElementById("ad-style-sample");
      var fresh = document.createElement("div");
      fresh.innerHTML = "<p" + styleVarsAttr(galleryStyleOf(p.theme), titleSelect.value, bodySelect.value) + "></p>";
      sample.setAttribute("style", fresh.firstChild.getAttribute("style"));
      sample.toggleAttribute("data-script", fresh.firstChild.hasAttribute("data-script"));
    };
    titleSelect.addEventListener("change", function () { syncSample(); save({ titleFont: titleSelect.value }, L("Police des titres enregistrée.", "Heading font saved.")); });
    bodySelect.addEventListener("change", function () { syncSample(); save({ bodyFont: bodySelect.value }, L("Police du texte enregistrée.", "Text font saved.")); });
    form.elements.intro.addEventListener("input", function () {
      document.querySelector("#ad-style-sample .ad-style-sample-body").textContent = form.elements.intro.value.trim() || L("Merci pour ces beaux moments partagés : voici vos photos.", "Thank you for these lovely moments together: here are your photos.");
    });
    var mode = form.querySelector('[data-header-mode][aria-pressed="true"]').getAttribute("data-header-mode");
    form.querySelectorAll("[data-header-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        mode = btn.getAttribute("data-header-mode");
        form.querySelectorAll("[data-header-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        form.querySelectorAll("[data-header-panel]").forEach(function (panel) { panel.hidden = panel.getAttribute("data-header-panel") !== mode; });
        if (mode === "video") form.elements.headerVideo.focus();
      });
    });
    document.querySelectorAll("#ad-style-section [data-language]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (btn.getAttribute("aria-pressed") === "true") return;
        var language = btn.getAttribute("data-language");
        if (await save({ language: language }, language === "en" ? L("Galerie en anglais pour votre client.", "Gallery in English for your client.") : L("Galerie en français pour votre client.", "Gallery in French for your client."))) {
          document.querySelectorAll("#ad-style-section [data-language]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
          p.language = language;
        }
      });
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fields = { intro: form.elements.intro.value };
      if (mode === "none") { fields.coverPhotoId = ""; fields.headerVideo = ""; }
      if (mode === "cover") {
        fields.headerVideo = "";
        if (!p.coverPhotoId && data.photos.length) fields.coverPhotoId = data.photos[0].id;
      }
      if (mode === "video") {
        if (!form.elements.headerVideo.value.trim()) { toast(L("Collez le lien de la vidéo (YouTube ou Vimeo).", "Paste the video link (YouTube or Vimeo)."), true); return; }
        fields.headerVideo = form.elements.headerVideo.value;
      }
      if (await save(fields, L("Texte et en-tête enregistrés.", "Text and header saved."))) renderDetail(slug, true);
    });
  }

  function layoutOptionsHtml(gallery) {
    var active = gallery.layout || "grille";
    return LAYOUT_OPTIONS.map(function (opt) {
      var isActive = opt.value === active;
      return (
        '<button type="button" class="ad-layout-option' + (isActive ? " ad-layout-option-active" : "") + '" ' +
        'data-layout="' + esc(opt.value) + '">' +
        '<span class="ad-layout-name">' + esc(opt.label) + "</span>" +
        '<span class="ad-layout-hint">' + esc(opt.hint) + "</span>" +
        "</button>"
      );
    }).join("");
  }

  /* ---------- Galerie de démonstration (créée à l'inscription) ---------- */
  // Un guide en tête de la fiche : l'ouvrir comme un client, tenter une
  // capture, lire la sélection de la cliente simulée. Les photos arrivent
  // en arrière-plan juste après l'inscription : on suit leur arrivée.

  var demoPoll = null;

  function demoGuideHtml(data) {
    var g = data.gallery;
    var expected = data.demoExpected || 0;
    var ready = data.photos.length;
    var preparing = expected > 0 && ready < expected;
    var selected = data.photos.filter(isSelected).length;
    var openable = /^https?:/.test(data.link || "");
    return (
      '<section class="ad-demo" id="ad-demo">' +
      '<div class="ad-demo-head">' +
      '<p class="ad-demo-kicker">' + L("Galerie de démonstration", "Demo gallery") + "</p>" +
      "<h3>" + L("Voici exactement ce que vit votre client.", "This is exactly what your client experiences.") + "</h3>" +
      "<p>" + L("Des photos libres de droits, protégées comme le seront les vôtres : découpées en tuiles, filigranées au nom de votre studio, marquées d'une empreinte invisible. Cette galerie ne compte pas dans votre formule.",
        "Royalty-free photos, protected just like yours will be: cut into tiles, watermarked with your studio's name, marked with an invisible fingerprint. This gallery doesn't count towards your plan.") + "</p>" +
      "</div>" +
      (preparing
        ? '<p class="ad-demo-progress" role="status"><span class="ad-demo-spinner" aria-hidden="true"></span><span>' +
          L("Préparation des photos : ", "Preparing the photos: ") + ready + " / " + expected + "…</span></p>"
        : (expected && !selected && Date.now() / 1000 - (g.created_at || 0) < 300
          ? '<p class="ad-demo-progress" role="status"><span class="ad-demo-spinner" aria-hidden="true"></span><span>' + L("La famille Martin fait sa sélection…", "The Martins are making their selection…") + "</span></p>"
          : "")) +
      '<ol class="ad-demo-steps">' +
      "<li><strong>" + L("Ouvrez-la comme votre client", "Open it as your client") + "</strong>" +
      "<span>" + L("Le lien et le mot de passe, tels que vous les enverrez :", "The link and password, just as you'll send them:") + "</span>" +
      '<div class="ad-demo-access">' +
      '<div class="ad-copy-row"><input type="text" readonly value="' + esc(data.link) + '" id="ad-demo-link" aria-label="' + L("Lien", "Link") + '" />' +
      (openable ? '<a class="ad-btn ad-btn-primary" href="' + esc(data.link) + '" target="_blank" rel="noopener">' + L("Ouvrir", "Open") + "</a>" : '<button type="button" class="ad-btn" data-copy="ad-demo-link">' + L("Copier", "Copy") + "</button>") +
      "</div>" +
      (g.demo_password
        ? '<div class="ad-copy-row"><input type="text" readonly value="' + esc(g.demo_password) + '" id="ad-demo-password" aria-label="' + L("Mot de passe", "Password") + '" />' +
          '<button type="button" class="ad-btn" data-copy="ad-demo-password">' + L("Copier le mot de passe", "Copy password") + "</button></div>"
        : "") +
      "</div></li>" +
      "<li><strong>" + L("Essayez de la copier", "Try to copy it") + "</strong>" +
      "<span>" + L("Dans la galerie, appuyez sur Impr. écran (⌘ Maj 4 sur Mac) : l'image se voile et l'alerte arrive dans votre boîte e-mail. Le clic droit, lui, n'offre rien à enregistrer.",
        "In the gallery, press Print Screen (⌘ Shift 4 on a Mac): the image is veiled and the alert lands in your inbox. Right-click offers nothing to save.") + "</span></li>" +
      "<li><strong>" + L("Lisez la sélection de la famille Martin", "Read the Martins' selection") + "</strong>" +
      "<span>" + (selected
        ? L(selected + " coups de cœur pour un forfait de " + (g.included_photos || 0) + " photos : " + (g.due_extra_count || 0) + " suppléments, " + formatEuros(g.due_total_cents || 0) + ", à régler en ligne. Son commentaire et ses codes couleur sont sur les photos, plus bas.",
            selected + " favourites for a " + (g.included_photos || 0) + "-photo package: " + (g.due_extra_count || 0) + " extras, " + formatEuros(g.due_total_cents || 0) + ", to be paid online. Their note and colour codes are on the photos below.")
        : L("Dès que les photos sont prêtes, la famille fait sa sélection : coups de cœur, commentaire, codes couleur.", "As soon as the photos are ready, the family makes their selection: favourites, a note, colour codes.")) +
      "</span></li>" +
      "<li><strong>" + L("Changez le style", "Change the style") + "</strong>" +
      "<span>" + L("Choisissez un autre style ou une autre mise en page plus bas, puis rechargez la galerie client.", "Pick another style or layout below, then reload the client gallery.") + "</span></li>" +
      "</ol>" +
      '<div class="ad-demo-foot">' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-demo-create">' + L("Créer ma première vraie galerie", "Create my first real gallery") + "</button>" +
      '<button type="button" class="ad-link-btn" id="ad-demo-delete">' + L("Supprimer la démo", "Delete the demo") + "</button>" +
      "</div>" +
      "</section>"
    );
  }

  function wireDemoGuide(slug, data) {
    if (demoPoll) { clearTimeout(demoPoll); demoPoll = null; }
    if (!data.gallery.demo) return;
    document.getElementById("ad-demo-create").addEventListener("click", openCreateModal);
    document.getElementById("ad-demo-delete").addEventListener("click", function () {
      confirmAction(L("Supprimer la galerie de démonstration ? Vous pourrez en recréer une depuis l'onglet Galeries tant que vous n'en avez aucune.",
        "Delete the demo gallery? You can create a new one from the Galleries tab while you have no galleries."), async function () {
        try {
          await api("DELETE", "/galleries/" + encodeURIComponent(slug));
          toast(L("Démo supprimée.", "Demo deleted."));
          renderList();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    // Photos encore en route (juste après l'inscription) : on suit leur
    // arrivée sur la ligne de progression seulement, puis on recharge la
    // fiche une seule fois, quand la famille a fait sa sélection — jamais
    // pendant que le photographe remplit un champ.
    var expected = data.demoExpected || 0;
    var startedAt = (data.gallery.created_at || 0) * 1000;
    var settled = function (d) { return d.photos.length >= expected && d.photos.some(isSelected); };
    if (!expected || settled(data) || Date.now() - startedAt > 5 * 60 * 1000) return;
    var hash = location.hash;
    var tick = async function () {
      demoPoll = null;
      if (location.hash !== hash) return;
      var fresh;
      try {
        fresh = await api("GET", "/galleries/" + encodeURIComponent(slug));
      } catch (err) {
        fresh = null;
      }
      if (location.hash !== hash) return;
      var done = fresh && (settled(fresh) || Date.now() - startedAt > 5 * 60 * 1000);
      var typing = document.activeElement && el.view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (done && !typing) return renderDetail(slug, true, { keepScroll: true });
      var line = document.querySelector("#ad-demo .ad-demo-progress");
      if (line && fresh) {
        line.lastChild.textContent = fresh.photos.length < expected
          ? L("Préparation des photos : ", "Preparing the photos: ") + fresh.photos.length + " / " + expected + "…"
          : L("La famille Martin fait sa sélection…", "The Martins are making their selection…");
      }
      demoPoll = setTimeout(tick, 3000);
    };
    demoPoll = setTimeout(tick, 3000);
  }

  async function renderDetail(slug, skipHash, options) {
    var hash = "#/g/" + encodeURIComponent(slug);
    if (!skipHash && location.hash !== hash) history.pushState(null, "", hash);
    setActiveTab("galleries");
    // Rechargement discret (suivi de la démo) : ni écran d'attente, ni saut.
    var keepScroll = options && options.keepScroll ? window.scrollY : null;
    if (keepScroll === null) el.view.innerHTML = '<p class="ad-loading">' + L("Chargement…", "Loading…") + "</p>";
    var data;
    try {
      data = await api("GET", "/galleries/" + encodeURIComponent(slug));
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }
    state.current = data;

    var photosById = {};
    data.photos.forEach(function (p) {
      photosById[p.id] = p;
    });

    var status = galleryStatus(data.gallery);
    el.view.innerHTML =
      '<button type="button" class="ad-back" id="ad-back">' + L("&larr; Toutes les galeries", "&larr; All galleries") + "</button>" +
      '<header class="ad-detail-header">' +
      "<div>" +
      "<h2>" + esc(data.gallery.title) + "</h2>" +
      '<p class="ad-card-sub">' + (data.gallery.client_name ? clLink(data.gallery.client_name, data.gallery.client_email) + " · " : "") + esc(data.gallery.slug) + "</p>" +
      (data.gallery.selection_done_at
        ? '<p class="ad-validated" id="ad-selection-validated">' + L("✓ Sélection validée par le client le ", "✓ Selection confirmed by the client on ") + formatDateTime(data.gallery.selection_done_at) + "</p>"
        : '<p class="ad-hint" id="ad-selection-pending">' + L("Sélection pas encore validée par le client", "Selection not yet confirmed by the client") +
          (data.gallery.expires_at
            ? L(" — relances automatiques à J-7 et J-2 de l'expiration", " — automatic reminders 7 and 2 days before expiry") +
              (data.gallery.client_email ? "" : L(" (aucun e-mail client renseigné : seule la relance qui vous est destinée à J-2 partira)", " (no client email on file: only your own reminder 2 days before will go out)"))
            : L(" — sans date d'expiration, aucune relance automatique ne part", " — with no expiry date, no automatic reminder goes out")) +
          ".</p>") +
      "</div>" +
      (status.label ? '<span class="ad-badge ' + status.cls + '">' + esc(status.label) + "</span>" : "") +
      "</header>" +
      (data.gallery.demo ? demoGuideHtml(data) : "") +
      '<section class="ad-share">' +
      '<label class="ad-field"><span>' + L("Lien", "Link") + '</span><div class="ad-copy-row">' +
      '<input type="text" readonly value="' + esc(data.link) + '" id="ad-detail-link" />' +
      '<button type="button" class="ad-btn" data-copy="ad-detail-link">' + L("Copier", "Copy") + "</button>" +
      "</div></label>" +
      '<p class="ad-hint">' + (data.gallery.demo && data.gallery.demo_password
        ? L("Le mot de passe de cette démo est affiché plus haut. ", "This demo's password is shown above. ")
        : L("Le mot de passe n'est plus récupérable ici : il n'a été affiché qu'à la création. ", "The password can't be retrieved here: it was only shown when the gallery was created. ")) +
      '<button type="button" class="ad-link-btn" id="ad-new-password">' + L("Générer un nouveau mot de passe", "Generate a new password") + "</button></p>" +
      "</section>" +
      '<section class="ad-quota">' +
      '<div class="ad-section-header"><h3>' + L("Forfait et suppléments", "Package and extras") + "</h3></div>" +
      '<p class="ad-hint">' + L("Le nombre de photos déjà payées par le client, et le prix de chaque photo au-delà. Calculé automatiquement à partir de ses coups de cœur — réglable en ligne par le client une fois votre compte Stripe actif (écran Facturation).",
        "The number of photos the client has already paid for, and the price of each photo beyond that. Worked out automatically from their favourites — payable online by the client once your Stripe account is active (Billing screen).") +
      (data.gallery.extras_online === false ? L(" Le paiement en ligne des suppléments est inclus à partir de la formule Essentiel : d'ici là, le montant dû s'affiche et se règle directement avec vous.",
        " Online payment for extras comes with the Essentials plan: until then, the amount due is shown and settled directly with you.") : "") + "</p>" +
      '<form class="ad-field-row" id="ad-quota-form">' +
      '<label class="ad-field"><span>' + L("Photos incluses", "Photos included") + "</span>" +
      '<input type="number" name="includedPhotos" min="0" step="1" placeholder="' + L("aucun forfait", "no package") + '" value="' +
      (data.gallery.included_photos === null || data.gallery.included_photos === undefined ? "" : data.gallery.included_photos) + '" /></label>' +
      '<label class="ad-field"><span>' + L("Prix du supplément (par photo, en €)", "Extra photo price (per photo, in €)") + "</span>" +
      '<input type="number" name="extraPhotoPrice" min="0" step="0.01" value="' +
      ((data.gallery.extra_photo_price_cents || 0) / 100) + '" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-quota-save">' + L("Enregistrer", "Save") + "</button>" +
      "</form>" +
      '<div id="ad-quota-summary">' + quotaSummaryHtml(data.gallery) + "</div>" +
      (data.payments && data.payments.length
        ? '<h4 class="ad-payments-heading">' + L("Historique des paiements", "Payment history") + "</h4>" + paymentsHistoryHtml(data.payments)
        : "") +
      "</section>" +
      '<section class="ad-background">' +
      '<div class="ad-section-header"><h3>' + L("Arrière-plan de l'écran de connexion client", "Client sign-in screen background") + "</h3></div>" +
      '<p class="ad-hint">' + L("Ce que voit le client avant même d'entrer son mot de passe. Jamais une de ses photos — uniquement une couleur ou une image que vous importez vous-même.",
        "What your client sees before even entering their password. Never one of their photos — only a colour or an image you upload yourself.") + "</p>" +
      '<div class="ad-bg-swatches" id="ad-bg-swatches">' + backgroundSwatchesHtml(data.gallery) + "</div>" +
      '<div class="ad-bg-custom">' +
      '<label class="ad-bg-color-label">' + L("Couleur personnalisée", "Custom colour") + '<input type="color" id="ad-bg-color-picker" value="' +
      esc(data.gallery.login_background_color || "#f7f2ec") + '" /></label>' +
      '<label class="ad-btn">' + L("Importer une image", "Upload an image") + '<input type="file" id="ad-bg-file-input" accept="image/*" hidden /></label>' +
      "</div>" +
      (data.gallery.login_background_type === "image"
        ? '<img class="ad-bg-preview" alt="' + L("Arrière-plan actuel", "Current background") + '" src="' +
          esc(state.config.api) + "/api/gallery/" + esc(data.gallery.slug) + "/background-image?t=" + Date.now() + '" />'
        : "") +
      "</section>" +
      presentationSectionHtml(data) +
      '<section class="ad-layout">' +
      '<div class="ad-section-header"><h3>' + L("Mise en page de la galerie", "Gallery layout") + "</h3></div>" +
      '<p class="ad-hint">' + L("Comment les photos s'affichent chez le client — à choisir selon le type de séance.", "How the photos are shown to your client — choose it by type of session.") + "</p>" +
      '<div class="ad-layout-options" id="ad-layout-options">' + layoutOptionsHtml(data.gallery) + "</div>" +
      "</section>" +
      musicSectionHtml(data.gallery) +
      deliverySectionHtml(data.gallery) +
      gallerySectionShopHtml(data) +
      '<section class="ad-dropzone" id="ad-dropzone">' +
      "<p>" + L("<strong>Glissez vos photos ici</strong>, ou", "<strong>Drag your photos here</strong>, or") + "</p>" +
      '<label class="ad-btn ad-btn-primary">' + L("Choisir des fichiers", "Choose files") + '<input type="file" id="ad-file-input" accept="image/*" multiple hidden /></label>' +
      '<div id="ad-upload-queue" class="ad-upload-queue"></div>' +
      "</section>" +
      '<section><div class="ad-section-header">' +
      '<h3 id="ad-photos-heading">Photos (' + data.photos.length + ")</h3>" +
      '<div class="ad-photos-actions">' +
      (data.photos.some(isSelected)
        ? '<label class="ad-photos-filter"><input type="checkbox" id="ad-filter-selected" />' +
          "<span>" + L("Afficher uniquement la sélection du client (", "Show only the client's selection (") + data.photos.filter(isSelected).length + ")</span></label>"
        : "") +
      (data.photos.some(isSelected)
        ? '<button type="button" class="ad-btn" id="ad-copy-lightroom" title="' + L("Noms de fichiers de la sélection, à coller dans le filtre de bibliothèque de Lightroom", "File names of the selection, to paste into Lightroom's library filter") + '">' + L("Copier pour Lightroom", "Copy for Lightroom") + "</button>"
        : "") +
      (data.photos.some(hasClientNotes)
        ? '<button type="button" class="ad-btn" id="ad-copy-notes">' + L("Copier les notes du client", "Copy the client's notes") + "</button>"
        : "") +
      "</div>" +
      "</div>" +
      tagLegendHtml(data.photos) +
      '<div class="ad-photos" id="ad-photos">' + data.photos.map(photoThumb).join("") + "</div>" +
      "</section>" +
      "<section><h3>" + L("Journal d'accès", "Access log") + "</h3>" +
      (data.log.length
        ? '<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>' + L("Quand", "When") + "</th><th>" + L("Évènement", "Event") + "</th><th>" + L("Détail", "Detail") + "</th></tr></thead><tbody>" +
          data.log.map(function (entry) { return logRow(entry, photosById); }).join("") + "</tbody></table></div>"
        : '<p class="ad-hint">' + L("Aucun accès enregistré pour l'instant.", "No access recorded yet.") + "</p>") +
      "</section>" +
      '<section class="ad-danger"><h3>' + L("Zone sensible", "Danger zone") + "</h3>" +
      '<button type="button" class="ad-btn ad-btn-danger" id="ad-delete-gallery">' + L("Supprimer cette galerie", "Delete this gallery") + "</button>" +
      '<p class="ad-hint">' + L("Supprime la galerie, ses photos et son journal — sans confirmation possible ensuite.", "Deletes the gallery, its photos and its log — this can't be undone.") + "</p>" +
      "</section>";

    document.getElementById("ad-back").addEventListener("click", function () {
      renderList();
    });
    var filterSelected = document.getElementById("ad-filter-selected");
    if (filterSelected) {
      filterSelected.addEventListener("change", function () {
        document.getElementById("ad-photos").classList.toggle("ad-photos-filtered", filterSelected.checked);
      });
    }
    var copyLightroomBtn = document.getElementById("ad-copy-lightroom");
    if (copyLightroomBtn) {
      copyLightroomBtn.addEventListener("click", function () {
        var chosen = data.photos.filter(isSelected);
        var names = lightroomNames(chosen);
        var missing = chosen.length - names.length;
        if (!names.length) {
          toast(L("Ces photos ont été envoyées avant que Holypixx garde le nom des fichiers : renvoyez-les pour pouvoir copier leurs noms.",
            "These photos were uploaded before Holypixx kept file names: upload them again to copy their names."), true);
          return;
        }
        navigator.clipboard.writeText(names.join(", ")).then(function () {
          toast(L(names.length + " nom" + (names.length > 1 ? "s" : "") + " copié" + (names.length > 1 ? "s" : "") +
            " : dans Lightroom, Bibliothèque › Texte › Nom de fichier › Contient, puis collez." +
            (missing ? " (" + missing + " photo" + (missing > 1 ? "s" : "") + " sans nom de fichier, envoyée" + (missing > 1 ? "s" : "") + " plus tôt.)" : ""),
            names.length + " name" + (names.length === 1 ? "" : "s") + " copied: in Lightroom, Library › Text › Filename › Contains, then paste." +
            (missing ? " (" + missing + " photo" + (missing === 1 ? "" : "s") + " without a file name, uploaded earlier.)" : "")));
        }).catch(function () {
          toast(L("Impossible de copier les noms de fichiers.", "Couldn't copy the file names."), true);
        });
      });
    }
    var copyNotesBtn = document.getElementById("ad-copy-notes");
    if (copyNotesBtn) {
      copyNotesBtn.addEventListener("click", function () {
        var selectedCount = data.photos.filter(isSelected).length;
        var noted = data.photos.filter(hasClientNotes);
        var lines = noted.map(function (p) {
          var line = L("Photo n° ", "Photo no. ") + (p.position + 1) + (p.source_name ? " · " + p.source_name : "") + (isSelected(p) ? L(" (sélectionnée)", " (selected)") : "");
          if (p.tag && tagLabel(p.tag)) line += " [" + tagLabel(p.tag) + "]";
          if (hasComment(p)) line += L(" — « " + p.comment.trim() + " »", " — “" + p.comment.trim() + "”");
          marksOf(p).forEach(function (m, i) {
            line += "\n    " + L("Repère ", "Marker ") + (i + 1) + " (" + Math.round(Number(m.x) * 100) + L(" % / ", "% / ") + Math.round(Number(m.y) * 100) + L(" %)", "%)") + (m.note ? L(" : ", ": ") + m.note : "");
          });
          return line;
        });
        var text =
          L("Notes du client — ", "Client notes — ") + data.gallery.title + " (" + data.gallery.slug + ")\n" +
          L(selectedCount + " photo(s) sur " + data.photos.length + " sélectionnée(s)", selectedCount + " of " + data.photos.length + " photo(s) selected") + "\n\n" +
          lines.join("\n");
        navigator.clipboard.writeText(text).then(function () {
          toast(L("Notes copiées (", "Notes copied (") + noted.length + (noted.length === 1 ? " photo)." : " photos)."));
        }).catch(function () {
          toast(L("Impossible de copier les notes.", "Couldn't copy the notes."), true);
        });
      });
    }
    document.getElementById("ad-delete-gallery").addEventListener("click", function () {
      confirmAction(L("Supprimer définitivement « " + data.gallery.title + " » et ses " + data.photos.length + " photo(s) ?",
        "Permanently delete “" + data.gallery.title + "” and its " + data.photos.length + " photo(s)?"), async function () {
        try {
          await api("DELETE", "/galleries/" + encodeURIComponent(slug));
          toast(L("Galerie supprimée.", "Gallery deleted."));
          renderList();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    document.getElementById("ad-bg-swatches").addEventListener("click", async function (event) {
      var btn = event.target.closest(".ad-bg-swatch");
      if (!btn) return;
      var color = btn.getAttribute("data-color");
      try {
        if (color) await api("POST", "/galleries/" + encodeURIComponent(slug) + "/background/color", { color: color });
        else await api("DELETE", "/galleries/" + encodeURIComponent(slug) + "/background");
        toast(L("Arrière-plan mis à jour.", "Background updated."));
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
      }
    });
    document.getElementById("ad-bg-color-picker").addEventListener("change", async function (event) {
      try {
        await api("POST", "/galleries/" + encodeURIComponent(slug) + "/background/color", { color: event.target.value });
        toast(L("Arrière-plan mis à jour.", "Background updated."));
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
      }
    });
    document.getElementById("ad-bg-file-input").addEventListener("change", async function (event) {
      var file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      var form = new FormData();
      form.append("file", file, file.name);
      try {
        var response = await fetch("/local/galleries/" + encodeURIComponent(slug) + "/background/image", {
          method: "POST",
          body: form,
        });
        var result = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(serverText(result.error) || L("Échec de l'envoi", "Upload failed"));
        toast(L("Arrière-plan mis à jour.", "Background updated."));
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
      }
    });
    document.getElementById("ad-quota-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var saveBtn = document.getElementById("ad-quota-save");
      saveBtn.disabled = true;
      try {
        await api("POST", "/galleries/" + encodeURIComponent(slug) + "/quota", {
          includedPhotos: form.includedPhotos.value.trim() || undefined,
          extraPhotoPrice: form.extraPhotoPrice.value.trim() || undefined,
        });
        toast(L("Forfait mis à jour.", "Package updated."));
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
      } finally {
        saveBtn.disabled = false;
      }
    });
    bindPresentation(slug, data);
    document.getElementById("ad-layout-options").addEventListener("click", async function (event) {
      var btn = event.target.closest(".ad-layout-option");
      if (!btn || btn.classList.contains("ad-layout-option-active")) return;
      var layout = btn.getAttribute("data-layout");
      try {
        await api("POST", "/galleries/" + encodeURIComponent(slug) + "/layout", { layout: layout });
        toast(L("Mise en page mise à jour.", "Layout updated."));
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
      }
    });
    document.getElementById("ad-music-file-input").addEventListener("change", async function (event) {
      var file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      var stateBox = document.getElementById("ad-music-state");
      stateBox.textContent = L("Envoi de « " + file.name + " »…", "Uploading “" + file.name + "”…");
      var form = new FormData();
      form.append("file", file, file.name);
      try {
        var response = await fetch("/local/galleries/" + encodeURIComponent(slug) + "/music", {
          method: "POST",
          body: form,
        });
        var result = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(serverText(result.error) || L("Échec de l'envoi", "Upload failed"));
        toast(L("Musique enregistrée.", "Music saved."));
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
        renderDetail(slug, true);
      }
    });
    wireMusicSection(slug, data.gallery);
    wireDeliverySection(slug);
    wirePromoBlock(slug);
    var shopToggle = document.getElementById("ad-gallery-shop-toggle");
    if (shopToggle) {
      shopToggle.addEventListener("change", async function () {
        try {
          await api("POST", "/galleries/" + encodeURIComponent(slug) + "/shop", { enabled: shopToggle.checked });
          toast(shopToggle.checked ? L("Boutique de tirages ouverte sur cette galerie.", "Print shop open on this gallery.") : L("Boutique de tirages fermée sur cette galerie.", "Print shop closed on this gallery."));
          renderDetail(slug, true);
        } catch (err) {
          shopToggle.checked = !shopToggle.checked;
          toast(err.message, true);
        }
      });
    }
    wireOrderResubmit(function () { renderDetail(slug, true); });
    var gotoShop = document.getElementById("ad-goto-shop");
    if (gotoShop) gotoShop.addEventListener("click", function () { renderShop(); });
    var musicRemove = document.getElementById("ad-music-remove");
    if (musicRemove) {
      musicRemove.addEventListener("click", function () {
        confirmAction(L("Retirer la musique de cette galerie ?", "Remove the music from this gallery?"), async function () {
          try {
            await api("DELETE", "/galleries/" + encodeURIComponent(slug) + "/music");
            toast(L("Musique retirée.", "Music removed."));
            renderDetail(slug, true);
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    }
    document.getElementById("ad-new-password").addEventListener("click", function () {
      confirmAction(L("Générer un nouveau mot de passe ? L'ancien cessera aussitôt de fonctionner.", "Generate a new password? The old one stops working immediately."), async function () {
        try {
          var result = await api("POST", "/galleries/" + encodeURIComponent(slug) + "/password");
          document.getElementById("ad-password-value").value = result.password;
          openModal("ad-password-modal");
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    wireUploads(slug, data.photos.length);
    wirePhotoRemoval(slug, data.photos);
    wireDemoGuide(slug, data);
    if (keepScroll !== null) window.scrollTo(0, keepScroll);
  }

  function wirePhotoRemoval(slug, photos) {
    document.getElementById("ad-photos").addEventListener("click", function (event) {
      var frame = event.target.closest(".ad-photo-frame");
      if (frame) {
        var id = frame.closest(".ad-photo").getAttribute("data-photo-id");
        var photo = photos.find(function (p) { return p.id === id; });
        if (photo) openPhotoModal(photo);
        return;
      }
      var star = event.target.closest(".ad-photo-cover");
      if (star) {
        var coverId = star.closest(".ad-photo").getAttribute("data-photo-id");
        if (star.classList.contains("ad-photo-cover-on")) return;
        api("POST", "/galleries/" + encodeURIComponent(slug) + "/presentation", { coverPhotoId: coverId })
          .then(function () {
            var presentation = state.current.gallery.presentation || {};
            toast(presentation.headerVideo
              ? L("Photo de couverture choisie. La vidéo reste en tête tant qu'elle est renseignée (en-tête « Photo de couverture » pour l'afficher).", "Cover photo chosen. The video stays at the top as long as it is set (choose the “Cover photo” header to show the photo).")
              : L("Photo de couverture choisie : elle ouvre la galerie.", "Cover photo chosen: it now opens the gallery."));
            renderDetail(slug, true);
          })
          .catch(function (err) { toast(err.message, true); });
        return;
      }
      var btn = event.target.closest(".ad-photo-remove");
      if (!btn) return;
      var card = btn.closest(".ad-photo");
      var photoId = card.getAttribute("data-photo-id");
      confirmAction(L("Supprimer cette photo de la galerie ?", "Remove this photo from the gallery?"), async function () {
        try {
          await api("DELETE", "/galleries/" + encodeURIComponent(slug) + "/photos/" + encodeURIComponent(photoId));
          card.remove();
          toast(L("Photo supprimée.", "Photo removed."));
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  /* ---------- Envoi de photos ---------- */

  function wireUploads(slug, startPosition) {
    var dropzone = document.getElementById("ad-dropzone");
    var fileInput = document.getElementById("ad-file-input");
    var nextPosition = startPosition;

    function handleFiles(fileList) {
      var files = Array.from(fileList).filter(function (f) {
        return f.type.indexOf("image/") === 0;
      });
      if (files.length === 0) return;
      queueUploads(slug, files, nextPosition);
      nextPosition += files.length;
    }

    fileInput.addEventListener("change", function () {
      handleFiles(fileInput.files);
      fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach(function (type) {
      dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        dropzone.classList.add("ad-dropzone-active");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        dropzone.classList.remove("ad-dropzone-active");
      });
    });
    dropzone.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
  }

  function queueUploads(slug, files, startPosition) {
    var queue = document.getElementById("ad-upload-queue");
    var photosSection = document.getElementById("ad-photos");
    var items = files.map(function (file, index) {
      var row = document.createElement("div");
      row.className = "ad-upload-item";
      row.innerHTML =
        '<span class="ad-upload-name">' + esc(file.name) + "</span>" +
        '<div class="ad-upload-bar"><div class="ad-upload-fill"></div></div>' +
        '<span class="ad-upload-state">' + L("en attente", "waiting") + '</span>';
      queue.appendChild(row);
      return { file: file, row: row, position: startPosition + index };
    });

    var fill = function (row, ratio, label) {
      row.querySelector(".ad-upload-fill").style.width = Math.round(ratio * 100) + "%";
      row.querySelector(".ad-upload-state").textContent = label;
    };

    var cursor = 0;
    var succeeded = 0;
    var failed = 0;

    function next() {
      if (cursor >= items.length) return Promise.resolve();
      var item = items[cursor++];
      fill(item.row, 0, L("envoi…", "uploading…"));
      return uploadPhoto(slug, item.file, item.position, function (ratio) {
        fill(item.row, ratio * 0.5, ratio < 1 ? L("envoi…", "uploading…") : L("traitement…", "processing…"));
      })
        .then(function (result) {
          fill(item.row, 1, L("terminé", "done"));
          item.row.classList.add("ad-upload-done");
          succeeded++;
          if (photosSection) photosSection.insertAdjacentHTML("beforeend", photoThumb(result.photo));
          setTimeout(function () {
            item.row.remove();
          }, 2500);
        })
        .catch(function (err) {
          fill(item.row, 1, L("échec", "failed"));
          item.row.classList.add("ad-upload-failed");
          item.row.title = err.message;
          failed++;
        })
        .then(next);
    }

    var workers = [];
    for (var i = 0; i < UPLOAD_CONCURRENCY; i++) workers.push(next());
    Promise.all(workers).then(function () {
      if (failed === 0) toast(L(succeeded + " photo(s) envoyée(s).", succeeded + (succeeded === 1 ? " photo uploaded." : " photos uploaded.")));
      else toast(L(succeeded + " envoyée(s), " + failed + " en échec — survolez la ligne pour le détail.", succeeded + " uploaded, " + failed + " failed — hover the row for details."), failed > 0);
      var photos = document.querySelectorAll("#ad-photos .ad-photo").length;
      var heading = document.getElementById("ad-photos-heading");
      if (heading) heading.textContent = "Photos (" + photos + ")";
    });
  }

  document.getElementById("ad-check-photo").addEventListener("click", function () {
    renderDetect();
  });

  /* ---------- Création de galerie ---------- */
  // Le bouton « + Nouvelle galerie » lui-même est rendu dans renderList
  // (onglet Galeries) — ce formulaire reste partagé par toute l'appli.

  document.getElementById("ad-create-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var errorBox = document.getElementById("ad-create-error");
    var submitBtn = document.getElementById("ad-create-submit");
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = L("Création…", "Creating…");

    var payload = {
      title: form.title.value.trim(),
      clientName: form.clientName.value.trim(),
      clientEmail: form.clientEmail.value.trim(),
      slug: form.slug.value.trim(),
      password: form.password.value.trim(),
      expires: form.expires.value || undefined,
      includedPhotos: form.includedPhotos.value.trim() || undefined,
      extraPhotoPrice: form.extraPhotoPrice.value.trim() || undefined,
      theme: form.theme.value || undefined,
      language: form.language.value === "en" ? "en" : undefined,
    };

    try {
      var created = await api("POST", "/galleries", payload);
      closeModal("ad-create-modal");
      document.getElementById("ad-created-link").value = created.link;
      document.getElementById("ad-created-password").value = created.password;
      document.getElementById("ad-created-hint").hidden = created.link.indexOf("http") === 0;
      openModal("ad-created-modal");
      renderDetail(created.slug || payload.slug);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = L("Créer la galerie", "Create gallery");
    }
  });

  /* ---------- Connexion ---------- */

  document.getElementById("ad-show-signup").addEventListener("click", function () {
    showLoginCard("ad-signup-card");
  });
  document.getElementById("ad-show-login").addEventListener("click", function () {
    showLoginCard("ad-login-card");
  });
  document.getElementById("ad-show-forgot").addEventListener("click", function () {
    showLoginCard("ad-forgot-card");
  });
  document.getElementById("ad-forgot-back").addEventListener("click", function () {
    showLoginCard("ad-login-card");
  });

  document.getElementById("ad-signup-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var errorBox = document.getElementById("ad-signup-error");
    var submitBtn = document.getElementById("ad-signup-submit");
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = L("Création…", "Creating…");

    try {
      var response = await fetch("/local/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.email.value.trim(),
          password: form.password.value,
          studioName: form.studioName.value.trim(),
          firstName: form.firstName.value.trim(),
          lastName: form.lastName.value.trim(),
          acceptTerms: form.acceptTerms.checked,
          referralCode: referralCode(),
          language: LANG,
        }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(serverText(data.error || "Inscription refusée"));
      try { localStorage.removeItem(REFERRAL_KEY); } catch (err) { /* rien à effacer */ }
      form.reset();
      // Premier écran : la galerie de démonstration, guide en tête.
      if (data.demoSlug) history.replaceState(null, "", location.pathname + "#/g/" + encodeURIComponent(data.demoSlug));
      showApp(data.photographer);
      bootstrap();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = L("Créer mon compte", "Create my account");
    }
  });

  document.getElementById("ad-login-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var errorBox = document.getElementById("ad-login-error");
    var submitBtn = document.getElementById("ad-login-submit");
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = L("Connexion…", "Signing in…");

    try {
      var response = await fetch("/local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(serverText(data.error || "Connexion refusée"));
      form.reset();
      showApp(data.photographer);
      bootstrap();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = L("Se connecter", "Sign in");
    }
  });

  document.getElementById("ad-forgot-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var messageBox = document.getElementById("ad-forgot-message");
    var submitBtn = document.getElementById("ad-forgot-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = L("Envoi…", "Sending…");

    try {
      var response = await fetch("/local/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.email.value.trim() }),
      });
      var data = await response.json().catch(function () { return {}; });
      // Toujours le même message, que le compte existe ou non — c'est le
      // Worker qui applique cette règle, l'interface ne fait que la refléter.
      messageBox.textContent = serverText(data.message || "Si un compte existe avec cette adresse, un lien vient d'être envoyé.");
      messageBox.hidden = false;
      form.reset();
    } catch (err) {
      messageBox.textContent = L("Connexion au serveur d'administration perdue.", "Lost connection to the admin server.");
      messageBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = L("Recevoir un lien", "Send me a link");
    }
  });

  var resetToken = new URLSearchParams(location.search).get("reset");

  document.getElementById("ad-reset-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var errorBox = document.getElementById("ad-reset-error");
    var submitBtn = document.getElementById("ad-reset-submit");
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = L("Validation…", "Saving…");

    try {
      var response = await fetch("/local/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: form.password.value }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(serverText(data.error || "Réinitialisation refusée"));
      form.reset();
      // Le lien ne doit plus jamais réapparaître dans l'URL (partagée,
      // mise en favori, historique du navigateur…) une fois utilisé.
      history.replaceState(null, "", location.pathname + location.hash);
      showApp(data.photographer);
      bootstrap();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = L("Valider le nouveau mot de passe", "Save new password");
    }
  });

  document.getElementById("ad-logout").addEventListener("click", async function () {
    try {
      await fetch("/local/auth/logout", { method: "POST" });
    } catch (err) {
      /* la déconnexion locale (écran de connexion) reste utile même si l'appel échoue */
    }
    showLogin();
  });

  /* ---------- Écoles, crèches et clubs (module photo de groupe) ---------- */

  var YEAR_STATUS = {
    draft: { text: "En préparation", cls: "ad-acc-status-muted" },
    open: { text: "En vente", cls: "ad-acc-status-ok" },
    closed: { text: "Ventes closes", cls: "ad-acc-status-warn" },
    archived: { text: "Archivée", cls: "ad-acc-status-muted" },
  };

  function schoolKindOf(data, kind) {
    return data.kinds[kind] || data.kinds.ecole;
  }

  // Date (epoch) → valeur d'un champ <input type="date"> (heure belge ≈ UTC).
  function dateInputValue(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }

  // Année affichée par défaut : la plus récente.
  function currentYearOf(school) {
    return school.years[0] || null;
  }

  async function renderSchool(skipHash) {
    var groupMatch = /^#\/scolaire\/groupe\/([^/]+)$/.exec(location.hash);
    if (groupMatch) return renderSchoolGroup(decodeURIComponent(groupMatch[1]));
    var match = /^#\/scolaire\/([^/]+)(?:\/([^/]+))?$/.exec(location.hash);
    var schoolId = match ? decodeURIComponent(match[1]) : "";
    var yearId = match && match[2] ? decodeURIComponent(match[2]) : "";
    if (!skipHash && location.hash.indexOf("#/scolaire") !== 0) history.pushState(null, "", "#/scolaire");
    setActiveTab("school");
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
    var data;
    try {
      data = await api("GET", "/school");
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }
    if (!data.access.allowed) return renderSchoolTeaser(data);
    var school = schoolId && data.schools.find(function (s) { return s.id === schoolId; });
    if (school) return renderSchoolDetail(data, school, yearId);
    renderSchoolList(data);
  }

  function renderSchoolTeaser(data) {
    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Écoles, crèches et clubs</h2>' +
      '<p class="ad-hint">Vendez vos photos de groupe : établissements, classes ou équipes, fiches parents avec QR, espace famille et commande groupée.</p></div></header>' +
      '<section class="ad-sc-teaser">' +
      "<p>Le module " + (data.access.launched ? "est" : "sera") + " inclus dans ces formules :</p>" +
      "<ul><li><strong>Scolaire</strong> : sans abonnement, 5 % sur les ventes scolaires, frais bancaires compris.</li>" +
      "<li><strong>Essentiel et Pro</strong> : votre abonnement, plus 5 % sur les ventes scolaires.</li>" +
      "<li><strong>Studio</strong> : 490 € par an, tout Pro plus le scolaire, sans commission.</li></ul>" +
      (data.access.launched
        ? '<button type="button" class="ad-btn ad-btn-primary" id="ad-sc-to-plans">Voir les formules</button>'
        : '<p class="ad-hint">Bientôt disponible.</p>') +
      "</section>";
    var btn = document.getElementById("ad-sc-to-plans");
    if (btn) btn.addEventListener("click", function () { renderSubscription(); });
  }

  function schoolFormHtml(data, school) {
    var s = school || { kind: "ecole", name: "", address: "", contactName: "", contactEmail: "", contactPhone: "" };
    return (
      '<form class="ad-sc-form" id="ad-sc-form">' +
      '<div class="ad-seg" role="radiogroup" aria-label="Type d\'établissement">' +
      Object.keys(data.kinds).map(function (k) {
        return '<button type="button" class="ad-seg-btn" data-kind="' + k + '" aria-pressed="' + (s.kind === k) + '">' + esc(data.kinds[k].label) + "</button>";
      }).join("") +
      "</div>" +
      '<input type="hidden" name="kind" value="' + esc(s.kind) + '" />' +
      '<label class="ad-field"><span>Nom</span><input type="text" name="name" required maxlength="120" value="' + esc(s.name) + '" placeholder="École communale de Rotheux" /></label>' +
      '<label class="ad-field"><span>Adresse <em>(livraison des commandes groupées)</em></span><input type="text" name="address" maxlength="240" value="' + esc(s.address) + '" /></label>' +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Contact <em>(direction, responsable)</em></span><input type="text" name="contactName" maxlength="120" value="' + esc(s.contactName) + '" /></label>' +
      '<label class="ad-field"><span>Téléphone</span><input type="tel" name="contactPhone" maxlength="40" value="' + esc(s.contactPhone) + '" /></label>' +
      "</div>" +
      '<label class="ad-field"><span>E-mail du contact</span><input type="email" name="contactEmail" maxlength="200" value="' + esc(s.contactEmail) + '" /></label>' +
      '<div class="ad-sc-actions"><button type="submit" class="ad-btn ad-btn-primary">' + (school ? "Enregistrer" : "Ajouter l'établissement") + "</button>" +
      (school ? "" : '<button type="button" class="ad-btn" id="ad-sc-cancel">Annuler</button>') + "</div>" +
      "</form>"
    );
  }

  function wireSchoolForm(onSubmit) {
    var form = document.getElementById("ad-sc-form");
    form.querySelector(".ad-seg").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-kind]");
      if (!btn) return;
      form.kind.value = btn.getAttribute("data-kind");
      this.querySelectorAll("[data-kind]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await onSubmit({
          kind: form.kind.value, name: form.name.value, address: form.address.value,
          contactName: form.contactName.value, contactEmail: form.contactEmail.value, contactPhone: form.contactPhone.value,
        });
      } catch (err) {
        toast(err.message, true);
        submit.disabled = false;
      }
    });
  }

  // Fiches parents (une par enfant : portrait, code, QR, date limite), pour
  // toute l'année ou un seul groupe. Le code d'accès est attribué au premier
  // téléchargement, puis ne change plus.
  function couponsSectionHtml(year, group, kind, childCount) {
    var base = "/local/school/years/" + encodeURIComponent(year.id) + "/coupons?" + (group ? "group=" + encodeURIComponent(group.id) + "&" : "");
    // Classe, section, équipe : toutes féminines, « son » devant une voyelle.
    var groupName = kind.group.toLowerCase();
    var vowel = /^[aeéèêiîouy]/.test(groupName);
    return (
      '<section class="ad-sc-coupons"><div class="ad-section-header"><h3>Fiches parents' + (group ? "" : " · toutes les " + esc(kind.groups.toLowerCase())) + "</h3></div>" +
      '<p class="ad-hint">Une fiche par enfant : son portrait, ' + (group ? (vowel ? "l'" : "la ") : (vowel ? "son " : "sa ")) + esc(groupName) +
      ", la date limite, un code d'accès personnel et un QR code qui ouvre l'espace famille. À distribuer par l'établissement.</p>" +
      // Sans enfant, le serveur refuse les fiches : un lien de téléchargement
      // n'afficherait qu'un échec muet dans le navigateur.
      (childCount
        ? '<div class="ad-sc-actions">' +
          '<a class="ad-btn ad-btn-primary" href="' + base + 'format=pdf" download>PDF à imprimer (A4, 4 par feuille)</a>' +
          '<a class="ad-btn" href="' + base + 'format=lab" download>Images 10×15 pour le labo (ZIP)</a></div>'
        : '<p class="ad-hint ad-acc-warn">Les fiches seront prêtes dès que les photos d\'au moins une ' + esc(kind.group.toLowerCase()) +
          " auront été importées et regroupées par enfant.</p>") +
      '<p class="ad-hint">Le PDF regroupe les fiches ' + (group ? "" : esc(kind.group.toLowerCase()) + " par " + esc(kind.group.toLowerCase()) + ", ") +
      "chacune précédée d'une feuille-paquet (liste des enfants à cocher à la distribution) ; les images 10×15 se tirent comme des photos, rangées par dossier.</p>" +
      (year.orderDeadline ? "" : '<p class="ad-hint ad-acc-warn">Aucune date de commande groupée n\'est fixée : elle n\'apparaîtra pas sur les fiches.</p>') +
      "</section>"
    );
  }

  function renderSchoolList(data) {
    var cards = data.schools.map(function (s) {
      var kind = schoolKindOf(data, s.kind);
      var year = currentYearOf(s);
      var status = year && YEAR_STATUS[year.status];
      return (
        '<div class="ad-card" tabindex="0" role="link" data-school="' + esc(s.id) + '">' +
        '<p class="ad-sc-kind">' + esc(kind.label) + "</p>" +
        "<h3>" + esc(s.name) + "</h3>" +
        '<p class="ad-card-sub">' + (s.address ? esc(s.address) : "&nbsp;") + "</p>" +
        '<div class="ad-card-meta"><span>' + (year ? esc(year.label) + " · " + year.groups.length + " " + esc(year.groups.length > 1 ? kind.groups.toLowerCase() : kind.group.toLowerCase()) : "Aucune année") + "</span>" +
        (status ? '<span class="ad-acc-status ' + status.cls + '">' + status.text + "</span>" : "") + "</div>" +
        "</div>"
      );
    });
    el.view.innerHTML =
      '<div class="ad-section-header"><h2>Écoles, crèches et clubs</h2>' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-sc-new">+ Nouvel établissement</button></div>' +
      '<div id="ad-sc-new-panel" hidden></div>' +
      (data.schools.length
        ? '<div class="ad-grid">' + cards.join("") + "</div>"
        : '<div class="ad-empty"><h2>Aucun établissement pour le moment</h2>' +
          "<p>Ajoutez une école, une crèche ou un club : vous y créerez ensuite ses classes, sections ou équipes pour l'année.</p></div>");

    el.view.querySelectorAll("[data-school]").forEach(function (card) {
      function open() {
        history.pushState(null, "", "#/scolaire/" + encodeURIComponent(card.getAttribute("data-school")));
        renderSchool(true);
      }
      card.addEventListener("click", open);
      card.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
    });
    document.getElementById("ad-sc-new").addEventListener("click", function () {
      var panel = document.getElementById("ad-sc-new-panel");
      panel.hidden = false;
      panel.innerHTML = '<section><h3>Nouvel établissement</h3>' + schoolFormHtml(data, null) + "</section>";
      panel.querySelector('[name="name"]').focus();
      document.getElementById("ad-sc-cancel").addEventListener("click", function () { panel.hidden = true; panel.innerHTML = ""; });
      wireSchoolForm(async function (fields) {
        var created = await api("POST", "/school/schools", fields);
        toast("Établissement ajouté.");
        history.pushState(null, "", "#/scolaire/" + encodeURIComponent(created.id));
        renderSchool(true);
      });
    });
  }

  function renderSchoolDetail(data, school, yearId) {
    var kind = schoolKindOf(data, school.kind);
    var year = school.years.find(function (y) { return y.id === yearId; }) || currentYearOf(school);
    var yearsNav = school.years.map(function (y) {
      return '<button type="button" class="ad-seg-btn" data-year="' + esc(y.id) + '" aria-pressed="' + (year && y.id === year.id) + '">' + esc(y.label) + "</button>";
    }).join("");

    var groupsHtml = "";
    if (year) {
      groupsHtml = year.groups.length
        ? '<ul class="ad-sc-groups">' + year.groups.map(function (g) {
            return (
              '<li data-group="' + esc(g.id) + '">' +
              '<input type="text" class="ad-sc-in" data-field="name" maxlength="60" value="' + esc(g.name) + '" aria-label="Nom" />' +
              '<input type="text" class="ad-sc-in ad-sc-in-muted" data-field="leader" maxlength="80" value="' + esc(g.leader) + '" placeholder="' + esc(kind.leader) + '" aria-label="' + esc(kind.leader) + '" />' +
              '<button type="button" class="ad-btn ad-sc-open" data-open-group>' +
              (g.photoCount ? g.childrenCount + " enfant" + (g.childrenCount > 1 ? "s" : "") + " · " + g.photoCount + " photo" + (g.photoCount > 1 ? "s" : "") : "Importer les photos") +
              "</button>" +
              '<button type="button" class="ad-link-btn ad-sc-del" data-del-group aria-label="Supprimer ' + esc(g.name) + '">Supprimer</button>' +
              "</li>"
            );
          }).join("") + "</ul>"
        : '<p class="ad-hint">Aucun groupe pour cette année. Ajoutez-les ci-dessous, un par ligne.</p>';
    }

    el.view.innerHTML =
      '<p class="ad-sc-back"><button type="button" class="ad-link-btn" id="ad-sc-back">← Tous les établissements</button></p>' +
      '<header class="ad-detail-header"><div><p class="ad-sc-kind">' + esc(kind.label) + "</p><h2>" + esc(school.name) + "</h2>" +
      '<p class="ad-hint">' + esc([school.address, school.contactName, school.contactEmail, school.contactPhone].filter(Boolean).join(" · ") || "Coordonnées à compléter") + "</p></div>" +
      '<button type="button" class="ad-btn" id="ad-sc-edit">Modifier</button></header>' +
      '<div id="ad-sc-edit-panel" hidden></div>' +

      '<section><div class="ad-section-header"><h3>' + esc(kind.period) + "</h3>" +
      '<div class="ad-sc-years"><div class="ad-seg" id="ad-sc-years" role="group" aria-label="' + esc(kind.period) + '">' + yearsNav + "</div>" +
      '<button type="button" class="ad-btn" id="ad-sc-new-year">+ ' + (school.years.length ? "Année suivante" : "Nouvelle année") + "</button></div></div>" +
      (year
        ? '<div class="ad-field-row ad-sc-year-fields">' +
          '<label class="ad-field"><span>Statut</span><select id="ad-sc-status">' +
          Object.keys(YEAR_STATUS).map(function (k) { return '<option value="' + k + '"' + (year.status === k ? " selected" : "") + ">" + YEAR_STATUS[k].text + "</option>"; }).join("") +
          "</select></label>" +
          '<label class="ad-field"><span>Commande groupée jusqu\'au <em>(livrée à l\'établissement)</em></span><input type="date" id="ad-sc-deadline" value="' + dateInputValue(year.orderDeadline) + '" /></label>' +
          '<label class="ad-field"><span>Commande à domicile jusqu\'au <em>(facultatif)</em></span><input type="date" id="ad-sc-late" value="' + dateInputValue(year.lateDeadline) + '" /></label>' +
          "</div>" +
          '<label class="ad-sc-toggle ad-sc-reminders"><input type="checkbox" id="ad-sc-reminders"' + (year.familyReminders ? " checked" : "") + " /> " +
          "Rappeler par e-mail les familles qui n\'ont pas encore commandé (7 et 2 jours avant la date limite)</label>"
        : '<p class="ad-hint">Créez l\'année en cours pour y ajouter les ' + esc(kind.groups.toLowerCase()) + ".</p>") +
      "</section>" +

      (year
        ? '<section><div class="ad-section-header"><h3>' + esc(kind.groups) + " · " + esc(year.label) + " (" + year.groups.length + ")</h3></div>" +
          groupsHtml +
          '<form id="ad-sc-add-groups" class="ad-sc-add">' +
          '<label class="ad-field"><span>Ajouter des ' + esc(kind.groups.toLowerCase()) + ' <em>(une par ligne)</em></span>' +
          '<textarea name="names" rows="3" placeholder="' + esc(school.kind === "club" ? "U7\nU9\nU11" : school.kind === "creche" ? "Bébés\nMoyens\nGrands" : "M1\nM2\nP1") + '"></textarea></label>' +
          '<button type="submit" class="ad-btn ad-btn-primary">Ajouter</button></form>' +
          '<p class="ad-hint ad-sc-next">Ouvrez chaque ' + esc(kind.group.toLowerCase()) + " pour importer ses photos : Holypixx les regroupe par enfant d'après l'heure de prise de vue.</p>" +
          "</section>" +
          couponsSectionHtml(year, null, kind, year.groups.reduce(function (n, g) { return n + (g.childrenCount || 0); }, 0)) +
          '<div id="ad-sc-shop"><p class="ad-loading">Chargement de la boutique…</p></div>'
        : "") +

      '<section class="ad-sc-danger"><div class="ad-section-header"><h3>Supprimer</h3></div>' +
      '<p class="ad-hint">Supprime l\'établissement avec toutes ses années et ses ' + esc(kind.groups.toLowerCase()) + ".</p>" +
      '<div class="ad-sc-actions"><button type="button" class="ad-btn ad-btn-danger" id="ad-sc-delete">Supprimer l\'établissement</button>' +
      '<span id="ad-sc-delete-confirm" hidden><button type="button" class="ad-btn ad-btn-danger" id="ad-sc-delete-yes">Oui, supprimer définitivement</button> ' +
      '<button type="button" class="ad-btn" id="ad-sc-delete-no">Annuler</button></span></div></section>';

    function reload(newYearId) {
      history.replaceState(null, "", "#/scolaire/" + encodeURIComponent(school.id) + (newYearId ? "/" + encodeURIComponent(newYearId) : ""));
      renderSchool(true);
    }

    document.getElementById("ad-sc-back").addEventListener("click", function () {
      history.pushState(null, "", "#/scolaire");
      renderSchool(true);
    });
    document.getElementById("ad-sc-edit").addEventListener("click", function () {
      var panel = document.getElementById("ad-sc-edit-panel");
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      panel.innerHTML = "<section>" + schoolFormHtml(data, school) + "</section>";
      wireSchoolForm(async function (fields) {
        await api("POST", "/school/schools/" + encodeURIComponent(school.id), fields);
        toast("Établissement enregistré.");
        reload(year && year.id);
      });
    });
    var yearsSeg = document.getElementById("ad-sc-years");
    yearsSeg.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-year]");
      if (btn) reload(btn.getAttribute("data-year"));
    });
    document.getElementById("ad-sc-new-year").addEventListener("click", async function () {
      this.disabled = true;
      try {
        var created = await api("POST", "/school/schools/" + encodeURIComponent(school.id) + "/years", {});
        toast("Année " + created.label + " créée" + (school.years.length ? ", avec les " + kind.groups.toLowerCase() + " de l'an dernier." : "."));
        reload(created.id);
      } catch (err) {
        toast(err.message, true);
        this.disabled = false;
      }
    });

    if (year) {
      async function saveYear(patch) {
        try {
          await api("POST", "/school/years/" + encodeURIComponent(year.id), patch);
          toast("Enregistré.");
        } catch (err) {
          toast(err.message, true);
        }
      }
      document.getElementById("ad-sc-status").addEventListener("change", function () { saveYear({ status: this.value }); });
      document.getElementById("ad-sc-deadline").addEventListener("change", function () { saveYear({ orderDeadline: this.value }); });
      document.getElementById("ad-sc-late").addEventListener("change", function () { saveYear({ lateDeadline: this.value }); });
      document.getElementById("ad-sc-reminders").addEventListener("change", function () { saveYear({ familyReminders: this.checked }); });

      el.view.querySelectorAll("[data-group]").forEach(function (li) {
        var id = li.getAttribute("data-group");
        li.querySelectorAll(".ad-sc-in").forEach(function (input) {
          input.addEventListener("change", async function () {
            var patch = {};
            patch[input.getAttribute("data-field")] = input.value;
            try {
              await api("POST", "/school/groups/" + encodeURIComponent(id), patch);
              toast("Enregistré.");
            } catch (err) {
              toast(err.message, true);
            }
          });
        });
        li.querySelector("[data-open-group]").addEventListener("click", function () {
          history.pushState(null, "", "#/scolaire/groupe/" + encodeURIComponent(id));
          renderSchool(true);
        });
        li.querySelector("[data-del-group]").addEventListener("click", async function () {
          try {
            await api("DELETE", "/school/groups/" + encodeURIComponent(id));
            reload(year.id);
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
      loadSchoolShop(year, kind);
      document.getElementById("ad-sc-add-groups").addEventListener("submit", async function (event) {
        event.preventDefault();
        var names = this.names.value.split(/\n/).map(function (n) { return n.trim(); }).filter(Boolean);
        if (!names.length) return;
        try {
          await api("POST", "/school/years/" + encodeURIComponent(year.id) + "/groups", { names: names });
          toast(names.length + " " + (names.length > 1 ? kind.groups.toLowerCase() + " ajoutées" : kind.group.toLowerCase() + " ajoutée") + ".");
          reload(year.id);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }

    document.getElementById("ad-sc-delete").addEventListener("click", function () {
      document.getElementById("ad-sc-delete-confirm").hidden = false;
      this.hidden = true;
    });
    document.getElementById("ad-sc-delete-no").addEventListener("click", function () {
      document.getElementById("ad-sc-delete-confirm").hidden = true;
      document.getElementById("ad-sc-delete").hidden = false;
    });
    document.getElementById("ad-sc-delete-yes").addEventListener("click", async function () {
      try {
        await api("DELETE", "/school/schools/" + encodeURIComponent(school.id));
        toast("Établissement supprimé.");
        history.pushState(null, "", "#/scolaire");
        renderSchool(true);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  /* ---------- Boutique d'une année : gamme, prix, commandes ---------- */

  var SCHOOL_SCOPES = { portrait: "Portrait de l'enfant", group: "Photo de groupe" };

  async function loadSchoolShop(year, kind) {
    var host = document.getElementById("ad-sc-shop");
    if (!host) return;
    var shop;
    try {
      shop = await api("GET", "/school/years/" + encodeURIComponent(year.id) + "/shop");
    } catch (err) {
      host.innerHTML = '<p class="ad-hint ad-acc-warn">' + esc(err.message) + "</p>";
      return;
    }
    // On a pu changer de vue pendant le chargement : la section n'existe plus.
    if (!host.isConnected) return;
    renderSchoolShop(host, year, kind, shop);
  }

  function schoolProductRowHtml(p, shop) {
    return (
      '<li data-product="' + esc(p.id) + '"' + (p.active ? "" : ' class="ad-sc-off"') + ">" +
      '<div class="ad-sc-prod-main">' +
      '<input type="text" class="ad-sc-in" data-pfield="name" maxlength="80" value="' + esc(p.name) + '" aria-label="Nom du produit" />' +
      '<input type="text" class="ad-sc-in ad-sc-in-muted" data-pfield="description" maxlength="240" value="' + esc(p.description) + '" placeholder="Contenu, format…" aria-label="Description" />' +
      "</div>" +
      '<span class="ad-sc-tag">' + esc(shop.kinds[p.kind] || p.kind) + " · " + esc(p.scope === "group" ? "groupe" : "portrait") + "</span>" +
      '<label class="ad-sc-price"><input type="text" inputmode="decimal" class="ad-sc-in" data-pfield="price" value="' + eurosInput(p.priceCents).replace(".", ",") + '" aria-label="Prix en euros" /> €</label>' +
      '<label class="ad-sc-toggle"><input type="checkbox" data-pfield="active"' + (p.active ? " checked" : "") + " /> En vente</label>" +
      '<button type="button" class="ad-link-btn ad-sc-del" data-del-product aria-label="Supprimer ' + esc(p.name) + '">Supprimer</button>' +
      '<div class="ad-sc-prod-lab">' + (p.preview ? '<img class="ad-sc-prod-thumb" src="' + esc(labPreviewUrl(p.preview)) + '" alt="Visuel de la planche" loading="lazy" />' : "") + (p.kind === "numerique"
        ? '<span class="ad-hint">Labo : rien à imprimer (téléchargé par la famille)</span>'
        : '<span class="' + (p.labItems.length ? "ad-hint" : "ad-hint ad-acc-warn") + '">Labo : ' + esc(labItemsSummary(p.labItems)) + "</span> " +
          '<button type="button" class="ad-link-btn" data-lab-product>' + (p.labItems.length ? "Modifier" : "Indiquer") + "</button>") +
      '<div class="ad-sc-lab-editor" hidden></div></div>' +
      "</li>"
    );
  }

  var PAPER_NAMES = { 1: "brillant", 2: "lustré" };
  var schoolLabCatalogue = null;

  function labPreviewUrl(path) {
    return path ? state.config.api + path : "";
  }

  function labItemsSummary(items) {
    if (!items || !items.length) return "à indiquer (ce que BePhoto imprime pour un exemplaire)";
    return items.map(function (i) {
      return i.quantity + "× " + (i.label || "produit " + i.idproduct) + " " + (PAPER_NAMES[i.idpaper] || "");
    }).join(" + ");
  }

  // Nom court d'un élément de composition (résumé, nom de fichier au labo).
  function labLabel(entry) {
    return entry.planche ? "Planche " + entry.sheet + " n°" + entry.idproduct : entry.name;
  }

  function labEntry(idproduct) {
    if (!schoolLabCatalogue) return null;
    return schoolLabCatalogue.planches.concat(schoolLabCatalogue.others).find(function (c) { return c.idproduct === idproduct; }) || null;
  }

  // Coût labo d'une composition : fourchette (paliers de la grille pour les
  // planches, prix du papier pour les autres produits), ou null si inconnu.
  function labCostRange(items) {
    var min = 0, max = 0;
    for (var k = 0; k < items.length; k++) {
      var entry = labEntry(items[k].idproduct);
      if (!entry) return null;
      if (entry.planche) {
        min += entry.minCents * items[k].quantity;
        max += entry.maxCents * items[k].quantity;
      } else {
        var price = entry.prices.find(function (pr) { return pr.idpaper === items[k].idpaper; });
        if (!price) return null;
        min += price.cents * items[k].quantity;
        max += price.cents * items[k].quantity;
      }
    }
    return { min: min, max: max };
  }

  function eurosRange(r) {
    return r.min === r.max ? formatEuros(r.min) : formatEuros(r.min) + " à " + formatEuros(r.max);
  }

  // Menu déroulant illustré : un bouton qui montre le choix (vignette, nom,
  // détail) et une liste à vignettes. Clavier : flèches, Entrée, Échap.
  function visualSelect(host, opts) {
    var current = opts.value;
    host.className = "ad-vsel";
    function itemHtml(o) {
      return (o.img ? '<img src="' + esc(o.img) + '" alt="" loading="lazy" />' : '<span class="ad-vsel-noimg" aria-hidden="true"></span>') +
        '<span class="ad-vsel-text"><strong>' + esc(o.label) + "</strong>" + (o.sub ? "<small>" + esc(o.sub) + "</small>" : "") + "</span>";
    }
    var selected = function () { return opts.options.find(function (o) { return o.value === current; }); };
    var groups = [];
    opts.options.forEach(function (o) {
      var g = groups.find(function (x) { return x.name === (o.group || ""); });
      if (!g) groups.push(g = { name: o.group || "", items: [] });
      g.items.push(o);
    });
    host.innerHTML =
      '<button type="button" class="ad-vsel-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(opts.ariaLabel) + '"></button>' +
      '<div class="ad-vsel-pop" hidden><ul role="listbox" tabindex="-1" aria-label="' + esc(opts.ariaLabel) + '">' +
      groups.map(function (g) {
        return (g.name ? '<li class="ad-vsel-group" role="presentation">' + esc(g.name) + "</li>" : "") +
          g.items.map(function (o) {
            return '<li role="option" tabindex="-1" data-value="' + esc(String(o.value)) + '" aria-selected="' + (o.value === current) + '">' + itemHtml(o) + "</li>";
          }).join("");
      }).join("") + "</ul></div>";
    var btn = host.querySelector(".ad-vsel-btn");
    var pop = host.querySelector(".ad-vsel-pop");
    var optionsEls = Array.prototype.slice.call(host.querySelectorAll('[role="option"]'));
    function paint() {
      var o = selected();
      btn.innerHTML = (o ? itemHtml(o) : '<span class="ad-vsel-noimg" aria-hidden="true"></span><span class="ad-vsel-text"><strong>' + esc(opts.placeholder) + "</strong></span>") + '<span class="ad-vsel-caret" aria-hidden="true">▾</span>';
      optionsEls.forEach(function (li) { li.setAttribute("aria-selected", String(li.getAttribute("data-value") === String(current))); });
    }
    function outside(event) { if (!host.contains(event.target)) close(); }
    function open() {
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", outside);
      var target = optionsEls.find(function (li) { return li.getAttribute("aria-selected") === "true"; }) || optionsEls[0];
      if (target) target.focus();
    }
    function close(refocus) {
      pop.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", outside);
      if (refocus) btn.focus();
    }
    function choose(li) {
      var o = opts.options.find(function (x) { return String(x.value) === li.getAttribute("data-value"); });
      current = o.value;
      paint();
      close(true);
      opts.onChange(o.value);
    }
    btn.addEventListener("click", function () { if (pop.hidden) open(); else close(); });
    btn.addEventListener("keydown", function (e) { if (e.key === "ArrowDown") { e.preventDefault(); open(); } });
    optionsEls.forEach(function (li, i) {
      li.addEventListener("click", function () { choose(li); });
      li.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" && optionsEls[i + 1]) { e.preventDefault(); optionsEls[i + 1].focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); (optionsEls[i - 1] || btn).focus(); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(li); }
        else if (e.key === "Escape" || e.key === "Tab") { close(e.key === "Escape"); }
      });
    });
    paint();
  }

  // Composition labo d'un produit : ce que BePhoto imprime pour UN
  // exemplaire. Les planches (montages composés par le labo à partir d'une
  // seule photo) se choisissent sur leur visuel ; coût et marge s'affichent.
  async function openLabEditor(li, product, onSaved) {
    var box = li.querySelector(".ad-sc-lab-editor");
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<p class="ad-loading">Catalogue BePhoto…</p>';
    if (!schoolLabCatalogue) {
      try {
        schoolLabCatalogue = await api("GET", "/school/lab/catalogue");
      } catch (err) {
        box.innerHTML = '<p class="ad-hint ad-acc-warn">' + esc(err.message) + "</p>";
        return;
      }
    }
    var cat = schoolLabCatalogue;
    var options = cat.planches.map(function (c) {
      return { value: c.idproduct, label: c.name, sub: "Sur " + c.sheet + " · n° " + c.idproduct + " · " + eurosRange({ min: c.minCents, max: c.maxCents }), img: labPreviewUrl(c.preview), group: "Planches composées par le labo" };
    }).concat(cat.others.map(function (c) {
      var prices = c.prices.map(function (pr) { return pr.cents; });
      return { value: c.idproduct, label: c.name, sub: "n° " + c.idproduct + (c.dimensions ? " · " + c.dimensions + " mm" : "") + (prices.length ? " · " + eurosRange({ min: Math.min.apply(null, prices), max: Math.max.apply(null, prices) }) : ""), img: "", group: "Tirages et autres produits BePhoto" };
    }));
    var rows = product.labItems.length ? product.labItems.map(function (i) { return Object.assign({}, i); }) : [{ idproduct: 0, idpaper: 1, quantity: 1 }];
    function draw() {
      var filled = rows.filter(function (r) { return r.idproduct; });
      var cost = filled.length ? labCostRange(filled) : null;
      box.innerHTML =
        '<p class="ad-hint">Pour <strong>un</strong> exemplaire de « ' + esc(product.name) + " », BePhoto imprime :</p>" +
        (cat.warning ? '<p class="ad-hint ad-acc-warn">' + esc(cat.warning) + "</p>" : "") +
        rows.map(function (r, i) {
          var entry = labEntry(r.idproduct);
          var papers = entry && !entry.planche && entry.prices.length ? entry.prices : [{ idpaper: 1 }, { idpaper: 2 }];
          return '<div class="ad-sc-lab-row" data-row="' + i + '">' +
            '<input type="number" min="1" max="50" value="' + r.quantity + '" data-f="quantity" aria-label="Quantité" />' +
            '<span aria-hidden="true">×</span>' +
            '<div data-vsel></div>' +
            '<select data-f="idpaper" aria-label="Papier">' + papers.map(function (pp) {
              return '<option value="' + pp.idpaper + '"' + (pp.idpaper === r.idpaper ? " selected" : "") + ">" + esc((PAPER_NAMES[pp.idpaper] || "papier " + pp.idpaper) + (pp.cents !== undefined ? " · " + formatEuros(pp.cents) : "")) + "</option>";
            }).join("") + "</select>" +
            '<button type="button" class="ad-link-btn ad-sc-del" data-remove-row aria-label="Retirer">Retirer</button></div>';
        }).join("") +
        '<div class="ad-sc-actions"><button type="button" class="ad-link-btn" data-add-row>+ Ajouter une planche ou un tirage</button>' +
        (cost ? '<span class="ad-hint" data-lab-cost>Coût labo ≈ ' + eurosRange(cost) + " · marge ≈ " + eurosRange({ min: product.priceCents - cost.max, max: product.priceCents - cost.min }) +
          " (selon la taille du lot, avant pochette et livraison)</span>" : "") +
        "</div>" +
        (cat.connected ? "" : '<p class="ad-hint">Sans compte BePhoto connecté, seules les planches de la grille publique sont proposées.</p>') +
        '<div class="ad-sc-actions"><button type="button" class="ad-btn ad-btn-primary" data-save-lab>Enregistrer</button>' +
        '<button type="button" class="ad-btn" data-cancel-lab>Annuler</button></div>';
      box.querySelectorAll(".ad-sc-lab-row").forEach(function (rowEl) {
        var i = Number(rowEl.getAttribute("data-row"));
        visualSelect(rowEl.querySelector("[data-vsel]"), {
          options: options, value: rows[i].idproduct || null, placeholder: "Choisir une planche ou un tirage…", ariaLabel: "Produit BePhoto",
          onChange: function (value) {
            rows[i].idproduct = value;
            var entry = labEntry(value);
            rows[i].label = entry ? labLabel(entry) : "";
            if (entry && !entry.planche && entry.prices.length && !entry.prices.some(function (pp) { return pp.idpaper === rows[i].idpaper; })) rows[i].idpaper = entry.prices[0].idpaper;
            draw();
          },
        });
        rowEl.querySelectorAll("[data-f]").forEach(function (input) {
          input.addEventListener("change", function () {
            rows[i][input.getAttribute("data-f")] = Number(input.value);
            draw();
          });
        });
        rowEl.querySelector("[data-remove-row]").addEventListener("click", function () { rows.splice(i, 1); draw(); });
      });
      box.querySelector("[data-add-row]").addEventListener("click", function () { rows.push({ idproduct: 0, idpaper: 1, quantity: 1 }); draw(); });
      box.querySelector("[data-cancel-lab]").addEventListener("click", function () { box.hidden = true; });
      box.querySelector("[data-save-lab]").addEventListener("click", async function () {
        var items = rows.filter(function (r) { return r.idproduct; }).map(function (r) {
          var entry = labEntry(r.idproduct);
          return { idproduct: r.idproduct, idpaper: r.idpaper, quantity: r.quantity, label: entry ? labLabel(entry) : r.label || "" };
        });
        try {
          await api("POST", "/school/products/" + encodeURIComponent(product.id) + "/lab", { items: items });
          toast("Composition labo enregistrée.");
          onSaved();
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
    draw();
  }

  /* ---------- Envois au labo : lots, compte BePhoto ---------- */

  var BATCH_STATUS = {
    ready: { text: "Prêt", cls: "ad-acc-status-trial" },
    sending: { text: "Envoi en cours", cls: "ad-acc-status-warn" },
    sent: { text: "Parti", cls: "ad-acc-status-ok" },
  };

  async function loadSchoolLab(year, kind) {
    var host = document.getElementById("ad-sc-lab");
    if (!host) return;
    var data;
    try {
      data = await api("GET", "/school/years/" + encodeURIComponent(year.id) + "/batches");
    } catch (err) {
      host.innerHTML = '<p class="ad-hint ad-acc-warn">' + esc(err.message) + "</p>";
      return;
    }
    if (!host.isConnected) return;
    renderSchoolLab(host, year, kind, data);
  }

  function renderSchoolLab(host, year, kind, data) {
    var base = "/local/school/years/" + encodeURIComponent(year.id) + "/production?batch=";
    var pendingCard = function (delivery, title, hint) {
      var p = data.pending[delivery];
      return '<div class="ad-sc-pending">' +
        "<div><strong>" + esc(title) + "</strong><span>" + (p.lines
          ? p.quantity + " article" + (p.quantity > 1 ? "s" : "") + " · " + p.children + " enfant" + (p.children > 1 ? "s" : "") + " · " + p.orders + " commande" + (p.orders > 1 ? "s" : "")
          : "Rien en attente") + "</span>" + (hint ? '<span class="ad-hint">' + esc(hint) + "</span>" : "") + "</div>" +
        '<button type="button" class="ad-btn' + (p.lines ? " ad-btn-primary" : "") + '" data-new-batch="' + delivery + '"' + (p.lines ? "" : " disabled") + ">Préparer un lot</button></div>";
    };
    var rows = data.batches.map(function (b) {
      var st = BATCH_STATUS[b.status] || BATCH_STATUS.ready;
      var statusText = b.status === "sent"
        ? "Parti le " + new Date(b.sentAt * 1000).toLocaleDateString("fr-BE") + (b.lab === "bephoto" ? " · BePhoto n° " + esc(b.labOrderId) : " · à la main")
        : b.status === "sending" ? "Envoi : " + b.progress.sent + " / " + b.progress.total + " lignes" : "Prêt à partir";
      var actions = '<a class="ad-link-btn" href="' + base + encodeURIComponent(b.id) + '" download>Fichier (ZIP)</a>';
      if (b.status === "ready") {
        if (b.delivery === "school" && data.lab.connected) actions += ' <button type="button" class="ad-btn ad-btn-primary ad-sc-mini" data-send-batch="' + esc(b.id) + '" data-number="' + b.number + '">Envoyer à BePhoto</button>';
        actions += ' <button type="button" class="ad-link-btn" data-mark-sent="' + esc(b.id) + '">Marquer comme parti</button>' +
          ' <button type="button" class="ad-link-btn ad-sc-del" data-cancel-batch="' + esc(b.id) + '">Annuler</button>';
      } else if (b.status === "sending") {
        actions += ' <button type="button" class="ad-btn ad-btn-primary ad-sc-mini" data-send-batch="' + esc(b.id) + '" data-resume="1" data-number="' + b.number + '">Reprendre l\'envoi</button>';
      }
      return "<tr><td><strong>Lot " + b.number + "</strong></td>" +
        "<td>" + (b.delivery === "home" ? "À domicile" : "École") + "</td>" +
        '<td class="ad-num">' + b.quantity + "</td>" +
        '<td class="ad-num">' + b.children + "</td>" +
        '<td><span class="ad-acc-status ' + st.cls + '">' + st.text + '</span> <span class="ad-hint" data-batch-status="' + esc(b.id) + '">' + statusText + "</span>" +
        (b.error ? '<br /><span class="ad-hint ad-acc-warn">' + esc(b.error) + "</span>" : "") + "</td>" +
        '<td class="ad-sc-batch-actions">' + actions + "</td></tr>";
    }).join("");

    host.innerHTML =
      '<section class="ad-sc-shop"><div class="ad-section-header"><h3>Envois au labo · ' + esc(year.label) + "</h3></div>" +
      '<p class="ad-hint">Conseil du labo : regroupez les commandes une ou deux fois pendant la vente (toutes les deux semaines, par exemple) plutôt que de les envoyer une à une. Un article ne part qu\'une fois : il entre dans un seul lot.</p>' +
      '<div class="ad-sc-pendings">' +
      pendingCard("school", "À livrer à l'établissement", "") +
      pendingCard("home", "À livrer à domicile", "Adresse des familles dans le fichier du lot") +
      "</div>" +
      (data.unmappedProducts.length
        ? '<p class="ad-hint ad-acc-warn">Pour envoyer à BePhoto, indiquez ce que le labo imprime pour : ' + esc(data.unmappedProducts.join(", ")) + " (Gamme et prix → Labo).</p>"
        : "") +
      (data.batches.length
        ? '<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>Lot</th><th>Livraison</th><th class="ad-num">Articles</th><th class="ad-num">Enfants</th><th>Statut</th><th><span class="ad-visually-hidden">Actions</span></th></tr></thead><tbody>' + rows + "</tbody></table></div>"
        : '<p class="ad-hint">Aucun lot pour l\'instant.</p>') +
      '<div class="ad-sc-labacct">' +
      (data.lab.connected
        ? "<p><strong>Compte BePhoto connecté</strong> · " + esc(data.lab.email) + ' <button type="button" class="ad-link-btn" id="ad-sc-lab-off">Déconnecter</button></p>' +
          '<p class="ad-hint">Les lots « école » peuvent partir directement chez BePhoto, qui vous facture l\'impression. Les envois à domicile partent encore avec leur fichier : l\'API BePhoto n\'a pas de champ adresse pour l\'instant.</p>'
        : '<form id="ad-sc-lab-form" class="ad-sc-lab-form"><p><strong>Connecter votre compte BePhoto</strong> <span class="ad-hint">(facultatif)</span></p>' +
          '<p class="ad-hint">Pour envoyer vos lots directement au labo. Votre mot de passe est chiffré et ne s\'affiche plus jamais ; c\'est vous que BePhoto facture.</p>' +
          '<label class="ad-field"><span>E-mail du compte BePhoto</span><input type="email" name="email" required autocomplete="off" /></label>' +
          '<label class="ad-field"><span>Mot de passe</span><input type="password" name="password" required autocomplete="new-password" /></label>' +
          '<button type="submit" class="ad-btn">Connecter</button></form>') +
      "</div></section>";

    function refresh() { loadSchoolLab(year, kind); }

    host.querySelectorAll("[data-new-batch]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          var created = await api("POST", "/school/years/" + encodeURIComponent(year.id) + "/batches", { delivery: btn.getAttribute("data-new-batch") });
          toast("Lot " + created.number + " préparé.");
          refresh();
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      });
    });
    host.querySelectorAll("[data-mark-sent]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        try {
          await api("POST", "/school/batches/" + encodeURIComponent(btn.getAttribute("data-mark-sent")), { status: "sent" });
          refresh();
        } catch (err) { toast(err.message, true); }
      });
    });
    host.querySelectorAll("[data-cancel-batch]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (btn.getAttribute("data-confirm") !== "1") {
          btn.setAttribute("data-confirm", "1");
          btn.textContent = "Confirmer l'annulation";
          return;
        }
        try {
          await api("DELETE", "/school/batches/" + encodeURIComponent(btn.getAttribute("data-cancel-batch")));
          toast("Lot annulé : ses articles sont de nouveau en attente.");
          refresh();
        } catch (err) { toast(err.message, true); }
      });
    });
    host.querySelectorAll("[data-send-batch]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-send-batch");
        if (!btn.getAttribute("data-resume") && btn.getAttribute("data-confirm") !== "1") {
          btn.setAttribute("data-confirm", "1");
          btn.textContent = "Confirmer : BePhoto imprime et vous facture";
          return;
        }
        btn.disabled = true;
        var status = host.querySelector('[data-batch-status="' + id + '"]');
        try {
          for (var guard = 0; guard < 2000; guard++) {
            var step = await api("POST", "/school/batches/" + encodeURIComponent(id) + "/send", {});
            if (status) status.textContent = step.done ? "Terminé" : "Envoi : " + step.sent + " / " + step.total + " lignes";
            if (step.done) break;
          }
          toast("Lot " + btn.getAttribute("data-number") + " envoyé à BePhoto.");
        } catch (err) {
          toast(err.message, true);
        }
        refresh();
      });
    });
    var form = document.getElementById("ad-sc-lab-form");
    if (form) form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await api("POST", "/school/lab", { email: form.email.value, password: form.password.value });
        schoolLabCatalogue = null;
        toast("Compte BePhoto connecté.");
        refresh();
      } catch (err) {
        toast(err.message, true);
        submit.disabled = false;
      }
    });
    var off = document.getElementById("ad-sc-lab-off");
    if (off) off.addEventListener("click", async function () {
      try {
        await api("DELETE", "/school/lab");
        schoolLabCatalogue = null;
        toast("Compte BePhoto déconnecté.");
        refresh();
      } catch (err) { toast(err.message, true); }
    });
  }

  // Rappels envoyés aux familles pour l'année (schoolreminders.js).
  function remindersLineHtml(shop) {
    if (!shop.familyReminders) return '<p class="ad-hint" id="ad-sc-reminders-stats">Rappels aux familles désactivés pour cette année.</p>';
    var r = shop.reminders || {};
    var parts = [["j7", "à 7 jours"], ["j2", "à 2 jours"], ["late2", "avant la fin des commandes à domicile"]]
      .filter(function (k) { return r[k[0]]; })
      .map(function (k) { return r[k[0]].families + " famille" + (r[k[0]].families > 1 ? "s" : "") + " " + k[1]; });
    return '<p class="ad-hint" id="ad-sc-reminders-stats">' + (parts.length
      ? "Rappels envoyés : " + esc(parts.join(", ")) + "."
      : "Rappels aux familles : le premier part 7 jours avant la date limite, aux familles qui ont ouvert leur espace sans commander.") + "</p>";
  }

  function renderSchoolShop(host, year, kind, shop) {
    var t = shop.totals;
    var groupWord = kind.group.toLowerCase();
    var productsHtml = shop.products.length
      ? '<ul class="ad-sc-products">' + shop.products.map(function (p) { return schoolProductRowHtml(p, shop); }).join("") + "</ul>"
      : '<div class="ad-sc-empty-shop"><p>Aucun produit pour cette année. Partez d\'une gamme type (pochettes, tirages, fichier numérique, photo de groupe) et ajustez les prix, ou créez vos produits un à un.</p>' +
        '<button type="button" class="ad-btn ad-btn-primary" id="ad-sc-starter">Créer la gamme de départ</button></div>';

    var groupRows = shop.groups.map(function (g) {
      var pct = g.children ? Math.round((g.childrenOrdered / g.children) * 100) : 0;
      return (
        "<tr><td>" + esc(g.name) + "</td>" +
        '<td><span class="ad-sc-meter" aria-hidden="true"><span style="width:' + pct + '%"></span></span> ' + g.childrenOrdered + " / " + g.children + "</td>" +
        '<td class="ad-num">' + g.orders + "</td>" +
        '<td class="ad-num">' + formatEuros(g.amountCents) + "</td>" +
        '<td class="ad-num">' + (g.orders ? '<a class="ad-link-btn" href="/local/school/years/' + encodeURIComponent(year.id) + "/production?group=" + encodeURIComponent(g.id) + '" download>Fichier</a>' : "") + "</td></tr>"
      );
    }).join("");

    var orderRows = shop.orders.map(function (o) {
      return (
        "<tr><td>" + esc(new Date(o.paidAt * 1000).toLocaleDateString("fr-BE")) + "</td>" +
        "<td>" + esc(o.email) + "</td>" +
        "<td>" + (o.delivery === "home" ? "À domicile" + (o.shippingName ? " · " + esc(o.shippingName) : "") : "École") + "</td>" +
        '<td class="ad-num">' + o.lines + "</td>" +
        '<td class="ad-num">' + formatEuros(o.amountCents) + "</td></tr>"
      );
    }).join("");

    host.innerHTML =
      '<section class="ad-sc-shop" id="ad-sc-range"><div class="ad-section-header"><h3>Gamme et prix · ' + esc(year.label) + "</h3></div>" +
      '<p class="ad-hint">Ce que les familles peuvent commander, sur un portrait de leur enfant ou sur la photo de ' + esc(groupWord) + '. Prix TTC, payés en ligne ; les montants arrivent sur votre compte Stripe.</p>' +
      productsHtml +
      '<form id="ad-sc-add-product" class="ad-sc-prod-form">' +
      '<label class="ad-field"><span>Type</span><select name="kind">' +
      Object.keys(shop.kinds).map(function (k) { return '<option value="' + k + '">' + esc(shop.kinds[k]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="ad-field"><span>Sur</span><select name="scope">' +
      Object.keys(SCHOOL_SCOPES).map(function (k) { return '<option value="' + k + '">' + esc(k === "group" ? "Photo de " + groupWord : SCHOOL_SCOPES[k]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="ad-field"><span>Nom</span><input type="text" name="name" required maxlength="80" placeholder="Pochette Duo" /></label>' +
      '<label class="ad-field"><span>Contenu <em>(facultatif)</em></span><input type="text" name="description" maxlength="240" placeholder="2 tirages 13×18" /></label>' +
      '<label class="ad-field"><span>Prix (€)</span><input type="text" name="price" required inputmode="decimal" placeholder="18,00" /></label>' +
      '<button type="submit" class="ad-btn">+ Ajouter</button></form>' +
      '<div class="ad-sc-shipping"><label class="ad-field"><span>Frais de port, commande à domicile <em>(après la commande groupée)</em></span>' +
      '<span class="ad-sc-price"><input type="text" inputmode="decimal" id="ad-sc-shipping" value="' + eurosInput(shop.homeShippingCents).replace(".", ",") + '" /> €</span></label>' +
      '<p class="ad-hint">Jusqu\'à la date de commande groupée, tout est livré à l\'établissement, sans frais. Ensuite, et jusqu\'à la date de commande à domicile, les familles paient ces frais et donnent leur adresse.</p></div>' +
      "</section>" +

      '<section class="ad-sc-shop" id="ad-sc-orders"><div class="ad-section-header"><h3>Commandes · ' + esc(year.label) + "</h3>" +
      (t.orders ? '<a class="ad-btn ad-btn-primary" href="/local/school/years/' + encodeURIComponent(year.id) + '/production" download>Fichier de production (ZIP)</a>' : "") + "</div>" +
      '<div class="ad-sc-kpis">' +
      '<div><strong>' + t.orders + "</strong><span>commande" + (t.orders > 1 ? "s" : "") + "</span></div>" +
      '<div><strong>' + t.families + "</strong><span>famille" + (t.families > 1 ? "s" : "") + "</span></div>" +
      '<div><strong>' + formatEuros(t.amountCents) + "</strong><span>encaissé</span></div>" +
      '<div><strong>' + formatEuros(t.amountCents - t.feeCents) + "</strong><span>pour vous, après frais</span></div>" +
      "</div>" +
      (shop.groups.length
        ? '<div class="ad-table-wrap"><table class="ad-table ad-sc-group-table"><thead><tr><th>' + esc(kind.group) + "</th><th>Enfants ayant commandé</th>" +
          '<th class="ad-num">Commandes</th><th class="ad-num">Montant</th><th class="ad-num"><span class="ad-visually-hidden">Production</span></th></tr></thead><tbody>' + groupRows + "</tbody></table></div>"
        : "") +
      (shop.orders.length
        ? '<h4 class="ad-sc-subhead">Dernières commandes</h4><div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>Date</th><th>E-mail</th><th>Livraison</th>' +
          '<th class="ad-num">Articles</th><th class="ad-num">Montant</th></tr></thead><tbody>' + orderRows + "</tbody></table></div>"
        : '<p class="ad-hint">Aucune commande pour l\'instant. Elles apparaîtront ici dès que les familles auront payé.</p>') +
      '<p class="ad-hint">Le fichier de production range les fichiers d\'impression par ' + esc(groupWord) + " puis par enfant, avec un récapitulatif (CSV) et la liste de distribution.</p>" +
      remindersLineHtml(shop) +
      "</section>" +
      '<div id="ad-sc-lab"></div>';

    function refresh() { loadSchoolShop(year, kind); }
    loadSchoolLab(year, kind);

    var starter = document.getElementById("ad-sc-starter");
    if (starter) starter.addEventListener("click", async function () {
      this.disabled = true;
      try {
        await api("POST", "/school/years/" + encodeURIComponent(year.id) + "/starter-products", {});
        toast("Gamme de départ créée : ajustez les prix à votre convenance.");
        refresh();
      } catch (err) {
        toast(err.message, true);
        this.disabled = false;
      }
    });

    host.querySelectorAll("[data-product]").forEach(function (li) {
      var id = li.getAttribute("data-product");
      var labBtn = li.querySelector("[data-lab-product]");
      if (labBtn) labBtn.addEventListener("click", function () {
        openLabEditor(li, shop.products.find(function (p) { return p.id === id; }), refresh);
      });
      li.querySelectorAll("[data-pfield]").forEach(function (input) {
        input.addEventListener("change", async function () {
          var field = input.getAttribute("data-pfield");
          var patch = {};
          patch[field] = field === "active" ? input.checked : input.value;
          try {
            await api("POST", "/school/products/" + encodeURIComponent(id), patch);
            if (field === "active") li.classList.toggle("ad-sc-off", !input.checked);
            toast("Enregistré.");
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
      li.querySelector("[data-del-product]").addEventListener("click", async function () {
        try {
          await api("DELETE", "/school/products/" + encodeURIComponent(id));
          refresh();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    document.getElementById("ad-sc-add-product").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = this;
      try {
        await api("POST", "/school/years/" + encodeURIComponent(year.id) + "/products", {
          kind: form.kind.value, scope: form.scope.value, name: form.name.value, description: form.description.value, price: form.price.value,
        });
        toast("Produit ajouté.");
        refresh();
      } catch (err) {
        toast(err.message, true);
      }
    });

    document.getElementById("ad-sc-shipping").addEventListener("change", async function () {
      try {
        await api("POST", "/school/years/" + encodeURIComponent(year.id) + "/shipping", { price: this.value });
        toast("Frais de port enregistrés.");
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  /* ---------- Groupe scolaire : import et regroupement par enfant ---------- */

  function schoolThumb(photo, selected) {
    var cols = state.config.previewCols || 2;
    var rows = state.config.previewRows || 2;
    var cells = "";
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        cells += '<img loading="lazy" src="/local/tiles/' + esc(photo.id) + "/0/" + col + "/" + row + '" alt="" />';
      }
    }
    var time = photo.takenAt ? new Date(photo.takenAt).toISOString().slice(11, 19) : "";
    return (
      '<button type="button" class="ad-sc-thumb' + (selected ? " ad-sc-thumb-on" : "") + '" data-photo="' + esc(photo.id) + '" aria-pressed="' + Boolean(selected) + '"' +
      ' title="' + esc((photo.sourceName || "") + (time ? " · " + time : "")) + '">' +
      '<span class="ad-sc-thumb-img" style="aspect-ratio:' + photo.width + "/" + photo.height + ";grid-template-columns:repeat(" + cols + ",1fr);grid-template-rows:repeat(" + rows + ',1fr)">' + cells + "</span>" +
      (time ? '<span class="ad-sc-thumb-time">' + time + "</span>" : "") +
      "</button>"
    );
  }

  var schoolSelection = { groupId: "", ids: [] };

  async function renderSchoolGroup(groupId) {
    setActiveTab("school");
    if (schoolSelection.groupId !== groupId) schoolSelection = { groupId: groupId, ids: [] };
    var data;
    try {
      data = await api("GET", "/school/groups/" + encodeURIComponent(groupId));
    } catch (err) {
      toast(err.message, true);
      history.replaceState(null, "", "#/scolaire");
      return renderSchool(true);
    }
    var kind = data.kinds[data.school.kind] || data.kinds.ecole;
    var selected = {};
    schoolSelection.ids = schoolSelection.ids.filter(function (id) { return data.photos.some(function (p) { return p.id === id; }); });
    schoolSelection.ids.forEach(function (id) { selected[id] = true; });
    var groupPhotos = data.photos.filter(function (p) { return p.role === "group"; });
    var unsorted = data.photos.filter(function (p) { return p.role !== "group" && !p.childId; });
    var byChild = {};
    data.photos.forEach(function (p) {
      if (p.childId && p.role !== "group") (byChild[p.childId] = byChild[p.childId] || []).push(p);
    });
    var undatedCount = unsorted.filter(function (p) { return !p.takenAt; }).length;

    function thumbs(list) {
      return '<div class="ad-sc-thumbs">' + list.map(function (p) { return schoolThumb(p, selected[p.id]); }).join("") + "</div>";
    }
    function childLabel(c) {
      return "Enfant " + c.number + (c.firstName ? " · " + c.firstName : "");
    }

    var childrenHtml = data.children.map(function (c, i) {
      var prev = data.children[i - 1];
      return (
        '<article class="ad-sc-child" data-child="' + esc(c.id) + '">' +
        '<header><span class="ad-sc-child-num">' + c.number + "</span>" +
        '<input type="text" class="ad-sc-in" data-child-name maxlength="60" value="' + esc(c.firstName) + '" placeholder="Prénom (facultatif)" aria-label="Prénom de l\'enfant ' + c.number + '" />' +
        '<span class="ad-hint">' + (byChild[c.id] || []).length + " photo" + ((byChild[c.id] || []).length > 1 ? "s" : "") + "</span>" +
        (c.code ? '<span class="ad-sc-code" title="Code d\'accès de la famille">' + esc(c.code) + "</span>" : "") +
        (prev ? '<button type="button" class="ad-link-btn" data-merge="' + esc(prev.id) + '" title="Même enfant : réunir avec ' + esc(childLabel(prev)) + '">Fusionner avec le n° ' + prev.number + "</button>" : "") +
        "</header>" + thumbs(byChild[c.id] || []) + "</article>"
      );
    }).join("");

    var moveOptions = '<option value="">Déplacer vers…</option>' +
      '<option value="new">Un nouvel enfant</option>' +
      '<option value="group">' + esc(kind.groupPhoto) + "</option>" +
      '<option value="unsorted">À trier</option>' +
      data.children.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(childLabel(c)) + "</option>"; }).join("");

    el.view.innerHTML =
      '<p class="ad-sc-back"><button type="button" class="ad-link-btn" id="ad-sc-back-school">← ' + esc(data.school.name) + " · " + esc(data.year.label) + "</button></p>" +
      '<header class="ad-detail-header"><div><p class="ad-sc-kind">' + esc(kind.group) + "</p><h2>" + esc(data.group.name) + "</h2>" +
      '<p class="ad-hint">' + esc([data.group.leader, data.photos.length + " photo" + (data.photos.length > 1 ? "s" : ""),
        data.children.length + " enfant" + (data.children.length > 1 ? "s" : "")].filter(Boolean).join(" · ")) + "</p></div></header>" +

      '<section class="ad-dropzone" id="ad-sc-drop">' +
      "<p><strong>Glissez les photos de " + esc(kind.group.toLowerCase()) + " " + esc(data.group.name) + "</strong> (portraits et " + esc(kind.groupPhoto.toLowerCase()) + "), ou</p>" +
      '<div class="ad-sc-actions" style="justify-content:center">' +
      '<label class="ad-btn ad-btn-primary">Choisir des photos<input type="file" id="ad-sc-files" accept="image/jpeg,image/*" multiple hidden /></label>' +
      '<label class="ad-btn">Choisir un dossier<input type="file" id="ad-sc-folder" webkitdirectory multiple hidden /></label></div>' +
      '<p class="ad-hint ad-sc-drop-hint">Gardez les fichiers d\'origine de l\'appareil : leur heure de prise de vue sert à reconnaître chaque enfant.</p>' +
      '<div class="ad-sc-progress" id="ad-sc-progress" hidden><div class="ad-sc-progress-bar"><span id="ad-sc-progress-fill"></span></div><p class="ad-hint" id="ad-sc-progress-text"></p></div>' +
      "</section>" +

      '<div class="ad-sc-toolbar" id="ad-sc-toolbar"' + (schoolSelection.ids.length ? "" : " hidden") + '>' +
      '<span id="ad-sc-sel-count"></span>' +
      '<select id="ad-sc-move" aria-label="Déplacer les photos choisies">' + moveOptions + "</select>" +
      '<button type="button" class="ad-btn ad-btn-danger" id="ad-sc-sel-delete">Supprimer</button>' +
      '<button type="button" class="ad-link-btn" id="ad-sc-sel-clear">Annuler</button></div>' +

      (unsorted.length
        ? '<section class="ad-sc-unsorted"><div class="ad-section-header"><h3>À trier (' + unsorted.length + ")</h3>" +
          (unsorted.length > undatedCount ? '<button type="button" class="ad-btn ad-btn-primary" id="ad-sc-arrange">Regrouper par enfant</button>' : "") + "</div>" +
          (undatedCount ? '<p class="ad-hint">' + undatedCount + " photo" + (undatedCount > 1 ? "s n'ont" : " n'a") + " pas d'heure de prise de vue : choisissez-les puis « Déplacer vers… ».</p>" : "") +
          thumbs(unsorted) + "</section>"
        : "") +

      '<section><div class="ad-section-header"><h3>' + esc(kind.groupPhoto) + " (" + groupPhotos.length + ")</h3></div>" +
      (groupPhotos.length ? thumbs(groupPhotos)
        : '<p class="ad-hint">Choisissez la ou les photos de groupe dans la grille, puis « Déplacer vers… » ' + esc(kind.groupPhoto.toLowerCase()) + ". Toutes les familles du groupe la verront.</p>") +
      "</section>" +

      (data.children.length ? couponsSectionHtml({ id: data.year.id, orderDeadline: data.year.orderDeadline }, data.group, kind, data.children.length) : "") +
      '<section><div class="ad-section-header"><h3>Enfants (' + data.children.length + ")</h3></div>" +
      (data.children.length
        ? '<p class="ad-hint">Vérifiez d\'un coup d\'œil : chaque carte doit montrer un seul enfant. Cliquez sur des photos pour les choisir et les déplacer ; deux cartes du même enfant se fusionnent.</p>' +
          '<div class="ad-sc-children">' + childrenHtml + "</div>"
        : '<p class="ad-hint">Les enfants apparaîtront ici une fois les photos importées et regroupées.</p>') +
      "</section>";

    function updateToolbar() {
      var n = schoolSelection.ids.length;
      document.getElementById("ad-sc-toolbar").hidden = n === 0;
      document.getElementById("ad-sc-sel-count").textContent = n + " photo" + (n > 1 ? "s choisies" : " choisie");
    }
    updateToolbar();

    function reload() { renderSchoolGroup(groupId); }

    document.getElementById("ad-sc-back-school").addEventListener("click", function () {
      history.pushState(null, "", "#/scolaire/" + encodeURIComponent(data.school.id) + "/" + encodeURIComponent(data.year.id));
      renderSchool(true);
    });

    el.view.querySelectorAll("[data-photo]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-photo");
        var at = schoolSelection.ids.indexOf(id);
        if (at === -1) schoolSelection.ids.push(id);
        else schoolSelection.ids.splice(at, 1);
        btn.classList.toggle("ad-sc-thumb-on", at === -1);
        btn.setAttribute("aria-pressed", String(at === -1));
        updateToolbar();
      });
    });
    document.getElementById("ad-sc-sel-clear").addEventListener("click", function () {
      schoolSelection.ids = [];
      reload();
    });
    document.getElementById("ad-sc-move").addEventListener("change", async function () {
      var to = this.value;
      if (!to) return;
      try {
        await api("POST", "/school/groups/" + encodeURIComponent(groupId) + "/assign", { photoIds: schoolSelection.ids, to: to });
        schoolSelection.ids = [];
        reload();
      } catch (err) {
        toast(err.message, true);
        this.value = "";
      }
    });
    document.getElementById("ad-sc-sel-delete").addEventListener("click", async function () {
      var ids = schoolSelection.ids.slice();
      this.disabled = true;
      try {
        for (var i = 0; i < ids.length; i++) {
          await api("DELETE", "/galleries/" + encodeURIComponent(data.group.gallerySlug) + "/photos/" + encodeURIComponent(ids[i]));
        }
        toast(ids.length + " photo" + (ids.length > 1 ? "s supprimées." : " supprimée."));
        schoolSelection.ids = [];
        reload();
      } catch (err) {
        toast(err.message, true);
        this.disabled = false;
      }
    });
    var arrange = document.getElementById("ad-sc-arrange");
    if (arrange) arrange.addEventListener("click", async function () {
      this.disabled = true;
      try {
        var result = await api("POST", "/school/groups/" + encodeURIComponent(groupId) + "/arrange", {});
        toast(result.created + " enfant" + (result.created > 1 ? "s trouvés." : " trouvé."));
        reload();
      } catch (err) {
        toast(err.message, true);
        this.disabled = false;
      }
    });
    el.view.querySelectorAll("[data-child]").forEach(function (card) {
      var childId = card.getAttribute("data-child");
      card.querySelector("[data-child-name]").addEventListener("change", async function () {
        try {
          await api("POST", "/school/children/" + encodeURIComponent(childId), { firstName: this.value });
          toast("Prénom enregistré.");
        } catch (err) {
          toast(err.message, true);
        }
      });
      var merge = card.querySelector("[data-merge]");
      if (merge) merge.addEventListener("click", async function () {
        try {
          await api("POST", "/school/children/" + encodeURIComponent(childId) + "/merge", { into: merge.getAttribute("data-merge") });
          reload();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    // Envoi : trois photos à la fois, puis regroupement automatique.
    async function uploadAll(files) {
      files = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name); });
      if (!files.length) return;
      var box = document.getElementById("ad-sc-progress");
      var fill = document.getElementById("ad-sc-progress-fill");
      var label = document.getElementById("ad-sc-progress-text");
      box.hidden = false;
      var done = 0, failed = 0, next = 0, base = data.photos.length;
      function show() {
        fill.style.width = Math.round(((done + failed) / files.length) * 100) + "%";
        label.textContent = (done + failed) + " / " + files.length + " photos traitées" + (failed ? " · " + failed + " en échec" : "");
      }
      show();
      async function worker() {
        while (next < files.length) {
          var file = files[next];
          var position = base + next;
          next += 1;
          var form = new FormData();
          form.append("file", file, file.name);
          form.append("position", String(position));
          try {
            var response = await fetch("/local/school/groups/" + encodeURIComponent(groupId) + "/photos", { method: "POST", body: form });
            if (!response.ok) throw new Error(((await response.json().catch(function () { return {}; })).error) || "HTTP " + response.status);
            done += 1;
          } catch (err) {
            failed += 1;
            console.error(file.name, err);
          }
          show();
        }
      }
      await Promise.all([worker(), worker(), worker()]);
      try {
        var result = await api("POST", "/school/groups/" + encodeURIComponent(groupId) + "/arrange", {});
        toast(done + " photo" + (done > 1 ? "s importées" : " importée") + ", " + result.created + " enfant" + (result.created > 1 ? "s trouvés." : " trouvé.") +
          (failed ? " " + failed + " en échec : réessayez-les." : ""), Boolean(failed));
      } catch (err) {
        toast(err.message, true);
      }
      reload();
    }
    document.getElementById("ad-sc-files").addEventListener("change", function () { uploadAll(this.files); });
    document.getElementById("ad-sc-folder").addEventListener("change", function () { uploadAll(this.files); });
    var drop = document.getElementById("ad-sc-drop");
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("ad-dropzone-active"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("ad-dropzone-active"); });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("ad-dropzone-active");
      uploadAll(e.dataTransfer.files);
    });
  }

  /* ---------- Réservations (formules, créneaux, séances réservées) ---------- */

  var BOOKING_ZONE = "Europe/Brussels";
  var BOOKING_STATUS = {
    confirmed: ["Confirmée", "ad-badge-validated"],
    pending: ["Paiement en cours", "ad-badge-soon"],
    cancelled: ["Annulée", "ad-badge-expired"],
    conflict: ["Acompte à rembourser", "ad-badge-due"],
  };
  // formOpen : formulaire de création ouvert ; draft : réglages de départ
  // (prestation enregistrée choisie dans « Type de séance »).
  var bookingState = { data: null, editingOfferId: "", slotMode: "times", formOpen: false, draft: null };

  function bookingDay(ts) {
    return new Date(ts * 1000).toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: BOOKING_ZONE });
  }
  function bookingTime(ts) {
    return new Date(ts * 1000).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: BOOKING_ZONE }).replace(":", " h ");
  }
  function durationText(minutes) {
    if (minutes < 60) return minutes + " min";
    var m = minutes % 60;
    return Math.floor(minutes / 60) + " h" + (m ? " " + String(m).padStart(2, "0") : "");
  }
  // « 30 », « 30,5 », « 30.50 € » → centimes ; NaN si illisible.
  function bookingCents(value) {
    var clean = String(value || "").replace(/[€\s]/g, "").replace(",", ".");
    if (!clean) return 0;
    return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : NaN;
  }
  function bookingEurosInput(cents) {
    return cents ? (cents / 100).toFixed(2).replace(".", ",").replace(",00", "") : "";
  }

  // « 5 photos 90 € / 10 photos 120 € » pour une formule à plusieurs tarifs.
  function bookingTiersText(tiers) {
    return (tiers || []).map(function (t) {
      return (t.label ? t.label + " : " : "") + t.photos + " photo" + (t.photos > 1 ? "s" : "") + " " + formatEuros(t.priceCents);
    }).join(" / ");
  }

  function offerMetaText(o) {
    var tiered = o.tiers && o.tiers.length;
    return [
      durationText(o.durationMin),
      tiered ? bookingTiersText(o.tiers) : (o.priceCents ? formatEuros(o.priceCents) : ""),
      o.depositCents ? "acompte " + formatEuros(o.depositCents) : "sans acompte",
      o.location,
    ].filter(Boolean).join(" · ");
  }

  function bookingTierRowHtml(t) {
    t = t || { label: "", photos: "", priceCents: 0 };
    return '<div class="ad-bk-tier">' +
      '<input data-tier="label" maxlength="40" placeholder="Nom (facultatif)" value="' + esc(t.label || "") + '" aria-label="Nom du tarif (facultatif)" />' +
      '<label class="ad-bk-tier-num"><input data-tier="photos" inputmode="numeric" maxlength="3" placeholder="10" value="' + esc(t.photos || "") + '" aria-label="Nombre de photos" /><span>photos</span></label>' +
      '<label class="ad-bk-tier-num"><input data-tier="price" inputmode="decimal" placeholder="120" value="' + esc(bookingEurosInput(t.priceCents)) + '" aria-label="Prix en euros" /><span>€</span></label>' +
      '<button type="button" class="ad-btn ad-btn-small ad-btn-icon" data-tier-remove aria-label="Retirer ce tarif">×</button>' +
      "</div>";
  }

  function bookingImageUrl(imageId) {
    return "/local/booking/images/" + encodeURIComponent(imageId);
  }

  function offerImageFieldHtml(imageId) {
    return '<div class="ad-bk-image" id="ad-bk-image">' +
      '<input type="hidden" name="imageId" value="' + esc(imageId || "") + '" />' +
      '<div class="ad-bk-image-preview">' + (imageId ? '<img src="' + esc(bookingImageUrl(imageId)) + '" alt="" />' : '<span>Aucune image</span>') + "</div>" +
      '<div class="ad-bk-image-side">' +
      '<span class="ad-bk-image-title">Image d\'illustration <em>(facultatif)</em></span>' +
      '<span class="ad-hint">Elle accompagne la formule sur votre mini-site : le décor, une photo de la séance de l\'an dernier… JPEG, PNG ou WebP.</span>' +
      '<div class="ad-bk-image-actions">' +
      '<label class="ad-btn ad-btn-small ad-bk-image-pick"><input type="file" accept="image/jpeg,image/png,image/webp" id="ad-bk-image-file" />' + (imageId ? "Changer l\'image" : "Choisir une image") + "</label>" +
      (imageId ? '<button type="button" class="ad-link-btn" id="ad-bk-image-remove">Retirer</button>' : "") +
      "</div></div></div>";
  }

  // Une prestation enregistrée porte-t-elle déjà ce nom ?
  function bookingTemplateNamed(title) {
    var key = String(title || "").trim().toLowerCase();
    return ((bookingState.data && bookingState.data.templates) || []).filter(function (t) { return t.title.toLowerCase() === key; })[0] || null;
  }

  function offerFormHtml(o) {
    o = o || { title: "", durationMin: 60, priceCents: 0, depositCents: 0, tiers: [], location: "", description: "", included: "", dressCode: "", imageId: "" };
    var editing = Boolean(o.id);
    var tiered = Boolean(o.tiers && o.tiers.length);
    var tierRows = tiered ? o.tiers : [null, null];
    // Nouvelle formule : enregistrée comme prestation par défaut ; formule
    // existante : cochée si une prestation du même nom existe déjà.
    var save = editing ? Boolean(bookingTemplateNamed(o.title)) : true;
    return '<form id="ad-bk-offer-form" class="ad-bk-offer-form" novalidate>' +
      offerImageFieldHtml(o.imageId) +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Nom de la formule</span><input name="title" maxlength="80" required placeholder="ex. Mini-séance de Noël" value="' + esc(o.title) + '" /></label>' +
      '<label class="ad-field"><span>Durée <em>(minutes)</em></span><input name="durationMin" type="number" min="5" max="720" step="5" required value="' + esc(o.durationMin) + '" /></label>' +
      "</div>" +
      '<div class="ad-bk-pricing">' +
      '<div class="ad-seg" role="group" aria-label="Tarif">' +
      '<button type="button" class="ad-seg-btn" data-bk-pricing="single" aria-pressed="' + !tiered + '">Prix unique</button>' +
      '<button type="button" class="ad-seg-btn" data-bk-pricing="tiers" aria-pressed="' + tiered + '">Plusieurs tarifs selon le nombre de photos</button>' +
      "</div>" +
      '<div class="ad-field-row" data-bk-pricing-panel="single"' + (tiered ? " hidden" : "") + ">" +
      '<label class="ad-field"><span>Prix de la séance <em>(€, facultatif)</em></span><input name="price" inputmode="decimal" placeholder="ex. 90" value="' + esc(tiered ? "" : bookingEurosInput(o.priceCents)) + '" /></label>' +
      "</div>" +
      '<div class="ad-bk-tiers-box" data-bk-pricing-panel="tiers"' + (tiered ? "" : " hidden") + ">" +
      '<div class="ad-bk-tiers" id="ad-bk-tiers">' + tierRows.map(bookingTierRowHtml).join("") + "</div>" +
      '<button type="button" class="ad-link-btn" id="ad-bk-tier-add">+ Ajouter un tarif</button>' +
      '<p class="ad-hint">Vos clients choisissent leur tarif en réservant, par exemple 5, 10 ou 15 photos. L\'acompte ci-dessous vaut pour tous les tarifs.</p>' +
      "</div>" +
      '<label class="ad-field"><span>Acompte payé en ligne <em>(€, 0 = sans acompte)</em></span><input name="deposit" inputmode="decimal" placeholder="ex. 30" value="' + esc(bookingEurosInput(o.depositCents)) + '" /></label>' +
      "</div>" +
      '<label class="ad-field"><span>Lieu <em>(facultatif)</em></span><input name="location" maxlength="160" placeholder="ex. Studio, rue de la Station 12, Liège" value="' + esc(o.location) + '" /></label>' +
      '<label class="ad-field"><span>Description <em>(facultatif, visible par vos clients)</em></span><textarea name="description" rows="3" maxlength="1000" placeholder="L\'ambiance de la séance, le décor, pour qui elle est pensée…">' + esc(o.description) + "</textarea></label>" +
      '<div class="ad-field-row ad-bk-notes">' +
      '<label class="ad-field"><span>Compris dans votre forfait <em>(une ligne par élément)</em></span><textarea name="included" rows="4" maxlength="1000" placeholder="10 photos retouchées&#10;Galerie privée en ligne&#10;Accessoires et tenues bébé fournis">' + esc(o.included || "") + "</textarea></label>" +
      '<label class="ad-field"><span>Conseil vestimentaire <em>(facultatif)</em></span><textarea name="dressCode" rows="4" maxlength="1000" placeholder="Tons doux et unis, sans logo ni grosse inscription. Prévoyez une tenue de rechange pour les plus petits.">' + esc(o.dressCode || "") + "</textarea></label>" +
      "</div>" +
      '<label class="ad-check ad-bk-save"><input type="checkbox" name="saveTemplate"' + (save ? " checked" : "") + " />" +
      "<span><strong>Sauvegarder le réglage de cette prestation</strong>" +
      '<span class="ad-hint">Vous la retrouverez dans « Type de séance » pour la remettre en ligne sans tout reparamétrer.</span></span></label>' +
      '<div class="ad-sc-actions">' +
      '<button type="submit" class="ad-btn ad-btn-primary">' + (editing ? "Enregistrer la formule" : "Ajouter la formule") + "</button>" +
      ((editing || bookingState.data && bookingState.data.offers.length) ? '<button type="button" class="ad-btn" id="ad-bk-offer-cancel">Annuler</button>' : "") +
      "</div></form>";
  }

  function templateMetaText(t) {
    var tiered = t.tiers && t.tiers.length;
    return [
      durationText(t.durationMin),
      tiered ? "à partir de " + formatEuros(t.tiers[0].priceCents) : (t.priceCents ? formatEuros(t.priceCents) : ""),
    ].filter(Boolean).join(" · ");
  }

  // « Type de séance » : partir d'une prestation enregistrée, ou en créer une.
  function offerStarterHtml(data) {
    var templates = data.templates || [];
    return '<div class="ad-bk-starter">' +
      '<label class="ad-field"><span>Type de séance</span><select id="ad-bk-template">' +
      '<option value="">' + (templates.length ? "Choisir une prestation enregistrée…" : "Aucune prestation enregistrée pour l\'instant") + "</option>" +
      templates.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.title) + " · " + esc(templateMetaText(t)) + "</option>";
      }).join("") + "</select></label>" +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-bk-new">Créer une nouvelle prestation</button>' +
      "</div>" +
      (templates.length
        ? '<details class="ad-advanced ad-bk-templates"><summary>Prestations enregistrées (' + templates.length + ")</summary><ul>" +
          templates.map(function (t) {
            return '<li>' + (t.imageId ? '<img src="' + esc(bookingImageUrl(t.imageId)) + '" alt="" loading="lazy" />' : '<span class="ad-bk-thumb-empty" aria-hidden="true"></span>') +
              '<span><strong>' + esc(t.title) + '</strong><span class="ad-hint">' + esc(templateMetaText(t)) + "</span></span>" +
              '<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-bk-template-delete="' + esc(t.id) + '">Supprimer</button></li>';
          }).join("") + "</ul></details>"
        : '<p class="ad-hint">Cochez « Sauvegarder le réglage de cette prestation » en la créant : elle s\'ajoutera à cette liste.</p>');
  }

  function offersSectionHtml(data) {
    var rows = data.offers.map(function (o) {
      var slotsLeft = data.slots.filter(function (s) { return s.offerId === o.id && !s.bookingId && s.startsAt > Date.now() / 1000; }).length;
      return '<li class="ad-bk-offer' + (o.active ? "" : " ad-bk-offer-off") + '" data-offer-id="' + esc(o.id) + '">' +
        (o.imageId ? '<img class="ad-bk-thumb" src="' + esc(bookingImageUrl(o.imageId)) + '" alt="" loading="lazy" />' : '<span class="ad-bk-thumb ad-bk-thumb-empty" aria-hidden="true"></span>') +
        '<div class="ad-bk-offer-main"><strong>' + esc(o.title) + "</strong>" +
        '<span class="ad-hint">' + esc(offerMetaText(o)) + "</span>" +
        '<span class="ad-hint">' + slotsLeft + " créneau" + (slotsLeft > 1 ? "x" : "") + " libre" + (slotsLeft > 1 ? "s" : "") +
        (o.depositCents && !data.stripeReady ? " · en attente du paiement en ligne" : "") + "</span></div>" +
        '<label class="ad-sc-toggle"><input type="checkbox" data-bk-active ' + (o.active ? "checked" : "") + " /> Proposée</label>" +
        '<button type="button" class="ad-btn ad-btn-small" data-bk-edit>Modifier</button>' +
        '<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-bk-delete>Supprimer</button>' +
        "</li>";
    }).join("");
    var editing = bookingState.editingOfferId && data.offers.filter(function (o) { return o.id === bookingState.editingOfferId; })[0];
    var draft = bookingState.draft;
    var creating = bookingState.formOpen || !data.offers.length;
    return '<section id="ad-bk-offers"><div class="ad-section-header"><h3>Formules de séance</h3></div>' +
      (rows ? '<ul class="ad-bk-offers">' + rows + "</ul>" : '<p class="ad-hint">Une formule décrit ce que vos clients réservent : séance famille d\'1 h, mini-séance de Noël de 20 min… Commencez par en créer une.</p>') +
      (editing
        ? '<h4 class="ad-sc-subhead">Modifier « ' + esc(editing.title) + " »</h4>" + offerFormHtml(editing)
        : offerStarterHtml(data) +
          (creating
            ? '<h4 class="ad-sc-subhead">' + (draft ? "Nouvelle formule à partir de « " + esc(draft.title) + " »" : "Nouvelle prestation") + "</h4>" +
              offerFormHtml(draft ? {
                title: draft.title, durationMin: draft.durationMin, priceCents: draft.priceCents, depositCents: draft.depositCents,
                tiers: draft.tiers, location: draft.location, description: draft.description, included: draft.included,
                dressCode: draft.dressCode, imageId: draft.imageId,
              } : null)
            : "")) +
      "</section>";
  }

  function slotsSectionHtml(data) {
    if (!data.offers.length) return "";
    var today = new Date().toLocaleDateString("en-CA", { timeZone: BOOKING_ZONE });
    var bookingsById = {};
    data.bookings.forEach(function (b) { bookingsById[b.id] = b; });
    var offersById = {};
    data.offers.forEach(function (o) { offersById[o.id] = o; });
    var future = data.slots.filter(function (s) { return s.startsAt > Date.now() / 1000; });
    var days = [];
    var byDay = {};
    future.forEach(function (s) {
      var key = bookingDay(s.startsAt);
      if (!byDay[key]) { byDay[key] = []; days.push(key); }
      byDay[key].push(s);
    });
    var series = bookingState.slotMode === "series";
    return '<section id="ad-bk-slots"><div class="ad-section-header"><h3>Créneaux</h3></div>' +
      '<p class="ad-hint">Ouvrez des horaires précis, ou une série pour vos mini-séances (par exemple de 10 h à 16 h, toutes les 20 minutes). Heure de Bruxelles.</p>' +
      '<form id="ad-bk-slot-form" class="ad-bk-slot-form" novalidate>' +
      '<div class="ad-seg" role="group" aria-label="Type de créneaux">' +
      '<button type="button" class="ad-seg-btn" data-bk-mode="times" aria-pressed="' + !series + '">Horaires précis</button>' +
      '<button type="button" class="ad-seg-btn" data-bk-mode="series" aria-pressed="' + series + '">Série (mini-séances)</button></div>' +
      '<div class="ad-bk-slot-fields">' +
      '<label class="ad-field"><span>Formule</span><select name="offerId">' + data.offers.map(function (o) {
        return '<option value="' + esc(o.id) + '">' + esc(o.title) + " (" + esc(durationText(o.durationMin)) + ")</option>";
      }).join("") + "</select></label>" +
      '<label class="ad-field"><span>Date</span><input type="date" name="date" min="' + today + '" required /></label>' +
      (series
        ? '<label class="ad-field"><span>De</span><input type="time" name="from" value="10:00" required /></label>' +
          '<label class="ad-field"><span>À</span><input type="time" name="to" value="16:00" required /></label>' +
          '<label class="ad-field"><span>Toutes les <em>(min)</em></span><input type="number" name="every" min="5" max="720" step="5" placeholder="durée" /></label>'
        : '<label class="ad-field ad-bk-times"><span>Heure(s) <em>(séparées par des virgules)</em></span><input name="times" placeholder="ex. 10:00, 14:30" required /></label>') +
      '<button type="submit" class="ad-btn ad-btn-primary">Ouvrir ' + (series ? "la série" : "les créneaux") + "</button>" +
      "</div></form>" +
      (days.length
        ? '<div class="ad-bk-days">' + days.map(function (day) {
            // Le nom de la formule n'est utile que si plusieurs se partagent la journée.
            var mixed = byDay[day].some(function (s) { return s.offerId !== byDay[day][0].offerId; });
            var single = !mixed && offersById[byDay[day][0].offerId];
            return '<div class="ad-bk-day"><h4>' + esc(day) + (single && data.offers.length > 1 ? ' <span class="ad-hint">· ' + esc(single.title) + "</span>" : "") +
              '</h4><ul class="ad-bk-chips">' + byDay[day].map(function (s) {
              var b = s.bookingId ? bookingsById[s.bookingId] : null;
              var o = offersById[s.offerId];
              var label = bookingTime(s.startsAt) + (mixed && o ? " · " + o.title : "");
              return b
                ? '<li class="ad-bk-chip ad-bk-chip-booked" title="' + esc(o ? o.title : "") + '">' + esc(label) + " · " + esc(b.clientName) + "</li>"
                : '<li class="ad-bk-chip" title="' + esc(o ? o.title : "") + '">' + esc(label) +
                  '<button type="button" data-bk-slot-delete="' + esc(s.id) + '" aria-label="Supprimer le créneau de ' + esc(label) + '">×</button></li>';
            }).join("") + "</ul></div>";
          }).join("") + "</div>"
        : '<p class="ad-hint">Aucun créneau ouvert pour l\'instant.</p>') +
      "</section>";
  }

  function bookingRowHtml(b, actionable) {
    var status = BOOKING_STATUS[b.status] || [b.status, ""];
    return "<tr>" +
      '<td><strong>' + esc(bookingDay(b.startsAt)) + "</strong><br>" + esc(bookingTime(b.startsAt)) + " · " + esc(durationText(b.durationMin)) + "</td>" +
      "<td>" + esc(b.offerTitle) +
      (b.photos ? '<br><span class="ad-hint">' + esc(b.photos + " photo" + (b.photos > 1 ? "s" : "") + (b.tierLabel ? " (" + b.tierLabel + ")" : "") + " · " + formatEuros(b.priceCents)) + "</span>" : "") +
      (b.location ? '<br><span class="ad-hint">' + esc(b.location) + "</span>" : "") + "</td>" +
      '<td><span class="ad-acc-name">' + clLink(b.clientName, b.clientEmail) + "</span>" +
      '<a class="ad-acc-sub" href="mailto:' + esc(b.clientEmail) + '">' + esc(b.clientEmail) + "</a>" +
      (b.clientPhone ? '<span class="ad-acc-sub">' + esc(b.clientPhone) + "</span>" : "") +
      (b.message ? '<span class="ad-bk-message">« ' + esc(b.message) + " »</span>" : "") + "</td>" +
      '<td class="ad-num">' + (b.depositCents ? formatEuros(b.depositCents) : "—") + "</td>" +
      '<td><span class="ad-badge ' + status[1] + '">' + esc(status[0]) + "</span></td>" +
      '<td class="ad-row-actions">' + (actionable && b.status !== "cancelled"
        ? '<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-bk-cancel="' + esc(b.id) + '">Annuler</button>'
        : "") + "</td></tr>";
  }

  function bookingsTableHtml(list, actionable) {
    return '<div class="ad-table-wrap"><table class="ad-table ad-bk-table"><thead><tr><th>Quand</th><th>Séance</th><th>Client</th><th class="ad-num">Acompte</th><th>État</th><th><span class="ad-visually-hidden">Actions</span></th></tr></thead><tbody>' +
      list.map(function (b) { return bookingRowHtml(b, actionable); }).join("") + "</tbody></table></div>";
  }

  async function renderBooking(skipHash) {
    if (!skipHash && location.hash !== "#/reservations") history.pushState(null, "", "#/reservations");
    setActiveTab("booking");
    if (!bookingState.data) el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
    var data;
    try {
      data = await api("GET", "/booking");
    } catch (err) {
      el.view.innerHTML = '<div class="ad-error-panel"><h2>Réservations indisponibles</h2><p>' + esc(err.message) + "</p></div>";
      return;
    }
    if (location.hash !== "#/reservations") return;
    paintBooking(data);
  }

  function paintBooking(data) {
    bookingState.data = data;
    var nowTs = Date.now() / 1000;
    var upcoming = data.bookings.filter(function (b) { return b.startsAt >= nowTs - 3600 && b.status !== "cancelled"; });
    var past = data.bookings.filter(function (b) { return b.startsAt < nowTs - 3600 || b.status === "cancelled"; }).reverse();
    var freeSlots = data.slots.filter(function (s) { return !s.bookingId && s.startsAt > nowTs; }).length;
    var depositsAhead = upcoming.filter(function (b) { return b.status === "confirmed"; })
      .reduce(function (sum, b) { return sum + b.depositCents; }, 0);

    var notices = "";
    if (!data.enabled) {
      notices += '<p class="ad-banner ad-banner-muted">La réservation en ligne est incluse dans la formule Pro. ' +
        '<button type="button" class="ad-link-btn" data-bk-goto="subscription">Voir les formules</button></p>';
    } else {
      if (!data.portfolio.published) {
        notices += '<p class="ad-banner ad-banner-muted">Vos clients réservent depuis votre mini-site : publiez-le pour ouvrir les réservations. ' +
          '<button type="button" class="ad-link-btn" data-bk-goto="portfolio">Onglet Portfolio</button></p>';
      }
      if (!data.stripeReady && data.offers.some(function (o) { return o.depositCents > 0; })) {
        notices += '<p class="ad-banner ad-banner-muted">Les formules avec acompte seront proposées dès que le paiement en ligne sera activé. Celles sans acompte sont déjà réservables. ' +
          '<button type="button" class="ad-link-btn" data-bk-goto="billing">Onglet Facturation</button></p>';
      }
    }

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Réservations</h2>' +
      '<p class="ad-hint">Vos clients choisissent un créneau sur votre mini-site et règlent l\'acompte en ligne ; vous recevez la réservation par e-mail, avec l\'invitation pour votre agenda.</p></div>' +
      (data.portfolio.published && data.portfolio.url ? '<a class="ad-btn" href="' + esc(data.portfolio.url) + '" target="_blank" rel="noopener">Voir la page de réservation</a>' : "") +
      "</header>" +
      notices +
      (data.enabled
        ? '<div class="ad-stats">' +
          salesStatHtml("Séances à venir", String(upcoming.filter(function (b) { return b.status === "confirmed"; }).length), "") +
          salesStatHtml("Créneaux libres", String(freeSlots), "") +
          salesStatHtml("Acomptes encaissés", depositsAhead ? formatEuros(depositsAhead) : "—", "Séances à venir") +
          "</div>" +
          '<section id="ad-bk-upcoming"><div class="ad-section-header"><h3>Prochaines séances</h3></div>' +
          (upcoming.length ? bookingsTableHtml(upcoming, true) : '<p class="ad-hint">Aucune séance réservée pour l\'instant. Ouvrez des créneaux ci-dessous : ils apparaissent aussitôt sur votre mini-site.</p>') +
          (past.length ? '<details class="ad-advanced"><summary>Séances passées et annulées (' + past.length + ")</summary>" + bookingsTableHtml(past, false) + "</details>" : "") +
          "</section>" +
          offersSectionHtml(data) +
          slotsSectionHtml(data)
        : "");

    bindBooking(data);
  }

  async function bookingCall(method, path, body, okMessage) {
    try {
      var data = await api(method, "/booking" + path, body);
      if (okMessage) toast(typeof okMessage === "function" ? okMessage(data) : okMessage);
      paintBooking(data);
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }

  function bindBooking(data) {
    el.view.querySelectorAll("[data-bk-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-bk-goto");
        if (target === "subscription") renderSubscription();
        else if (target === "portfolio") renderPortfolio();
        else renderBilling();
      });
    });

    var offerForm = document.getElementById("ad-bk-offer-form");
    if (offerForm) {
      offerForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var f = offerForm.elements;
        var tieredMode = offerForm.querySelector('[data-bk-pricing="tiers"]').getAttribute("aria-pressed") === "true";
        var priceCents = tieredMode ? 0 : bookingCents(f.price.value);
        var depositCents = bookingCents(f.deposit.value);
        if (isNaN(priceCents) || isNaN(depositCents)) { toast("Montant illisible : écrivez par exemple 30 ou 30,50.", true); return; }
        // Plusieurs tarifs : les lignes laissées vides sont ignorées.
        var tiers = [];
        if (tieredMode) {
          var problem = "";
          offerForm.querySelectorAll(".ad-bk-tier").forEach(function (row) {
            var label = row.querySelector('[data-tier="label"]').value.trim();
            var photosRaw = row.querySelector('[data-tier="photos"]').value.trim();
            var priceRaw = row.querySelector('[data-tier="price"]').value.trim();
            if (!label && !photosRaw && !priceRaw) return;
            var photos = Number(photosRaw);
            var cents = bookingCents(priceRaw);
            if (!problem && !(Number.isInteger(photos) && photos >= 1)) problem = "Indiquez le nombre de photos de chaque tarif.";
            if (!problem && (isNaN(cents) || cents < 100)) problem = "Indiquez le prix de chaque tarif, par exemple 120 ou 120,50.";
            tiers.push({ label: label, photos: photos, priceCents: cents });
          });
          if (problem) { toast(problem, true); return; }
          if (!tiers.length) { toast("Ajoutez au moins un tarif, ou choisissez « Prix unique ».", true); return; }
        }
        if (offerForm.getAttribute("data-uploading")) { toast("L'image est encore en cours d'envoi.", true); return; }
        var body = {
          title: f.title.value, durationMin: Number(f.durationMin.value), priceCents: priceCents, depositCents: depositCents,
          tiers: tiers, location: f.location.value, description: f.description.value,
          included: f.included.value, dressCode: f.dressCode.value, imageId: f.imageId.value,
          saveTemplate: f.saveTemplate.checked,
        };
        var editing = bookingState.editingOfferId;
        var saved = body.saveTemplate;
        var ok = await bookingCall("POST", editing ? "/offers/" + encodeURIComponent(editing) : "/offers", body, function (res) {
          if (res.templateError) return res.templateError;
          return (editing ? "Formule enregistrée" : "Formule ajoutée") + (saved ? " et prestation sauvegardée." : ".");
        });
        if (ok) {
          bookingState.editingOfferId = "";
          bookingState.formOpen = false;
          bookingState.draft = null;
          paintBooking(bookingState.data);
        }
      });
    }
    if (offerForm) {
      // Prix unique ou plusieurs tarifs : un seul des deux panneaux visible.
      offerForm.querySelectorAll("[data-bk-pricing]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var mode = btn.getAttribute("data-bk-pricing");
          offerForm.querySelectorAll("[data-bk-pricing]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
          offerForm.querySelectorAll("[data-bk-pricing-panel]").forEach(function (panel) { panel.hidden = panel.getAttribute("data-bk-pricing-panel") !== mode; });
          if (mode === "tiers") { var first = offerForm.querySelector('.ad-bk-tier [data-tier="photos"]'); if (first) first.focus(); }
        });
      });
      var tierBox = document.getElementById("ad-bk-tiers");
      var addTier = document.getElementById("ad-bk-tier-add");
      var syncTierAdd = function () { addTier.hidden = tierBox.children.length >= 6; };
      addTier.addEventListener("click", function () {
        tierBox.insertAdjacentHTML("beforeend", bookingTierRowHtml());
        tierBox.lastElementChild.querySelector('[data-tier="photos"]').focus();
        syncTierAdd();
      });
      tierBox.addEventListener("click", function (e) {
        var remove = e.target.closest("[data-tier-remove]");
        if (!remove) return;
        remove.closest(".ad-bk-tier").remove();
        if (!tierBox.children.length) tierBox.insertAdjacentHTML("beforeend", bookingTierRowHtml());
        syncTierAdd();
      });
      syncTierAdd();
    }
    var cancelEdit = document.getElementById("ad-bk-offer-cancel");
    if (cancelEdit) cancelEdit.addEventListener("click", function () {
      bookingState.editingOfferId = "";
      bookingState.formOpen = false;
      bookingState.draft = null;
      paintBooking(data);
    });

    // Type de séance : une prestation enregistrée pré-remplit le formulaire.
    var templateSelect = document.getElementById("ad-bk-template");
    var openForm = function (draft) {
      bookingState.formOpen = true;
      bookingState.draft = draft;
      paintBooking(data);
      var form = document.getElementById("ad-bk-offer-form");
      if (form) { form.scrollIntoView({ block: "start", behavior: "smooth" }); form.elements.title.focus({ preventScroll: true }); }
    };
    if (templateSelect) {
      if (bookingState.draft) templateSelect.value = bookingState.draft.id || "";
      templateSelect.addEventListener("change", function () {
        var t = (data.templates || []).filter(function (x) { return x.id === templateSelect.value; })[0];
        if (t) openForm(t);
      });
    }
    var newOffer = document.getElementById("ad-bk-new");
    if (newOffer) newOffer.addEventListener("click", function () { openForm(null); });
    el.view.querySelectorAll("[data-bk-template-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-bk-template-delete");
        var t = (data.templates || []).filter(function (x) { return x.id === id; })[0];
        confirmAction("Supprimer la prestation enregistrée « " + t.title + " » ? Les formules déjà en ligne ne changent pas.", function () {
          if (bookingState.draft && bookingState.draft.id === id) bookingState.draft = null;
          bookingCall("DELETE", "/templates/" + encodeURIComponent(id), null, "Prestation supprimée.");
        });
      });
    });

    // Image d'illustration : envoyée dès qu'elle est choisie (réduite par le
    // serveur), puis enregistrée avec la formule.
    var imageBox = document.getElementById("ad-bk-image");
    if (imageBox && offerForm) {
      var setImage = function (imageId) {
        var fresh = document.createElement("div");
        fresh.innerHTML = offerImageFieldHtml(imageId);
        imageBox.replaceWith(fresh.firstChild);
        imageBox = document.getElementById("ad-bk-image");
        bindImage();
      };
      var bindImage = function () {
        var file = document.getElementById("ad-bk-image-file");
        var remove = document.getElementById("ad-bk-image-remove");
        if (remove) remove.addEventListener("click", function () { setImage(""); });
        file.addEventListener("change", async function () {
          var chosen = file.files && file.files[0];
          if (!chosen) return;
          if (chosen.size > 40 * 1024 * 1024) { toast("Image trop lourde (40 Mo maximum).", true); return; }
          var body = new FormData();
          body.append("file", chosen);
          offerForm.setAttribute("data-uploading", "1");
          imageBox.classList.add("ad-bk-image-busy");
          imageBox.querySelector(".ad-bk-image-preview").innerHTML = "<span>Envoi…</span>";
          try {
            var response = await fetch("/local/booking/images", { method: "POST", body: body });
            var result = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(result.error || "L'image n'a pas pu être envoyée.");
            offerForm.removeAttribute("data-uploading");
            setImage(result.imageId);
          } catch (err) {
            offerForm.removeAttribute("data-uploading");
            toast(err.message, true);
            setImage(offerForm.elements.imageId.value);
          }
        });
      };
      bindImage();
    }

    el.view.querySelectorAll(".ad-bk-offer").forEach(function (row) {
      var id = row.getAttribute("data-offer-id");
      row.querySelector("[data-bk-active]").addEventListener("change", function (e) {
        bookingCall("POST", "/offers/" + encodeURIComponent(id), { active: e.target.checked },
          e.target.checked ? "Formule proposée sur votre mini-site." : "Formule retirée de votre mini-site.");
      });
      row.querySelector("[data-bk-edit]").addEventListener("click", function () {
        bookingState.editingOfferId = id;
        paintBooking(data);
        var form = document.getElementById("ad-bk-offer-form");
        if (form) { form.scrollIntoView({ block: "center" }); form.elements.title.focus(); }
      });
      row.querySelector("[data-bk-delete]").addEventListener("click", function () {
        var offer = data.offers.filter(function (o) { return o.id === id; })[0];
        confirmAction("Supprimer la formule « " + offer.title + " » et ses créneaux libres ?", function () {
          bookingCall("DELETE", "/offers/" + encodeURIComponent(id), null, "Formule supprimée.");
        });
      });
    });

    el.view.querySelectorAll("[data-bk-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        bookingState.slotMode = btn.getAttribute("data-bk-mode");
        paintBooking(data);
        document.getElementById("ad-bk-slots").scrollIntoView({ block: "start" });
      });
    });
    var slotForm = document.getElementById("ad-bk-slot-form");
    if (slotForm) {
      slotForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var f = slotForm.elements;
        var body = { offerId: f.offerId.value, date: f.date.value };
        if (!body.date) { toast("Choisissez une date.", true); return; }
        if (bookingState.slotMode === "series") {
          body.from = f.from.value;
          body.to = f.to.value;
          if (f.every.value) body.every = Number(f.every.value);
        } else {
          body.times = String(f.times.value).split(/[,;\s]+/).map(function (t) { return t.replace(/h/i, ":").replace(/:$/, ":00"); }).filter(Boolean);
        }
        bookingCall("POST", "/slots", body, function (res) {
          return res.created
            ? res.created + " créneau" + (res.created > 1 ? "x ouverts" : " ouvert") + (res.skipped ? " (" + res.skipped + " déjà ouvert" + (res.skipped > 1 ? "s" : "") + ")" : "") + "."
            : "Ces créneaux étaient déjà ouverts.";
        });
      });
    }
    el.view.querySelectorAll("[data-bk-slot-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        bookingCall("DELETE", "/slots/" + encodeURIComponent(btn.getAttribute("data-bk-slot-delete")), null, "Créneau supprimé.");
      });
    });
    el.view.querySelectorAll("[data-bk-cancel]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-bk-cancel");
        var b = data.bookings.filter(function (x) { return x.id === id; })[0];
        confirmAction("Annuler la séance de " + b.clientName + " (" + bookingDay(b.startsAt) + ", " + bookingTime(b.startsAt) + ") ? Le client est prévenu par e-mail" +
          (b.depositCents ? " ; remboursez l'acompte depuis votre tableau de bord Stripe." : "."), function () {
          bookingCall("POST", "/bookings/" + encodeURIComponent(id) + "/cancel", {}, "Séance annulée, le client est prévenu.");
        });
      });
    });
  }

  /* ---------- Devis et contrats signés en ligne ---------- */

  var CONTRACT_STATUS = {
    draft: ["Brouillon", ""],
    sent: ["Envoyé", "ad-badge-selected"],
    viewed: ["Lu par le client", "ad-badge-selected"],
    signed: ["Signé, acompte attendu", "ad-badge-soon"],
    paid: ["Signé", "ad-badge-validated"],
    declined: ["Refusé", "ad-badge-expired"],
    cancelled: ["Annulé", ""],
  };
  var contractsState = { data: null, editing: null };

  function contractStatusHtml(c) {
    var s = CONTRACT_STATUS[c.status] || [c.status, ""];
    var label = s[0];
    var cls = s[1];
    // Signé sans acompte demandé : le contrat est conclu, rien n'est attendu.
    if (c.status === "signed" && !c.depositCents) { label = "Signé"; cls = "ad-badge-validated"; }
    if (c.status === "paid") label = c.depositCents ? "Signé, acompte reçu" : "Signé";
    return '<span class="ad-badge ' + cls + '">' + esc(label) + "</span>";
  }

  function contractDateInput(ts) {
    return ts ? new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }) : "";
  }

  function contractLineRowHtml(line) {
    return '<div class="ad-ct-line">' +
      '<input class="ad-ct-line-label" placeholder="ex. Séance famille 1 h en extérieur" maxlength="160" value="' + esc(line.label || "") + '" aria-label="Prestation" />' +
      '<input class="ad-ct-line-amount" inputmode="decimal" placeholder="0" value="' + esc(line.amountCents ? bookingEurosInput(line.amountCents) : "") + '" aria-label="Montant en euros" />' +
      '<button type="button" class="ad-btn ad-btn-small ad-btn-icon" data-ct-remove-line aria-label="Retirer cette ligne">×</button></div>';
  }

  function contractEditorHtml(data, c) {
    var editing = Boolean(c && c.id);
    // Nouveau devis, éventuellement ouvert depuis la fiche d'un client.
    c = c || Object.assign({ clientName: "", clientEmail: "", title: "", sessionDate: "", sessionDay: "", sessionTime: "", lines: [{ label: "", amountCents: 0 }], depositCents: 0, terms: data.terms, validUntil: 0 }, contractsState.prefill || {});
    contractsState.prefill = null;
    return '<section id="ad-ct-editor"><div class="ad-section-header"><h3>' + (editing ? "Modifier le devis n° " + esc(c.number) : "Nouveau devis") + "</h3></div>" +
      (editing && c.status !== "draft" ? '<p class="ad-banner ad-banner-muted">Ce devis a déjà été envoyé : après modification, renvoyez-le pour que votre client signe la nouvelle version.</p>' : "") +
      '<form id="ad-ct-form" novalidate>' +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Client</span><input name="clientName" maxlength="120" required placeholder="ex. Camille Dubois" value="' + esc(c.clientName) + '" /></label>' +
      '<label class="ad-field"><span>E-mail du client</span><input type="email" name="clientEmail" maxlength="200" required placeholder="camille@exemple.be" value="' + esc(c.clientEmail) + '" /></label>' +
      "</div>" +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Titre</span><input name="title" maxlength="160" required placeholder="ex. Séance nouveau-né" value="' + esc(c.title) + '" /></label>' +
      // Vraie date (et heure) : le contrat l'écrit en toutes lettres, et la
      // séance arrive dans le Planning.
      '<div class="ad-field-row ad-ct-when">' +
      '<label class="ad-field"><span>Date de la séance <em>(facultatif)</em></span><input type="date" name="sessionDay" value="' + esc(c.sessionDay || "") + '" /></label>' +
      '<label class="ad-field"><span>Heure <em>(facultatif)</em></span><input type="time" name="sessionTime" value="' + esc(c.sessionTime || "") + '"' + (c.sessionDay ? "" : " disabled") + " /></label>" +
      "</div>" +
      "</div>" +
      (c.sessionDate && !c.sessionDay
        ? '<p class="ad-hint">Date notée auparavant : « ' + esc(c.sessionDate) + " ». Choisissez-la dans le calendrier pour qu'elle apparaisse dans le Planning.</p>"
        : "") +
      '<div class="ad-field"><span>Prestations <em>(montants TTC, en euros)</em></span><div id="ad-ct-lines" class="ad-ct-lines">' +
      (c.lines.length ? c.lines : [{ label: "", amountCents: 0 }]).map(contractLineRowHtml).join("") + "</div>" +
      '<button type="button" class="ad-link-btn ad-ct-add-line" id="ad-ct-add-line">+ Ajouter une prestation</button></div>' +
      '<p class="ad-ct-total">Total TTC : <strong id="ad-ct-total">—</strong></p>' +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Acompte à la signature <em>(€, 0 = aucun)</em></span><input name="deposit" inputmode="decimal" placeholder="0" value="' + esc(bookingEurosInput(c.depositCents)) + '" /></label>' +
      '<label class="ad-field"><span>Valable jusqu\'au <em>(facultatif)</em></span><input type="date" name="validUntil" value="' + esc(contractDateInput(c.validUntil)) + '" /></label>' +
      "</div>" +
      '<label class="ad-field"><span>Conditions du contrat</span><textarea name="terms" rows="12" maxlength="20000">' + esc(c.terms) + "</textarea></label>" +
      '<div class="ad-sc-actions">' +
      '<button type="submit" class="ad-btn ad-btn-primary" data-ct-submit="send">' + (editing && c.status !== "draft" ? "Enregistrer et renvoyer" : "Envoyer au client") + "</button>" +
      '<button type="submit" class="ad-btn" data-ct-submit="draft">Enregistrer le brouillon</button>' +
      '<button type="button" class="ad-btn" id="ad-ct-cancel">Annuler</button>' +
      "</div></form></section>";
  }

  function contractRowHtml(c) {
    var actions = [];
    if (["draft", "sent", "viewed"].indexOf(c.status) !== -1) actions.push('<button type="button" class="ad-btn ad-btn-small" data-ct-edit="' + esc(c.id) + '">Modifier</button>');
    if (c.status === "draft") actions.push('<button type="button" class="ad-btn ad-btn-small ad-btn-primary" data-ct-send="' + esc(c.id) + '">Envoyer</button>');
    if (c.status === "sent" || c.status === "viewed") actions.push('<button type="button" class="ad-btn ad-btn-small" data-ct-send="' + esc(c.id) + '">Renvoyer</button>');
    if (c.url) actions.push('<button type="button" class="ad-btn ad-btn-small" data-ct-copy="' + esc(c.url) + '">Copier le lien</button>');
    if (c.status === "signed" || c.status === "paid") actions.push('<a class="ad-btn ad-btn-small" href="/local/contracts/' + encodeURIComponent(c.id) + '/pdf" download>PDF signé</a>');
    if (["draft", "sent", "viewed"].indexOf(c.status) !== -1 && c.status !== "draft") actions.push('<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-ct-cancel="' + esc(c.id) + '">Retirer</button>');
    if (["draft", "cancelled", "declined"].indexOf(c.status) !== -1) actions.push('<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-ct-delete="' + esc(c.id) + '">Supprimer</button>');
    var detail = c.signedAt
      ? "Signé par " + c.signerName + " le " + formatDateTime(c.signedAt) + (c.paidAt ? " · acompte reçu le " + formatDate(c.paidAt) : "")
      : c.declinedAt ? "Refusé le " + formatDate(c.declinedAt) + (c.declineReason ? " : « " + c.declineReason + " »" : "")
      : c.viewedAt ? "Lu le " + formatDateTime(c.viewedAt)
      : c.sentAt ? "Envoyé le " + formatDateTime(c.sentAt)
      : "Créé le " + formatDate(c.createdAt);
    return '<tr data-contract-id="' + esc(c.id) + '">' +
      '<td class="ad-acc-num">' + esc(c.number) + "</td>" +
      '<td><span class="ad-acc-name">' + esc(c.title) + '</span><span class="ad-acc-sub">' + clLink(c.clientName, c.clientEmail) + " · " + esc(c.clientEmail) + "</span>" +
      '<span class="ad-acc-sub">' + esc(detail) + "</span></td>" +
      '<td class="ad-num">' + formatEuros(c.totalCents) + (c.depositCents ? '<span class="ad-acc-sub">acompte ' + formatEuros(c.depositCents) + "</span>" : "") + "</td>" +
      "<td>" + contractStatusHtml(c) + "</td>" +
      '<td class="ad-row-actions"><div class="ad-ct-actions">' + actions.join("") + "</div></td></tr>";
  }

  async function renderContracts(skipHash) {
    if (!skipHash && location.hash !== "#/contrats") history.pushState(null, "", "#/contrats");
    setActiveTab("contracts");
    if (!contractsState.data) el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
    var data;
    try {
      data = await api("GET", "/contracts");
    } catch (err) {
      el.view.innerHTML = '<div class="ad-error-panel"><h2>Devis et contrats indisponibles</h2><p>' + esc(err.message) + "</p></div>";
      return;
    }
    if (location.hash !== "#/contrats") return;
    paintContracts(data);
  }

  function paintContracts(data) {
    contractsState.data = data;
    var list = data.contracts;
    var editing = contractsState.editing;
    var waiting = list.filter(function (c) { return c.status === "sent" || c.status === "viewed"; }).length;
    var signedCount = list.filter(function (c) { return c.status === "signed" || c.status === "paid"; }).length;
    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Devis et contrats</h2>' +
      '<p class="ad-hint">Envoyez un devis : votre client le lit, le signe en ligne et règle l\'acompte. Chacun reçoit le contrat signé en PDF.</p></div>' +
      (data.enabled && !editing ? '<button type="button" class="ad-btn ad-btn-primary" id="ad-ct-new">+ Nouveau devis</button>' : "") +
      "</header>" +
      (!data.enabled ? '<p class="ad-banner ad-banner-muted">Les devis et contrats signés en ligne sont inclus dans la formule Pro. <button type="button" class="ad-link-btn" id="ad-ct-plans">Voir les formules</button></p>' : "") +
      (data.enabled && !data.stripeReady ? '<p class="ad-banner ad-banner-muted">Sans paiement en ligne actif, vos clients signent mais ne peuvent pas régler l\'acompte en ligne. <button type="button" class="ad-link-btn" id="ad-ct-billing">Onglet Facturation</button></p>' : "") +
      (editing ? contractEditorHtml(data, editing === "new" ? null : editing) : "") +
      (data.enabled && list.length && !editing
        ? '<div class="ad-stats">' + salesStatHtml("En attente de signature", String(waiting), "") + salesStatHtml("Contrats signés", String(signedCount), "") + "</div>"
        : "") +
      (!editing
        ? '<section id="ad-ct-list"><div class="ad-section-header"><h3>Vos devis</h3></div>' +
          (list.length
            ? '<div class="ad-table-wrap"><table class="ad-table ad-ct-table"><thead><tr><th>N°</th><th>Devis</th><th class="ad-num">Total</th><th>État</th><th><span class="ad-visually-hidden">Actions</span></th></tr></thead><tbody>' +
              list.map(contractRowHtml).join("") + "</tbody></table></div>"
            : '<p class="ad-hint">Aucun devis pour l\'instant. Un devis reprend vos prestations et vos conditions ; votre client le signe depuis le lien reçu par e-mail, sans compte à créer.</p>') +
          "</section>" +
          (data.enabled
            ? '<section><details class="ad-advanced" id="ad-ct-terms-box"><summary>Conditions par défaut de vos contrats</summary>' +
              '<p class="ad-hint">Reprises dans chaque nouveau devis, où vous pouvez encore les adapter. Le modèle proposé est un point de départ, pas un conseil juridique.</p>' +
              '<form id="ad-ct-terms-form"><label class="ad-field"><span class="ad-visually-hidden">Conditions</span><textarea name="terms" rows="14" maxlength="20000">' + esc(data.terms) + "</textarea></label>" +
              '<div class="ad-sc-actions"><button type="submit" class="ad-btn ad-btn-primary">Enregistrer les conditions</button>' +
              '<button type="button" class="ad-btn" id="ad-ct-terms-reset">Revenir au modèle Holypixx</button></div></form></details></section>'
            : "")
        : "");
    bindContracts(data);
  }

  function readContractForm(form) {
    var lines = [];
    var bad = false;
    form.querySelectorAll(".ad-ct-line").forEach(function (row) {
      var label = row.querySelector(".ad-ct-line-label").value.trim();
      var amount = bookingCents(row.querySelector(".ad-ct-line-amount").value);
      if (isNaN(amount)) bad = true;
      if (label || amount) lines.push({ label: label, amountCents: amount });
    });
    var deposit = bookingCents(form.elements.deposit.value);
    if (bad || isNaN(deposit)) return { error: "Montant illisible : écrivez par exemple 180 ou 180,50." };
    return {
      body: {
        clientName: form.elements.clientName.value, clientEmail: form.elements.clientEmail.value, title: form.elements.title.value,
        sessionDay: form.elements.sessionDay.value, sessionTime: form.elements.sessionDay.value ? form.elements.sessionTime.value : "", lines: lines, depositCents: deposit, terms: form.elements.terms.value,
        validUntil: form.elements.validUntil.value || "",
      },
    };
  }

  function refreshContractTotal() {
    var total = 0;
    document.querySelectorAll("#ad-ct-lines .ad-ct-line-amount").forEach(function (input) {
      var cents = bookingCents(input.value);
      if (!isNaN(cents)) total += cents;
    });
    var out = document.getElementById("ad-ct-total");
    if (out) out.textContent = formatEuros(total);
  }

  async function contractsCall(method, path, body, message) {
    try {
      var data = await api(method, "/contracts" + path, body);
      if (message) toast(typeof message === "function" ? message(data) : message);
      return data;
    } catch (err) {
      toast(err.message, true);
      return null;
    }
  }

  function bindContracts(data) {
    var on = function (id, fn) { var node = document.getElementById(id); if (node) node.addEventListener("click", fn); };
    on("ad-ct-plans", function () { renderSubscription(); });
    on("ad-ct-billing", function () { renderBilling(); });
    on("ad-ct-new", function () { contractsState.editing = "new"; paintContracts(data); document.getElementById("ad-ct-form").elements.clientName.focus(); });
    on("ad-ct-cancel", function () { contractsState.editing = null; paintContracts(data); });
    on("ad-ct-add-line", function () {
      document.getElementById("ad-ct-lines").insertAdjacentHTML("beforeend", contractLineRowHtml({}));
      var rows = document.querySelectorAll("#ad-ct-lines .ad-ct-line-label");
      rows[rows.length - 1].focus();
    });

    var form = document.getElementById("ad-ct-form");
    if (form && form.elements.sessionDay) {
      // L'heure n'a de sens qu'avec une date.
      form.elements.sessionDay.addEventListener("input", function () {
        form.elements.sessionTime.disabled = !form.elements.sessionDay.value;
        if (!form.elements.sessionDay.value) form.elements.sessionTime.value = "";
      });
    }
    if (form) {
      refreshContractTotal();
      form.addEventListener("input", refreshContractTotal);
      form.addEventListener("click", function (e) {
        var remove = e.target.closest("[data-ct-remove-line]");
        if (!remove) return;
        var rows = form.querySelectorAll(".ad-ct-line");
        if (rows.length > 1) remove.closest(".ad-ct-line").remove();
        else rows[0].querySelectorAll("input").forEach(function (i) { i.value = ""; });
        refreshContractTotal();
      });
      var mode = "send";
      form.querySelectorAll("[data-ct-submit]").forEach(function (b) {
        b.addEventListener("click", function () { mode = b.getAttribute("data-ct-submit"); });
      });
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var read = readContractForm(form);
        if (read.error) { toast(read.error, true); return; }
        read.body.send = mode === "send";
        var editing = contractsState.editing;
        var result = await contractsCall("POST", editing && editing.id ? "/" + encodeURIComponent(editing.id) : "", read.body,
          read.body.send ? "Devis envoyé à " + read.body.clientEmail + "." : "Brouillon enregistré.");
        if (result) { contractsState.editing = null; paintContracts(result); }
      });
    }

    el.view.querySelectorAll("[data-ct-edit]").forEach(function (b) {
      b.addEventListener("click", function () {
        contractsState.editing = data.contracts.filter(function (c) { return c.id === b.getAttribute("data-ct-edit"); })[0];
        paintContracts(data);
        window.scrollTo(0, 0);
      });
    });
    el.view.querySelectorAll("[data-ct-send]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var result = await contractsCall("POST", "/" + encodeURIComponent(b.getAttribute("data-ct-send")) + "/send", {}, "Devis envoyé au client.");
        if (result) paintContracts(result);
      });
    });
    el.view.querySelectorAll("[data-ct-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        navigator.clipboard.writeText(b.getAttribute("data-ct-copy")).then(function () {
          toast("Lien copié : votre client peut l'ouvrir pour lire et signer.");
        }).catch(function () { toast("Impossible de copier le lien.", true); });
      });
    });
    el.view.querySelectorAll("[data-ct-cancel]").forEach(function (b) {
      b.addEventListener("click", function () {
        confirmAction("Retirer ce devis ? Le lien envoyé au client n'en permettra plus la signature.", async function () {
          var result = await contractsCall("POST", "/" + encodeURIComponent(b.getAttribute("data-ct-cancel")) + "/cancel", {}, "Devis retiré.");
          if (result) paintContracts(result);
        });
      });
    });
    el.view.querySelectorAll("[data-ct-delete]").forEach(function (b) {
      b.addEventListener("click", function () {
        confirmAction("Supprimer définitivement ce devis ?", async function () {
          var result = await contractsCall("DELETE", "/" + encodeURIComponent(b.getAttribute("data-ct-delete")), null, "Devis supprimé.");
          if (result) paintContracts(result);
        });
      });
    });

    var termsForm = document.getElementById("ad-ct-terms-form");
    if (termsForm) {
      termsForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var result = await contractsCall("POST", "/terms", { terms: termsForm.elements.terms.value }, "Conditions enregistrées : elles seront reprises dans vos prochains devis.");
        if (result) { paintContracts(result); document.getElementById("ad-ct-terms-box").open = true; }
      });
      on("ad-ct-terms-reset", function () { termsForm.elements.terms.value = data.defaultTerms; });
    }
  }

  /* ---------- Clients : fiches, dates à retenir, relances ---------- */

  var clientsState = { data: null, query: "", filter: "all", creating: false };
  var CL_DATE_KINDS = [
    ["baby", "Suivi bébé (3 mois, 1 an…)", "Prénom"],
    ["birthday", "Naissance d'un enfant", "Prénom"],
    ["season", "Séance de saison (Noël…)", "Occasion"],
    ["wedding", "Mariage", "Prénoms du couple"],
    ["other", "Autre date", "Nom de la date"],
  ];
  // Mêmes listes que le Worker (clients.js).
  var CL_SEASONS = [["noel", "Noël"], ["valentin", "Saint-Valentin"], ["paques", "Pâques"], ["meres", "Fête des mères"], ["peres", "Fête des pères"], ["rentree", "Rentrée"], ["halloween", "Halloween"]];
  var CL_STEPS = [["3", "3 mois"], ["6", "6 mois"], ["9", "9 mois"], ["12", "1 an"], ["18", "18 mois"], ["y", "Chaque anniversaire"]];
  var CL_LEADS = [[14, "2 semaines avant"], [21, "3 semaines avant"], [30, "1 mois avant"], [42, "6 semaines avant"], [60, "2 mois avant"]];
  var CL_LEAD_DEFAULT = { baby: 30, birthday: 30, season: 42, wedding: 30, other: 21 };

  function clToday() { return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }); }
  function clIsoOf(ts) { return new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }); }
  function clAddMonths(iso, n) {
    var p = iso.split("-").map(Number);
    var total = p[0] * 12 + (p[1] - 1) + n;
    var y = Math.floor(total / 12), m = total - y * 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(p[2], last))).toISOString().slice(0, 10);
  }
  function clAddDays(iso, n) {
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function clDaysUntil(iso) {
    var a = clToday().split("-").map(Number), b = iso.split("-").map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }
  function clFullDay(iso, withWeekday) {
    var sameYear = iso.slice(0, 4) === clToday().slice(0, 4);
    return new Date(iso + "T12:00:00Z").toLocaleDateString("fr-BE", { weekday: withWeekday ? "long" : undefined, day: "numeric", month: "long", year: sameYear ? undefined : "numeric", timeZone: "Europe/Brussels" });
  }
  function clMonthYear(iso) {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("fr-BE", { month: "long", year: "numeric", timeZone: "Europe/Brussels" });
  }
  // Étapes d'un bébé encore à venir (même calcul que le Worker).
  function clBabySteps(birth, plan, today) {
    var out = [];
    CL_STEPS.forEach(function (st) {
      if (st[0] === "y" || plan.indexOf(st[0]) === -1) return;
      var date = clAddMonths(birth, Number(st[0]));
      if (date >= today) out.push({ date: date, label: st[1], key: st[0] });
    });
    if (plan.indexOf("y") !== -1) {
      for (var y = 2; y <= 18; y++) {
        var date = clAddMonths(birth, 12 * y);
        if (date >= today) out.push({ date: date, label: y + " ans", key: "y" });
      }
    }
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function clLeadOptions(selected) {
    return CL_LEADS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === selected ? " selected" : "") + ">" + esc(l[1]) + "</option>"; }).join("");
  }
  function clSeasonName(key) {
    var found = CL_SEASONS.filter(function (x) { return x[0] === key; })[0];
    return found ? found[1] : key;
  }

  function clHref(email) { return "#/clients/" + encodeURIComponent(email); }
  // Lien discret vers la fiche d'un client, depuis les autres écrans.
  function clLink(name, email) {
    return email ? '<a class="ad-cl-link" href="' + clHref(email) + '">' + esc(name || email) + "</a>" : esc(name || "");
  }

  function clInitials(name) {
    var words = String(name || "?").replace(/[^\p{L}\s-]/gu, " ").trim().split(/[\s-]+/).filter(Boolean);
    return ((words[0] || "?").charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : "")).toUpperCase();
  }
  function clAvatar(name, big) {
    return '<span class="ad-cl-avatar' + (big ? " ad-cl-avatar-lg" : "") + '" aria-hidden="true">' + esc(clInitials(name)) + "</span>";
  }

  // « aujourd'hui », « hier », « il y a 3 jours », « il y a 2 mois »…
  function clAgo(ts) {
    if (!ts) return "—";
    var days = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (days < 0) return clIn(-days);
    if (days === 0) return "aujourd'hui";
    if (days === 1) return "hier";
    if (days < 30) return "il y a " + days + " jours";
    var months = Math.round(days / 30.4);
    if (months < 12) return "il y a " + months + " mois";
    var years = Math.floor(days / 365);
    var rest = Math.round((days - years * 365) / 30.4);
    return "il y a " + years + " an" + (years > 1 ? "s" : "") + (rest >= 2 ? " et " + rest + " mois" : "");
  }
  function clIn(days) {
    return days === 0 ? "aujourd'hui" : days === 1 ? "demain" : "dans " + days + " jours";
  }
  function clDay(isoDate, withWeekday) {
    return new Date(isoDate + "T12:00:00Z").toLocaleDateString("fr-BE", { weekday: withWeekday ? "long" : undefined, day: "numeric", month: "long", timeZone: "Europe/Brussels" });
  }
  function clWhenChip(next, lead) {
    var soon = next.daysUntil <= (lead || 21);
    return '<span class="ad-cl-when' + (soon ? " ad-cl-when-soon" : "") + '">' + esc(clIn(next.daysUntil)) + "</span>";
  }

  function clRemindRowHtml(item) {
    return '<li class="ad-cl-remind">' + clAvatar(item.name) +
      '<div class="ad-cl-remind-main"><strong>' + esc(item.next.title) + "</strong>" +
      '<span class="ad-hint">' + clLink(item.name, item.email) + " · " + esc(clDay(item.next.date, true)) + "</span></div>" +
      clWhenChip(item.next, item.lead) +
      '<a class="ad-btn ad-btn-small ad-btn-primary" href="' + esc(item.mailto) + '">Proposer une séance</a></li>';
  }
  // Temps fort du studio arrivé dans sa période de rappel : à proposer à tous.
  var CL_SPARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/></svg>';
  function clSeasonRemindHtml(item) {
    var n = item.recipients;
    return '<li class="ad-cl-remind ad-cl-remind-season" data-cl-season="' + esc(item.id) + '"><span class="ad-cl-avatar ad-cl-avatar-season" aria-hidden="true">' + CL_SPARK + "</span>" +
      '<div class="ad-cl-remind-main"><strong>' + esc(item.next.title) + " le " + esc(clFullDay(item.next.date, true)) + "</strong>" +
      '<span class="ad-hint">Temps fort du studio · à proposer à ' + (n === 1 ? "votre client" : "vos " + n + " clients") + "</span></div>" +
      clWhenChip(item.next, item.lead) +
      '<div class="ad-cl-remind-actions">' +
      (n && n <= 60 ? '<a class="ad-btn ad-btn-small ad-btn-primary" href="' + esc(item.mailto) + '">Écrire à tous</a>' : "") +
      '<button type="button" class="ad-btn ad-btn-small" data-cl-copy-emails>Copier les ' + n + " adresse" + (n > 1 ? "s" : "") + "</button></div></li>";
  }
  function clDormantRowHtml(item) {
    return '<li class="ad-cl-remind">' + clAvatar(item.name) +
      '<div class="ad-cl-remind-main"><strong>' + clLink(item.name, item.email) + "</strong>" +
      '<span class="ad-hint">Dernière séance ' + esc(clAgo(item.lastSessionAt)) + "</span></div>" +
      '<span class="ad-cl-when">À recontacter</span>' +
      '<a class="ad-btn ad-btn-small" href="' + esc(item.mailto) + '">Écrire</a></li>';
  }

  function clMatches(c, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    if ((c.name || "").toLowerCase().indexOf(q) !== -1 || c.email.indexOf(q) !== -1) return true;
    // Numéro tapé à la belge (0470…) ou à l'international (+32 470…) : on
    // compare les chiffres, sans le 0 initial ni l'indicatif.
    var digits = q.replace(/\D/g, "").replace(/^0+/, "");
    var phone = (c.phone || "").replace(/\D/g, "");
    return digits.length >= 3 && /^[\d\s+().\/-]+$/.test(q) && phone.indexOf(digits) !== -1;
  }

  function clRowsHtml(list) {
    if (!list.length) return '<tr><td colspan="5" class="ad-cl-none">Aucun client ne correspond à cette recherche.</td></tr>';
    return list.map(function (c) {
      return '<tr class="ad-cl-row" tabindex="0" data-cl-email="' + esc(c.email) + '">' +
        '<td><div class="ad-cl-who">' + clAvatar(c.name) + '<div><span class="ad-acc-name">' + esc(c.name) + '</span><span class="ad-acc-sub">' + esc(c.email) + "</span></div></div></td>" +
        '<td class="ad-num">' + (c.sessions || "—") + "</td>" +
        '<td class="ad-num">' + (c.paidCents ? formatEuros(c.paidCents) : "—") + "</td>" +
        "<td>" + esc(c.upcomingSessionAt ? "Séance " + clAgo(c.upcomingSessionAt).replace("dans", "dans") : clAgo(c.lastAt)) + "</td>" +
        "<td>" + (c.nextDate ? '<span class="ad-cl-date">' + esc(c.nextDate.next.title) + "</span> " + clWhenChip(c.nextDate.next) : '<span class="ad-hint">—</span>') + "</td></tr>";
    }).join("");
  }

  async function renderClients(skipHash) {
    if (!skipHash && location.hash !== "#/clients") history.pushState(null, "", "#/clients");
    setActiveTab("clients");
    if (!clientsState.data) el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
    var data;
    try {
      data = await api("GET", "/clients");
    } catch (err) {
      el.view.innerHTML = '<div class="ad-error-panel"><h2>Clients indisponibles</h2><p>' + esc(err.message) + "</p></div>";
      return;
    }
    if (location.hash !== "#/clients") return;
    clientsState.data = data;
    updateClientsBadge(data);
    paintClients();
  }

  // Pastille du menu : le nombre de relances arrivées dans leur période de rappel.
  function updateClientsBadge(data) {
    var tab = document.getElementById("ad-tab-clients");
    if (!tab) return;
    var due = (data.upcoming || []).filter(function (u) { return u.next.daysUntil <= (u.lead || 21); }).length +
      (data.seasons || []).filter(function (u) { return u.remind && u.next && u.next.daysUntil <= u.lead && data.emails.length; }).length;
    var badge = tab.querySelector(".ad-tab-count");
    if (!due) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ad-tab-count";
      tab.appendChild(badge);
    }
    badge.textContent = String(due);
    badge.setAttribute("aria-label", due + " client" + (due > 1 ? "s" : "") + " à relancer");
  }

  function paintClients() {
    var data = clientsState.data;
    var list = data.clients.filter(function (c) {
      if (clientsState.filter === "upcoming" && !c.upcomingSessionAt) return false;
      if (clientsState.filter === "dates" && !c.nextDate) return false;
      return clMatches(c, clientsState.query);
    });
    var seasonsDue = (data.seasons || []).filter(function (x) { return x.remind && x.next && x.next.daysUntil <= Math.max(45, x.lead) && data.emails.length; });
    var remindCount = seasonsDue.length + data.upcoming.length + data.dormant.length;
    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Clients</h2>' +
      '<p class="ad-hint">Tous ceux qui vous ont confié une séance, réunis par adresse e-mail : galeries, réservations, contrats et paiements. Ajoutez vos notes et les dates à retenir, Holypixx vous prévient au bon moment.</p></div>' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-cl-new">+ Nouveau client</button></header>' +
      (clientsState.creating
        ? '<section id="ad-cl-create"><div class="ad-section-header"><h3>Nouveau client</h3></div>' +
          '<form id="ad-cl-create-form" class="ad-cl-create" novalidate>' +
          '<label class="ad-field"><span>Nom</span><input name="name" maxlength="120" required placeholder="ex. Camille Dubois" autocomplete="off" /></label>' +
          '<label class="ad-field"><span>E-mail</span><input type="email" name="email" maxlength="200" required placeholder="camille@exemple.be" autocomplete="off" /></label>' +
          '<label class="ad-field"><span>Téléphone <em>(facultatif)</em></span><input type="tel" name="phone" maxlength="30" autocomplete="off" /></label>' +
          '<div class="ad-sc-actions"><button type="submit" class="ad-btn ad-btn-primary">Créer la fiche</button><button type="button" class="ad-btn" id="ad-cl-create-cancel">Annuler</button></div>' +
          "</form></section>"
        : "") +
      (remindCount
        ? '<section id="ad-cl-reminders"><div class="ad-section-header"><h3>À relancer</h3><span class="ad-hint">' + remindCount + " suggestion" + (remindCount > 1 ? "s" : "") + "</span></div>" +
          '<ul class="ad-cl-reminds">' + seasonsDue.map(clSeasonRemindHtml).join("") + data.upcoming.map(clRemindRowHtml).join("") + data.dormant.map(clDormantRowHtml).join("") + "</ul>" +
          '<p class="ad-hint ad-cl-reminds-note">Chaque bouton ouvre votre messagerie avec un message déjà rédigé' + (data.bookingUrl ? ", lien de réservation compris" : "") + ". Vous recevez aussi un e-mail au moment choisi pour chaque date.</p></section>"
        : "") +
      clSeasonsHtml(data) +
      '<section id="ad-cl-list">' +
      (data.clients.length
        ? '<div class="ad-cl-toolbar">' +
          '<label class="ad-cl-search"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '<input type="search" id="ad-cl-search" placeholder="Rechercher un nom, un e-mail, un numéro" value="' + esc(clientsState.query) + '" aria-label="Rechercher un client" /><kbd>/</kbd></label>' +
          '<div class="ad-seg" role="group" aria-label="Filtrer">' +
          [["all", "Tous (" + data.clients.length + ")"], ["upcoming", "Séance prévue"], ["dates", "Avec date à retenir"]].map(function (f) {
            return '<button type="button" class="ad-seg-btn" data-cl-filter="' + f[0] + '" aria-pressed="' + (clientsState.filter === f[0]) + '">' + esc(f[1]) + "</button>";
          }).join("") + "</div></div>" +
          '<div class="ad-table-wrap"><table class="ad-table ad-cl-table"><thead><tr><th>Client</th><th class="ad-num">Séances</th><th class="ad-num">Encaissé</th><th>Activité</th><th>Prochaine date</th></tr></thead>' +
          '<tbody id="ad-cl-rows">' + clRowsHtml(list) + "</tbody></table></div>"
        : '<div class="ad-cl-empty">' + clAvatar("?") + "<h3>Vos clients arrivent ici tout seuls</h3>" +
          "<p>Dès votre première galerie, réservation ou devis, chaque client a sa fiche : historique, montants encaissés, notes et dates à retenir. Vous pouvez aussi en créer une à la main.</p></div>") +
      "</section>";
    bindClients();
  }

  // Temps forts du studio : séances de saison proposées à tous les clients.
  function clSeasonsHtml(data) {
    var seasons = data.seasons || [];
    return '<section id="ad-cl-seasons"><div class="ad-section-header"><h3>Temps forts du studio</h3>' +
      '<span class="ad-hint">Proposés à tous vos clients</span></div>' +
      (seasons.length
        ? '<ul class="ad-cl-dates ad-cl-seasons">' + seasons.map(function (x) {
            return '<li class="ad-cl-dateitem" data-cls="' + esc(x.id) + '">' +
              '<span class="ad-cl-avatar ad-cl-avatar-season" aria-hidden="true">' + CL_SPARK + "</span>" +
              '<div class="ad-cl-dateitem-main"><strong>' + esc(x.next ? x.next.title : "Séances de " + clSeasonName(x.label)) + "</strong>" +
              '<span class="ad-hint">' + (x.next ? "Le " + esc(clFullDay(x.next.date, true)) + (x.remind ? " · e-mail de rappel le " + esc(clFullDay(x.next.remindOn)) : "") : "") + "</span></div>" +
              (x.next ? clWhenChip(x.next, x.lead) : "") +
              clRemindControlsHtml(x) +
              '<button type="button" class="ad-btn ad-btn-small ad-btn-icon" data-cld-remove aria-label="Retirer ce temps fort">×</button></li>';
          }).join("") + "</ul>"
        : '<p class="ad-hint ad-cl-seasons-intro">Séances de Noël, fête des mères, rentrée… Indiquez quand elles ont lieu : Holypixx vous prévient à l\'avance, avec un message prêt à envoyer à tous vos clients.</p>') +
      '<form id="ad-cl-season-form" class="ad-cl-date-form ad-cl-season-form" novalidate>' +
      '<label class="ad-field"><span>Occasion</span><select name="label">' + CL_SEASONS.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="ad-field"><span>Date des séances</span><input type="date" name="date" required /></label>' +
      '<label class="ad-field"><span>Me prévenir</span><select name="lead">' + clLeadOptions(42) + "</select></label>" +
      '<button type="submit" class="ad-btn">Ajouter</button></form></section>';
  }

  // Case « Me prévenir » et délai du rappel, communs aux dates et temps forts.
  function clRemindControlsHtml(d) {
    return '<div class="ad-cl-remind-ctl"><label class="ad-sc-toggle" title="Recevoir un e-mail avant la date"><input type="checkbox" data-cld-remind ' + (d.remind ? "checked" : "") + " /> Me prévenir</label>" +
      '<select data-cld-lead aria-label="Délai du rappel"' + (d.remind ? "" : " disabled") + ">" + clLeadOptions(d.lead) + "</select></div>";
  }

  // Branche la case, le délai et la croix d'une ligne de date ; « refresh »
  // repeint l'écran avec la réponse du Worker.
  function clBindDateRow(row, id, refresh, removedText) {
    row.querySelector("[data-cld-remind]").addEventListener("change", async function (e) {
      try {
        refresh(await api("POST", "/clients/dates/" + encodeURIComponent(id), { remind: e.target.checked }));
        toast(e.target.checked ? "Rappel activé." : "Rappel désactivé.");
      } catch (err) { toast(err.message, true); }
    });
    row.querySelector("[data-cld-lead]").addEventListener("change", async function (e) {
      try {
        refresh(await api("POST", "/clients/dates/" + encodeURIComponent(id), { lead: Number(e.target.value) }));
        toast("Rappel " + e.target.options[e.target.selectedIndex].text + ".");
      } catch (err) { toast(err.message, true); }
    });
    row.querySelector("[data-cld-remove]").addEventListener("click", async function () {
      try {
        refresh(await api("DELETE", "/clients/dates/" + encodeURIComponent(id)));
        toast(removedText);
      } catch (err) { toast(err.message, true); }
    });
  }

  function bindClients() {
    var data = clientsState.data;
    var repaint = function (fresh) { clientsState.data = fresh; updateClientsBadge(fresh); paintClients(); };
    el.view.querySelectorAll("[data-cls]").forEach(function (row) {
      clBindDateRow(row, row.getAttribute("data-cls"), repaint, "Temps fort retiré.");
    });
    var seasonForm = document.getElementById("ad-cl-season-form");
    seasonForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var f = seasonForm.elements;
      if (!f.date.value) { toast("Indiquez la date de vos séances.", true); f.date.focus(); return; }
      try {
        repaint(await api("POST", "/clients/dates", { studio: true, kind: "season", label: f.label.value, date: f.date.value, lead: Number(f.lead.value) }));
        toast("Temps fort ajouté : rappel " + f.lead.options[f.lead.selectedIndex].text + ".");
      } catch (err) { toast(err.message, true); }
    });
    el.view.querySelectorAll("[data-cl-copy-emails]").forEach(function (b) {
      b.addEventListener("click", function () {
        navigator.clipboard.writeText(data.emails.join(", ")).then(function () {
          toast(data.emails.length + " adresse" + (data.emails.length > 1 ? "s" : "") + " copiée" + (data.emails.length > 1 ? "s" : "") + " : collez-les en copie cachée.");
        }).catch(function () { toast("Impossible de copier les adresses.", true); });
      });
    });
    document.getElementById("ad-cl-new").addEventListener("click", function () {
      clientsState.creating = true;
      paintClients();
      document.querySelector('#ad-cl-create-form [name="name"]').focus();
    });
    var createForm = document.getElementById("ad-cl-create-form");
    if (createForm) {
      document.getElementById("ad-cl-create-cancel").addEventListener("click", function () { clientsState.creating = false; paintClients(); });
      createForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var f = createForm.elements;
        try {
          var detail = await api("POST", "/clients", { create: true, name: f.name.value, email: f.email.value, phone: f.phone.value });
          clientsState.creating = false;
          toast("Fiche créée pour " + detail.client.name + ".");
          location.hash = clHref(detail.client.email);
        } catch (err) {
          if (err.status === 409 && /déjà une fiche/.test(err.message)) {
            clientsState.creating = false;
            toast("Ce client a déjà une fiche : la voici.");
            location.hash = clHref(f.email.value.trim().toLowerCase());
            return;
          }
          toast(err.message, true);
        }
      });
    }
    var search = document.getElementById("ad-cl-search");
    if (search) {
      search.addEventListener("input", function () {
        clientsState.query = search.value.trim();
        var list = data.clients.filter(function (c) {
          if (clientsState.filter === "upcoming" && !c.upcomingSessionAt) return false;
          if (clientsState.filter === "dates" && !c.nextDate) return false;
          return clMatches(c, clientsState.query);
        });
        document.getElementById("ad-cl-rows").innerHTML = clRowsHtml(list);
      });
      // Échap vide la recherche, puis rend la main au clavier.
      search.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        if (search.value) { search.value = ""; search.dispatchEvent(new Event("input")); }
        else search.blur();
      });
    }
    el.view.querySelectorAll("[data-cl-filter]").forEach(function (b) {
      b.addEventListener("click", function () { clientsState.filter = b.getAttribute("data-cl-filter"); paintClients(); });
    });
    var rows = document.getElementById("ad-cl-rows");
    if (rows) {
      var open = function (e) {
        var row = e.target.closest("tr[data-cl-email]");
        if (!row || e.target.closest("a")) return;
        location.hash = clHref(row.getAttribute("data-cl-email"));
      };
      rows.addEventListener("click", open);
      rows.addEventListener("keydown", function (e) { if (e.key === "Enter") open(e); });
    }
  }

  // « / » place le curseur dans la recherche, comme dans la plupart des outils.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    var target = e.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
    var search = document.getElementById("ad-cl-search");
    if (search) { e.preventDefault(); search.focus(); search.select(); }
  });

  /* Fiche d'un client */

  var CL_HISTORY = {
    gallery: ["Galerie", '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>'],
    booking: ["Séance réservée", '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>'],
    contract: ["Contrat", '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h3"/></svg>'],
    payment: ["Paiement", '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>'],
  };

  function clHistoryHtml(items) {
    if (!items.length) return '<p class="ad-hint">Rien encore : l\'historique se remplit à chaque galerie, réservation, contrat ou paiement.</p>';
    return '<ol class="ad-cl-history">' + items.map(function (h) {
      var kind = CL_HISTORY[h.type];
      var title = h.type === "gallery" ? '<a href="#/g/' + encodeURIComponent(h.slug) + '">' + esc(h.title) + "</a>"
        : h.type === "contract" ? '<a href="#/contrats">' + esc(h.title) + "</a> <span class=\"ad-hint\">n° " + esc(h.number) + "</span>"
        : h.type === "payment" ? esc(h.kind === "print" ? "Tirages" : "Suppléments") + " · " + (h.slug ? '<a href="#/g/' + encodeURIComponent(h.slug) + '">' + esc(h.title) + "</a>" : esc(h.title || ""))
        : esc(h.title);
      var status = h.type === "booking" && h.status === "cancelled" ? ' <span class="ad-badge ad-badge-expired">Annulée</span>'
        : h.type === "contract" ? " " + contractStatusHtml({ status: h.status, depositCents: h.status === "paid" ? 1 : 0 })
        : "";
      return '<li class="ad-cl-event ad-cl-event-' + h.type + '"><span class="ad-cl-event-ico" aria-hidden="true">' + kind[1] + "</span>" +
        '<div class="ad-cl-event-main"><span class="ad-cl-event-kind">' + esc(kind[0]) + " · " + esc(formatDate(h.at)) + "</span>" +
        '<span class="ad-cl-event-title">' + title + status + "</span></div>" +
        (h.amountCents ? '<span class="ad-cl-event-amount">' + formatEuros(h.amountCents) + "</span>" : "") + "</li>";
    }).join("") + "</ol>";
  }

  // « Naissance vers avril 2026 (estimée) », « Mariage le 3 juin 2016 »…
  function clDateDesc(d) {
    var full = new Date(d.date + "T12:00:00Z").toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" });
    if (d.kind === "baby") return d.approx ? "Naissance vers " + clMonthYear(d.date) + " (estimée)" : "Naissance le " + full;
    if (d.kind === "birthday") return "Naissance le " + full;
    if (d.kind === "wedding") return "Mariage le " + full;
    if (d.kind === "season") return "Séance du " + full + ", chaque année";
    return "Le " + full + ", chaque année";
  }

  function clDatesHtml(dates, client) {
    return (dates.length
      ? '<ul class="ad-cl-dates">' + dates.map(function (d) {
          var steps = d.kind === "baby" ? CL_STEPS.filter(function (st) { return d.plan.indexOf(st[0]) !== -1; }).map(function (st) { return st[1].toLowerCase(); }) : [];
          return '<li class="ad-cl-dateitem" data-cld="' + esc(d.id) + '">' +
            '<div class="ad-cl-dateitem-main"><strong>' + esc(d.next ? d.next.title : d.label) + "</strong>" +
            '<span class="ad-hint">' + esc(clDateDesc(d)) + "</span>" +
            (steps.length ? '<span class="ad-hint">Étapes : ' + esc(steps.join(" · ")) + "</span>" : "") +
            (d.next
              ? '<span class="ad-cl-dateitem-next">Le ' + esc(clFullDay(d.next.date, true)) +
                (d.remind ? " · " + (d.next.remindOn > clToday() ? "e-mail de rappel le " + esc(clFullDay(d.next.remindOn)) : "à relancer dès maintenant") : "") + "</span>"
              : '<span class="ad-hint">Plus d\'étape à venir.</span>') +
            "</div>" +
            (d.next ? clWhenChip(d.next, d.lead) : "") +
            clRemindControlsHtml(d) +
            (d.mailto ? '<a class="ad-btn ad-btn-small" href="' + esc(d.mailto) + '">Proposer une séance</a>' : "") +
            '<button type="button" class="ad-btn ad-btn-small ad-btn-icon" data-cld-remove aria-label="Retirer cette date">×</button></li>';
        }).join("") + "</ul>"
      : '<p class="ad-hint">Une séance bébé, une naissance, Noël, un anniversaire de mariage… Notez-le ici : Holypixx calcule les prochaines séances à proposer et vous prévient à l\'avance, avec un message prêt à envoyer.</p>') +
      '<form id="ad-cl-date-form" class="ad-cl-date-form ad-cl-date-form-full" novalidate>' +
      '<label class="ad-field ad-cl-date-kind"><span>Type</span><select name="kind">' + CL_DATE_KINDS.map(function (k) { return '<option value="' + k[0] + '">' + esc(k[1]) + "</option>"; }).join("") + "</select></label>" +
      '<div class="ad-cl-date-fields" id="ad-cl-date-fields"></div>' +
      '<fieldset class="ad-cl-steps" id="ad-cl-steps"><legend>Séances à proposer</legend>' +
      CL_STEPS.map(function (st) { return '<label class="ad-cl-step"><input type="checkbox" name="plan" value="' + st[0] + '" checked /><span>' + esc(st[1]) + "</span></label>"; }).join("") + "</fieldset>" +
      '<div class="ad-cl-date-foot"><label class="ad-field ad-cl-lead"><span>Me prévenir</span><select name="lead">' + clLeadOptions(30) + "</select></label>" +
      '<p class="ad-cl-preview" id="ad-cl-date-preview" aria-live="polite"></p>' +
      '<button type="submit" class="ad-btn ad-btn-primary">Ajouter</button></div></form>';
  }

  // Champs du formulaire selon le type de date.
  function clDateFieldsHtml(kind, sessionIso) {
    var label = CL_DATE_KINDS.filter(function (k) { return k[0] === kind; })[0][2];
    var name = kind === "season"
      ? '<label class="ad-field"><span id="ad-cl-label-name">Occasion</span><select name="label">' + CL_SEASONS.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + "</option>"; }).join("") + "</select></label>"
      : '<label class="ad-field"><span id="ad-cl-label-name">' + esc(label) + '</span><input name="label" maxlength="80" required autocomplete="off" /></label>';
    if (kind === "baby") {
      var ages = '<option value="birth">Je connais sa date de naissance</option><option value="0">Nouveau-né</option>';
      for (var m = 1; m <= 12; m++) ages += '<option value="' + m + '"' + (m === 6 ? " selected" : "") + ">" + (m === 12 ? "1 an" : m + " mois") + "</option>";
      ages += '<option value="15">15 mois</option><option value="18">18 mois</option><option value="24">2 ans</option>';
      return name +
        '<label class="ad-field"><span>Âge à la séance</span><select name="ageMonths">' + ages + "</select></label>" +
        '<label class="ad-field"><span id="ad-cl-date-label">Date de la séance</span><input type="date" name="date" required value="' + esc(sessionIso) + '" /></label>';
    }
    var dateLabel = { birthday: "Date de naissance", season: "Date de la séance", wedding: "Date du mariage", other: "Date" }[kind];
    return name + '<label class="ad-field"><span id="ad-cl-date-label">' + dateLabel + '</span><input type="date" name="date" required value="' + (kind === "season" ? esc(sessionIso) : "") + '" /></label>';
  }

  // Lit le formulaire : la date de naissance (estimée ou non), la prochaine
  // occasion et le jour du rappel, pour l'aperçu et l'envoi.
  function clReadDateForm(form) {
    var f = form.elements;
    var kind = f.kind.value;
    var today = clToday();
    var date = f.date.value;
    var out = { kind: kind, label: f.label.value.trim(), date: date, lead: Number(f.lead.value), plan: [], ageMonths: "", sessionDate: "" };
    if (!date) return out;
    if (kind === "baby") {
      var age = f.ageMonths.value;
      if (age !== "birth") {
        out.ageMonths = Number(age);
        out.sessionDate = date;
        out.birth = Number(age) > 0 ? clAddMonths(date, -Number(age)) : clAddDays(date, -10);
        out.approx = true;
      } else {
        out.birth = date;
      }
      form.querySelectorAll('[name="plan"]').forEach(function (cb) { if (cb.checked && !cb.disabled) out.plan.push(cb.value); });
      var next = clBabySteps(out.birth, out.plan, today)[0];
      if (next) out.next = { date: next.date, title: next.label };
      return out;
    }
    // Date annuelle : prochaine occurrence, aujourd'hui compris.
    var md = date.slice(5);
    var year = Number(today.slice(0, 4));
    var candidate = year + "-" + md;
    if (md === "02-29" && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) candidate = year + "-02-28";
    if (candidate < today) candidate = (year + 1) + "-" + (md === "02-29" ? "02-28" : md);
    out.next = { date: candidate };
    return out;
  }

  function clUpdateDateForm(form) {
    var f = form.elements;
    var kind = f.kind.value;
    var steps = document.getElementById("ad-cl-steps");
    steps.hidden = kind !== "baby";
    var info = clReadDateForm(form);
    var today = clToday();
    if (kind === "baby") {
      // Étapes déjà passées : grisées et décochées.
      form.querySelectorAll('[name="plan"]').forEach(function (cb) {
        if (cb.value === "y") return;
        var past = !info.birth || clAddMonths(info.birth, Number(cb.value)) < today;
        if (past && !cb.disabled) { cb.checked = false; cb.disabled = true; }
        else if (!past && cb.disabled) { cb.disabled = false; cb.checked = true; }
        cb.closest(".ad-cl-step").classList.toggle("ad-cl-step-past", past);
      });
      var dateLabel = document.getElementById("ad-cl-date-label");
      if (dateLabel) dateLabel.textContent = f.ageMonths.value === "birth" ? "Date de naissance" : "Date de la séance";
      info = clReadDateForm(form);
    }
    var preview = document.getElementById("ad-cl-date-preview");
    if (!info.date) { preview.textContent = ""; return; }
    var parts = [];
    if (kind === "baby" && info.approx) parts.push("Naissance vers " + clMonthYear(info.birth));
    if (info.next) {
      var remindOn = clAddDays(info.next.date, -info.lead);
      parts.push((kind === "baby" ? "Prochaine : " + info.next.title + " le " : "Prochaine fois le ") + clFullDay(info.next.date, true));
      parts.push(remindOn > today ? "e-mail de rappel le " + clFullDay(remindOn) : "à relancer dès maintenant");
    } else if (kind === "baby") {
      parts.push("Aucune étape à venir : cochez « Chaque anniversaire »");
    }
    preview.textContent = parts.join(" · ");
  }

  async function renderClientDetail(email, skipHash) {
    var hash = clHref(email);
    if (!skipHash && location.hash !== hash) history.pushState(null, "", hash);
    setActiveTab("clients");
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
    var data;
    try {
      data = await api("GET", "/clients/detail?email=" + encodeURIComponent(email));
    } catch (err) {
      el.view.innerHTML = '<button type="button" class="ad-back" id="ad-cl-back">&larr; Tous les clients</button><div class="ad-error-panel"><h2>Fiche introuvable</h2><p>' + esc(err.message) + "</p></div>";
      document.getElementById("ad-cl-back").addEventListener("click", function () { renderClients(); });
      return;
    }
    paintClientDetail(data);
  }

  function paintClientDetail(data) {
    var c = data.client;
    el.view.innerHTML =
      '<button type="button" class="ad-back" id="ad-cl-back">&larr; Tous les clients</button>' +
      '<header class="ad-cl-head">' + clAvatar(c.name, true) +
      '<div class="ad-cl-head-main"><h2>' + esc(c.name) + "</h2>" +
      '<p class="ad-cl-contact"><span>' + esc(c.email) + '</span><button type="button" class="ad-link-btn" id="ad-cl-copy">Copier</button>' +
      (c.phone ? '<span aria-hidden="true">·</span><a href="tel:' + esc(c.phone.replace(/\s/g, "")) + '">' + esc(c.phone) + "</a>" : "") + "</p></div>" +
      '<div class="ad-cl-head-actions">' +
      '<a class="ad-btn" href="' + esc(data.contactMailto) + '">Écrire</a>' +
      '<button type="button" class="ad-btn" id="ad-cl-gallery">Nouvelle galerie</button>' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-cl-quote">Nouveau devis</button></div></header>' +
      '<div class="ad-stats">' +
      salesStatHtml("Client depuis", c.firstAt ? new Date(c.firstAt * 1000).toLocaleDateString("fr-BE", { month: "long", year: "numeric" }) : "—", c.firstAt ? clAgo(c.firstAt) : "") +
      salesStatHtml("Séances", String(c.sessions), c.galleries ? c.galleries + " galerie" + (c.galleries > 1 ? "s" : "") : "") +
      salesStatHtml("Encaissé", c.paidCents ? formatEuros(c.paidCents) : "—", "Suppléments, tirages et acomptes") +
      salesStatHtml("Prochaine séance", c.upcomingSessionAt ? new Date(c.upcomingSessionAt * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "short", timeZone: "Europe/Brussels" }) : "—",
        c.upcomingSessionAt ? clAgo(c.upcomingSessionAt) : (c.lastSessionAt ? "Dernière " + clAgo(c.lastSessionAt) : "")) +
      "</div>" +
      '<div class="ad-cl-grid">' +
      '<div class="ad-cl-col">' +
      '<section><div class="ad-section-header"><h3>Dates à retenir</h3></div>' + clDatesHtml(data.dates, c) + "</section>" +
      '<section><div class="ad-section-header"><h3>Historique</h3></div>' + clHistoryHtml(data.history) + "</section>" +
      "</div>" +
      '<div class="ad-cl-col">' +
      '<section><div class="ad-section-header"><h3>Notes</h3><span class="ad-cl-saved" id="ad-cl-saved" aria-live="polite"></span></div>' +
      '<textarea class="ad-cl-notes" id="ad-cl-notes" rows="9" maxlength="10000" placeholder="Prénoms et âges des enfants, préférences, allergies, le chien qui s\'appelle Pixel…">' + esc(c.notes || "") + "</textarea>" +
      '<p class="ad-hint">Enregistrées automatiquement, visibles par vous seul.</p></section>' +
      '<section><div class="ad-section-header"><h3>Coordonnées</h3></div><form id="ad-cl-info" novalidate>' +
      '<label class="ad-field"><span>Nom</span><input name="name" maxlength="120" value="' + esc(c.name) + '" /></label>' +
      '<label class="ad-field"><span>Téléphone</span><input type="tel" name="phone" maxlength="30" value="' + esc(c.phone || "") + '" /></label>' +
      '<button type="submit" class="ad-btn">Enregistrer</button></form>' +
      (c.recordId ? '<details class="ad-danger-zone"><summary>Effacer mes notes sur ce client</summary><p class="ad-hint">Retire le téléphone, les notes et les dates à retenir. Ses galeries, réservations et contrats restent.</p>' +
        '<button type="button" class="ad-btn ad-btn-danger ad-btn-small" id="ad-cl-erase">Effacer</button></details>' : "") +
      "</section></div></div>";
    bindClientDetail(data);
  }

  function bindClientDetail(data) {
    var c = data.client;
    var refresh = function (fresh) { paintClientDetail(fresh); };
    document.getElementById("ad-cl-back").addEventListener("click", function () { renderClients(); });
    document.getElementById("ad-cl-copy").addEventListener("click", function () {
      navigator.clipboard.writeText(c.email).then(function () { toast("Adresse copiée."); }).catch(function () { toast("Impossible de copier l'adresse.", true); });
    });
    document.getElementById("ad-cl-quote").addEventListener("click", function () {
      contractsState.editing = "new";
      contractsState.prefill = { clientName: c.name, clientEmail: c.email };
      renderContracts();
    });
    document.getElementById("ad-cl-gallery").addEventListener("click", function () {
      openCreateModal();
      var form = document.getElementById("ad-create-form");
      if (form.elements.clientName) form.elements.clientName.value = c.name;
      if (form.elements.clientEmail) form.elements.clientEmail.value = c.email;
      if (form.elements.title) form.elements.title.focus();
    });

    // Notes : enregistrement automatique, une seconde après la dernière frappe.
    var notes = document.getElementById("ad-cl-notes");
    var saved = document.getElementById("ad-cl-saved");
    var timer = null;
    var lastSaved = notes.value;
    var saveNotes = async function () {
      clearTimeout(timer);
      if (notes.value === lastSaved) return;
      var value = notes.value;
      saved.textContent = "Enregistrement…";
      saved.className = "ad-cl-saved";
      try {
        await api("POST", "/clients", { email: c.email, notes: value });
        lastSaved = value;
        saved.textContent = "Enregistré à " + new Date().toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" });
        saved.className = "ad-cl-saved ad-cl-saved-ok";
      } catch (err) {
        saved.textContent = "Non enregistré : " + err.message;
        saved.className = "ad-cl-saved ad-cl-saved-error";
      }
    };
    notes.addEventListener("input", function () { clearTimeout(timer); saved.textContent = ""; timer = setTimeout(saveNotes, 1000); });
    notes.addEventListener("blur", saveNotes);

    document.getElementById("ad-cl-info").addEventListener("submit", async function (e) {
      e.preventDefault();
      var f = e.currentTarget.elements;
      try {
        refresh(await api("POST", "/clients", { email: c.email, name: f.name.value, phone: f.phone.value }));
        toast("Coordonnées enregistrées.");
      } catch (err) {
        toast(err.message, true);
      }
    });

    var dateForm = document.getElementById("ad-cl-date-form");
    var sessionIso = c.lastSessionAt ? clIsoOf(c.lastSessionAt) : clToday();
    var setKind = function (kind) {
      document.getElementById("ad-cl-date-fields").innerHTML = clDateFieldsHtml(kind, sessionIso);
      dateForm.elements.lead.value = String(CL_LEAD_DEFAULT[kind]);
      clUpdateDateForm(dateForm);
    };
    setKind(dateForm.elements.kind.value);
    dateForm.elements.kind.addEventListener("change", function () { setKind(dateForm.elements.kind.value); });
    dateForm.addEventListener("input", function (e) { if (e.target.name !== "kind") clUpdateDateForm(dateForm); });
    dateForm.addEventListener("change", function (e) {
      if (e.target.name === "kind") return;
      // Date de naissance connue : le champ se vide ; âge à la séance : il
      // reprend la date de la dernière séance.
      if (e.target.name === "ageMonths") {
        var wasBirth = dateForm.dataset.birth === "1";
        var isBirth = e.target.value === "birth";
        if (isBirth !== wasBirth) dateForm.elements.date.value = isBirth ? "" : sessionIso;
        dateForm.dataset.birth = isBirth ? "1" : "";
      }
      clUpdateDateForm(dateForm);
    });
    dateForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var info = clReadDateForm(dateForm);
      if (!info.label) { toast(info.kind === "baby" || info.kind === "birthday" ? "Indiquez le prénom." : "Donnez un nom à cette date.", true); dateForm.elements.label.focus(); return; }
      if (!info.date) { toast("Indiquez la date.", true); dateForm.elements.date.focus(); return; }
      var body = { email: c.email, kind: info.kind, label: info.label, date: info.kind === "baby" && info.ageMonths !== "" ? "" : info.date, lead: info.lead };
      if (info.kind === "baby") {
        body.plan = info.plan;
        if (info.ageMonths !== "") { body.ageMonths = info.ageMonths; body.sessionDate = info.sessionDate; }
      }
      try {
        refresh(await api("POST", "/clients/dates", body));
        toast("C'est noté : rappel " + dateForm.elements.lead.options[dateForm.elements.lead.selectedIndex].text + ".");
      } catch (err) {
        toast(err.message, true);
      }
    });
    el.view.querySelectorAll("[data-cld]").forEach(function (row) {
      clBindDateRow(row, row.getAttribute("data-cld"), refresh, "Date retirée.");
    });
    var erase = document.getElementById("ad-cl-erase");
    if (erase) {
      erase.addEventListener("click", function () {
        confirmAction("Effacer le téléphone, les notes et les dates à retenir de " + c.name + " ?", async function () {
          try {
            await api("DELETE", "/clients?email=" + encodeURIComponent(c.email));
            toast("Notes effacées.");
            renderClientDetail(c.email, true);
          } catch (err) { toast(err.message, true); }
        });
      });
    }
  }

  /* ---------- Planning : séances, rappels et tâches au même endroit ---------- */
  // Agenda (séances réservées, dates à retenir des clients, temps forts du
  // studio, rendez-vous perso) et « À faire » (sélections à retoucher,
  // galeries à créer, clients à recontacter, tâches perso). Tout est
  // recalculé par le Worker à chaque affichage (worker/src/planning.js).

  var planningState = { data: null, filter: "all", adding: false };

  var PL_SEASONS_EN = { noel: "Christmas", valentin: "Valentine's Day", paques: "Easter", meres: "Mother's Day", peres: "Father's Day", rentree: "Back-to-school", halloween: "Halloween" };

  // Titre d'une date à retenir. Le Worker le rédige en français ; en
  // anglais, on le recompose depuis ses éléments (type, prénom, âge).
  function plReminderTitle(ev) {
    if (LANG !== "en") return ev.title;
    var label = ev.label || "";
    if (ev.kind === "season") return (PL_SEASONS_EN[label] || label) + (ev.type === "season" ? " sessions" : " session");
    if (ev.kind === "baby" && ev.months) return label + " turns " + ev.months + " months";
    if (ev.kind === "birthday" || ev.kind === "baby") return ev.years ? label + " turns " + ev.years : label + "'s birthday";
    if (ev.kind === "wedding") return ev.years ? ev.years + (ev.years === 1 ? " year" : " years") + " married: " + label : "Wedding anniversary: " + label;
    return label;
  }

  function plParseDay(day) {
    var p = String(day || "").split("-").map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function plDayDiff(day, today) {
    return Math.round((plParseDay(day) - plParseDay(today)) / 86400000);
  }
  function plDayLabel(day, today) {
    var diff = plDayDiff(day, today);
    if (diff === 0) return L("Aujourd'hui", "Today");
    if (diff === 1) return L("Demain", "Tomorrow");
    var d = plParseDay(day);
    var opts = { weekday: "long", day: "numeric", month: "long" };
    if (d.getFullYear() !== plParseDay(today).getFullYear()) opts.year = "numeric";
    var text = d.toLocaleDateString(locale(), opts);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function plShortDay(day) {
    return plParseDay(day).toLocaleDateString(locale(), { day: "numeric", month: "short" });
  }
  function plTime(ts) {
    return new Date(ts * 1000).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  }
  function plIn(days) {
    if (days <= 0) return "";
    return L("dans " + days + " j", "in " + days + " d");
  }

  var PL_TYPES = {
    booking: { cls: "ad-pl-booking", fr: "Séance", en: "Session" },
    reminder: { cls: "ad-pl-reminder", fr: "Rappel client", en: "Client date" },
    season: { cls: "ad-pl-season", fr: "Temps fort", en: "Studio date" },
    item: { cls: "ad-pl-item", fr: "Rendez-vous", en: "Appointment" },
    contract: { cls: "ad-pl-booking", fr: "Séance sous contrat", en: "Contracted session" },
  };
  var PL_FILTERS = [
    ["all", "Tout", "All"],
    ["booking", "Séances", "Sessions"],
    ["reminder", "Rappels", "Reminders"],
    ["item", "Mes rendez-vous", "My appointments"],
  ];

  function plEventHtml(ev, today) {
    var type = PL_TYPES[ev.type] || PL_TYPES.item;
    var when = ev.startsAt ? plTime(ev.startsAt) : ev.time ? ev.time : L("Journée", "All day");
    var title = ev.type === "reminder" || ev.type === "season" ? plReminderTitle(ev) : ev.title;
    var meta = [];
    var actions = "";
    if (ev.type === "booking") {
      if (ev.clientName || ev.clientEmail) meta.push(clLink(ev.clientName, ev.clientEmail));
      if (ev.durationMin) meta.push(ev.durationMin + " min");
      if (ev.tier) meta.push(esc(ev.tier));
      if (ev.location) meta.push(esc(ev.location));
      if (ev.depositCents) meta.push(ev.depositPaid
        ? '<span class="ad-pl-ok">' + L("Acompte réglé", "Deposit paid") + " · " + formatEuros(ev.depositCents) + "</span>"
        : L("Acompte en attente", "Deposit pending"));
      if (ev.clientPhone) actions += '<a class="ad-btn ad-btn-sm" href="tel:' + esc(ev.clientPhone.replace(/\s+/g, "")) + '">' + L("Appeler", "Call") + "</a>";
      if (ev.clientEmail) actions += '<a class="ad-btn ad-btn-sm" href="' + clHref(ev.clientEmail) + '">' + L("Fiche client", "Client record") + "</a>";
    } else if (ev.type === "contract") {
      if (ev.clientName || ev.clientEmail) meta.push(clLink(ev.clientName, ev.clientEmail));
      meta.push('<span class="ad-nowrap">' + L("Contrat n° ", "Contract no. ") + esc(ev.number) + "</span>");
      meta.push(ev.signed
        ? '<span class="ad-pl-ok">' + L("Signé", "Signed") + (ev.depositCents ? (ev.depositPaid ? L(" · acompte réglé", " · deposit paid") : L(" · acompte en attente", " · deposit pending")) : "") + "</span>"
        : '<span class="ad-pl-due">' + L("Devis envoyé, pas encore signé", "Quote sent, not signed yet") + "</span>");
      actions += '<a class="ad-btn ad-btn-sm" href="#/contrats">' + L("Voir le contrat", "View the contract") + "</a>";
      if (ev.clientEmail) actions += '<a class="ad-btn ad-btn-sm" href="' + clHref(ev.clientEmail) + '">' + L("Fiche client", "Client record") + "</a>";
    } else if (ev.type === "reminder") {
      meta.push(clLink(ev.clientName, ev.clientEmail));
      meta.push(ev.remindOn <= today ? '<span class="ad-pl-due">' + L("Moment de lui écrire", "Time to get in touch") + "</span>"
        : L("Rappel le ", "Reminder on ") + plShortDay(ev.remindOn));
      if (ev.mailto) actions += '<a class="ad-btn ad-btn-sm" href="' + esc(ev.mailto) + '">' + L("Écrire", "Write") + "</a>";
    } else if (ev.type === "season") {
      meta.push(L("À proposer à tous vos clients", "To offer to all your clients"));
      actions += '<a class="ad-btn ad-btn-sm" href="#/clients">' + L("Préparer l'envoi", "Prepare the email") + "</a>";
    } else {
      if (ev.clientEmail) meta.push(clLink(ev.clientName, ev.clientEmail));
      if (ev.note) meta.push(esc(ev.note));
      actions += '<button type="button" class="ad-link-btn ad-pl-delete" data-pl-delete="' + esc(ev.id.slice(4)) + '">' + L("Supprimer", "Delete") + "</button>";
    }
    var href = ev.type === "reminder" && ev.clientEmail ? clHref(ev.clientEmail) : "";
    return (
      '<li class="ad-pl-event ' + type.cls + '"' + (href ? ' data-pl-href="' + esc(href) + '"' : "") + ">" +
      '<span class="ad-pl-when">' + esc(when) + "</span>" +
      '<div class="ad-pl-body">' +
      '<p class="ad-pl-title"><span class="ad-pl-type">' + L(type.fr, type.en) + "</span>" +
      (href ? '<a href="' + esc(href) + '">' + esc(title) + "</a>" : esc(title)) + "</p>" +
      (meta.length ? '<p class="ad-pl-meta">' + meta.join(" · ") + "</p>" : "") +
      "</div>" +
      (actions ? '<div class="ad-pl-actions">' + actions + "</div>" : "") +
      "</li>"
    );
  }

  function plAgendaHtml(data) {
    var events = data.events.filter(function (ev) {
      var f = planningState.filter;
      return f === "all" || ev.type === f || (f === "reminder" && ev.type === "season") || (f === "booking" && ev.type === "contract");
    });
    var counts = { all: data.events.length, booking: 0, reminder: 0, item: 0 };
    var group = { season: "reminder", contract: "booking" };
    data.events.forEach(function (ev) { var k = group[ev.type] || ev.type; counts[k] = (counts[k] || 0) + 1; });
    var chips = '<div class="ad-pl-filters" role="group" aria-label="' + L("Filtrer l'agenda", "Filter the agenda") + '">' +
      PL_FILTERS.map(function (f) {
        return '<button type="button" class="ad-pl-chip" data-pl-filter="' + f[0] + '" aria-pressed="' + (planningState.filter === f[0]) + '">' +
          L(f[1], f[2]) + ' <span class="ad-pl-chip-n">' + (counts[f[0]] || 0) + "</span></button>";
      }).join("") + "</div>";
    if (!events.length) {
      return chips + '<div class="ad-pl-empty"><p><strong>' + (data.events.length ? L("Rien dans cette catégorie.", "Nothing in this category.") : L("Rien de prévu pour l'instant.", "Nothing planned yet.")) + "</strong></p>" +
        "<p>" + L("Les séances réservées sur votre mini-site, les dates de vos clients (anniversaires, étapes de bébé) et vos rendez-vous s'afficheront ici, sur les quatre prochains mois.",
          "Sessions booked on your mini-site, your clients' dates (birthdays, baby milestones) and your appointments will show here, over the next four months.") + "</p>" +
        '<p class="ad-pl-empty-links"><a href="#/clients">' + L("Ajouter une date à une fiche client", "Add a date to a client record") + '</a> · <a href="#/reservations">' + L("Ouvrir des créneaux", "Open booking slots") + "</a></p></div>";
    }
    var html = chips;
    var current = "";
    events.forEach(function (ev) {
      if (ev.date !== current) {
        if (current) html += "</ol></div>";
        current = ev.date;
        var diff = plDayDiff(ev.date, data.today);
        html += '<div class="ad-pl-day' + (diff === 0 ? " ad-pl-today" : "") + '"><h4><span>' + esc(plDayLabel(ev.date, data.today)) + "</span>" +
          (diff > 1 ? '<span class="ad-pl-in">' + plIn(diff) + "</span>" : "") + '</h4><ol class="ad-pl-events">';
      }
      html += plEventHtml(ev, data.today);
    });
    return html + "</ol></div>";
  }

  function plTaskHtml(t, today) {
    var title, meta = [], actions = "";
    if (t.type === "selection") {
      title = L("Sélection reçue : à retoucher", "Selection received: to retouch");
      meta.push("<strong>" + esc(t.title) + "</strong>");
      meta.push((t.selectedCount
        ? L(t.selectedCount + " photo" + (t.selectedCount > 1 ? "s" : "") + " choisie" + (t.selectedCount > 1 ? "s" : ""), t.selectedCount + " photo" + (t.selectedCount > 1 ? "s" : "") + " chosen") +
          (t.clientName ? L(" par ", " by ") + clLink(t.clientName, t.clientEmail) : "")
        : L("Validée", "Confirmed") + (t.clientName ? L(" par ", " by ") + clLink(t.clientName, t.clientEmail) : "")) + L(", le ", " on ") + plShortDay(t.since));
      actions = '<button type="button" class="ad-btn ad-btn-sm" data-pl-gallery="' + esc(t.slug) + '">' + L("Ouvrir la galerie", "Open the gallery") + "</button>";
    } else if (t.type === "gallery") {
      title = L("Séance passée : créer la galerie", "Past session: create the gallery");
      meta.push("<strong>" + esc(t.title) + "</strong>");
      meta.push((t.clientName ? clLink(t.clientName, t.clientEmail) + ", " : "") + L("le ", "on ") + plShortDay(t.since));
      actions = '<button type="button" class="ad-btn ad-btn-sm" data-pl-create="' + esc(t.key) + '">' + L("Nouvelle galerie", "New gallery") + "</button>";
    } else if (t.type === "contact") {
      title = L("Écrire à ", "Get in touch with ") + (t.clientName || t.clientEmail);
      meta.push(esc(plReminderTitle(t)) + L(" le ", " on ") + plShortDay(t.date));
      actions = (t.mailto ? '<a class="ad-btn ad-btn-sm" href="' + esc(t.mailto) + '">' + L("Écrire", "Write") + "</a>" : "") +
        '<a class="ad-btn ad-btn-sm" href="' + clHref(t.clientEmail) + '">' + L("Fiche client", "Client record") + "</a>";
    } else {
      title = t.title;
      if (t.date) {
        var late = !t.done && t.date < today;
        meta.push((late ? '<span class="ad-pl-late">' + L("En retard · ", "Overdue · ") : "<span>") + plShortDay(t.date) + (t.time ? " · " + esc(t.time) : "") + "</span>");
      }
      if (t.clientEmail) meta.push(clLink(t.clientName, t.clientEmail));
      if (t.note) meta.push(esc(t.note));
      actions = '<button type="button" class="ad-link-btn ad-pl-delete" data-pl-delete="' + esc(t.id) + '">' + L("Supprimer", "Delete") + "</button>";
    }
    var id = "pl-" + t.key.replace(/[^a-zA-Z0-9_-]/g, "-");
    return (
      '<li class="ad-pl-task' + (t.done ? " ad-pl-done" : "") + '">' +
      '<input type="checkbox" id="' + id + '" data-pl-check="' + esc(t.key) + '"' + (t.done ? " checked" : "") + ' aria-label="' + esc(L("Marquer comme fait : ", "Mark as done: ") + title) + '" />' +
      '<div class="ad-pl-body"><label for="' + id + '" class="ad-pl-title">' + esc(title) + "</label>" +
      (meta.length ? '<p class="ad-pl-meta">' + meta.join(" · ") + "</p>" : "") +
      (actions && !t.done ? '<div class="ad-pl-actions">' + actions + "</div>" : "") +
      "</div></li>"
    );
  }

  function plFormHtml(data) {
    return (
      '<form class="ad-pl-form" id="ad-pl-form"' + (planningState.adding ? "" : " hidden") + ">" +
      '<label class="ad-field"><span>' + L("Quoi", "What") + '</span><input name="title" required maxlength="160" placeholder="' +
      L("ex. Repérage au parc, commander les albums", "e.g. Scout the park, order the albums") + '" /></label>' +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>' + L("Date", "Date") + " <em>" + L("(facultatif)", "(optional)") + '</em></span><input type="date" name="date" /></label>' +
      '<label class="ad-field"><span>' + L("Heure", "Time") + " <em>" + L("(facultatif)", "(optional)") + '</em></span><input type="time" name="time" /></label>' +
      "</div>" +
      '<label class="ad-field"><span>' + L("Client", "Client") + " <em>" + L("(facultatif)", "(optional)") + '</em></span><input name="clientEmail" type="email" list="ad-pl-clients" placeholder="' +
      L("adresse e-mail du client", "client's email address") + '" /></label>' +
      '<datalist id="ad-pl-clients">' + (data.clients || []).map(function (c) {
        return '<option value="' + esc(c.email) + '">' + esc(c.name || c.email) + "</option>";
      }).join("") + "</datalist>" +
      '<p class="ad-hint">' + L("Avec une date, elle s'affiche aussi dans l'agenda.", "With a date, it also shows in the agenda.") + "</p>" +
      '<div class="ad-pl-form-actions"><button type="submit" class="ad-btn ad-btn-primary">' + L("Ajouter", "Add") + '</button>' +
      '<button type="button" class="ad-link-btn" id="ad-pl-cancel">' + L("Annuler", "Cancel") + "</button></div>" +
      "</form>"
    );
  }

  function updatePlanningBadge(data) {
    var tab = document.getElementById("ad-tab-planning");
    if (!tab) return;
    var due = data && data.counts ? data.counts.todo : 0;
    var badge = tab.querySelector(".ad-tab-count");
    if (!due) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ad-tab-count";
      tab.appendChild(badge);
    }
    badge.textContent = String(due);
    badge.setAttribute("aria-label", L(due + " chose" + (due > 1 ? "s" : "") + " à faire", due + " thing" + (due > 1 ? "s" : "") + " to do"));
  }

  function paintPlanning() {
    var data = planningState.data;
    var open = data.tasks.filter(function (t) { return !t.done; });
    var done = data.tasks.filter(function (t) { return t.done; });
    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>' + L("Planning", "Planning") + "</h2>" +
      '<p class="ad-hint">' + L("Vos séances, les dates de vos clients et ce qui reste à faire, au même endroit.", "Your sessions, your clients' dates and what's left to do, in one place.") + "</p></div>" +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-pl-add">' + L("+ Ajouter une tâche ou un rendez-vous", "+ Add a task or appointment") + "</button>" +
      "</header>" +
      '<div class="ad-pl-layout">' +
      '<section class="ad-pl-todo" aria-labelledby="ad-pl-todo-h"><div class="ad-section-header"><h3 id="ad-pl-todo-h">' + L("À faire", "To do") +
      (open.length ? ' <span class="ad-pl-count">' + open.length + "</span>" : "") + "</h3></div>" +
      plFormHtml(data) +
      (open.length || done.length
        ? '<ul class="ad-pl-tasks">' + open.concat(done).map(function (t) { return plTaskHtml(t, data.today); }).join("") + "</ul>"
        : '<p class="ad-pl-clear">' + L("Rien à faire pour l'instant. Les sélections reçues, les galeries à créer après une séance et les clients à recontacter arriveront ici d'eux-mêmes.",
          "Nothing to do right now. Selections received, galleries to create after a session and clients to get back to will show up here on their own.") + "</p>") +
      "</section>" +
      '<section class="ad-pl-agenda" aria-labelledby="ad-pl-agenda-h"><div class="ad-section-header"><h3 id="ad-pl-agenda-h">' + L("Agenda", "Agenda") + "</h3></div>" +
      plAgendaHtml(data) +
      "</section>" +
      "</div>";
    wirePlanning();
  }

  async function reloadPlanning() {
    try {
      planningState.data = await api("GET", "/planning");
      updatePlanningBadge(planningState.data);
      var y = window.scrollY;
      paintPlanning();
      window.scrollTo(0, y);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function wirePlanning() {
    var data = planningState.data;
    var form = document.getElementById("ad-pl-form");
    document.getElementById("ad-pl-add").addEventListener("click", function () {
      planningState.adding = true;
      form.hidden = false;
      form.elements.title.focus();
    });
    document.getElementById("ad-pl-cancel").addEventListener("click", function () {
      planningState.adding = false;
      form.reset();
      form.hidden = true;
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await api("POST", "/planning/items", {
          title: form.elements.title.value, date: form.elements.date.value, time: form.elements.time.value,
          clientEmail: form.elements.clientEmail.value,
        });
        planningState.adding = false;
        toast(L("Ajouté au planning.", "Added to your planning."));
        reloadPlanning();
      } catch (err) {
        btn.disabled = false;
        toast(err.message, true);
      }
    });
    el.view.querySelectorAll("[data-pl-filter]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        planningState.filter = chip.getAttribute("data-pl-filter");
        paintPlanning();
      });
    });
    el.view.querySelectorAll("[data-pl-check]").forEach(function (box) {
      box.addEventListener("change", async function () {
        var key = box.getAttribute("data-pl-check");
        box.disabled = true;
        try {
          if (key.indexOf("itm:") === 0) await api("POST", "/planning/items/" + encodeURIComponent(key.slice(4)), { done: box.checked });
          else await api("POST", "/planning/done", { key: key, done: box.checked });
          if (box.checked && key.indexOf("itm:") !== 0) toast(L("C'est fait.", "Done."));
          reloadPlanning();
        } catch (err) {
          box.disabled = false;
          box.checked = !box.checked;
          toast(err.message, true);
        }
      });
    });
    el.view.querySelectorAll("[data-pl-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        confirmAction(L("Supprimer cette tâche du planning ?", "Delete this item from your planning?"), async function () {
          try {
            await api("DELETE", "/planning/items/" + encodeURIComponent(btn.getAttribute("data-pl-delete")));
            reloadPlanning();
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    });
    el.view.querySelectorAll("[data-pl-gallery]").forEach(function (btn) {
      btn.addEventListener("click", function () { renderDetail(btn.getAttribute("data-pl-gallery")); });
    });
    // Séance passée : la fenêtre de création s'ouvre déjà remplie.
    el.view.querySelectorAll("[data-pl-create]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var task = data.tasks.filter(function (t) { return t.key === btn.getAttribute("data-pl-create"); })[0];
        openCreateModal();
        if (!task) return;
        var f = document.getElementById("ad-create-form");
        f.title.value = task.title + (task.clientName ? " — " + task.clientName : "");
        f.clientName.value = task.clientName || "";
        f.clientEmail.value = task.clientEmail || "";
      });
    });
    // Un rappel client mène à sa fiche, sur toute la ligne.
    el.view.querySelectorAll("[data-pl-href]").forEach(function (row) {
      row.addEventListener("click", function (event) {
        if (event.target.closest("a, button")) return;
        location.hash = row.getAttribute("data-pl-href");
      });
    });
  }

  async function renderPlanning(skipHash) {
    if (!skipHash && location.hash !== "#/planning") history.pushState(null, "", "#/planning");
    setActiveTab("planning");
    el.view.innerHTML = '<p class="ad-loading">' + L("Chargement du planning…", "Loading your planning…") + "</p>";
    try {
      planningState.data = await api("GET", "/planning");
    } catch (err) {
      el.view.innerHTML = '<div class="ad-error-panel"><h2>' + L("Planning indisponible", "Planning unavailable") + "</h2><p>" + esc(err.message) + "</p></div>";
      return;
    }
    updatePlanningBadge(planningState.data);
    paintPlanning();
  }

  /* ---------- Démarrage et navigation ---------- */

  function routeFromHash() {
    var match = /^#\/g\/(.+)$/.exec(location.hash);
    if (match) renderDetail(decodeURIComponent(match[1]), true);
    else if (location.hash === "#/detect") renderDetect(true);
    else if (location.hash === "#/planning") renderPlanning(true);
    else if (location.hash === "#/ventes") renderSales(true);
    else if (location.hash === "#/reservations") renderBooking(true);
    else if (location.hash === "#/clients") renderClients(true);
    else if (/^#\/clients\/.+/.test(location.hash)) renderClientDetail(decodeURIComponent(location.hash.slice(10)), true);
    else if (location.hash === "#/contrats") renderContracts(true);
    else if (location.hash === "#/portfolio") renderPortfolio(true);
    else if (location.hash.indexOf("#/facturation") === 0) renderBilling(true);
    else if (location.hash.indexOf("#/abonnement") === 0) renderSubscription(true);
    else if (location.hash === "#/parametres") renderSettings(true);
    else if (location.hash === "#/boutique") renderShop(true);
    else if (location.hash === "#/proprietaire") renderOwner(true);
    else if (location.hash.indexOf("#/scolaire") === 0) renderSchool(true);
    else renderList(true);
  }

  window.addEventListener("popstate", routeFromHash);

  function bootstrap() {
    return api("GET", "/config").then(function (cfg) {
      state.config = cfg;
    }).catch(function () {
      /* la vue liste ne dépend pas de la configuration ; on continue avec les valeurs par défaut */
    }).then(function () {
      routeFromHash();
      // La pastille « à relancer » s'affiche dès l'ouverture, sans attendre l'onglet.
      if (location.hash.indexOf("#/clients") !== 0) api("GET", "/clients").then(updateClientsBadge).catch(function () {});
      if (location.hash !== "#/planning") api("GET", "/planning").then(updatePlanningBadge).catch(function () {});
    });
  }

  // Confirmation d'un changement d'adresse e-mail (voir renderSettings) :
  // n'exige aucune session — le lien envoyé par e-mail en tient lieu, et peut
  // donc être ouvert depuis un autre appareil que celui où le changement a
  // été demandé. On l'efface de l'URL une fois traité, comme pour `reset`.
  var confirmEmailToken = new URLSearchParams(location.search).get("confirm-email");

  function handleEmailConfirmation() {
    return fetch("/local/auth/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: confirmEmailToken }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          history.replaceState(null, "", location.pathname + location.hash);
          if (!response.ok) {
            toast(serverText(data.error || "Lien de confirmation invalide ou expiré."), true);
          } else {
            toast(L("Nouvelle adresse confirmée : ", "New email address confirmed: ") + data.email);
          }
        });
      })
      .catch(function () {
        history.replaceState(null, "", location.pathname + location.hash);
        toast(L("Connexion au serveur d'administration perdue.", "Lost connection to the admin server."), true);
      });
  }

  if (resetToken) {
    // Un lien de réinitialisation prime sur une éventuelle session déjà
    // ouverte dans ce navigateur : cliquer ce lien est une intention claire.
    showLoginCard("ad-reset-card");
  } else {
    var afterConfirm = confirmEmailToken ? handleEmailConfirmation() : Promise.resolve();
    afterConfirm.then(function () {
      return fetch("/local/auth/me").then(function (response) {
        if (!response.ok) {
          showLogin();
          return;
        }
        return response.json().then(function (data) {
          showApp(data.photographer);
          bootstrap();
        });
      });
    }).catch(showLogin);
  }
})();
