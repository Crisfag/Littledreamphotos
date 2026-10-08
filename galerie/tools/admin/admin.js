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
    showLoginCard(location.hash === "#/inscription" ? "ad-signup-card" : "ad-login-card");
  }

  function showApp(photographer) {
    el.login.hidden = true;
    el.app.hidden = false;
    if (el.account) {
      el.account.textContent = (photographer.studioName || photographer.email) + " · Galeries protégées";
      el.account.title = el.account.textContent;
    }
    state.isOwner = Boolean(photographer.isOwner);
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
      ? (margin.coverage < 0.999 ? "Sur " + percentText(margin.coverage) + " des tirages (coût connu), " : "") + "frais de paiement déduits, hors port"
      : "Aucun tirage vendu";

    el.view.innerHTML =
      '<header class="ad-detail-header"><div><h2>Ventes</h2>' +
      '<p class="ad-hint">Les 12 derniers mois, paiements encaissés (suppléments photos et commandes de tirages), montants TTC.</p>' +
      "</div></header>" +
      '<div class="ad-stats">' +
      salesStatHtml("Chiffre d'affaires", formatEuros(t.revenueCents),
        formatEurosShort(t.supplementCents) + " suppléments · " + formatEurosShort(t.printCents) + " tirages" +
        (t.feeCents ? " · " + formatEuros(t.netCents) + " reçus après frais de paiement" : "")) +
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

  function planFeaturesHtml(plan) {
    var items = [
      plan.maxActiveGalleries === null ? "Galeries actives illimitées" : plan.maxActiveGalleries + " galeries actives",
      plan.storageBytes ? formatStorage(plan.storageBytes) + " de stockage" : "",
      "Protection, sélection, musique et livraison HD",
      (plan.features.shop ? "✓ " : "— ") + "Boutique de tirages",
      (plan.features.subdomain ? "✓ " : "— ") + "Vos galeries à votre nom",
      plan.features.school ? "✓ Écoles, crèches et clubs" + (plan.schoolFeePercent ? " (" + String(plan.schoolFeePercent).replace(".", ",") + " % des ventes)" : ", sans commission") : "",
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
          planFeaturesHtml(plan) + action + "</article>"
        );
    }
    // Formules galeries, puis (si proposées) celles qui incluent les écoles,
    // crèches et clubs.
    function cardsHtml() {
      var galleries = data.plans.filter(function (p) { return !p.features.school; });
      var school = data.plans.filter(function (p) { return p.features.school; });
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
        esc(euros(studioPlan.yearlyCents)) + " (ou " + esc(euros(studioPlan.founderCents)) + " par mois pendant 12 mois).</p>";
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
      '<p class="ad-hint">Prix TTC. Les fichiers HD livrés et les fichiers d\'impression d\'une galerie expirée depuis ' +
      ((data.usage.storage && data.usage.storage.purgeAfterExpiryDays) || 90) + " jours sont effacés automatiquement, avec un e-mail de rappel 14 jours avant ; les photos de la galerie restent. " +
      'Paiement sécurisé par Stripe ; factures disponibles dans « Gérer mon abonnement ». ' +
      'Voir les <a href="https://www.holypixx.com/conditions.html" target="_blank" rel="noopener">conditions d\'utilisation</a>.</p>';

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
      "<p>Le module est inclus dans deux formules :</p>" +
      "<ul><li><strong>Scolaire</strong> : sans abonnement, 4,5 % sur les ventes scolaires, frais bancaires compris.</li>" +
      "<li><strong>Studio</strong> : 49 € par mois, tout Pro plus le scolaire, sans commission.</li></ul>" +
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
  function couponsSectionHtml(year, group, kind) {
    var base = "/local/school/years/" + encodeURIComponent(year.id) + "/coupons?" + (group ? "group=" + encodeURIComponent(group.id) + "&" : "");
    return (
      '<section class="ad-sc-coupons"><div class="ad-section-header"><h3>Fiches parents' + (group ? "" : " · toutes les " + esc(kind.groups.toLowerCase())) + "</h3></div>" +
      '<p class="ad-hint">Une fiche par enfant : son portrait, ' + (group ? "le " + esc(kind.group.toLowerCase()) : "son " + esc(kind.group.toLowerCase())) +
      ", la date limite, un code d'accès personnel et un QR code qui ouvre l'espace famille. À distribuer par l'établissement.</p>" +
      '<div class="ad-sc-actions">' +
      '<a class="ad-btn ad-btn-primary" href="' + base + 'format=pdf" download>PDF à imprimer (A4, 4 par feuille)</a>' +
      '<a class="ad-btn" href="' + base + 'format=lab" download>Images 10×15 pour le labo (ZIP)</a></div>' +
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
          "</div>"
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
          couponsSectionHtml(year, null, kind) +
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
      '<div class="ad-sc-prod-lab">' + (p.kind === "numerique"
        ? '<span class="ad-hint">Labo : rien à imprimer (téléchargé par la famille)</span>'
        : '<span class="' + (p.labItems.length ? "ad-hint" : "ad-hint ad-acc-warn") + '">Labo : ' + esc(labItemsSummary(p.labItems)) + "</span> " +
          '<button type="button" class="ad-link-btn" data-lab-product>' + (p.labItems.length ? "Modifier" : "Indiquer") + "</button>") +
      '<div class="ad-sc-lab-editor" hidden></div></div>' +
      "</li>"
    );
  }

  var PAPER_NAMES = { 1: "brillant", 2: "lustré" };
  var schoolLabCatalogue = null;

  function labItemsSummary(items) {
    if (!items || !items.length) return "à indiquer (ce que BePhoto imprime pour un exemplaire)";
    return items.map(function (i) {
      return i.quantity + "× " + (i.label || "produit " + i.idproduct) + " " + (PAPER_NAMES[i.idpaper] || "");
    }).join(" + ");
  }

  function labCostCents(items) {
    if (!schoolLabCatalogue) return null;
    var total = 0;
    for (var k = 0; k < items.length; k++) {
      var prod = schoolLabCatalogue.find(function (c) { return c.idproduct === items[k].idproduct; });
      var price = prod && prod.prices.find(function (pr) { return pr.idpaper === items[k].idpaper; });
      if (!price) return null;
      total += price.cents * items[k].quantity;
    }
    return total;
  }

  // Composition labo d'un produit : ce que BePhoto imprime pour UN
  // exemplaire (une pochette = plusieurs tirages), avec le coût et la marge.
  async function openLabEditor(li, product, onSaved) {
    var box = li.querySelector(".ad-sc-lab-editor");
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<p class="ad-loading">Catalogue BePhoto…</p>';
    if (!schoolLabCatalogue) {
      try {
        schoolLabCatalogue = (await api("GET", "/school/lab/products")).products;
      } catch (err) {
        box.innerHTML = '<p class="ad-hint ad-acc-warn">' + esc(err.message) + " Connectez votre compte BePhoto dans « Envois au labo », plus bas.</p>";
        return;
      }
    }
    var rows = product.labItems.length ? product.labItems.map(function (i) { return Object.assign({}, i); }) : [{ idproduct: 0, idpaper: 1, quantity: 1 }];
    function optionHtml(c, selected) {
      return '<option value="' + c.idproduct + '"' + (c.idproduct === selected ? " selected" : "") + ">" + esc(c.name + (c.dimensions ? " (" + c.dimensions + " mm)" : "")) + "</option>";
    }
    function draw() {
      var cost = labCostCents(rows.filter(function (r) { return r.idproduct; }));
      box.innerHTML =
        '<p class="ad-hint">Pour <strong>un</strong> exemplaire de « ' + esc(product.name) + " », BePhoto imprime :</p>" +
        rows.map(function (r, i) {
          var prod = schoolLabCatalogue.find(function (c) { return c.idproduct === r.idproduct; });
          var papers = prod ? prod.prices : [{ idpaper: 1 }, { idpaper: 2 }];
          return '<div class="ad-sc-lab-row" data-row="' + i + '">' +
            '<input type="number" min="1" max="50" value="' + r.quantity + '" data-f="quantity" aria-label="Quantité" />' +
            '<span aria-hidden="true">×</span>' +
            '<select data-f="idproduct" aria-label="Produit BePhoto"><option value="0">Choisir un produit…</option>' + schoolLabCatalogue.map(function (c) { return optionHtml(c, r.idproduct); }).join("") + "</select>" +
            '<select data-f="idpaper" aria-label="Papier">' + papers.map(function (pp) {
              return '<option value="' + pp.idpaper + '"' + (pp.idpaper === r.idpaper ? " selected" : "") + ">" + esc((PAPER_NAMES[pp.idpaper] || "papier " + pp.idpaper) + (pp.cents !== undefined ? " · " + formatEuros(pp.cents) : "")) + "</option>";
            }).join("") + "</select>" +
            '<button type="button" class="ad-link-btn ad-sc-del" data-remove-row aria-label="Retirer">Retirer</button></div>';
        }).join("") +
        '<div class="ad-sc-actions"><button type="button" class="ad-link-btn" data-add-row>+ Ajouter un tirage</button>' +
        (cost !== null && rows.some(function (r) { return r.idproduct; })
          ? '<span class="ad-hint">Coût labo ≈ ' + formatEuros(cost) + " · marge ≈ " + formatEuros(product.priceCents - cost) + " (prix de base, avant remise au volume et livraison)</span>"
          : "") +
        "</div>" +
        '<div class="ad-sc-actions"><button type="button" class="ad-btn ad-btn-primary" data-save-lab>Enregistrer</button>' +
        '<button type="button" class="ad-btn" data-cancel-lab>Annuler</button></div>';
      box.querySelectorAll(".ad-sc-lab-row").forEach(function (rowEl) {
        var i = Number(rowEl.getAttribute("data-row"));
        rowEl.querySelectorAll("[data-f]").forEach(function (input) {
          input.addEventListener("change", function () {
            rows[i][input.getAttribute("data-f")] = Number(input.value);
            if (input.getAttribute("data-f") === "idproduct") {
              var prod = schoolLabCatalogue.find(function (c) { return c.idproduct === rows[i].idproduct; });
              rows[i].label = prod ? prod.name : "";
              if (prod && prod.prices.length && !prod.prices.some(function (pp) { return pp.idpaper === rows[i].idpaper; })) rows[i].idpaper = prod.prices[0].idpaper;
            }
            draw();
          });
        });
        rowEl.querySelector("[data-remove-row]").addEventListener("click", function () { rows.splice(i, 1); draw(); });
      });
      box.querySelector("[data-add-row]").addEventListener("click", function () { rows.push({ idproduct: 0, idpaper: 1, quantity: 1 }); draw(); });
      box.querySelector("[data-cancel-lab]").addEventListener("click", function () { box.hidden = true; });
      box.querySelector("[data-save-lab]").addEventListener("click", async function () {
        var items = rows.filter(function (r) { return r.idproduct; }).map(function (r) {
          var prod = schoolLabCatalogue.find(function (c) { return c.idproduct === r.idproduct; });
          return { idproduct: r.idproduct, idpaper: r.idpaper, quantity: r.quantity, label: prod ? prod.name : r.label || "" };
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

      (data.children.length ? couponsSectionHtml({ id: data.year.id, orderDeadline: data.year.orderDeadline }, data.group, kind) : "") +
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
    else if (location.hash.indexOf("#/scolaire") === 0) renderSchool(true);
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
