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
  ];

  var state = { view: "list", galleries: [], current: null, config: { previewCols: 2, previewRows: 2 } };
  var el = {
    view: document.getElementById("ad-view"),
    toast: document.getElementById("ad-toast"),
    login: document.getElementById("ad-login"),
    app: document.getElementById("ad-app"),
    account: document.getElementById("ad-current-account"),
    tabs: document.getElementById("ad-tabs"),
    tabOwner: document.getElementById("ad-tab-owner"),
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
      // Sur téléphone, la barre défile : l'onglet ouvert reste visible.
      if (active && el.tabs.scrollWidth > el.tabs.clientWidth) {
        var offset = btn.getBoundingClientRect().left - el.tabs.getBoundingClientRect().left;
        el.tabs.scrollLeft += offset - (el.tabs.clientWidth - btn.offsetWidth) / 2;
      }
    });
  }

  if (el.tabs) {
    el.tabs.addEventListener("click", function (event) {
      var btn = event.target.closest(".ad-tab");
      if (!btn) return;
      var tab = btn.getAttribute("data-tab");
      if (tab === "galleries") renderList();
      else if (tab === "sales") renderSales();
      else if (tab === "portfolio") renderPortfolio();
      else if (tab === "billing") renderBilling();
      else if (tab === "shop") renderShop();
      else if (tab === "subscription") renderSubscription();
      else if (tab === "settings") renderSettings();
      else if (tab === "owner") renderOwner();
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
    showLoginCard(location.hash === "#/inscription" ? "ad-signup-card" : "ad-login-card");
  }

  function showApp(photographer) {
    el.login.hidden = true;
    el.app.hidden = false;
    if (el.account) {
      el.account.textContent = (photographer.studioName || photographer.email) + " · Galeries protégées";
    }
    state.isOwner = Boolean(photographer.isOwner);
    if (el.tabOwner) el.tabOwner.hidden = !state.isOwner;
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
      throw new Error(message);
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
    toast._t = setTimeout(function () {
      el.toast.hidden = true;
    }, 4200);
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
    document.getElementById("ad-create-form").reset();
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

  function stripeStatusHtml(photographer) {
    if (photographer.stripeChargesEnabled) {
      return (
        '<p class="ad-stripe-badge ad-stripe-badge-ok">✓ Compte Stripe actif</p>' +
        '<p class="ad-hint">Les suppléments payés par vos clients (carte, Apple Pay, PayPal) arrivent directement sur votre compte — jamais via un compte intermédiaire.</p>'
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
      "</div></section>" +

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
        if (el.account) el.account.textContent = (studioName || photographer.email) + " · Galeries protégées";
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

  function planPrice(plan) {
    return plan.priceCents ? formatEuros(plan.priceCents).replace(",00", "") + " / mois" : "Gratuit";
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
  ];
  var salesData = null;
  var salesMode = "chart";

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
    var totals = months.map(function (m) { return m.supplementCents + m.printCents; });
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
      var stacked = SALES_SERIES.filter(function (s) { return m[s.key] > 0; });
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
    var rows = months.slice().reverse().map(function (m) {
      return "<tr><th scope=\"row\">" + esc(m.label) + "</th><td>" + esc(formatEuros(m.supplementCents)) + "</td><td>" +
        esc(formatEuros(m.printCents)) + "</td><td><strong>" + esc(formatEuros(m.supplementCents + m.printCents)) + "</strong></td><td>" + m.orders + "</td></tr>";
    }).join("");
    return '<div class="ad-table-wrap"><table class="ad-table ad-sales-table"><thead><tr><th>Mois</th><th>Suppléments</th><th>Tirages</th><th>Total</th><th>Paiements</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>";
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
        SALES_SERIES.map(function (s) {
          return '<span class="ad-chart-tip-row"><i style="background:' + s.color + '"></i>' + esc(s.label) + "<b>" + esc(formatEuros(m[s.key])) + "</b></span>";
        }).join("") +
        '<span class="ad-chart-tip-row ad-chart-tip-total">Total<b>' + esc(formatEuros(m.supplementCents + m.printCents)) + "</b></span>" +
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
    var margin = data.printMargin;
    var marginNote = margin.lineRevenueCents
      ? (margin.coverage < 0.999 ? "Sur " + percentText(margin.coverage) + " des tirages (coût connu), " : "") + "hors port et frais Stripe"
      : "Aucun tirage vendu";

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Ventes</h2>' +
      '<p class="ad-hint">Les 12 derniers mois, paiements encaissés (suppléments photos et commandes de tirages), montants TTC.</p>' +
      "</div></header>" +
      '<div class="ad-stats">' +
      salesStatHtml("Chiffre d'affaires", formatEuros(t.revenueCents),
        formatEurosShort(t.supplementCents) + " suppléments · " + formatEurosShort(t.printCents) + " tirages") +
      salesStatHtml("Paiements", String(t.orders), t.orders ? "Panier moyen " + formatEuros(t.averageOrderCents) : "") +
      salesStatHtml("Marge estimée sur les tirages", margin.lineRevenueCents ? formatEuros(margin.marginCents) : "—", marginNote) +
      salesStatHtml("Galeries qui vendent", data.conversion.galleries ? percentText(data.conversion.rate) : "—",
        data.conversion.withSales + " sur " + data.conversion.galleries + " galerie" + (data.conversion.galleries > 1 ? "s" : "") + " créée" + (data.conversion.galleries > 1 ? "s" : "") + " sur la période") +
      "</div>" +
      '<section><div class="ad-section-header"><h3>Chiffre d\'affaires par mois</h3>' +
      '<div class="ad-seg" role="group" aria-label="Affichage">' +
      '<button type="button" class="ad-seg-btn" data-sales-mode="chart">Graphique</button>' +
      '<button type="button" class="ad-seg-btn" data-sales-mode="table">Tableau</button></div></div>' +
      '<ul class="ad-legend">' + SALES_SERIES.slice().reverse().map(function (s) {
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

  function planFeaturesHtml(plan) {
    var items = [
      plan.maxActiveGalleries === null ? "Galeries actives illimitées" : plan.maxActiveGalleries + " galeries actives",
      "Protection, sélection, musique et livraison HD",
      (plan.features.shop ? "✓ " : "— ") + "Boutique de tirages",
      (plan.features.subdomain ? "✓ " : "— ") + "Vos galeries à votre nom",
    ];
    return '<ul class="ad-plan-features">' + items.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
  }

  async function renderSubscription(skipHash) {
    var returned = /abonnement=(merci|annule)/.exec(location.hash);
    if (!skipHash && location.hash.indexOf("#/abonnement") !== 0) history.pushState(null, "", "#/abonnement");
    if (returned) history.replaceState(null, "", "#/abonnement");
    setActiveTab("subscription");
    el.view.innerHTML = '<p class="ad-loading">Chargement…</p>';

    var data;
    try {
      data = await api("GET", "/subscription");
      // Retour de Stripe : le webhook peut arriver quelques secondes après.
      if (returned && returned[1] === "merci" && data.plan.key === "free") {
        await new Promise(function (r) { setTimeout(r, 2500); });
        data = await api("GET", "/subscription");
      }
    } catch (err) {
      toast(err.message, true);
      return renderList();
    }

    var current = data.plan;
    var status = "";
    if (data.owner) status = "Compte propriétaire : toutes les fonctionnalités sont incluses.";
    else if (current.key !== "free" && data.cancelAtPeriodEnd && data.renewsAt) status = "Résiliation programmée : votre formule reste active jusqu'au " + formatDate(data.renewsAt) + ".";
    else if (current.key !== "free" && data.status === "past_due") status = "Le dernier prélèvement a échoué : mettez à jour votre carte depuis « Gérer mon abonnement ».";
    else if (current.key !== "free" && data.renewsAt) status = "Prochain renouvellement le " + formatDate(data.renewsAt) + ".";
    var usage = current.maxActiveGalleries === null
      ? data.usage.activeGalleries + " galerie" + (data.usage.activeGalleries > 1 ? "s" : "") + " active" + (data.usage.activeGalleries > 1 ? "s" : "")
      : data.usage.activeGalleries + " / " + current.maxActiveGalleries + " galeries actives";

    var cards = data.plans.map(function (plan) {
      var isCurrent = plan.key === current.key;
      var action;
      if (isCurrent) action = '<span class="ad-badge ad-badge-selected">✓ Votre formule</span>';
      else if (data.owner) action = "";
      else if (data.canManage) action = '<button type="button" class="ad-btn" data-portal>Changer de formule</button>';
      else if (plan.key === "free") action = "";
      else action = '<button type="button" class="ad-btn ad-btn-primary" data-subscribe="' + esc(plan.key) + '"' + (data.stripeConfigured ? "" : " disabled") + ">Choisir " + esc(plan.label) + "</button>";
      return (
        '<article class="ad-plan' + (isCurrent ? " ad-plan-current" : "") + (plan.key === "pro" ? " ad-plan-featured" : "") + '">' +
        "<h3>" + esc(plan.label) + "</h3>" +
        '<p class="ad-plan-price">' + esc(planPrice(plan)) + "</p>" +
        '<p class="ad-hint">' + esc(plan.pitch) + "</p>" +
        planFeaturesHtml(plan) + action + "</article>"
      );
    }).join("");

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Abonnement</h2>' +
      '<p class="ad-hint">Votre formule Holypixx. Sans engagement : résiliable à tout moment, effet à la fin du mois payé.</p>' +
      "</div></header>" +
      (returned ? '<p class="ad-banner' + (returned[1] === "merci" ? "" : " ad-banner-muted") + '">' +
        (returned[1] === "merci" ? "Merci ! Votre abonnement est enregistré." : "Paiement annulé : votre formule n'a pas changé.") + "</p>" : "") +
      '<section class="ad-plan-summary"><div><p class="ad-hint">Formule actuelle</p><p class="ad-plan-name">' + esc(current.label) + "</p>" +
      (status ? '<p class="ad-hint">' + esc(status) + "</p>" : "") + "</div>" +
      '<div><p class="ad-hint">Utilisation</p><p class="ad-plan-usage">' + esc(usage) + "</p></div>" +
      (data.canManage ? '<button type="button" class="ad-btn" data-portal>Gérer mon abonnement</button>' : "") +
      "</section>" +
      (data.stripeConfigured || data.owner ? "" : '<p class="ad-hint">Le paiement des abonnements n\'est pas encore ouvert sur la plateforme.</p>') +
      '<div class="ad-plans">' + cards + "</div>" +
      '<p class="ad-hint">Prix TTC. Paiement sécurisé par Stripe ; factures disponibles dans « Gérer mon abonnement ». ' +
      'Voir les <a href="https://www.holypixx.com/conditions.html" target="_blank" rel="noopener">conditions d\'utilisation</a>.</p>';

    el.view.querySelectorAll("[data-subscribe]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          var result = await api("POST", "/subscription/checkout", { plan: btn.getAttribute("data-subscribe") });
          window.location.href = result.url;
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
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
      "Une fois la livraison ouverte, le client les télécharge depuis sa galerie, une par une ou toutes d'un coup (ZIP).</p>" +
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

  function photographersTableHtml(photographers) {
    if (!photographers.length) return '<p class="ad-hint">Aucun compte pour l\'instant.</p>';
    var rows = photographers.map(function (p) {
      var name = [p.firstName, p.lastName].filter(Boolean).join(" ");
      return (
        "<tr>" +
        "<td>" + (name ? esc(name) : '<span class="ad-hint">—</span>') + "</td>" +
        "<td>" + (p.studioName ? esc(p.studioName) : '<span class="ad-hint">—</span>') + "</td>" +
        "<td>" + esc(p.email) + "</td>" +
        "<td>" + esc(formatDate(p.createdAt)) + "</td>" +
        "<td>" + p.galleriesCount + "</td>" +
        "<td>" + p.photosCount + "</td>" +
        "<td>" + (p.stripeChargesEnabled
          ? '<span class="ad-stripe-badge ad-stripe-badge-ok">✓ Actif</span>'
          : '<span class="ad-hint">—</span>') + "</td>" +
        "</tr>"
      );
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
      "<th>Nom</th><th>Studio</th><th>E-mail</th><th>Inscrit le</th><th>Galeries</th><th>Photos</th><th>Stripe</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
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

      '<section><div class="ad-section-header"><h3>Inscriptions par mois</h3></div>' +
      signupsTableHtml(statsData.signupsByMonth) +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Comptes photographes (' +
      photographersData.photographers.length + ")</h3></div>" +
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
      '<td class="ad-margin-cell">' + (cost ? marginHtml(p.priceCents - cost) : "—") + "</td>" +
      '<td><input type="checkbox" data-field="active"' + (p.active ? " checked" : "") + ' aria-label="Proposé aux clients" /></td>' +
      '<td class="ad-row-actions"><button type="button" class="ad-btn ad-btn-small" data-save-product>Enregistrer</button>' +
      ' <button type="button" class="ad-btn ad-btn-small ad-btn-danger" data-delete-product>Supprimer</button></td>' +
      "</tr>"
    );
  }

  function marginHtml(cents) {
    return '<strong class="' + (cents > 0 ? "ad-margin-ok" : "ad-order-error") + '">' + formatEuros(cents) + "</strong>";
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
      $("ad-pick-price").textContent = ok ? formatEuros(pick.costCents + margin) : "—";
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
          priceCents: pick.costCents + margin,
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
      '<p class="ad-hint">Prix TTC payé par le client. Votre marge = prix client − coût du produit chez le labo ; la livraison est couverte à part par vos frais de port (' + formatEuros(s.shippingCents) + " par commande)." +
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
        if (cost && !isNaN(price)) row.querySelector(".ad-margin-cell").innerHTML = marginHtml(price - cost);
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
    return (
      '<div class="ad-photo' + (selected ? " ad-photo-selected" : "") + '" data-photo-id="' + esc(photo.id) + '">' +
      '<div class="ad-photo-frame" title="Voir en grand" style="aspect-ratio:' + photo.width + "/" + photo.height +
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
        "<td>" + formatEuros(p.amount_cents) + "</td>" +
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
      '<p class="ad-card-sub">' + (data.gallery.client_name ? esc(data.gallery.client_name) + " · " : "") + esc(data.gallery.slug) + "</p>" +
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
      '<p class="ad-hint">Le nombre de photos déjà payées par le client, et le prix de chaque photo au-delà. Calculé automatiquement à partir de ses coups de cœur — réglable en ligne par le client une fois votre compte Stripe actif (écran Facturation).</p>' +
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
    var copyNotesBtn = document.getElementById("ad-copy-notes");
    if (copyNotesBtn) {
      copyNotesBtn.addEventListener("click", function () {
        var selectedCount = data.photos.filter(isSelected).length;
        var noted = data.photos.filter(hasClientNotes);
        var lines = noted.map(function (p) {
          var line = "Photo n° " + (p.position + 1) + (isSelected(p) ? " (sélectionnée)" : "");
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
        }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Inscription refusée");
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

  /* ---------- Démarrage et navigation ---------- */

  function routeFromHash() {
    var match = /^#\/g\/(.+)$/.exec(location.hash);
    if (match) renderDetail(decodeURIComponent(match[1]), true);
    else if (location.hash === "#/detect") renderDetect(true);
    else if (location.hash === "#/ventes") renderSales(true);
    else if (location.hash === "#/portfolio") renderPortfolio(true);
    else if (location.hash.indexOf("#/facturation") === 0) renderBilling(true);
    else if (location.hash.indexOf("#/abonnement") === 0) renderSubscription(true);
    else if (location.hash === "#/parametres") renderSettings(true);
    else if (location.hash === "#/boutique") renderShop(true);
    else if (location.hash === "#/proprietaire") renderOwner(true);
    else renderList(true);
  }

  window.addEventListener("popstate", routeFromHash);

  function bootstrap() {
    return api("GET", "/config").then(function (cfg) {
      state.config = cfg;
    }).catch(function () {
      /* la vue liste ne dépend pas de la configuration ; on continue avec les valeurs par défaut */
    }).then(routeFromHash);
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
