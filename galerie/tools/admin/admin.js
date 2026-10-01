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
    if (!el.tabs) return;
    el.tabs.querySelectorAll(".ad-tab").forEach(function (btn) {
      btn.classList.toggle("ad-tab-active", btn.getAttribute("data-tab") === name);
    });
  }

  if (el.tabs) {
    el.tabs.addEventListener("click", function (event) {
      var btn = event.target.closest(".ad-tab");
      if (!btn) return;
      var tab = btn.getAttribute("data-tab");
      if (tab === "galleries") renderList();
      else if (tab === "billing") renderBilling();
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
    showLoginCard("ad-login-card");
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
      "</form></section>";

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

      '<section><div class="ad-section-header"><h3>Relances automatiques</h3></div>' +
      '<p class="ad-hint">Une passe tourne chaque jour sur le Worker (08:00 UTC) : rappel au client à J-7 et J-2 de l\'expiration tant que sa sélection n\'est pas validée, rappel au photographe à J-2. ' +
      "Chaque relance ne part qu'une fois. Vous pouvez lancer la passe tout de suite :</p>" +
      '<button type="button" class="ad-btn" id="ad-run-reminders">Lancer les relances maintenant</button>' +
      '<p class="ad-hint" id="ad-run-reminders-result"></p>' +
      "</section>" +

      '<section><div class="ad-section-header"><h3>Trafic du site &amp; sources de visiteurs</h3></div>' +
      trafficSectionHtml() +
      "</section>";

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
        "<td>" + p.extra_count + " photo" + (p.extra_count > 1 ? "s" : "") + "</td>" +
        "<td>" + formatEuros(p.amount_cents) + "</td>" +
        "<td><span class=\"ad-badge " + statusCls + "\">" + statusLabel + "</span></td>" +
        "<td>" + invoiceCell + "</td>" +
        "</tr>"
      );
    });
    return (
      '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
      "<th>Quand</th><th>Suppléments</th><th>Montant</th><th>Statut</th><th>Facture</th>" +
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
      '<section class="ad-music">' +
      '<div class="ad-section-header"><h3>Musique d\'ambiance</h3></div>' +
      '<p class="ad-hint">Un morceau (MP3, 15 Mo maximum) joué en boucle chez le client. Lancé automatiquement en mise en page « Défilement », proposé en pause dans les autres — le client garde toujours la main.</p>' +
      '<p class="ad-music-state" id="ad-music-state">' +
      (data.gallery.music_name
        ? "Piste actuelle : <strong>" + esc(data.gallery.music_name) + "</strong>"
        : '<span class="ad-hint">Aucune musique pour cette galerie.</span>') +
      "</p>" +
      '<div class="ad-bg-custom">' +
      '<label class="ad-btn">' + (data.gallery.music_name ? "Remplacer le MP3" : "Importer un MP3") +
      '<input type="file" id="ad-music-file-input" accept="audio/mpeg,.mp3" hidden /></label>' +
      (data.gallery.music_name
        ? '<button type="button" class="ad-btn" id="ad-music-remove">Retirer la musique</button>'
        : "") +
      "</div>" +
      "</section>" +
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
    else if (location.hash.indexOf("#/facturation") === 0) renderBilling(true);
    else if (location.hash === "#/parametres") renderSettings(true);
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
