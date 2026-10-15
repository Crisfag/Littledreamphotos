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

  /* ---------- Onglets (Galeries / Facturation / Paramètres) ---------- */
  // Purement visuel : chaque écran reste atteignable par son propre lien de
  // hachage (#/facturation, #/parametres…) — les onglets ne sont qu'un
  // raccourci qui reflète, et met à jour, ce même état.

  function setActiveTab(name) {
    stopTrackPreview();
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
      banner.innerHTML = "<strong>" + esc(data.studio) + "</strong> vous parraine : −" + Number(data.discountPercent) +
        " % sur votre mois suivant, dès votre premier paiement.";
      banner.hidden = false;
    } catch (err) { /* sans bandeau, l'inscription garde le code */ }
  }
  showReferralBanner();

  function showApp(photographer) {
    el.login.hidden = true;
    el.app.hidden = false;
    if (el.account) {
      el.account.textContent = (photographer.studioName || photographer.email) + " · Galeries protégées";
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
      throw new Error("Session expirée — reconnectez-vous.");
    }
    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      /* réponse vide, sans conséquence */
    }
    if (!response.ok) {
      var message = (data && data.error) || ("Erreur HTTP " + response.status);
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
        else reject(new Error((data && data.error) || "Échec de l'envoi (" + xhr.status + ")"));
      };
      xhr.onerror = function () {
        reject(new Error("Connexion au serveur d'administration perdue"));
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
    return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" });
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString("fr-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
        toast("Copié dans le presse-papiers.");
      }).catch(function () {
        input.select();
        toast("Sélectionné — copiez avec Ctrl/Cmd + C.");
      });
    }
  });

  /* ---------- Vue : liste des galeries ---------- */

  function galleryStatus(gallery) {
    if (gallery.expires_at && gallery.expires_at * 1000 < Date.now()) {
      return { label: "Expirée", cls: "ad-badge-expired" };
    }
    if (gallery.expires_at) {
      return { label: "Expire le " + formatDate(gallery.expires_at), cls: "ad-badge-soon" };
    }
    return { label: "Sans expiration", cls: "" };
  }

  function openCreateModal() {
    var form = document.getElementById("ad-create-form");
    form.reset();
    // Style de départ : celui des paramètres, modifiable ici et ensuite.
    var preferred = (state.me && state.me.defaultTheme) || "classique";
    form.theme.innerHTML = GALLERY_STYLES.map(function (s) {
      return '<option value="' + s.key + '"' + (s.key === preferred ? " selected" : "") + ">" + esc(s.label) + " — " + esc(s.ideal.toLowerCase()) + "</option>";
    }).join("");
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
      statTile("Galeries créées", stats.galleriesCount) +
      statTile("Ventes effectuées", stats.salesCount) +
      statTile("Montant encaissé", formatEuros(stats.salesAmountCents)) +
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

  async function renderList(skipHash) {
    if (!skipHash && location.hash) history.pushState(null, "", location.pathname);
    setActiveTab("galleries");
    el.view.innerHTML = '<p class="ad-loading">Chargement des galeries…</p>';
    var data;
    try {
      data = await api("GET", "/galleries");
    } catch (err) {
      el.view.innerHTML =
        '<div class="ad-error-panel"><h2>Impossible de joindre le Worker</h2><p>' + esc(err.message) + "</p></div>";
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
      "<h2>Vos galeries</h2>" +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-new-gallery">+ Nouvelle galerie</button>' +
      "</div>";

    if (state.galleries.length === 0) {
      el.view.innerHTML =
        statsBar +
        header +
        '<div class="ad-empty"><h2>Aucune galerie pour le moment</h2>' +
        '<p>Cliquez sur « Nouvelle galerie » pour envoyer votre première séance.</p></div>';
      document.getElementById("ad-new-gallery").addEventListener("click", openCreateModal);
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
        "<span>" + g.photo_count + (g.photo_count > 1 ? " photos" : " photo") + "</span>" +
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
          ? '<span class="ad-badge ad-badge-validated" title="Sélection validée le ' + formatDate(g.selection_done_at) + '">✓ Validée</span>'
          : "") +
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
    return '<p class="ad-hint ad-fee-hint">Frais de paiement : <strong>' + esc(fee.label) + "</strong> par vente (carte bancaire et virement vers votre compte). " +
      "Aucune commission Holypixx sur vos ventes.</p>";
  }

  function stripeStatusHtml(photographer) {
    if (photographer.stripeChargesEnabled) {
      return (
        '<p class="ad-stripe-badge ad-stripe-badge-ok">✓ Compte Stripe actif</p>' +
        '<p class="ad-hint">Les suppléments et tirages payés par vos clients (carte, Apple Pay, Bancontact…) arrivent directement sur votre compte.</p>' +
        paymentFeeHintHtml(photographer)
      );
    }
    if (photographer.stripeConnected) {
      return (
        '<p class="ad-stripe-badge">Configuration Stripe incomplète</p>' +
        '<p class="ad-hint">Le compte a été créé, mais Stripe attend encore quelques informations (identité, coordonnées bancaires) avant d\'activer les paiements.</p>' +
        '<div class="ad-stripe-actions">' +
        '<button type="button" class="ad-btn ad-btn-primary" id="ad-stripe-connect">Continuer la configuration</button>' +
        '<button type="button" class="ad-btn" id="ad-stripe-refresh">Vérifier le statut</button>' +
        "</div>"
      );
    }
    return (
      '<p class="ad-hint">Connectez un compte Stripe pour que vos clients puissent régler leurs suppléments en ligne (carte, Apple Pay, PayPal) — l\'argent arrive directement chez vous.</p>' +
      paymentFeeHintHtml(photographer) +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-stripe-connect">Connecter Stripe</button>'
    );
  }

  function invoiceRowsHtml(invoices) {
    if (!invoices.length) {
      return '<p class="ad-hint">Aucune facture émise pour l\'instant — elles apparaissent ici dès qu\'un client règle un supplément en ligne.</p>';
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
      "<th>Quand</th><th>Facture</th><th>Galerie</th><th>Montant</th><th>Envoyée à</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
  }

  // Rien n'agrège encore les suppléments dus toutes galeries confondues côté
  // Worker : la liste des galeries porte déjà due_extra_count/due_total_cents
  // par galerie (voir admin.js du Worker), il suffit de les additionner ici.
  function dueSummaryHtml(galleries) {
    var due = galleries.filter(function (g) { return g.due_extra_count > 0; });
    if (!due.length) {
      return '<p class="ad-hint">Aucun supplément en attente de règlement pour l\'instant.</p>';
    }
    var totalCents = due.reduce(function (sum, g) { return sum + g.due_total_cents; }, 0);
    var rows = due.map(function (g) {
      return (
        "<tr>" +
        '<td><button type="button" class="ad-link-btn" data-slug="' + esc(g.slug) + '">' + esc(g.title) + "</button></td>" +
        "<td>" + g.due_extra_count + " photo" + (g.due_extra_count > 1 ? "s" : "") + "</td>" +
        "<td>" + formatEuros(g.due_total_cents) + "</td>" +
        "</tr>"
      );
    });
    return (
      '<p class="ad-quota-due">' + formatEuros(totalCents) + " au total, sur " + due.length + " galerie" + (due.length > 1 ? "s" : "") + "</p>" +
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>Galerie</th><th>Suppléments</th><th>Montant</th></tr></thead><tbody>' +
      rows.join("") + "</tbody></table></div>"
    );
  }

  async function renderBilling(skipHash) {
    var cameFromStripe = location.hash.indexOf("stripe=retour") !== -1 || location.hash.indexOf("stripe=repriser") !== -1;
    if (!skipHash && location.hash.indexOf("#/facturation") !== 0) history.pushState(null, "", "#/facturation");
    if (cameFromStripe) history.replaceState(null, "", "#/facturation");
    setActiveTab("billing");

    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
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
      '<header class="ad-detail-header"><div><h2>Facturation</h2>' +
      '<p class="ad-hint">Paiement en ligne des suppléments, factures émises et montants encore dus, toutes galeries confondues.</p>' +
      "</div></header>" +
      '<section class="ad-stripe"><div class="ad-section-header"><h3>Paiement en ligne</h3></div>' +
      stripeStatusHtml(photographer) +
      "</section>" +
      '<section><div class="ad-section-header"><h3>Suppléments dus</h3></div>' +
      dueSummaryHtml(galleriesData.galleries) +
      "</section>" +
      '<section><div class="ad-section-header"><h3>Historique des factures</h3>' +
      (invoicesData.invoices.length ? "<p class=\"ad-hint\">" + formatEuros(invoicesData.totalCents) + " au total</p>" : "") +
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
        connectBtn.textContent = "Connexion…";
        try {
          var result = await api("POST", "/stripe/connect");
          window.location.href = result.url;
        } catch (err) {
          toast(err.message, true);
          connectBtn.disabled = false;
          connectBtn.textContent = "Connecter Stripe";
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
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';

    var data;
    try {
      data = await api("GET", "/auth/me");
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }
    var photographer = data.photographer;

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Paramètres</h2>' +
      '<p class="ad-hint">Studio, présentation par défaut de vos futures galeries, coordonnées fiscales et connexion.</p>' +
      "</div></header>" +

      '<section><div class="ad-section-header"><h3>Studio</h3></div>' +
      '<form id="ad-studio-form">' +
      '<label class="ad-field"><span>Nom du studio</span>' +
      '<input type="text" name="studioName" value="' + esc(photographer.studioName) + '" placeholder="Mon Studio" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-studio-save">Enregistrer</button>' +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>Votre identité</h3></div>' +
      '<p class="ad-hint">Jamais affichée à vos clients — contrairement au nom du studio ci-dessus.</p>' +
      '<form id="ad-name-form" class="ad-field-row">' +
      '<label class="ad-field"><span>Prénom</span>' +
      '<input type="text" name="firstName" value="' + esc(photographer.firstName) + '" placeholder="Christine" /></label>' +
      '<label class="ad-field"><span>Nom</span>' +
      '<input type="text" name="lastName" value="' + esc(photographer.lastName) + '" placeholder="Fagnant" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-name-save">Enregistrer</button>' +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>Présentation par défaut</h3></div>' +
      '<p class="ad-hint">Proposée à la création d\'une nouvelle galerie — modifiable au cas par cas ensuite, comme pour n\'importe quelle galerie déjà créée.</p>' +
      '<div class="ad-layout-options" id="ad-default-layout-options">' +
      layoutOptionsHtml({ layout: photographer.defaultLayout }) +
      "</div>" +
      '<h4 class="ad-sc-subhead">Style par défaut</h4>' +
      '<p class="ad-hint">Survolez un style pour l\'apercevoir ; il sera proposé à chaque nouvelle galerie.</p>' +
      '<div class="ad-style-cards" id="ad-default-style-cards">' + styleCardsHtml(photographer.defaultTheme || "classique", "", "") + "</div>" +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Adresse de votre studio</h3></div>' +
      '<p class="ad-hint">Vos clients ouvrent leurs galeries à une adresse à votre nom — <strong>votre-studio.' + esc(state.config.studioDomain || "holypixx.com") + '</strong> — plutôt que sur le site de la plateforme. Lettres minuscules, chiffres et tirets, 3 à 30 caractères. Laissez vide pour revenir au site principal.</p>' +
      '<form id="ad-subdomain-form"><label class="ad-field"><span>Sous-domaine</span>' +
      '<div class="ad-subdomain-row"><input type="text" name="subdomain" value="' + esc(photographer.subdomain || "") + '" placeholder="votre-studio" autocapitalize="off" autocomplete="off" spellcheck="false" maxlength="30" />' +
      '<span class="ad-subdomain-suffix">.' + esc(state.config.studioDomain || "holypixx.com") + "</span></div></label>" +
      '<p class="ad-hint" id="ad-subdomain-current">' +
      (photographer.subdomain
        ? "Vos liens de galerie commencent par <strong>https://" + esc(photographer.subdomain) + "." + esc(state.config.studioDomain || "holypixx.com") + "/</strong>."
        : "Aucun sous-domaine pour l'instant : vos liens pointent vers le site principal.") +
      "</p>" +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-subdomain-save">Enregistrer</button>' +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>Relances automatiques</h3></div>' +
      '<p class="ad-hint">Tant qu\'un client n\'a pas cliqué « Valider ma sélection », il reçoit un rappel à 7 jours puis à 2 jours de l\'expiration de sa galerie (s\'il a un e-mail renseigné), et vous en recevez un à 2 jours. Rien n\'est envoyé pour une galerie sans date d\'expiration.</p>' +
      '<label class="ad-toggle"><input type="checkbox" id="ad-reminders-toggle"' + (photographer.remindersEnabled ? " checked" : "") + " />" +
      "<span>Envoyer les relances automatiques</span></label>" +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Coordonnées fiscales</h3></div>' +
      '<p class="ad-hint">Ces informations apparaissent sur les factures émises pour vos clients.</p>' +
      '<form id="ad-billing-form">' +
      '<label class="ad-field"><span>Raison sociale</span>' +
      '<input type="text" name="companyName" value="' + esc(photographer.billingCompanyName) + '" placeholder="Little Dream Photos" /></label>' +
      '<label class="ad-field"><span>Adresse</span>' +
      '<textarea name="address" rows="3" placeholder="Rue…, code postal, ville, pays">' + esc(photographer.billingAddress) + "</textarea></label>" +
      '<label class="ad-field"><span>Numéro de TVA</span>' +
      '<input type="text" name="vatNumber" value="' + esc(photographer.billingVatNumber) + '" placeholder="BE0123456789" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-billing-save">Enregistrer</button>' +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>Adresse e-mail</h3></div>' +
      '<p class="ad-hint">Adresse actuelle : <strong>' + esc(photographer.email) + '</strong>. La changer nécessite de confirmer la nouvelle adresse en ouvrant le lien reçu par e-mail — rien ne change avant ça.</p>' +
      '<form id="ad-email-form">' +
      '<label class="ad-field"><span>Nouvelle adresse</span>' +
      '<input type="email" name="newEmail" required autocomplete="username" /></label>' +
      '<label class="ad-field"><span>Mot de passe actuel</span>' +
      '<input type="password" name="password" required autocomplete="current-password" /></label>' +
      '<p class="ad-error" id="ad-email-error" hidden></p>' +
      '<p class="ad-hint" id="ad-email-message" hidden></p>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-email-save">Envoyer le lien de confirmation</button>' +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>Mot de passe</h3></div>' +
      '<form id="ad-password-change-form">' +
      '<label class="ad-field"><span>Mot de passe actuel</span>' +
      '<input type="password" name="currentPassword" required autocomplete="current-password" /></label>' +
      '<label class="ad-field"><span>Nouveau mot de passe <em>(10 caractères minimum)</em></span>' +
      '<input type="password" name="newPassword" required minlength="10" autocomplete="new-password" /></label>' +
      '<p class="ad-error" id="ad-password-change-error" hidden></p>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-password-change-save">Changer le mot de passe</button>' +
      "</form></section>" +

      '<section class="ad-mydata"><div class="ad-section-header"><h3>Mes données</h3></div>' +
      '<p class="ad-hint">Toutes les données de votre compte (galeries, sélections de vos clients, paiements, commandes, journaux) dans un fichier, ' +
      'conformément au RGPD. Voir la <a href="https://www.holypixx.com/confidentialite.html" target="_blank" rel="noopener">politique de confidentialité</a>.</p>' +
      '<a class="ad-btn" href="/local/account/export" download>Exporter mes données</a>' +
      '<details class="ad-danger-zone"><summary>Supprimer mon compte</summary>' +
      '<p class="ad-hint">Suppression <strong>définitive et immédiate</strong> de votre compte, de toutes vos galeries, photos, fichiers livrés et des données de vos clients. ' +
      "Téléchargez d'abord vos factures et l'export ci-dessus : rien ne pourra être récupéré. Pensez aussi à déconnecter Stripe et Prodigi de leur côté si vous ne les utilisez plus.</p>" +
      '<form id="ad-delete-account-form">' +
      '<label class="ad-field"><span>Mot de passe</span><input type="password" name="password" required autocomplete="current-password" /></label>' +
      '<label class="ad-field"><span>Tapez SUPPRIMER pour confirmer</span><input type="text" name="confirm" required autocomplete="off" /></label>' +
      '<p class="ad-error" id="ad-delete-account-error" hidden></p>' +
      '<button type="submit" class="ad-btn ad-btn-danger" id="ad-delete-account-submit">Supprimer définitivement mon compte</button>' +
      "</form></details></section>";

    document.getElementById("ad-delete-account-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var errorBox = document.getElementById("ad-delete-account-error");
      errorBox.hidden = true;
      if (form.confirm.value.trim() !== "SUPPRIMER") {
        errorBox.textContent = "Tapez SUPPRIMER en majuscules pour confirmer.";
        errorBox.hidden = false;
        return;
      }
      var btn = document.getElementById("ad-delete-account-submit");
      btn.disabled = true;
      try {
        var result = await api("POST", "/account/delete", { password: form.password.value, confirm: "SUPPRIMER" });
        toast("Compte supprimé (" + result.deletedGalleries + " galerie" + (result.deletedGalleries > 1 ? "s" : "") + "). Au revoir !");
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
        toast("Nom du studio enregistré.");
        if (el.account) el.account.textContent = el.account.title = (studioName || photographer.email) + " · Galeries protégées";
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
        toast("Identité enregistrée.");
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
        toast(result.subdomain ? "Adresse du studio enregistrée." : "Sous-domaine retiré.");
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
        toast(box.checked ? "Relances automatiques activées." : "Relances automatiques désactivées.");
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
        toast("Style par défaut : " + galleryStyleOf(card.getAttribute("data-style")).label + ".");
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
          toast("Présentation par défaut mise à jour.");
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
        toast("Coordonnées de facturation enregistrées.");
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
      btn.textContent = "Envoi…";
      try {
        var newEmail = form.newEmail.value.trim();
        await api("POST", "/account/email", { newEmail: newEmail, password: form.password.value });
        messageBox.textContent = "Un lien de confirmation a été envoyé à " + newEmail + ". Ouvrez-le pour finaliser le changement — rien ne change avant ça.";
        messageBox.hidden = false;
        form.reset();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = "Envoyer le lien de confirmation";
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
        toast("Mot de passe changé.");
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
    return formatEuros(cents).replace(",00", "");
  }

  // Prix affiché d'une formule (HTML) : mensuel ou annuel, et prix
  // Fondateurs barrant le prix normal quand l'offre s'applique.
  function planPriceHtml(plan, interval, founder) {
    if (plan.noSubscription) {
      return "Sans abonnement" + '<span class="ad-plan-price-note">' + esc(String(plan.schoolFeePercent).replace(".", ",")) + " % sur les ventes scolaires, frais bancaires compris</span>";
    }
    if (!plan.priceCents) return "Gratuit";
    // Studio : paiement annuel seulement (la photo scolaire est saisonnière).
    if (plan.yearlyOnly) {
      if (founder && plan.founderYearlyCents) {
        return "<s>" + esc(euros(plan.yearlyCents)) + "</s> " + esc(euros(plan.founderYearlyCents)) + " / an" +
          '<span class="ad-plan-price-note">la 1re année, puis ' + esc(euros(plan.yearlyCents)) + " / an</span>";
      }
      return esc(euros(plan.yearlyCents)) + " / an" +
        '<span class="ad-plan-price-note">soit ' + esc(euros(Math.round(plan.yearlyCents / 12))) + " / mois, paiement annuel</span>";
    }
    var yearly = interval === "year";
    var normal = yearly ? plan.yearlyCents : plan.priceCents;
    var unit = yearly ? " / an" : " / mois";
    if (founder && plan.founderCents) {
      var reduced = yearly ? plan.founderYearlyCents : plan.founderCents;
      return "<s>" + esc(euros(normal)) + "</s> " + esc(euros(reduced)) + esc(unit) +
        '<span class="ad-plan-price-note">la 1re année, puis ' + esc(euros(normal)) + esc(unit) + "</span>";
    }
    return esc(euros(normal)) + esc(unit) +
      (yearly ? '<span class="ad-plan-price-note">soit ' + esc(euros(Math.round(normal / 12))) + " / mois, 2 mois offerts</span>" : "");
  }

  // Compatibilité : prix mensuel en texte (ailleurs dans l'admin).
  function planPrice(plan) {
    return plan.priceCents ? euros(plan.priceCents) + " / mois" : "Gratuit";
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
    var fmt = function (v, unit) { return v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 }) + " " + unit; };
    if (n >= 1e12) return fmt(n / 1e12, "To");
    if (n >= 1e9) return fmt(n / 1e9, "Go");
    return fmt(n / 1e6, "Mo");
  }

  // Jauge d'espace utilisé : la couleur ne porte jamais seule l'information,
  // le texte donne toujours les chiffres.
  function storageGaugeHtml(storage) {
    if (!storage) return "";
    var unlimited = storage.quotaBytes === null;
    var ratio = unlimited ? 0 : Math.min(1, storage.usedBytes / storage.quotaBytes);
    var level = ratio >= 0.95 ? " ad-gauge-full" : ratio >= 0.8 ? " ad-gauge-warn" : "";
    return '<div class="ad-storage"><p class="ad-hint">Stockage</p>' +
      '<p class="ad-plan-usage" id="ad-storage-text">' + esc(storage.usedLabel) + (unlimited ? " (illimité)" : " sur " + esc(storage.quotaLabel)) + "</p>" +
      (unlimited ? "" : '<div class="ad-gauge' + level + '" role="meter" aria-label="Espace de stockage utilisé" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        Math.round(ratio * 100) + '"><span style="width:' + (ratio * 100).toFixed(1) + '%"></span></div>') +
      (ratio >= 0.8 && !unlimited ? '<p class="ad-hint ad-gauge-note">' + (ratio >= 1 ? "Espace plein : les nouveaux envois sont refusés." : "Bientôt plein.") +
        " Supprimez d'anciennes galeries ou livraisons, ou passez à la formule supérieure.</p>" : "") +
      "</div>";
  }

  function planFeaturesHtml(plan, schoolOpen) {
    var items = [
      plan.maxActiveGalleries === null ? "Galeries actives illimitées" : plan.maxActiveGalleries + " galeries actives",
      plan.storageBytes ? formatStorage(plan.storageBytes) + " de stockage" : "",
      "Protection, sélection, musique et livraison HD",
      (plan.features.shop ? "✓ " : "— ") + "Boutique de tirages",
      (plan.features.extras ? "✓ " : "— ") + "Suppléments payés en ligne, factures",
      (plan.features.campaigns ? "✓ " : "— ") + "Campagnes de vente (promotions, relances)",
      (plan.features.subdomain ? "✓ " : "— ") + "Vos galeries à votre nom",
      (plan.features.booking ? "✓ " : "— ") + "Réservation en ligne avec acompte",
      (plan.features.contracts ? "✓ " : "— ") + "Devis et contrats signés en ligne",
      plan.features.school && schoolOpen ? "✓ Écoles, crèches et clubs" + (plan.schoolFeePercent ? " (" + String(plan.schoolFeePercent).replace(".", ",") + " % des ventes scolaires)" : ", sans commission") : "",
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
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';

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
    var billing = data.interval === "year" ? "Facturation annuelle. " : "";
    if (data.owner) status = "Compte propriétaire : toutes les fonctionnalités sont incluses.";
    else if (current.key !== "free" && data.cancelAtPeriodEnd && data.renewsAt) status = "Résiliation programmée : votre formule reste active jusqu'au " + formatDate(data.renewsAt) + ".";
    else if (current.key !== "free" && data.status === "past_due") status = "Le dernier prélèvement a échoué : mettez à jour votre carte depuis « Gérer mon abonnement ».";
    else if (current.key !== "free" && data.status === "trialing" && data.renewsAt) status = "Essai gratuit jusqu'au " + formatDate(data.renewsAt) + ", puis premier prélèvement automatique (résiliable avant, sans frais).";
    else if (current.key !== "free" && data.renewsAt) status = billing + "Prochain renouvellement le " + formatDate(data.renewsAt) + ".";
    if (data.isFounder && current.key !== "free" && !data.owner) status += " Tarif Fondateurs la première année.";
    var usage = current.maxActiveGalleries === null
      ? data.usage.activeGalleries + " galerie" + (data.usage.activeGalleries > 1 ? "s" : "") + " active" + (data.usage.activeGalleries > 1 ? "s" : "")
      : data.usage.activeGalleries + " / " + current.maxActiveGalleries + " galeries actives";

    var interval = data.interval === "year" && current.key !== "free" ? "year" : subscriptionInterval;
    if (!data.plans.some(function (p) { return p.yearlyCents; })) interval = "month";
    var founder = data.founderEligible && !data.owner;
    var studioFounder = data.studioFounderEligible && !data.owner;
    function planCardHtml(plan) {
        var isCurrent = plan.key === current.key;
        var action;
        if (isCurrent) {
          action = '<span class="ad-badge ad-badge-selected">✓ Votre formule</span>' +
            (plan.noSubscription && !data.owner ? ' <button type="button" class="ad-link-btn" data-scolaire="off">Revenir à Découverte</button>' : "");
        } else if (data.owner) action = "";
        else if (plan.noSubscription) {
          action = current.key === "free"
            ? '<button type="button" class="ad-btn ad-btn-primary" data-scolaire="on">Activer, sans abonnement</button>'
            : '<p class="ad-hint">Disponible une fois votre abonnement actuel résilié.</p>';
        }
        else if (data.canManage && current.key !== "scolaire") action = '<button type="button" class="ad-btn" data-portal>Changer de formule</button>';
        else if (data.canManage) action = '<button type="button" class="ad-btn" data-portal>Changer de formule</button>';
        else if (plan.key === "free") action = "";
        else action = '<button type="button" class="ad-btn ad-btn-primary" data-subscribe="' + esc(plan.key) + '"' + (data.stripeConfigured ? "" : " disabled") + ">" +
          (data.trialAvailable ? "Essayer " + data.trialDays + " jours gratuitement" : "Choisir " + esc(plan.label)) + "</button>" +
          (data.trialAvailable ? '<p class="ad-hint ad-plan-trial">Aucun prélèvement pendant l\'essai ; résiliable avant la fin, sans frais.</p>' : "");
        var planFounder = plan.key === "studio" ? studioFounder && data.studioFounders && data.studioFounders.remaining > 0 : founder;
        return (
          '<article class="ad-plan' + (isCurrent ? " ad-plan-current" : "") + (plan.key === "pro" || plan.key === "studio" ? " ad-plan-featured" : "") + '">' +
          "<h3>" + esc(plan.label) + "</h3>" +
          '<p class="ad-plan-price">' + planPriceHtml(plan, interval, planFounder) + "</p>" +
          '<p class="ad-hint">' + esc(plan.pitch) + "</p>" +
          planFeaturesHtml(plan, data.schoolOpen) + action + "</article>"
        );
    }
    // Formules galeries, puis (si proposées) celles qui incluent les écoles,
    // crèches et clubs.
    function cardsHtml() {
      var galleries = data.plans.filter(function (p) { return !p.schoolPlan; });
      var school = data.plans.filter(function (p) { return p.schoolPlan; });
      return galleries.map(planCardHtml).join("") +
        (school.length ? '<h3 class="ad-plans-group">Avec les écoles, crèches et clubs</h3>' + school.map(planCardHtml).join("") : "");
    }
    // Bascule annuelle seulement si le Worker connaît les prix annuels.
    var intervalSwitch = (current.key === "free" || current.key === "scolaire") && !data.owner && data.plans.some(function (p) { return p.yearlyCents; })
      ? '<div class="ad-seg ad-interval" role="group" aria-label="Période de facturation">' +
        '<button type="button" class="ad-seg-btn" data-interval="month" aria-pressed="' + (interval === "month") + '">Mensuel</button>' +
        '<button type="button" class="ad-seg-btn" data-interval="year" aria-pressed="' + (interval === "year") + '">Annuel · 2 mois offerts</button></div>'
      : "";
    var founderBanner = founder && data.founders.remaining > 0
      ? '<p class="ad-banner ad-founders">🎉 <strong>Offre Fondateurs</strong> : plus que ' + data.founders.remaining + " place" + (data.founders.remaining > 1 ? "s" : "") +
        ". Essentiel à " + esc(euros(data.plans[1].founderCents)) + " et Pro à " + esc(euros(data.plans[2].founderCents)) + " par mois pendant toute la première année, puis le prix normal.</p>"
      : "";
    var studioPlan = data.plans.find(function (p) { return p.key === "studio"; });
    if (studioPlan && studioFounder && data.studioFounders && data.studioFounders.remaining > 0) {
      founderBanner += '<p class="ad-banner ad-founders">🎓 <strong>Fondateurs Studio</strong> : plus que ' + data.studioFounders.remaining + " place" +
        (data.studioFounders.remaining > 1 ? "s" : "") + ". " + esc(euros(studioPlan.founderYearlyCents)) + " la première année au lieu de " +
        esc(euros(studioPlan.yearlyCents)) + ".</p>";
    }

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Abonnement</h2>' +
      '<p class="ad-hint">Votre formule Holypixx. Sans engagement : résiliable à tout moment, effet à la fin de la période payée.</p>' +
      "</div></header>" +
      (returned ? '<p class="ad-banner' + (returned[1] === "merci" ? "" : " ad-banner-muted") + '">' +
        (returned[1] === "merci" ? "Merci ! Votre abonnement est enregistré." : "Paiement annulé : votre formule n'a pas changé.") + "</p>" : "") +
      '<section class="ad-plan-summary"><div><p class="ad-hint">Formule actuelle</p><p class="ad-plan-name">' + esc(current.label) + "</p>" +
      (status ? '<p class="ad-hint">' + esc(status) + "</p>" : "") + "</div>" +
      '<div><p class="ad-hint">Utilisation</p><p class="ad-plan-usage">' + esc(usage) + "</p></div>" +
      storageGaugeHtml(data.usage.storage) +
      (data.canManage ? '<button type="button" class="ad-btn" data-portal>Gérer mon abonnement</button>' : "") +
      "</section>" +
      (data.stripeConfigured || data.owner ? "" : '<p class="ad-hint">Le paiement des abonnements n\'est pas encore ouvert sur la plateforme.</p>') +
      founderBanner + intervalSwitch +
      '<div class="ad-plans" id="ad-plans">' + cardsHtml() + "</div>" +
      '<section class="ad-referral" id="ad-referral" hidden></section>' +
      '<p class="ad-hint">Prix TTC. Les fichiers HD livrés et les fichiers d\'impression d\'une galerie expirée depuis ' +
      ((data.usage.storage && data.usage.storage.purgeAfterExpiryDays) || 90) + " jours sont effacés automatiquement, avec un e-mail de rappel 14 jours avant ; les photos de la galerie restent. " +
      'Paiement sécurisé par Stripe ; factures disponibles dans « Gérer mon abonnement ». ' +
      'Voir les <a href="https://www.holypixx.com/conditions" target="_blank" rel="noopener">conditions d\'utilisation</a>.</p>';

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
            toast(btn.getAttribute("data-scolaire") === "on" ? "Formule Scolaire activée." : "Retour à la formule Découverte.");
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
      ? "Encore " + left + " confrère" + (left > 1 ? "s" : "") + " abonné" + (left > 1 ? "s" : "") + " pour un mois offert."
      : "Trois confrères abonnés, un mois offert.";
    var rewards = [];
    if (card.granted) rewards.push(card.granted + " mois offert" + (card.granted > 1 ? "s" : "") + (card.grantedThisYear ? " (dont " + card.grantedThisYear + " ces douze derniers mois)" : ""));
    if (card.waiting) {
      rewards.push(card.waiting + " en attente" + (card.room === 0 && card.nextFreeAt
        ? " : plafond de " + ref.maxPerYear + " mois par an atteint, crédité le " + formatDate(card.nextFreeAt)
        : " : crédité dès que vous avez un abonnement payant"));
    }
    var message = "Je gère mes galeries clients avec Holypixx : photos protégées, sélection, tirages et réservation en ligne. " +
      "Avec mon lien, tu as −" + ref.discountPercent + " % sur ton mois suivant dès ton abonnement : " + ref.link;
    var filleuls = ref.filleuls.length
      ? '<ul class="ad-ref-list">' + ref.filleuls.map(function (f) {
          return "<li><span>" + esc(f.name) + '</span><span class="ad-hint">' +
            (f.paid ? '<span class="ad-ref-ok">Abonné · case gagnée</span>' : "Inscrit le " + esc(formatDate(f.since)) + ", pas encore abonné") + "</span></li>";
        }).join("") + "</ul>"
      : '<p class="ad-hint">Aucun confrère parrainé pour l\'instant.</p>';
    box.innerHTML =
      '<div class="ad-section-header"><h3>Parrainez un confrère</h3></div>' +
      (ref.referredBy ? '<p class="ad-banner ad-banner-muted">Parrainé par <strong>' + esc(ref.referredBy.name) + "</strong> : " +
        (ref.referredBy.rewarded ? "votre −" + ref.discountPercent + " % est déduit de votre prochaine facture" + (ref.referredBy.creditCents ? " (" + esc(euros(ref.referredBy.creditCents)) + ")" : "") + "."
          : "−" + ref.discountPercent + " % sur votre mois suivant, dès votre premier paiement.") + "</p>" : "") +
      '<div class="ad-ref-grid">' +
      '<div class="ad-ref-card" role="img" aria-label="Carte de fidélité : ' + card.stamps + " case" + (card.stamps > 1 ? "s" : "") + " sur " + card.perCard + '">' +
      '<p class="ad-ref-card-title">Votre carte de parrain</p>' +
      '<div class="ad-ref-stamps">' + stamps + "</div>" +
      '<p class="ad-ref-card-gift">= 1 mois offert</p>' +
      "</div>" +
      '<div class="ad-ref-side">' +
      "<p>" + esc(progress) + "</p>" +
      (rewards.length ? '<p class="ad-hint">' + esc(rewards.join(" · ")) + "</p>" : "") +
      '<p class="ad-hint">Votre confrère a −' + ref.discountPercent + " % sur son mois suivant dès son premier paiement, et vous gagnez une case. " +
      "Trois cases, un mois offert, " + ref.maxPerYear + " au plus par an. Les mois offerts sont déduits de vos prochaines factures.</p>" +
      '<label class="ad-field"><span>Votre lien</span><div class="ad-copy-row"><input type="text" id="ad-ref-link" readonly value="' + esc(ref.link) + '" />' +
      '<button type="button" class="ad-btn" data-copy="ad-ref-link">Copier</button></div></label>' +
      '<label class="ad-field"><span>Message prêt à envoyer</span><textarea id="ad-ref-message" rows="4" readonly>' + esc(message) + "</textarea></label>" +
      '<button type="button" class="ad-btn" data-copy="ad-ref-message">Copier le message</button>' +
      "</div></div>" +
      '<h4 class="ad-ref-heading">Vos filleuls</h4>' + filleuls;
    box.hidden = false;
  }

  /* ---------- Livraison des photos définitives ---------- */
  // Fichiers finaux (haute définition, sans filigrane) que le client
  // télécharge une fois la livraison ouverte. Envoyés un par un, bruts :
  // admin-server calcule leur CRC-32 (nécessaire au ZIP du Worker).

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1).replace(".", ",") + " Go";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " Mo";
    return Math.max(1, Math.round(bytes / 1024)) + " Ko";
  }

  function deliverySectionHtml(gallery) {
    var d = gallery.delivery || { open: false, files: [], totalBytes: 0 };
    var n = d.files.length;
    var status = d.open
      ? '<span class="ad-badge ad-badge-selected">✓ Livraison ouverte</span> depuis le ' + esc(formatDate(d.openedAt)) +
        (d.notifiedAt ? " · client prévenu par e-mail le " + esc(formatDate(d.notifiedAt)) : "")
      : '<span class="ad-hint">Pas encore ouverte : le client ne voit rien tant que vous ne l\'ouvrez pas.</span>';
    var rows = d.files.map(function (f) {
      return (
        '<li data-delivery-file="' + esc(f.id) + '"><span class="ad-delivery-name">' + esc(f.name) + "</span>" +
        '<span class="ad-hint">' + esc(formatBytes(f.size)) + "</span>" +
        '<button type="button" class="ad-delivery-remove" data-remove-delivery="' + esc(f.id) + '" aria-label="Retirer ' + esc(f.name) + '">&times;</button></li>'
      );
    }).join("");
    var notify = gallery.client_email
      ? '<label class="ad-check"><input type="checkbox" id="ad-delivery-notify" checked /> Prévenir le client par e-mail (' + esc(gallery.client_email) + ")</label>"
      : '<p class="ad-hint">Aucun e-mail client renseigné : pensez à prévenir votre client vous-même.</p>';
    return (
      '<section class="ad-delivery">' +
      '<div class="ad-section-header"><h3>Livraison des photos définitives</h3></div>' +
      '<p class="ad-hint">Déposez ici les photos finales, en haute définition et sans filigrane (JPEG, PNG, TIFF… 80 Mo maximum chacune). ' +
      "Une fois la livraison ouverte, le client les télécharge depuis sa galerie, une par une ou toutes d'un coup (ZIP). " +
      "Ces fichiers sont effacés 90 jours après l'expiration de la galerie (e-mail de rappel 14 jours avant) : prolongez-la pour les garder.</p>" +
      '<p class="ad-delivery-status">' + status + "</p>" +
      '<div class="ad-bg-custom"><label class="ad-btn">Ajouter des photos' +
      '<input type="file" id="ad-delivery-input" accept="image/jpeg,image/png,image/tiff,image/webp,.heic,.tif,.tiff" multiple hidden /></label>' +
      '<span class="ad-hint" id="ad-delivery-progress">' + (n ? n + " photo" + (n > 1 ? "s" : "") + " · " + esc(formatBytes(d.totalBytes)) : "Aucune photo déposée.") + "</span></div>" +
      (n ? '<ul class="ad-delivery-list">' + rows + "</ul>" : "") +
      (d.open
        ? '<button type="button" class="ad-btn" id="ad-delivery-close">Fermer la livraison</button>'
        : (n ? notify + '<button type="button" class="ad-btn ad-btn-primary" id="ad-delivery-open">Ouvrir la livraison au client</button>' : "")) +
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
        progress.textContent = "Envoi " + (i + 1) + " / " + files.length + " : " + files[i].name + "…";
        try {
          var response = await fetch("/local/galleries/" + encodeURIComponent(slug) + "/delivery/files?name=" + encodeURIComponent(files[i].name), {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: files[i],
          });
          var result = await response.json().catch(function () { return {}; });
          if (!response.ok) throw new Error(result.error || "Échec de l'envoi");
        } catch (err) {
          failed.push(files[i].name + " (" + err.message + ")");
        }
      }
      if (failed.length) toast("Non envoyées : " + failed.join(", "), true);
      else toast(files.length + " photo" + (files.length > 1 ? "s" : "") + " ajoutée" + (files.length > 1 ? "s" : "") + " à la livraison.");
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
        confirmAction("Ouvrir la livraison ? Le client pourra télécharger ces photos en haute définition, sans filigrane." + (notify ? " Il sera prévenu par e-mail." : ""), async function () {
          try {
            var result = await api("POST", "/galleries/" + encodeURIComponent(slug) + "/delivery", { open: true, notify: notify });
            toast(result.notified ? "Livraison ouverte, client prévenu par e-mail." : "Livraison ouverte.");
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
          toast("Livraison fermée : le client ne peut plus télécharger.");
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
    trackPreview.audio.play().catch(function () { toast("Lecture impossible dans ce navigateur.", true); });
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
        : "La bibliothèque est encore vide — elle se remplit depuis l'onglet Admin de la plateforme.") + "</p>";
    }
    var moods = {};
    library.tracks.forEach(function (t) { moods[t.mood] = t.moodLabel || t.mood; });
    var chips = Object.keys(moods).length > 1
      ? '<div class="ad-music-moods" role="group" aria-label="Ambiance">' +
        '<button type="button" class="ad-chip ad-chip-active" data-mood-filter="">Toutes</button>' +
        Object.keys(moods).map(function (m) {
          return '<button type="button" class="ad-chip" data-mood-filter="' + esc(m) + '">' + esc(moods[m]) + "</button>";
        }).join("") + "</div>"
      : "";
    var items = library.tracks.map(function (t) {
      var meta = [t.artist, t.moodLabel, formatDuration(t.durationSeconds)].filter(Boolean).map(esc).join(" · ");
      var action;
      if (mode === "manage") {
        action = '<button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-remove-track="' + esc(t.id) + '">Retirer</button>';
      } else if (t.id === currentId) {
        action = '<span class="ad-badge ad-badge-selected">✓ Choisie</span>';
      } else {
        action = '<button type="button" class="ad-btn ad-btn-small" data-pick-track="' + esc(t.id) + '">Choisir</button>';
      }
      return (
        '<li class="ad-track' + (t.id === currentId ? " ad-track-current" : "") + '" data-mood="' + esc(t.mood) + '">' +
        '<button type="button" class="ad-track-play" data-preview="' + esc(t.id) + '" aria-pressed="false" aria-label="Écouter « ' + esc(t.title) + ' »">▶</button>' +
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
    if (m.source === "library" && m.track) current = "Morceau de la bibliothèque : <strong>" + esc(m.track.title) + "</strong>" + (m.track.artist ? " — " + esc(m.track.artist) : "");
    else if (m.source === "link") current = "Lecteur <strong>" + esc(m.providerLabel || "intégré") + "</strong> affiché dans la galerie";
    else if (m.source === "file") current = "Fichier MP3 : <strong>" + esc(m.name) + "</strong>";
    else current = '<span class="ad-hint">Aucune musique pour cette galerie.</span>';
    var tab = m.source === "link" ? "link" : m.source === "file" ? "file" : "library";
    var tabButton = function (key, label) {
      return '<button type="button" class="ad-music-tab' + (key === tab ? " ad-music-tab-active" : "") + '" data-music-tab="' + key + '" aria-pressed="' + (key === tab) + '">' + label + "</button>";
    };
    return (
      '<section class="ad-music">' +
      '<div class="ad-section-header"><h3>Musique d\'ambiance</h3></div>' +
      '<p class="ad-hint">Lancée automatiquement en mise en page « Défilement », proposée en pause dans les autres — le client garde toujours la main.</p>' +
      '<p class="ad-music-state" id="ad-music-state">' + current + "</p>" +
      '<div class="ad-music-tabs">' +
      tabButton("library", "Bibliothèque") + tabButton("link", "Spotify, Deezer, YouTube…") + tabButton("file", "Mon fichier MP3") +
      "</div>" +
      '<div class="ad-music-pane" data-music-pane="library"' + (tab === "library" ? "" : " hidden") + ">" +
      '<p class="ad-hint">Morceaux libres de droits, utilisables sans souci pour un usage professionnel. Écoutez, puis choisissez.</p>' +
      '<div id="ad-music-library"><p class="ad-hint">Chargement de la bibliothèque…</p></div>' +
      "</div>" +
      '<div class="ad-music-pane" data-music-pane="link"' + (tab === "link" ? "" : " hidden") + ">" +
      '<p class="ad-hint">Collez le lien d\'un morceau ou d\'une playlist (Partager → Copier le lien). Le lecteur officiel s\'affiche discrètement dans la galerie et le client lance lui-même la lecture. ' +
      "Avec Spotify, un client sans compte Spotify n'entend qu'un extrait de 30 secondes ; YouTube, SoundCloud et Deezer jouent le morceau en entier.</p>" +
      '<div class="ad-music-link"><input type="url" id="ad-music-link-input" placeholder="https://open.spotify.com/playlist/…" autocomplete="off" />' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-music-link-save">Enregistrer</button></div>' +
      "</div>" +
      '<div class="ad-music-pane" data-music-pane="file"' + (tab === "file" ? "" : " hidden") + ">" +
      '<p class="ad-hint">Un morceau dont vous avez les droits (MP3, 15 Mo maximum), joué en boucle.</p>' +
      '<div class="ad-bg-custom">' +
      '<label class="ad-btn">' + (m.source === "file" ? "Remplacer le MP3" : "Importer un MP3") +
      '<input type="file" id="ad-music-file-input" accept="audio/mpeg,.mp3" hidden /></label>' +
      "</div></div>" +
      (m.source !== "none" ? '<p><button type="button" class="ad-btn" id="ad-music-remove">Retirer la musique</button></p>' : "") +
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
      if (!url) return toast("Collez d'abord un lien.", true);
      choose({ source: "link", url: url }, "Lecteur enregistré : il s'affichera dans la galerie.");
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
          choose({ source: "library", trackId: btn.getAttribute("data-pick-track") }, "Musique choisie pour cette galerie.");
        });
      });
    } catch (err) {
      if (document.body.contains(box)) box.innerHTML = '<p class="ad-hint">Bibliothèque indisponible : ' + esc(err.message) + "</p>";
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
      if (document.body.contains(box)) box.innerHTML = '<p class="ad-hint">Bibliothèque indisponible : ' + esc(err.message) + "</p>";
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

    var statsData, photographersData;
    try {
      statsData = await api("GET", "/owner/stats");
      photographersData = await api("GET", "/owner/photographers");
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

  function printOrdersTableHtml(orders, withGallery) {
    if (!orders || !orders.length) return '<p class="ad-hint" id="ad-print-orders-empty">Aucune commande de tirages pour l\'instant.</p>';
    var rows = orders.map(function (o) {
      var count = o.lines.reduce(function (n, l) { return n + l.copies; }, 0);
      var detail = o.lines.map(function (l) { return l.copies + " × " + l.label + " (photo n° " + l.photoNumber + ")"; }).join(", ");
      return (
        '<tr data-order-id="' + esc(o.id) + '">' +
        "<td>" + esc(formatDateTime(o.paidAt || o.createdAt)) + "</td>" +
        (withGallery ? '<td><button type="button" class="ad-link-btn" data-slug="' + esc(o.gallerySlug) + '">' + esc(o.galleryTitle) + "</button></td>" : "") +
        "<td>" + esc(o.recipient.name || "") + '<br /><span class="ad-hint">' + esc(o.clientEmail) + "</span></td>" +
        '<td title="' + esc(detail) + '">' + count + " article" + (count > 1 ? "s" : "") + "</td>" +
        "<td>" + formatEuros(o.totalCents) + "</td>" +
        '<td><span class="ad-badge ' + (ORDER_STATUS_CLS[o.status] || "") + '">' + esc(o.statusLabel) + "</span>" +
        (o.error ? '<br /><span class="ad-hint ad-order-error">' + esc(o.error) + "</span>" : "") + "</td>" +
        "<td>" + (o.trackingUrl ? '<a href="' + esc(o.trackingUrl) + '" target="_blank" rel="noopener">Suivi</a>' : "—") +
        (o.status === "failed" || o.status === "paid"
          ? ' <button type="button" class="ad-btn ad-btn-small" data-resubmit="' + esc(o.id) + '">Relancer au labo</button>'
          : "") +
        "</td>" +
        "</tr>"
      );
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table" id="ad-print-orders"><thead><tr>' +
      "<th>Quand</th>" + (withGallery ? "<th>Galerie</th>" : "") + "<th>Client</th><th>Articles</th><th>Total</th><th>Statut</th><th>Expédition</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
  }

  function wireOrderResubmit(onDone) {
    document.querySelectorAll("[data-resubmit]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          var result = await api("POST", "/print-orders/" + encodeURIComponent(btn.getAttribute("data-resubmit")) + "/submit");
          if (result.ok) toast("Commande transmise au laboratoire.");
          else toast("Le laboratoire a encore refusé la commande : " + (result.error || "raison inconnue"), true);
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
      '<section class="ad-gallery-shop"><div class="ad-section-header"><h3>Boutique de tirages</h3></div>' +
      '<p class="ad-hint">Le client commande tirages, toiles ou cadres depuis sa galerie ; le paiement arrive sur votre compte Stripe et la commande part automatiquement au laboratoire Prodigi. Réglages et formats dans l\'onglet <button type="button" class="ad-link-btn" id="ad-goto-shop">Boutique</button>.</p>' +
      '<label class="ad-toggle"><input type="checkbox" id="ad-gallery-shop-toggle"' + (on ? " checked" : "") + " />" +
      "<span>Proposer des tirages sur cette galerie</span></label>" +
      '<p class="ad-hint" id="ad-shop-printable">' + printable + " photo" + (printable > 1 ? "s" : "") + " sur " + photos.length +
      " disponible" + (printable > 1 ? "s" : "") + " en tirage. " +
      (on
        ? "Les photos importées tant que la boutique est ouverte gardent un fichier d'impression en pleine définition (jamais montré au client) ; réimportez les plus anciennes pour les proposer aussi."
        : "Ouvrez la boutique avant d'importer les photos : seules celles importées ensuite pourront être commandées.") +
      "</p>" +
      (on ? promoBlockHtml(data.gallery) : "") +
      "<h4>Commandes de cette galerie</h4>" +
      printOrdersTableHtml(data.printOrders, false) +
      "</section>"
    );
  }

  // Campagnes de vente : promotion à durée limitée et panier en cours.
  function promoBlockHtml(gallery) {
    var sales = gallery.sales || { promo: null, percents: [10, 15, 20, 25, 30, 40, 50], cart: null };
    var promo = sales.promo;
    var html = '<div class="ad-promo"><h4>Promotion sur les tirages</h4>';
    if (sales.enabled === false) {
      // Campagnes réservées à Pro : une promotion déjà lancée peut être arrêtée.
      html += '<p class="ad-banner ad-banner-muted">Promotions à durée limitée et relances des paniers oubliés : les campagnes de vente sont incluses dans la formule Pro. ' +
        '<button type="button" class="ad-link-btn" data-goto-plans>Voir les formules</button></p>';
      if (promo) html += '<div class="ad-promo-actions"><button type="button" class="ad-btn" id="ad-promo-stop">Arrêter la promotion</button></div>';
      return html + "</div>";
    }
    if (promo) {
      html += '<p class="ad-promo-on"><strong>−' + promo.percent + " %</strong> sur tous les tirages jusqu'au " + esc(formatDate(promo.endsAt)) +
        (promo.sentAt ? ' · <span class="ad-hint">annoncée au client le ' + esc(formatDate(promo.sentAt)) + "</span>" : "") + "</p>" +
        '<div class="ad-promo-actions">' +
        (!promo.sentAt && gallery.client_email ? '<button type="button" class="ad-btn ad-btn-primary" id="ad-promo-send">Annoncer au client par e-mail</button>' : "") +
        '<button type="button" class="ad-btn" id="ad-promo-stop">Arrêter la promotion</button></div>';
    } else {
      var defaultEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      html += '<p class="ad-hint">Une remise sur tous les tirages de cette galerie, pour une durée limitée : prix barrés chez le client, ' +
        "remise appliquée au paiement. Jamais en dessous de votre coût labo.</p>" +
        '<div class="ad-promo-form"><label class="ad-field"><span>Remise</span><select id="ad-promo-percent">' +
        sales.percents.map(function (p) { return '<option value="' + p + '"' + (p === 20 ? " selected" : "") + ">−" + p + " %</option>"; }).join("") +
        '</select></label><label class="ad-field"><span>Jusqu\'au (inclus)</span><input type="date" id="ad-promo-end" value="' + defaultEnd + '" /></label>' +
        '<button type="button" class="ad-btn ad-btn-primary" id="ad-promo-start">Lancer la promotion</button></div>';
    }
    if (sales.cart) {
      html += '<p class="ad-hint">Panier en cours chez le client : <strong>' + sales.cart.items + " article" + (sales.cart.items > 1 ? "s" : "") +
        "</strong> (mis à jour le " + esc(formatDate(sales.cart.updatedAt)) + ")" +
        (sales.cart.remindedAt ? " · rappel envoyé le " + esc(formatDate(sales.cart.remindedAt)) : " · un rappel partira par e-mail après 24 h sans commande") + ".</p>";
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
          toast("Promotion lancée : les prix remisés s'affichent chez le client.");
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
          toast("Promotion arrêtée.");
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
          toast("Promotion annoncée au client par e-mail.");
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
      (p.fromCatalogue ? "" : '<br /><span class="ad-hint">Réf. ' + esc(p.sku) + (Object.keys(p.attributes || {}).length ? " " + esc(JSON.stringify(p.attributes)) : "") + "</span>") +
      "</td>" +
      '<td class="ad-cost-cell" id="ad-quote-' + esc(p.id) + '">' + (cost ? formatEuros(cost) : '<span class="ad-hint">à estimer</span>') + "</td>" +
      '<td><input type="text" class="ad-input ad-input-price" data-field="price" value="' + eurosInput(p.priceCents) + '" inputmode="decimal" aria-label="Prix pour le client" /></td>' +
      '<td class="ad-margin-cell">' + (cost ? marginHtml(netMarginFor(p.priceCents, cost)) : "—") + "</td>" +
      '<td><input type="checkbox" data-field="active"' + (p.active ? " checked" : "") + ' aria-label="Proposé aux clients" /></td>' +
      '<td class="ad-row-actions"><button type="button" class="ad-btn ad-btn-small" data-save-product>Enregistrer</button>' +
      ' <button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-delete-product>Supprimer</button></td>' +
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
    if (!products.length) return '<p class="ad-hint" id="ad-shop-no-products">Aucun produit pour l\'instant : ajoutez-en avec les menus ci-dessus, ou en un clic avec « Ajouter les formats suggérés ».</p>';
    var groups = {};
    var order = [];
    products.forEach(function (p) {
      if (!groups[p.category]) { groups[p.category] = []; order.push(p.category); }
      groups[p.category].push(p);
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table ad-shop-products" id="ad-shop-products"><thead><tr>' +
      "<th>Produit</th><th>Coût labo</th><th>Prix client (€)</th><th>Votre marge</th><th>Actif</th><th></th>" +
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
      return '<p class="ad-hint" id="ad-shop-picker">Les menus d\'ajout apparaîtront dès que le serveur de la galerie (Worker) sera mis à jour.</p>';
    }
    return (
      '<div class="ad-picker" id="ad-shop-picker">' +
      '<div class="ad-picker-grid">' +
      '<label class="ad-field"><span>Catégorie</span><select id="ad-pick-category">' +
      catalogue.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="ad-field"><span>Produit</span><select id="ad-pick-product"></select></label>' +
      '<label class="ad-field"><span>Format</span><select id="ad-pick-size"></select></label>' +
      '<label class="ad-field" id="ad-pick-option-wrap"><span id="ad-pick-option-label">Finition</span><select id="ad-pick-option"></select></label>' +
      "</div>" +
      '<p class="ad-hint" id="ad-pick-description"></p>' +
      '<p class="ad-pick-cost" id="ad-pick-cost">' + (connected ? "—" : "Enregistrez d'abord votre clé Prodigi (plus haut) pour voir le coût de chaque produit.") + "</p>" +
      '<div class="ad-picker-price">' +
      '<label class="ad-field"><span>Votre marge (€)</span><input type="text" id="ad-pick-margin" inputmode="decimal" placeholder="Ex. 10" /></label>' +
      '<div class="ad-pick-total"><span>Prix pour le client</span><strong id="ad-pick-price">—</strong></div>' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-pick-add" disabled>Ajouter à ma boutique</button>' +
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
      $("ad-pick-cost").textContent = "Demande du coût au laboratoire…";
      try {
        var q = await api("POST", "/shop/quote-item", {
          product: product.key,
          size: $("ad-pick-size").value,
          option: product.option ? $("ad-pick-option").value : "",
          countryCode: $("ad-shop-country").value,
        });
        if (seq !== pick.seq || !$("ad-pick-cost")) return; // un autre choix a été fait entre-temps, ou l'onglet a été quitté
        if (!q.available) {
          $("ad-pick-cost").innerHTML = '<span class="ad-order-error">Indisponible chez le labo dans cette version : ' + esc(q.error || "") + "</span>";
          return;
        }
        pick.costCents = q.itemsCents;
        pick.shipCents = q.shippingCents;
        $("ad-pick-cost").innerHTML =
          "Coût labo : <strong>" + formatEuros(q.itemsCents) + "</strong> le produit" +
          ' <span class="ad-hint">(+ ' + formatEuros(q.shippingCents) + " de livraison pour une commande d'un article, couverte par vos frais de port)</span>";
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
        $("ad-pick-cost").textContent = "Vérification des formats proposés par le labo…";
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
          $("ad-pick-cost").innerHTML = '<span class="ad-order-error">Le labo ne propose aucun format de ce produit pour une livraison dans ce pays.</span>';
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
        toast("Produit ajouté à votre boutique.");
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
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';

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

    data.products.forEach(function (p) { if (!p.category) p.category = "Mes produits"; });
    var maxShip = data.products.reduce(function (m, p) { return Math.max(m, p.shipCostCents || 0); }, 0);

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Boutique de tirages</h2>' +
      '<p class="ad-hint">Vos clients commandent tirages, toiles et cadres directement depuis leur galerie. Le paiement arrive sur votre compte Stripe, la commande part automatiquement chez <strong>Prodigi</strong>, qui imprime et expédie. Prodigi vous facture son prix ; la différence avec votre prix de vente est votre marge.</p>' +
      "</div></header>" +

      '<section><div class="ad-section-header"><h3>Avant d\'ouvrir la boutique</h3></div>' +
      '<ul class="ad-shop-steps" id="ad-shop-steps">' +
      check(s.connected, "Clé d'API Prodigi enregistrée" + (s.connected ? " (" + esc(s.keyHint) + ", " + (s.environment === "live" ? "production" : "mode test") + ")" : "")) +
      check(s.stripeReady, 'Paiement en ligne Stripe actif — <button type="button" class="ad-link-btn" id="ad-goto-billing">onglet Facturation</button>') +
      check(activeCount > 0, "Au moins un format proposé (" + activeCount + " actif" + (activeCount > 1 ? "s" : "") + ")") +
      check(false, "Puis, sur chaque galerie : « Proposer des tirages sur cette galerie »") +
      "</ul></section>" +

      '<section><div class="ad-section-header"><h3>Compte Prodigi</h3></div>' +
      '<ol class="ad-owner-steps">' +
      '<li>Créez un compte gratuit sur <a href="https://dashboard.prodigi.com/register" target="_blank" rel="noopener">dashboard.prodigi.com</a>.</li>' +
      "<li>Commencez en <strong>mode test</strong> avec la clé <em>Sandbox</em> : elle figure dans l'e-mail de bienvenue de Prodigi, ou sur le tableau de bord de test <a href=\"https://sandbox-beta-dashboard.pwinty.com\" target=\"_blank\" rel=\"noopener\">sandbox-beta-dashboard.pwinty.com</a> (mêmes identifiants) → Settings → Integrations → API. Rien n'est imprimé ni facturé.</li>" +
      "<li>Attention : la clé affichée sur dashboard.prodigi.com est la clé <em>Live</em>, refusée en mode test. Quand tout est prêt, ajoutez un moyen de paiement chez Prodigi, collez cette clé Live et passez en production.</li>" +
      "</ol>" +
      '<form id="ad-shop-settings">' +
      '<label class="ad-field"><span>Clé d\'API Prodigi</span>' +
      '<input type="password" name="apiKey" autocomplete="off" placeholder="' +
      (s.connected ? "Clé enregistrée (" + esc(s.keyHint) + ") — laissez vide pour la garder" : "Collez votre clé d'API Prodigi") + '" /></label>' +
      '<div class="ad-field-row">' +
      '<label class="ad-field"><span>Environnement</span><select name="environment">' +
      '<option value="sandbox"' + (s.environment !== "live" ? " selected" : "") + ">Test (sandbox) — rien n'est imprimé</option>" +
      '<option value="live"' + (s.environment === "live" ? " selected" : "") + ">Production — commandes réelles</option>" +
      "</select></label>" +
      '<label class="ad-field"><span>Frais de port facturés au client (€)</span>' +
      '<input type="text" name="shipping" inputmode="decimal" value="' + eurosInput(s.shippingCents) + '" /></label>' +
      "</div>" +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-shop-settings-save">Enregistrer</button>' +
      (s.connected ? ' <button type="button" class="ad-btn" id="ad-shop-clear-key">Retirer la clé</button>' : "") +
      "</form></section>" +

      '<section><div class="ad-section-header"><h3>Ajouter un produit</h3>' +
      '<button type="button" class="ad-btn" id="ad-shop-suggested">Ajouter les formats suggérés</button></div>' +
      '<p class="ad-hint">Choisissez dans les menus : le coût réel chez Prodigi s\'affiche aussitôt, vous indiquez votre marge, le prix client se calcule tout seul. Le labo recadre la photo au format choisi.</p>' +
      '<div class="ad-shop-quote-bar"><label>Coûts calculés pour une livraison en <select id="ad-shop-country">' + countryOptions + "</select></label></div>" +
      pickerHtml(data.catalogue, s.connected) +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Mes produits</h3>' +
      '<button type="button" class="ad-btn" id="ad-shop-quote"' + (s.connected && data.products.length ? "" : " disabled") + ">Mettre à jour les coûts labo</button></div>" +
      '<p class="ad-hint">Prix TTC payé par le client. Votre marge = prix client − coût du produit chez le labo' +
      (s.paymentFee && s.paymentFee.label !== "aucun" ? " − frais de paiement (" + esc(s.paymentFee.label) + ", comptés comme si le produit était commandé seul)" : "") +
      " ; la livraison est couverte à part par vos frais de port (" + formatEuros(s.shippingCents) + " par commande)." +
      (maxShip ? " Dernier devis : le labo facture jusqu'à " + formatEuros(maxShip) + " de livraison pour un article." : "") + "</p>" +
      productsTableHtml(data.products) +
      '<details class="ad-advanced"><summary>Mode avancé : ajouter une référence Prodigi hors catalogue</summary>' +
      '<p class="ad-hint">Pour un produit absent des menus : sa référence (SKU) et ses options sont celles du <a href="https://www.prodigi.com/products/" target="_blank" rel="noopener">catalogue Prodigi</a>.</p>' +
      '<div class="ad-advanced-grid" id="ad-shop-new">' +
      '<label class="ad-field"><span>Libellé</span><input type="text" class="ad-input" data-field="label" placeholder="Ex. Tirage 13 × 18 cm" maxlength="100" /></label>' +
      '<label class="ad-field"><span>Référence (SKU)</span><input type="text" class="ad-input ad-input-mono" data-field="sku" placeholder="GLOBAL-PHO-5x7" maxlength="80" /></label>' +
      '<label class="ad-field"><span>Options (JSON)</span><input type="text" class="ad-input ad-input-mono" data-field="attributes" placeholder="{}" /></label>' +
      '<label class="ad-field"><span>Prix client (€)</span><input type="text" class="ad-input ad-input-price" data-field="price" placeholder="9.00" inputmode="decimal" /></label>' +
      '<button type="button" class="ad-btn ad-btn-primary" id="ad-shop-add">Ajouter</button>' +
      "</div></details>" +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Commandes</h3></div>' +
      printOrdersTableHtml(ordersData.orders, true) +
      "</section>";

    document.getElementById("ad-goto-billing").addEventListener("click", function () { renderBilling(); });

    document.getElementById("ad-shop-settings").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.target;
      var shipping = centsFromEuros(form.shipping.value);
      if (isNaN(shipping) || shipping < 0) return toast("Frais de port invalides.", true);
      try {
        await api("POST", "/shop/settings", {
          apiKey: form.apiKey.value.trim(),
          environment: form.environment.value,
          shippingCents: shipping,
        });
        toast("Réglages de la boutique enregistrés.");
        renderShop(true);
      } catch (err) {
        toast(err.message, true);
      }
    });

    var clearKey = document.getElementById("ad-shop-clear-key");
    if (clearKey) {
      clearKey.addEventListener("click", function () {
        confirmAction("Retirer la clé Prodigi ? La boutique sera fermée sur toutes vos galeries tant qu'aucune clé n'est enregistrée.", async function () {
          try {
            await api("POST", "/shop/settings", { clearKey: true, environment: s.environment, shippingCents: s.shippingCents });
            toast("Clé Prodigi retirée.");
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
        toast(result.added ? result.added + " format(s) ajouté(s) — vérifiez les prix." : "Tous les formats suggérés sont déjà là.");
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
          throw new Error("Options : JSON invalide (ex. {\"finish\": \"lustre\"})");
        }
        var price = centsFromEuros(get("price"));
        if (isNaN(price)) throw new Error("Prix invalide.");
        await api("POST", "/shop/products", { label: get("label"), sku: get("sku"), attributes: attributes, priceCents: price });
        toast("Produit ajouté.");
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
          if (isNaN(price)) return toast("Prix invalide.", true);
          try {
            await api("PUT", "/shop/products/" + encodeURIComponent(id), {
              priceCents: price,
              active: row.querySelector('[data-field="active"]').checked,
            });
            toast("Produit enregistré.");
            renderShop(true);
          } catch (err) {
            toast(err.message, true);
          }
        }
        if (event.target.closest("[data-delete-product]")) {
          confirmAction("Retirer ce produit de votre boutique ? Les commandes déjà passées ne changent pas.", async function () {
            try {
              await api("DELETE", "/shop/products/" + encodeURIComponent(id));
              toast("Produit retiré.");
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
      btn.textContent = "Mise à jour…";
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
            cell.innerHTML = formatEuros(q.itemsCents) + '<br /><span class="ad-hint">+ ' + formatEuros(q.shippingCents) + " livraison</span>";
            row.querySelector(".ad-margin-cell").innerHTML = marginHtml(q.marginCents);
          }
        });
        toast("Coûts labo mis à jour.");
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Mettre à jour les coûts labo";
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
        '<p class="ad-detect-badge ad-detect-badge-ok">✓ Origine identifiée</p>' +
        "<h3>" + esc(data.gallery.title) + "</h3>" +
        (data.gallery.clientName ? "<p>" + esc(data.gallery.clientName) + "</p>" : "") +
        '<p class="ad-hint">Photo n° ' + (data.photo.position + 1) +
        " · fiabilité : signal/bruit " + data.snr.toFixed(2) + ", " + data.matchingBits + "/32 bits concordants</p>" +
        "</div>"
      );
    }
    if (data.status === "no-match") {
      return (
        '<div class="ad-detect-result">' +
        '<p class="ad-detect-badge">Aucune correspondance fiable</p>' +
        '<p class="ad-hint">Cette image ne semble pas venir de vos galeries, ou a été trop dégradée pour l\'affirmer avec certitude ' +
        "(signal/bruit " + data.snr.toFixed(2) + ", " + data.matchingBits + "/32 bits — seuils : " +
        data.thresholds.snr + " et " + data.thresholds.bits + "/32).</p>" +
        "</div>"
      );
    }
    if (data.status === "too-small") {
      return (
        '<div class="ad-detect-result"><p class="ad-detect-badge">Image trop petite</p>' +
        '<p class="ad-hint">Elle ne peut pas porter une empreinte lisible.</p></div>'
      );
    }
    if (data.status === "no-prints") {
      return '<div class="ad-detect-result"><p class="ad-hint">Aucune de vos photos n’a encore d’empreinte enregistrée.</p></div>';
    }
    return '<div class="ad-detect-result"><p class="ad-hint">Résultat inattendu.</p></div>';
  }

  function renderDetect(skipHash) {
    if (!skipHash && location.hash !== "#/detect") history.pushState(null, "", "#/detect");
    el.view.innerHTML =
      '<button type="button" class="ad-back" id="ad-detect-back">&larr; Toutes les galeries</button>' +
      '<header class="ad-detail-header"><div><h2>Vérifier une photo</h2>' +
      '<p class="ad-hint">Une image retrouvée ailleurs (réseaux sociaux, un site…) vous semble provenir de l’une de vos ' +
      "galeries ? Déposez-la ici : elle est comparée aux empreintes invisibles de toutes vos photos, sans jamais quitter " +
      "votre ordinateur.</p></div></header>" +
      '<section class="ad-dropzone" id="ad-detect-dropzone">' +
      "<p><strong>Glissez une photo ici</strong>, ou</p>" +
      '<label class="ad-btn ad-btn-primary">Choisir un fichier<input type="file" id="ad-detect-file-input" accept="image/*" hidden /></label>' +
      "</section>" +
      '<div id="ad-detect-result"></div>';

    document.getElementById("ad-detect-back").addEventListener("click", function () {
      renderList();
    });

    var resultBox = document.getElementById("ad-detect-result");
    var dropzone = document.getElementById("ad-detect-dropzone");

    async function analyze(file) {
      resultBox.innerHTML = '<p class="ad-loading">Analyse en cours…</p>';
      var form = new FormData();
      form.append("file", file, file.name);
      try {
        var response = await fetch("/local/detect", { method: "POST", body: form });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || "Échec de l'analyse");
        resultBox.innerHTML = detectResultHtml(data);
      } catch (err) {
        resultBox.innerHTML = '<div class="ad-error-panel"><h2>Analyse impossible</h2><p>' + esc(err.message) + "</p></div>";
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
        return '<span class="ad-tag-legend-' + tag + '">' + counts[tag] + " " + TAG_LABELS[tag].toLowerCase() + (counts[tag] > 1 && tag !== "yellow" && tag !== "red" ? "s" : "") + "</span>";
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
    document.getElementById("ad-photo-modal-title").textContent = "Photo n° " + (photo.position + 1);
    body.innerHTML =
      '<div class="ad-photo-meta">' +
      (isSelected(photo) ? '<span class="ad-badge ad-badge-selected">♥ Sélectionnée</span>' : "") +
      (photo.tag ? '<span class="ad-badge ad-badge-tag-' + photo.tag + '">' + TAG_LABELS[photo.tag] + "</span>" : "") +
      "<span>" + photo.width + " × " + photo.height + "</span>" +
      "</div>" +
      '<div class="ad-photo-large" style="aspect-ratio:' + photo.width + "/" + photo.height +
      ";grid-template-columns:repeat(" + photo.cols + ",1fr);grid-template-rows:repeat(" + photo.rows + ',1fr)">' +
      cells + '<div class="ad-photo-large-pins">' + pins + "</div></div>" +
      (hasComment(photo) ? "<p><strong>Remarque :</strong> « " + esc(photo.comment.trim()) + " »</p>" : "") +
      (marks.length
        ? '<ol class="ad-photo-notes" id="ad-photo-notes">' +
          marks.map(function (m) { return "<li>" + (m.note ? esc(m.note) : "<em>Sans note</em>") + "</li>"; }).join("") +
          "</ol>"
        : '<p class="ad-hint">Aucun repère posé par le client sur cette photo.</p>');
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
      '<div class="ad-photo-frame" title="' + esc(photo.source_name ? photo.source_name + " — voir en grand" : "Voir en grand") + '" style="aspect-ratio:' + photo.width + "/" + photo.height +
      ";grid-template-columns:repeat(" + cols + ",1fr);grid-template-rows:repeat(" + rows + ',1fr)">' +
      cells +
      '<span class="ad-photo-dims">n° ' + (photo.position + 1) + " · " + photo.width + "×" + photo.height + "</span>" +
      (selected ? '<span class="ad-photo-heart" title="Sélectionnée par le client">♥</span>' : "") +
      (commented ? '<span class="ad-photo-comment" title="' + esc(photo.comment) + '">💬</span>' : "") +
      (photo.tag && TAG_LABELS[photo.tag]
        ? '<span class="ad-photo-tag ad-photo-tag-' + photo.tag + '" title="' + TAG_LABELS[photo.tag] + '"></span>'
        : "") +
      (markCount ? '<span class="ad-photo-marks" title="' + markCount + " repère" + (markCount > 1 ? "s" : "") + ' annoté(s)">📍 ' + markCount + "</span>" : "") +
      "</div>" +
      '<button type="button" class="ad-photo-cover' + (isCover ? " ad-photo-cover-on" : "") + '" title="' + (isCover ? "Photo de couverture" : "Choisir comme photo de couverture") + '" aria-label="' + (isCover ? "Photo de couverture" : "Choisir comme photo de couverture") + '" aria-pressed="' + isCover + '">★</button>' +
      '<button type="button" class="ad-photo-remove" title="Supprimer cette photo" aria-label="Supprimer cette photo">&times;</button>' +
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

  function logRow(entry, photosById) {
    var label = EVENT_LABELS[entry.event] || entry.event;
    if (entry.event === "capture_suspected" && EMAIL_ALERT_REASONS.has(entry.detail)) {
      label = "🔔 " + label + " (e-mail envoyé)";
    }
    var cls = /failed|expired|capture/.test(entry.event) ? "ad-log-warn" : "";
    var detail = entry.detail || "";
    if (PHOTO_ID_EVENTS.has(entry.event) && photosById[detail]) {
      detail = "Photo n° " + (photosById[detail].position + 1);
    } else if (CAPTURE_EVENTS.has(entry.event)) {
      detail = CAPTURE_REASON_LABELS[detail] || detail;
      if (entry.photo_id && photosById[entry.photo_id]) {
        detail += (detail ? " — " : "") + "Photo n° " + (photosById[entry.photo_id].position + 1);
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
    return ((cents || 0) / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  function quotaSummaryHtml(gallery) {
    if (gallery.included_photos === null || gallery.included_photos === undefined) {
      return '<p class="ad-hint">Aucun forfait défini pour l\'instant — les coups de cœur du client ne déclenchent aucun supplément.</p>';
    }
    var selected = gallery.selected_count || 0;
    var included = gallery.included_photos;
    var extra = gallery.extra_count || 0;
    var due = gallery.due_extra_count || 0;
    var paid = gallery.paid_extra_count || 0;
    var withinQuota = '<p class="ad-quota-count">' + selected + ' / ' + included + ' photo' + (included > 1 ? "s" : "") + ' incluse' + (included > 1 ? "s" : "") + '</p>';
    if (extra <= 0) return withinQuota;

    var html = withinQuota;
    if (due > 0) {
      html +=
        '<p class="ad-quota-due">' +
        "+" + due + " supplément" + (due > 1 ? "s" : "") + " × " + formatEuros(gallery.extra_photo_price_cents) +
        " = <strong>" + formatEuros(gallery.due_total_cents) + " à régler</strong>" +
        "</p>";
    }
    if (paid > 0) {
      html +=
        '<p class="ad-quota-paid">✓ ' + paid + " supplément" + (paid > 1 ? "s" : "") +
        " déjà réglé" + (paid > 1 ? "s" : "") + " en ligne</p>";
    }
    return html;
  }

  function paymentsHistoryHtml(payments) {
    if (!payments || !payments.length) return "";
    var rows = payments.map(function (p) {
      var statusLabel = p.status === "paid" ? "Réglé" : "En attente";
      var statusCls = p.status === "paid" ? "ad-badge-selected" : "";
      var invoiceCell = p.invoice_id
        ? '<a href="/local/invoices/' + encodeURIComponent(p.invoice_id) + '" target="_blank" rel="noopener">' +
          esc(p.invoice_number) + "</a>" +
          (p.invoice_emailed_to ? ' <span class="ad-hint">(envoyée à ' + esc(p.invoice_emailed_to) + ")</span>" : "")
        : "—";
      return (
        "<tr>" +
        "<td>" + esc(formatDateTime(p.paid_at || p.created_at)) + "</td>" +
        "<td>" + (p.kind === "print" ? "Tirages" : p.extra_count + " photo" + (p.extra_count > 1 ? "s" : "")) + "</td>" +
        "<td>" + formatEuros(p.amount_cents) +
        (p.fee_cents ? '<br><span class="ad-hint">dont ' + formatEuros(p.fee_cents) + " de frais de paiement</span>" : "") + "</td>" +
        "<td><span class=\"ad-badge " + statusCls + "\">" + statusLabel + "</span></td>" +
        "<td>" + invoiceCell + "</td>" +
        "</tr>"
      );
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
      "<th>Quand</th><th>Objet</th><th>Montant</th><th>Statut</th><th>Facture</th>" +
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
    var groups = { serif: "Avec empattements", sans: "Sans empattements", script: "Manuscrites" };
    var themeFont = galleryStyleOf(styleKey).fonts[part];
    var html = '<option value="">Celle du style (' + esc(GALLERY_FONTS[themeFont][0]) + ")</option>";
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
        '<span class="ad-style-pop-eyebrow">' + esc(c.studio || "Votre studio") + "</span>" +
        '<span class="ad-style-pop-title">' + esc(c.title || "Léa & Tom") + "</span>" +
        (c.client ? '<span class="ad-style-pop-sub">Galerie de ' + esc(c.client) + "</span>" : "") +
        '<span class="ad-style-pop-intro">' + esc(c.intro || "Merci pour ces beaux moments partagés. Choisissez vos photos préférées en cliquant sur le cœur.") + "</span>" +
        "</div>" +
        '<div class="ad-style-pop-grid' + (photos.length ? "" : " ad-style-pop-grid-empty") + '">' + thumbs + "</div></div>" +
        '<p class="ad-style-pop-cap"><strong>' + esc(s.label) + "</strong> · idéal pour " + esc(s.ideal.toLowerCase()) + "</p>";
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
      '<div class="ad-section-header"><h3>Style de la galerie</h3></div>' +
      '<p class="ad-hint">Survolez un style pour le voir avec vos photos, cliquez pour l\'appliquer. Votre client le découvre à sa prochaine visite.</p>' +
      '<div class="ad-style-cards" id="ad-style-cards">' + styleCardsHtml(p.theme, p.titleFont, p.bodyFont) + "</div>" +
      '<div class="ad-style-fonts">' +
      '<label class="ad-field"><span>Police des titres</span><select id="ad-title-font">' + fontOptionsHtml(TITLE_FONT_KEYS, p.titleFont, p.theme, 0) + "</select></label>" +
      '<label class="ad-field"><span>Police du texte d\'accompagnement</span><select id="ad-body-font">' + fontOptionsHtml(BODY_FONT_KEYS, p.bodyFont, p.theme, 1) + "</select></label>" +
      '<p class="ad-style-sample" id="ad-style-sample"' + styleVarsAttr(galleryStyleOf(p.theme), p.titleFont, p.bodyFont) + ">" +
      '<span class="ad-style-sample-title">' + esc(data.gallery.title) + "</span>" +
      '<span class="ad-style-sample-body">' + esc(p.intro || "Merci pour ces beaux moments partagés : voici vos photos.") + "</span></p>" +
      "</div>" +
      '<form id="ad-presentation-form" class="ad-presentation-form" novalidate>' +
      '<label class="ad-field"><span>Texte d\'accompagnement <em>(facultatif, sous le titre)</em></span>' +
      '<textarea name="intro" rows="3" maxlength="600" placeholder="Merci pour cette belle journée ! Voici vos photos : choisissez vos préférées en cliquant sur le cœur.">' + esc(p.intro) + "</textarea></label>" +
      '<div class="ad-style-header">' +
      '<span class="ad-style-header-title">En-tête de la galerie</span>' +
      '<div class="ad-seg" role="group" aria-label="En-tête de la galerie">' +
      '<button type="button" class="ad-seg-btn" data-header-mode="none" aria-pressed="' + (mode === "none") + '">Sans</button>' +
      '<button type="button" class="ad-seg-btn" data-header-mode="cover" aria-pressed="' + (mode === "cover") + '">Photo de couverture</button>' +
      '<button type="button" class="ad-seg-btn" data-header-mode="video" aria-pressed="' + (mode === "video") + '">Vidéo</button></div>' +
      '<div class="ad-style-cover" data-header-panel="cover"' + (mode === "cover" ? "" : " hidden") + ">" +
      (cover ? '<span class="ad-style-cover-thumb" style="aspect-ratio:' + cover.width + "/" + cover.height + '">' + tileThumbHtml(cover) + "</span>" : "") +
      '<span class="ad-hint">' + (cover ? "La photo n° " + (cover.position + 1) + " ouvre la galerie, en grand. " : "") +
      "Pour en choisir une autre, cliquez sur l'étoile ★ d'une photo ci-dessous." + (data.photos.length && !cover ? " Sans choix, la première photo sera utilisée." : "") + "</span></div>" +
      '<div data-header-panel="video"' + (mode === "video" ? "" : " hidden") + ">" +
      '<label class="ad-field"><span>Lien de la vidéo <em>(YouTube ou Vimeo)</em></span><input name="headerVideo" inputmode="url" placeholder="https://vimeo.com/… ou https://youtu.be/…" value="' + esc(p.headerVideo) + '" /></label>' +
      '<p class="ad-hint">Le film du mariage, la bande-annonce de la séance… en tête de galerie. Une vidéo non répertoriée fonctionne aussi.</p></div>' +
      "</div>" +
      '<div class="ad-sc-actions"><button type="submit" class="ad-btn ad-btn-primary">Enregistrer le texte et l\'en-tête</button></div>' +
      "</form></section>";
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
      if (await save({ theme: theme }, "Style « " + galleryStyleOf(theme).label + " » appliqué.")) renderDetail(slug, true);
    });
    var syncSample = function () {
      var sample = document.getElementById("ad-style-sample");
      var fresh = document.createElement("div");
      fresh.innerHTML = "<p" + styleVarsAttr(galleryStyleOf(p.theme), titleSelect.value, bodySelect.value) + "></p>";
      sample.setAttribute("style", fresh.firstChild.getAttribute("style"));
      sample.toggleAttribute("data-script", fresh.firstChild.hasAttribute("data-script"));
    };
    titleSelect.addEventListener("change", function () { syncSample(); save({ titleFont: titleSelect.value }, "Police des titres enregistrée."); });
    bodySelect.addEventListener("change", function () { syncSample(); save({ bodyFont: bodySelect.value }, "Police du texte enregistrée."); });
    form.elements.intro.addEventListener("input", function () {
      document.querySelector("#ad-style-sample .ad-style-sample-body").textContent = form.elements.intro.value.trim() || "Merci pour ces beaux moments partagés : voici vos photos.";
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
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fields = { intro: form.elements.intro.value };
      if (mode === "none") { fields.coverPhotoId = ""; fields.headerVideo = ""; }
      if (mode === "cover") {
        fields.headerVideo = "";
        if (!p.coverPhotoId && data.photos.length) fields.coverPhotoId = data.photos[0].id;
      }
      if (mode === "video") {
        if (!form.elements.headerVideo.value.trim()) { toast("Collez le lien de la vidéo (YouTube ou Vimeo).", true); return; }
        fields.headerVideo = form.elements.headerVideo.value;
      }
      if (await save(fields, "Texte et en-tête enregistrés.")) renderDetail(slug, true);
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

  async function renderDetail(slug, skipHash) {
    var hash = "#/g/" + encodeURIComponent(slug);
    if (!skipHash && location.hash !== hash) history.pushState(null, "", hash);
    setActiveTab("galleries");
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';
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
      '<button type="button" class="ad-back" id="ad-back">&larr; Toutes les galeries</button>' +
      '<header class="ad-detail-header">' +
      "<div>" +
      "<h2>" + esc(data.gallery.title) + "</h2>" +
      '<p class="ad-card-sub">' + (data.gallery.client_name ? clLink(data.gallery.client_name, data.gallery.client_email) + " · " : "") + esc(data.gallery.slug) + "</p>" +
      (data.gallery.selection_done_at
        ? '<p class="ad-validated" id="ad-selection-validated">✓ Sélection validée par le client le ' + formatDateTime(data.gallery.selection_done_at) + "</p>"
        : '<p class="ad-hint" id="ad-selection-pending">Sélection pas encore validée par le client' +
          (data.gallery.expires_at
            ? " — relances automatiques à J-7 et J-2 de l\'expiration" +
              (data.gallery.client_email ? "" : " (aucun e-mail client renseigné : seule la relance qui vous est destinée à J-2 partira)")
            : " — sans date d\'expiration, aucune relance automatique ne part") +
          ".</p>") +
      "</div>" +
      (status.label ? '<span class="ad-badge ' + status.cls + '">' + esc(status.label) + "</span>" : "") +
      "</header>" +
      '<section class="ad-share">' +
      '<label class="ad-field"><span>Lien</span><div class="ad-copy-row">' +
      '<input type="text" readonly value="' + esc(data.link) + '" id="ad-detail-link" />' +
      '<button type="button" class="ad-btn" data-copy="ad-detail-link">Copier</button>' +
      "</div></label>" +
      '<p class="ad-hint">Le mot de passe n\'est plus récupérable ici : il n\'a été affiché qu\'à la création. ' +
      '<button type="button" class="ad-link-btn" id="ad-new-password">Générer un nouveau mot de passe</button></p>' +
      "</section>" +
      '<section class="ad-quota">' +
      '<div class="ad-section-header"><h3>Forfait et suppléments</h3></div>' +
      '<p class="ad-hint">Le nombre de photos déjà payées par le client, et le prix de chaque photo au-delà. Calculé automatiquement à partir de ses coups de cœur — réglable en ligne par le client une fois votre compte Stripe actif (écran Facturation).' +
      (data.gallery.extras_online === false ? " Le paiement en ligne des suppléments est inclus à partir de la formule Essentiel : d'ici là, le montant dû s'affiche et se règle directement avec vous." : "") + "</p>" +
      '<form class="ad-field-row" id="ad-quota-form">' +
      '<label class="ad-field"><span>Photos incluses</span>' +
      '<input type="number" name="includedPhotos" min="0" step="1" placeholder="aucun forfait" value="' +
      (data.gallery.included_photos === null || data.gallery.included_photos === undefined ? "" : data.gallery.included_photos) + '" /></label>' +
      '<label class="ad-field"><span>Prix du supplément (par photo, en €)</span>' +
      '<input type="number" name="extraPhotoPrice" min="0" step="0.01" value="' +
      ((data.gallery.extra_photo_price_cents || 0) / 100) + '" /></label>' +
      '<button type="submit" class="ad-btn ad-btn-primary" id="ad-quota-save">Enregistrer</button>' +
      "</form>" +
      '<div id="ad-quota-summary">' + quotaSummaryHtml(data.gallery) + "</div>" +
      (data.payments && data.payments.length
        ? '<h4 class="ad-payments-heading">Historique des paiements</h4>' + paymentsHistoryHtml(data.payments)
        : "") +
      "</section>" +
      '<section class="ad-background">' +
      '<div class="ad-section-header"><h3>Arrière-plan de l\'écran de connexion client</h3></div>' +
      '<p class="ad-hint">Ce que voit le client avant même d\'entrer son mot de passe. Jamais une de ses photos — uniquement une couleur ou une image que vous importez vous-même.</p>' +
      '<div class="ad-bg-swatches" id="ad-bg-swatches">' + backgroundSwatchesHtml(data.gallery) + "</div>" +
      '<div class="ad-bg-custom">' +
      '<label class="ad-bg-color-label">Couleur personnalisée<input type="color" id="ad-bg-color-picker" value="' +
      esc(data.gallery.login_background_color || "#f7f2ec") + '" /></label>' +
      '<label class="ad-btn">Importer une image<input type="file" id="ad-bg-file-input" accept="image/*" hidden /></label>' +
      "</div>" +
      (data.gallery.login_background_type === "image"
        ? '<img class="ad-bg-preview" alt="Arrière-plan actuel" src="' +
          esc(state.config.api) + "/api/gallery/" + esc(data.gallery.slug) + "/background-image?t=" + Date.now() + '" />'
        : "") +
      "</section>" +
      presentationSectionHtml(data) +
      '<section class="ad-layout">' +
      '<div class="ad-section-header"><h3>Mise en page de la galerie</h3></div>' +
      '<p class="ad-hint">Comment les photos s\'affichent chez le client — à choisir selon le type de séance.</p>' +
      '<div class="ad-layout-options" id="ad-layout-options">' + layoutOptionsHtml(data.gallery) + "</div>" +
      "</section>" +
      musicSectionHtml(data.gallery) +
      deliverySectionHtml(data.gallery) +
      gallerySectionShopHtml(data) +
      '<section class="ad-dropzone" id="ad-dropzone">' +
      '<p><strong>Glissez vos photos ici</strong>, ou</p>' +
      '<label class="ad-btn ad-btn-primary">Choisir des fichiers<input type="file" id="ad-file-input" accept="image/*" multiple hidden /></label>' +
      '<div id="ad-upload-queue" class="ad-upload-queue"></div>' +
      "</section>" +
      '<section><div class="ad-section-header">' +
      '<h3 id="ad-photos-heading">Photos (' + data.photos.length + ")</h3>" +
      '<div class="ad-photos-actions">' +
      (data.photos.some(isSelected)
        ? '<label class="ad-photos-filter"><input type="checkbox" id="ad-filter-selected" />' +
          '<span>Afficher uniquement la sélection du client (' + data.photos.filter(isSelected).length + ")</span></label>"
        : "") +
      (data.photos.some(isSelected)
        ? '<button type="button" class="ad-btn" id="ad-copy-lightroom" title="Noms de fichiers de la sélection, à coller dans le filtre de bibliothèque de Lightroom">Copier pour Lightroom</button>'
        : "") +
      (data.photos.some(hasClientNotes)
        ? '<button type="button" class="ad-btn" id="ad-copy-notes">Copier les notes du client</button>'
        : "") +
      "</div>" +
      "</div>" +
      tagLegendHtml(data.photos) +
      '<div class="ad-photos" id="ad-photos">' + data.photos.map(photoThumb).join("") + "</div>" +
      "</section>" +
      '<section><h3>Journal d\'accès</h3>' +
      (data.log.length
        ? '<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>Quand</th><th>Évènement</th><th>Détail</th></tr></thead><tbody>' +
          data.log.map(function (entry) { return logRow(entry, photosById); }).join("") + "</tbody></table></div>"
        : '<p class="ad-hint">Aucun accès enregistré pour l\'instant.</p>') +
      "</section>" +
      '<section class="ad-danger"><h3>Zone sensible</h3>' +
      '<button type="button" class="ad-btn ad-btn-danger" id="ad-delete-gallery">Supprimer cette galerie</button>' +
      '<p class="ad-hint">Supprime la galerie, ses photos et son journal — sans confirmation possible ensuite.</p>' +
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
          toast("Ces photos ont été envoyées avant que Holypixx garde le nom des fichiers : renvoyez-les pour pouvoir copier leurs noms.", true);
          return;
        }
        navigator.clipboard.writeText(names.join(", ")).then(function () {
          toast(names.length + " nom" + (names.length > 1 ? "s" : "") + " copié" + (names.length > 1 ? "s" : "") +
            " : dans Lightroom, Bibliothèque › Texte › Nom de fichier › Contient, puis collez." +
            (missing ? " (" + missing + " photo" + (missing > 1 ? "s" : "") + " sans nom de fichier, envoyée" + (missing > 1 ? "s" : "") + " plus tôt.)" : ""));
        }).catch(function () {
          toast("Impossible de copier les noms de fichiers.", true);
        });
      });
    }
    var copyNotesBtn = document.getElementById("ad-copy-notes");
    if (copyNotesBtn) {
      copyNotesBtn.addEventListener("click", function () {
        var selectedCount = data.photos.filter(isSelected).length;
        var noted = data.photos.filter(hasClientNotes);
        var lines = noted.map(function (p) {
          var line = "Photo n° " + (p.position + 1) + (p.source_name ? " · " + p.source_name : "") + (isSelected(p) ? " (sélectionnée)" : "");
          if (p.tag && TAG_LABELS[p.tag]) line += " [" + TAG_LABELS[p.tag] + "]";
          if (hasComment(p)) line += " — « " + p.comment.trim() + " »";
          marksOf(p).forEach(function (m, i) {
            line += "\n    Repère " + (i + 1) + " (" + Math.round(Number(m.x) * 100) + " % / " + Math.round(Number(m.y) * 100) + " %)" + (m.note ? " : " + m.note : "");
          });
          return line;
        });
        var text =
          "Notes du client — " + data.gallery.title + " (" + data.gallery.slug + ")\n" +
          selectedCount + " photo(s) sur " + data.photos.length + " sélectionnée(s)\n\n" +
          lines.join("\n");
        navigator.clipboard.writeText(text).then(function () {
          toast("Notes copiées (" + noted.length + (noted.length > 1 ? " photos)." : " photo)."));
        }).catch(function () {
          toast("Impossible de copier les notes.", true);
        });
      });
    }
    document.getElementById("ad-delete-gallery").addEventListener("click", function () {
      confirmAction('Supprimer définitivement « ' + data.gallery.title + ' » et ses ' + data.photos.length + " photo(s) ?", async function () {
        try {
          await api("DELETE", "/galleries/" + encodeURIComponent(slug));
          toast("Galerie supprimée.");
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
        toast("Arrière-plan mis à jour.");
        renderDetail(slug, true);
      } catch (err) {
        toast(err.message, true);
      }
    });
    document.getElementById("ad-bg-color-picker").addEventListener("change", async function (event) {
      try {
        await api("POST", "/galleries/" + encodeURIComponent(slug) + "/background/color", { color: event.target.value });
        toast("Arrière-plan mis à jour.");
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
        if (!response.ok) throw new Error(result.error || "Échec de l'envoi");
        toast("Arrière-plan mis à jour.");
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
        toast("Forfait mis à jour.");
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
        toast("Mise en page mise à jour.");
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
      stateBox.textContent = "Envoi de « " + file.name + " »…";
      var form = new FormData();
      form.append("file", file, file.name);
      try {
        var response = await fetch("/local/galleries/" + encodeURIComponent(slug) + "/music", {
          method: "POST",
          body: form,
        });
        var result = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(result.error || "Échec de l'envoi");
        toast("Musique enregistrée.");
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
          toast(shopToggle.checked ? "Boutique de tirages ouverte sur cette galerie." : "Boutique de tirages fermée sur cette galerie.");
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
        confirmAction("Retirer la musique de cette galerie ?", async function () {
          try {
            await api("DELETE", "/galleries/" + encodeURIComponent(slug) + "/music");
            toast("Musique retirée.");
            renderDetail(slug, true);
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    }
    document.getElementById("ad-new-password").addEventListener("click", function () {
      confirmAction("Générer un nouveau mot de passe ? L'ancien cessera aussitôt de fonctionner.", async function () {
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
              ? "Photo de couverture choisie. La vidéo reste en tête tant qu'elle est renseignée (en-tête « Photo de couverture » pour l'afficher)."
              : "Photo de couverture choisie : elle ouvre la galerie.");
            renderDetail(slug, true);
          })
          .catch(function (err) { toast(err.message, true); });
        return;
      }
      var btn = event.target.closest(".ad-photo-remove");
      if (!btn) return;
      var card = btn.closest(".ad-photo");
      var photoId = card.getAttribute("data-photo-id");
      confirmAction("Supprimer cette photo de la galerie ?", async function () {
        try {
          await api("DELETE", "/galleries/" + encodeURIComponent(slug) + "/photos/" + encodeURIComponent(photoId));
          card.remove();
          toast("Photo supprimée.");
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
        '<span class="ad-upload-state">en attente</span>';
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
      fill(item.row, 0, "envoi…");
      return uploadPhoto(slug, item.file, item.position, function (ratio) {
        fill(item.row, ratio * 0.5, ratio < 1 ? "envoi…" : "traitement…");
      })
        .then(function (result) {
          fill(item.row, 1, "terminé");
          item.row.classList.add("ad-upload-done");
          succeeded++;
          if (photosSection) photosSection.insertAdjacentHTML("beforeend", photoThumb(result.photo));
          setTimeout(function () {
            item.row.remove();
          }, 2500);
        })
        .catch(function (err) {
          fill(item.row, 1, "échec");
          item.row.classList.add("ad-upload-failed");
          item.row.title = err.message;
          failed++;
        })
        .then(next);
    }

    var workers = [];
    for (var i = 0; i < UPLOAD_CONCURRENCY; i++) workers.push(next());
    Promise.all(workers).then(function () {
      if (failed === 0) toast(succeeded + " photo(s) envoyée(s).");
      else toast(succeeded + " envoyée(s), " + failed + " en échec — survolez la ligne pour le détail.", failed > 0);
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
    submitBtn.textContent = "Création…";

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
      submitBtn.textContent = "Créer la galerie";
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
    submitBtn.textContent = "Création…";

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
        }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Inscription refusée");
      try { localStorage.removeItem(REFERRAL_KEY); } catch (err) { /* rien à effacer */ }
      form.reset();
      showApp(data.photographer);
      bootstrap();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Créer mon compte";
    }
  });

  document.getElementById("ad-login-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var errorBox = document.getElementById("ad-login-error");
    var submitBtn = document.getElementById("ad-login-submit");
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Connexion…";

    try {
      var response = await fetch("/local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Connexion refusée");
      form.reset();
      showApp(data.photographer);
      bootstrap();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Se connecter";
    }
  });

  document.getElementById("ad-forgot-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var messageBox = document.getElementById("ad-forgot-message");
    var submitBtn = document.getElementById("ad-forgot-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi…";

    try {
      var response = await fetch("/local/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.email.value.trim() }),
      });
      var data = await response.json().catch(function () { return {}; });
      // Toujours le même message, que le compte existe ou non — c'est le
      // Worker qui applique cette règle, l'interface ne fait que la refléter.
      messageBox.textContent = data.message || "Si un compte existe avec cette adresse, un lien vient d'être envoyé.";
      messageBox.hidden = false;
      form.reset();
    } catch (err) {
      messageBox.textContent = "Connexion au serveur d'administration perdue.";
      messageBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Recevoir un lien";
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
    submitBtn.textContent = "Validation…";

    try {
      var response = await fetch("/local/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: form.password.value }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Réinitialisation refusée");
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
      submitBtn.textContent = "Valider le nouveau mot de passe";
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
    c = c || Object.assign({ clientName: "", clientEmail: "", title: "", sessionDate: "", lines: [{ label: "", amountCents: 0 }], depositCents: 0, terms: data.terms, validUntil: 0 }, contractsState.prefill || {});
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
      '<label class="ad-field"><span>Date prévue <em>(facultatif, en toutes lettres)</em></span><input name="sessionDate" maxlength="120" placeholder="ex. samedi 14 novembre, 10 h" value="' + esc(c.sessionDate) + '" /></label>' +
      "</div>" +
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
        sessionDate: form.elements.sessionDate.value, lines: lines, depositCents: deposit, terms: form.elements.terms.value,
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

  /* ---------- Démarrage et navigation ---------- */

  function routeFromHash() {
    var match = /^#\/g\/(.+)$/.exec(location.hash);
    if (match) renderDetail(decodeURIComponent(match[1]), true);
    else if (location.hash === "#/detect") renderDetect(true);
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
            toast(data.error || "Lien de confirmation invalide ou expiré.", true);
          } else {
            toast("Nouvelle adresse confirmée : " + data.email);
          }
        });
      })
      .catch(function () {
        history.replaceState(null, "", location.pathname + location.hash);
        toast("Connexion au serveur d'administration perdue.", true);
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
