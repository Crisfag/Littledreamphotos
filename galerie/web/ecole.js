/* =====================================================================
   Espace famille du module scolaire (Holypixx).
   Le parent entre son e-mail et le code de la fiche ; il retrouve ensuite
   tous ses enfants au même endroit. Les photos sont servies tuile par
   tuile avec le jeton de la famille et dessinées dans des canvas — jamais
   d'image téléchargeable telle quelle, comme dans la galerie classique.
   ===================================================================== */
(function () {
  "use strict";

  var CONFIG = window.ECOLE_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/+$/, "");
  var STORE_KEY = "holypixx-famille";

  var el = {
    login: document.getElementById("ec-login"),
    app: document.getElementById("ec-app"),
    view: document.getElementById("ec-view"),
    account: document.getElementById("ec-account"),
    studio: document.getElementById("ec-studio"),
    accessForm: document.getElementById("ec-access-form"),
    email: document.getElementById("ec-email"),
    code: document.getElementById("ec-code"),
    accessError: document.getElementById("ec-access-error"),
    accessSubmit: document.getElementById("ec-access-submit"),
    linkForm: document.getElementById("ec-link-form"),
    linkEmail: document.getElementById("ec-link-email"),
    linkError: document.getElementById("ec-link-error"),
    linkOk: document.getElementById("ec-link-ok"),
    linkSubmit: document.getElementById("ec-link-submit"),
    switchBtn: document.getElementById("ec-switch"),
    lede: document.getElementById("ec-login-lede"),
    lightbox: document.getElementById("ec-lightbox"),
    lightboxCanvas: document.getElementById("ec-lightbox-canvas"),
    lightboxOrder: document.getElementById("ec-lightbox-order"),
    cartbar: document.getElementById("ec-cartbar"),
    cartbarText: document.getElementById("ec-cartbar-text"),
    sheet: document.getElementById("ec-sheet"),
    sheetBody: document.getElementById("ec-sheet-body"),
  };

  var CART_KEY = "holypixx-famille-panier";
  var MAX_QTY = 20;
  var state = { token: "", data: null, childId: "", lightbox: null, cart: loadCart(), notice: null };

  /* ---------- Outils ---------- */

  function esc(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML.replace(/"/g, "&quot;");
  }

  function show(node, text) {
    node.textContent = text || "";
    node.hidden = !text;
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
  }

  function euros(cents) {
    return ((cents || 0) / 100).toLocaleString("fr-BE", { style: "currency", currency: "EUR" });
  }

  function formatCode(value) {
    var raw = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    return raw.length > 4 ? raw.slice(0, 4) + " " + raw.slice(4) : raw;
  }

  function saveSession(token, expiresIn) {
    state.token = token;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ token: token, exp: Date.now() + (expiresIn || 0) * 1000 }));
    } catch (err) { /* stockage indisponible : la session vaut pour cet onglet */ }
  }

  function loadSession() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.token && saved.exp > Date.now()) return saved.token;
    } catch (err) { /* rien */ }
    return "";
  }

  function clearSession() {
    state.token = "";
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* rien */ }
  }

  async function api(method, path, body) {
    if (!API) throw new Error("Configuration manquante : ECOLE_CONFIG.api.");
    var response = await fetch(API + "/api/family" + path, {
      method: method,
      headers: Object.assign(
        body ? { "content-type": "application/json" } : {},
        state.token ? { authorization: "Bearer " + state.token } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = await response.json().catch(function () { return {}; });
    if (response.status === 401 && state.token) {
      clearSession();
      showLogin("Votre session a expiré : entrez à nouveau votre e-mail et votre code.");
      throw new Error(data.error || "Session expirée");
    }
    if (!response.ok) throw new Error(data.error || "Erreur " + response.status);
    return data;
  }

  /* ---------- Tuiles protégées ---------- */

  function fetchTile(photoId, level, col, row) {
    return fetch(API + "/api/family/tile/" + encodeURIComponent(photoId) + "/" + level + "/" + col + "/" + row, {
      headers: { authorization: "Bearer " + state.token },
      cache: "no-store",
    }).then(function (response) {
      if (!response.ok) throw new Error("tuile " + response.status);
      return response.blob();
    }).then(function (blob) {
      if (window.createImageBitmap) return createImageBitmap(blob);
      return new Promise(function (resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(blob);
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = reject;
        img.src = url;
      });
    });
  }

  // Dessine une photo dans un canvas à partir de sa grille de tuiles (niveau
  // 0 : vignette 2 × 2 ; niveau 1 : pleine définition cols × rows).
  async function drawPhoto(canvas, photo, level) {
    var cols = level === 0 ? 2 : photo.cols;
    var rows = level === 0 ? 2 : photo.rows;
    var jobs = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) jobs.push(fetchTile(photo.id, level, c, r));
    var tiles = await Promise.all(jobs);
    var widths = [], heights = [];
    for (var i = 0; i < cols; i++) widths.push(tiles[i].width);
    for (var j = 0; j < rows; j++) heights.push(tiles[j * cols].height);
    canvas.width = widths.reduce(function (a, b) { return a + b; }, 0);
    canvas.height = heights.reduce(function (a, b) { return a + b; }, 0);
    var ctx = canvas.getContext("2d");
    var y = 0;
    for (var rr = 0; rr < rows; rr++) {
      var x = 0;
      for (var cc = 0; cc < cols; cc++) {
        ctx.drawImage(tiles[rr * cols + cc], x, y);
        x += widths[cc];
      }
      y += heights[rr];
    }
  }

  // Les vignettes se chargent quand elles approchent de l'écran.
  var observer = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      loadThumb(entry.target);
    });
  }, { rootMargin: "300px" }) : null;

  function loadThumb(canvas) {
    var photo = JSON.parse(canvas.getAttribute("data-photo"));
    drawPhoto(canvas, photo, 0).then(function () { canvas.classList.add("ec-loaded"); }).catch(function () { canvas.classList.add("ec-failed"); });
  }

  function thumbHtml(photo, index, list) {
    return '<button type="button" class="ec-thumb" data-list="' + list + '" data-index="' + index + '" aria-label="Voir la photo en grand">' +
      '<canvas style="aspect-ratio:' + photo.width + "/" + photo.height + '" data-photo="' + esc(JSON.stringify(photo)) + '"></canvas></button>';
  }

  /* ---------- Connexion ---------- */

  function showLogin(message) {
    el.app.hidden = true;
    el.login.hidden = false;
    show(el.accessError, message || "");
  }

  function setMode(link) {
    el.accessForm.hidden = link;
    el.linkForm.hidden = !link;
    el.switchBtn.textContent = link ? "J'ai ma fiche : entrer le code d'accès" : "Déjà venu sans votre fiche ? Recevoir un lien par e-mail";
    el.lede.textContent = link
      ? "Entrez l'adresse e-mail de votre espace : vous recevrez un lien de connexion, valable une demi-heure."
      : "Entrez votre adresse e-mail et le code d'accès imprimé sur la fiche remise par l'établissement.";
    (link ? el.linkEmail : el.email).focus();
  }

  el.switchBtn.addEventListener("click", function () { setMode(el.linkForm.hidden); });
  el.code.addEventListener("input", function () {
    var at = el.code.selectionStart === el.code.value.length;
    el.code.value = formatCode(el.code.value);
    if (at) el.code.setSelectionRange(el.code.value.length, el.code.value.length);
  });

  el.accessForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    show(el.accessError, "");
    if (!el.email.value.trim() || !el.email.checkValidity()) return show(el.accessError, "Entrez une adresse e-mail valide.");
    if (el.code.value.replace(/\s/g, "").length < 8) return show(el.accessError, "Le code d'accès compte 8 caractères.");
    el.accessSubmit.disabled = true;
    try {
      var data = await api("POST", "/access", { email: el.email.value.trim(), code: el.code.value });
      saveSession(data.token, data.expiresIn);
      history.replaceState(null, "", location.pathname);
      enter(data, data.childId);
    } catch (err) {
      show(el.accessError, err.message);
    } finally {
      el.accessSubmit.disabled = false;
    }
  });

  el.linkForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    show(el.linkError, "");
    show(el.linkOk, "");
    if (!el.linkEmail.value.trim() || !el.linkEmail.checkValidity()) return show(el.linkError, "Entrez une adresse e-mail valide.");
    el.linkSubmit.disabled = true;
    try {
      await api("POST", "/login-link", { email: el.linkEmail.value.trim() });
      show(el.linkOk, "Si cette adresse a un espace famille, un lien de connexion vient de lui être envoyé. Pensez à regarder dans les indésirables.");
    } catch (err) {
      show(el.linkError, err.message);
    } finally {
      el.linkSubmit.disabled = false;
    }
  });

  document.getElementById("ec-logout").addEventListener("click", function () {
    clearSession();
    state.data = null;
    el.cartbar.hidden = true;
    photoSources = {};
    el.email.value = "";
    el.code.value = "";
    showLogin("");
  });

  /* ---------- Espace famille ---------- */

  function childName(child) {
    return child.firstName || "Votre enfant";
  }

  function enter(data, childId) {
    state.data = data;
    if (childId) state.childId = childId;
    el.login.hidden = true;
    el.app.hidden = false;
    el.account.textContent = data.email;
    var studios = data.children.map(function (c) { return c.studioName; }).filter(Boolean);
    el.studio.textContent = studios.length && studios.every(function (s) { return s === studios[0]; }) ? studios[0] : "Espace famille";
    pruneCart();
    render();
  }

  function deadlineBanner(child) {
    var y = child.year;
    var nowSec = Date.now() / 1000;
    if (y.status === "closed") return '<p class="ec-banner ec-banner-muted">Les commandes sont closes pour ' + esc(child.school.name) + ".</p>";
    if (y.orderDeadline && y.orderDeadline > nowSec) {
      return '<p class="ec-banner">Commande groupée, livrée gratuitement à l\'établissement, jusqu\'au <strong>' + esc(formatDate(y.orderDeadline)) + "</strong>.</p>";
    }
    if (y.lateDeadline && y.lateDeadline > nowSec) {
      return '<p class="ec-banner">Commande avec livraison à domicile jusqu\'au <strong>' + esc(formatDate(y.lateDeadline)) + "</strong>.</p>";
    }
    return "";
  }

  function render() {
    var data = state.data;
    if (!data.children.length) {
      el.view.innerHTML = '<section class="ec-empty"><h2>Aucun enfant pour l\'instant</h2>' +
        "<p>Ajoutez un enfant avec le code imprimé sur sa fiche.</p>" + addChildFormHtml() + "</section>";
      wireAddChild();
      return;
    }
    var child = data.children.find(function (c) { return c.id === state.childId; }) || data.children[0];
    state.childId = child.id;

    var tabs = data.children.length > 1
      ? '<nav class="ec-kids" aria-label="Vos enfants">' + data.children.map(function (c) {
          return '<button type="button" class="ec-kid' + (c.id === child.id ? " ec-kid-on" : "") + '" data-child="' + esc(c.id) + '" aria-pressed="' + (c.id === child.id) + '">' +
            '<span class="ec-kid-name">' + esc(childName(c)) + "</span>" +
            '<span class="ec-kid-sub">' + esc(c.group.name + " · " + c.year.label) + "</span></button>";
        }).join("") + "</nav>"
      : "";

    var body;
    if (!child.viewable) {
      body = '<p class="ec-banner ec-banner-muted">Les photos de cette année ne sont plus en ligne.</p>';
    } else {
      body =
        deadlineBanner(child) +
        '<section class="ec-section"><div class="ec-section-head"><h3>Photos de ' + esc(childName(child)) + "</h3>" +
        '<span class="ec-count">' + child.photos.length + " photo" + (child.photos.length > 1 ? "s" : "") + "</span></div>" +
        (child.photos.length
          ? '<div class="ec-grid">' + child.photos.map(function (p, i) { return thumbHtml(p, i, "photos"); }).join("") + "</div>"
          : '<p class="ec-hint">Les photos arrivent bientôt.</p>') +
        "</section>" +
        (child.groupPhotos.length
          ? '<section class="ec-section"><div class="ec-section-head"><h3>' + esc(child.vocabulary.groupPhoto) + "</h3></div>" +
            '<div class="ec-grid ec-grid-wide">' + child.groupPhotos.map(function (p, i) { return thumbHtml(p, i, "groupPhotos"); }).join("") + "</div></section>"
          : "") +
        orderSectionHtml(child);
    }

    var notice = state.notice
      ? '<p class="ec-notice' + (state.notice.ok ? " ec-notice-ok" : "") + '" role="status">' + esc(state.notice.text) + "</p>"
      : "";

    el.view.innerHTML =
      notice +
      tabs +
      '<header class="ec-child-head"><p class="ec-eyebrow">' + esc(child.school.name) + "</p>" +
      "<h1>" + esc(childName(child)) + "</h1>" +
      '<p class="ec-sub">' + esc(child.vocabulary.group + " " + child.group.name + (child.group.leader ? " · " + child.group.leader : "") + " · " + child.year.label) + "</p></header>" +
      body +
      ordersSectionHtml() +
      '<section class="ec-section ec-family"><h3>Un autre enfant ?</h3>' +
      "<p class=\"ec-hint\">Frère, sœur, autre école : ajoutez-le avec le code de sa fiche pour tout retrouver ici, et commander en une fois.</p>" +
      addChildFormHtml() +
      '<p class="ec-hint ec-remove"><button type="button" class="ec-link-btn" id="ec-remove">Retirer ' + esc(childName(child)) + " de cet espace</button></p>" +
      '<label class="ec-reminders"><input type="checkbox" id="ec-reminders"' + (data.remindersOn ? " checked" : "") + " /> " +
      "Recevoir un rappel par e-mail avant la date limite de commande</label>" +
      "</section>";

    el.view.querySelectorAll("[data-child]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.childId = btn.getAttribute("data-child");
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    el.view.querySelectorAll(".ec-thumb canvas").forEach(function (canvas) {
      if (observer) observer.observe(canvas);
      else loadThumb(canvas);
    });
    el.view.querySelectorAll(".ec-thumb").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openLightbox(child, btn.getAttribute("data-list"), Number(btn.getAttribute("data-index")));
      });
    });
    el.view.querySelectorAll("[data-mockup]").forEach(function (canvas) {
      var product = (shopOf(child) || { products: [] }).products.find(function (p) { return p.id === canvas.getAttribute("data-mockup"); });
      if (product) renderMockup(canvas, product.layout, mockupPhotoFor(child, product), 480);
    });
    el.view.querySelectorAll("[data-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () { openPicker(child, { productId: btn.getAttribute("data-pick") }); });
    });
    el.view.querySelectorAll("[data-download]").forEach(function (btn) {
      btn.addEventListener("click", function () { downloadFile(btn); });
    });
    wireAddChild();
    var reminders = document.getElementById("ec-reminders");
    if (reminders) reminders.addEventListener("change", async function () {
      try {
        state.data.remindersOn = (await api("POST", "/reminders", { on: reminders.checked })).remindersOn;
      } catch (err) {
        reminders.checked = !reminders.checked;
        window.alert(err.message);
      }
    });
    var remove = document.getElementById("ec-remove");
    if (remove) remove.addEventListener("click", async function () {
      if (remove.getAttribute("data-confirm") !== "1") {
        remove.setAttribute("data-confirm", "1");
        remove.textContent = "Confirmer : retirer " + childName(child) + " (son code reste valable)";
        return;
      }
      try {
        var data2 = await api("DELETE", "/children/" + encodeURIComponent(child.id));
        state.childId = "";
        enter(data2);
      } catch (err) {
        window.alert(err.message);
      }
    });
  }

  function addChildFormHtml() {
    return '<form class="ec-add" id="ec-add-form" novalidate>' +
      '<input type="text" id="ec-add-code" class="ec-code-input" maxlength="12" placeholder="Code d\'accès" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Code d\'accès de l\'enfant à ajouter" />' +
      '<button type="submit" class="ec-btn ec-btn-small">Ajouter</button>' +
      '<p class="ec-error" id="ec-add-error" role="alert" hidden></p></form>';
  }

  function wireAddChild() {
    var form = document.getElementById("ec-add-form");
    if (!form) return;
    var input = document.getElementById("ec-add-code");
    input.addEventListener("input", function () { input.value = formatCode(input.value); });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var error = document.getElementById("ec-add-error");
      show(error, "");
      if (input.value.replace(/\s/g, "").length < 8) return show(error, "Le code d'accès compte 8 caractères.");
      try {
        var data = await api("POST", "/children", { code: input.value });
        enter(data, data.childId);
      } catch (err) {
        show(error, err.message);
      }
    });
  }

  /* ---------- Commande : gamme, panier, paiement ---------- */

  function loadCart() {
    try {
      var cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(cart) ? cart : [];
    } catch (err) {
      return [];
    }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (err) { /* panier de cet onglet */ }
    updateCartBar();
  }

  function shopOf(child) {
    return (child && state.data && state.data.shops && state.data.shops[child.yearId]) || null;
  }

  function childById(id) {
    return state.data.children.find(function (c) { return c.id === id; }) || null;
  }

  // Lignes du panier relues contre la vue actuelle : un article retiré de la
  // vente, un enfant retiré de l'espace ou une boutique fermée en sortent.
  function cartLines() {
    if (!state.data) return [];
    return state.cart.map(function (item) {
      var child = childById(item.childId);
      var shop = shopOf(child);
      if (!child || !shop || !shop.delivery) return null;
      var product = shop.products.find(function (p) { return p.id === item.productId; });
      if (!product) return null;
      var photo = (product.scope === "group" ? child.groupPhotos : child.photos).find(function (p) { return p.id === item.photoId; });
      if (!photo) return null;
      return { item: item, child: child, product: product, photo: photo, shop: shop };
    }).filter(Boolean);
  }

  function pruneCart() {
    state.cart = cartLines().map(function (l) { return l.item; });
    saveCart();
  }

  function cartTotals(lines) {
    var items = lines.reduce(function (n, l) { return n + l.product.priceCents * l.item.quantity; }, 0);
    var shop = lines.length ? lines[0].shop : null;
    var shipping = shop && shop.delivery === "home" ? shop.homeShippingCents : 0;
    var count = lines.reduce(function (n, l) { return n + l.item.quantity; }, 0);
    return { items: items, shipping: shipping, total: items + shipping, count: count, shop: shop };
  }

  function updateCartBar() {
    var lines = cartLines();
    if (!lines.length || el.app.hidden) {
      el.cartbar.hidden = true;
      return;
    }
    var t = cartTotals(lines);
    el.cartbarText.innerHTML = "<strong>" + t.count + " article" + (t.count > 1 ? "s" : "") + "</strong> · " + esc(euros(t.items));
    el.cartbar.hidden = false;
  }

  function deliveryText(shop, child) {
    if (shop.delivery === "home") {
      return "Livraison à domicile" + (shop.homeShippingCents ? " : " + euros(shop.homeShippingCents) + " par commande" : ", offerte") +
        (child.year.lateDeadline ? ", jusqu'au " + formatDate(child.year.lateDeadline) : "") + ".";
    }
    return "Livraison gratuite à l'établissement, avec les photos de toute " + (child.vocabulary.group === "Équipe" ? "l'équipe" : "la " + child.vocabulary.group.toLowerCase()) +
      (child.year.orderDeadline ? " : commandez avant le " + formatDate(child.year.orderDeadline) : "") + ".";
  }

  function orderSectionHtml(child) {
    var shop = shopOf(child);
    if (!shop || !shop.delivery) return "";
    var products = shop.products.filter(function (p) {
      return p.scope === "group" ? child.groupPhotos.length : child.photos.length;
    });
    if (!products.length) {
      return '<section class="ec-section ec-order"><h3>Commander</h3><p class="ec-hint">La boutique ouvre très bientôt dans cet espace.</p></section>';
    }
    return (
      '<section class="ec-section ec-order" id="ec-order"><div class="ec-section-head"><h3>Commander pour ' + esc(childName(child)) + "</h3></div>" +
      '<p class="ec-hint">' + esc(deliveryText(shop, child)) + " Un seul panier pour tous vos enfants.</p>" +
      '<div class="ec-products">' + products.map(function (p) {
        return (
          '<article class="ec-product' + (p.preview ? " ec-product-visual" : "") + '">' +
          (p.layout && mockupPhotoFor(child, p)
            ? '<canvas class="ec-product-img ec-mockup" data-mockup="' + esc(p.id) + '" style="aspect-ratio:' + p.layout.ratio + '" role="img" aria-label="Aperçu : ' + esc(p.name) + " avec la photo de " + esc(childName(child)) + '"></canvas>'
            : p.preview ? '<img class="ec-product-img" src="' + esc(previewUrl(p.preview)) + '" alt="Composition : ' + esc(p.name) + '" loading="lazy" />' : "") +
          '<p class="ec-product-kind">' + esc(p.scope === "group" ? child.vocabulary.groupPhoto : "Portrait") + "</p>" +
          "<h4>" + esc(p.name) + "</h4>" +
          (p.description ? '<p class="ec-product-desc">' + esc(p.description) + "</p>" : "") +
          '<div class="ec-product-foot"><span class="ec-price">' + esc(euros(p.priceCents)) + "</span>" +
          '<button type="button" class="ec-btn ec-btn-small ec-btn-ghost" data-pick="' + esc(p.id) + '" aria-label="Choisir ' + esc(p.name) + '">Choisir</button></div>' +
          "</article>"
        );
      }).join("") + "</div></section>"
    );
  }

  function ordersSectionHtml() {
    var orders = (state.data && state.data.orders) || [];
    if (!orders.length) return "";
    return (
      '<section class="ec-section ec-orders"><h3>Vos commandes</h3><ul class="ec-order-list">' +
      orders.map(function (o) {
        return (
          "<li><div class=\"ec-order-head\"><strong>" + esc(formatDate(o.paidAt)) + "</strong><span>" + esc(euros(o.amountCents)) + " · " +
          (o.delivery === "home" ? "livraison à domicile" : "livrée à l'établissement") + "</span></div>" +
          '<ul class="ec-order-lines">' + o.lines.map(function (l) {
            var child = childById(l.childId);
            return "<li><span>" + l.quantity + " × " + esc(l.name) + (child ? " · " + esc(childName(child)) : "") + "</span>" +
              (l.kind === "numerique"
                ? '<button type="button" class="ec-link-btn" data-download="' + esc(l.id) + '">Télécharger</button>'
                : "") + "</li>";
          }).join("") + "</ul></li>"
        );
      }).join("") +
      "</ul></section>"
    );
  }

  async function downloadFile(btn) {
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = "Téléchargement…";
    try {
      var response = await fetch(API + "/api/family/download/" + encodeURIComponent(btn.getAttribute("data-download")), {
        headers: { authorization: "Bearer " + state.token },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Le fichier n'est pas disponible pour le moment.");
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      var match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "");
      a.href = url;
      a.download = match ? match[1] : "photo.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    } catch (err) {
      window.alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* Panneau : choisir un article (produit, photo, quantité) ou voir le panier. */

  var lastFocus = null;

  function openSheet(html) {
    lastFocus = document.activeElement;
    el.sheetBody.innerHTML = html;
    el.sheet.hidden = false;
    document.body.classList.add("ec-locked");
    el.sheetBody.querySelectorAll("canvas[data-photo]").forEach(function (canvas) {
      if (observer) observer.observe(canvas);
      else loadThumb(canvas);
    });
    var focus = el.sheetBody.querySelector("[autofocus], button, input");
    if (focus) focus.focus();
  }

  function closeSheet() {
    el.sheet.hidden = true;
    el.sheetBody.innerHTML = "";
    document.body.classList.remove("ec-locked");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.getElementById("ec-sheet-close").addEventListener("click", closeSheet);
  el.sheet.addEventListener("click", function (event) { if (event.target === el.sheet) closeSheet(); });
  document.getElementById("ec-cartbar-open").addEventListener("click", openCart);

  // Visuel d'exemple d'un produit (planche du labo), servi par l'API.
  function previewUrl(path) {
    return path ? API + path : "";
  }

  // Menu déroulant illustré pour choisir l'article : vignette, nom, contenu
  // et prix. Clavier : flèches, Entrée, Échap.
  function visualSelect(host, opts) {
    var current = opts.value;
    function itemHtml(o) {
      return (o.img ? '<img src="' + esc(o.img) + '" alt="" />' : '<span class="ec-vsel-noimg" aria-hidden="true"></span>') +
        '<span class="ec-vsel-text"><strong>' + esc(o.label) + "</strong>" + (o.sub ? "<small>" + esc(o.sub) + "</small>" : "") + "</span>" +
        '<span class="ec-price">' + esc(o.price) + "</span>";
    }
    host.className = "ec-vsel";
    host.innerHTML =
      '<button type="button" class="ec-vsel-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(opts.ariaLabel) + '"></button>' +
      '<ul class="ec-vsel-list" role="listbox" aria-label="' + esc(opts.ariaLabel) + '" hidden>' +
      opts.options.map(function (o) {
        return '<li role="option" tabindex="-1" data-value="' + esc(o.value) + '" aria-selected="' + (o.value === current) + '">' + itemHtml(o) + "</li>";
      }).join("") + "</ul>";
    var btn = host.querySelector(".ec-vsel-btn");
    var list = host.querySelector(".ec-vsel-list");
    var items = Array.prototype.slice.call(list.children);
    function paint() {
      var o = opts.options.find(function (x) { return x.value === current; });
      btn.innerHTML = itemHtml(o) + '<span class="ec-vsel-caret" aria-hidden="true">▾</span>';
      items.forEach(function (li) { li.setAttribute("aria-selected", String(li.getAttribute("data-value") === current)); });
    }
    function outside(event) { if (!host.contains(event.target)) close(); }
    function open() {
      list.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", outside);
      (items.find(function (li) { return li.getAttribute("aria-selected") === "true"; }) || items[0]).focus();
    }
    function close(refocus) {
      list.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", outside);
      if (refocus) btn.focus();
    }
    function choose(li) {
      current = li.getAttribute("data-value");
      paint();
      close(true);
      opts.onChange(current);
    }
    btn.addEventListener("click", function () { if (list.hidden) open(); else close(); });
    btn.addEventListener("keydown", function (e) { if (e.key === "ArrowDown") { e.preventDefault(); open(); } });
    items.forEach(function (li, i) {
      li.addEventListener("click", function () { choose(li); });
      li.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" && items[i + 1]) { e.preventDefault(); items[i + 1].focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || btn).focus(); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(li); }
        else if (e.key === "Escape") { e.stopPropagation(); close(true); }
        else if (e.key === "Tab") { close(false); }
      });
    });
    paint();
  }

  /* ---------- Aperçu de la planche avec la photo de l'enfant ---------- */

  // La photo source est la vignette protégée déjà affichée (tuiles du niveau
  // 0, filigranées) : l'aperçu ne révèle rien de plus que la galerie.
  var photoSources = {};
  function photoSource(photo) {
    if (!photoSources[photo.id]) {
      var source = document.createElement("canvas");
      photoSources[photo.id] = drawPhoto(source, photo, 0).then(function () { return source; }, function (err) {
        delete photoSources[photo.id];
        throw err;
      });
    }
    return photoSources[photo.id];
  }

  // Recadrage « couverture » : la photo remplit la case, centrée en largeur,
  // un peu plus haut que le centre en hauteur (les visages).
  function coverRect(sw, sh, dw, dh) {
    var scale = Math.max(dw / sw, dh / sh);
    var w = dw / scale;
    var h = dh / scale;
    return { x: (sw - w) / 2, y: (sh - h) * 0.35, w: w, h: h };
  }

  // Teinte d'une case : 1 noir et blanc, 2 sépia.
  function toneBox(ctx, x, y, w, h, tone) {
    try {
      var img = ctx.getImageData(x, y, w, h);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        if (tone === 1) {
          d[i] = d[i + 1] = d[i + 2] = 0.299 * r + 0.587 * g + 0.114 * b;
        } else {
          d[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
          d[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
          d[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
        }
      }
      ctx.putImageData(img, x, y);
    } catch (err) { /* aperçu en couleur à défaut */ }
  }

  // Compose la planche : chaque case de la mise en page (millièmes du
  // visuel) reçoit la photo, recadrée à son format.
  function renderMockup(canvas, layout, photo, width) {
    var token = (canvas._mockupToken || 0) + 1;
    canvas._mockupToken = token;
    canvas.classList.remove("ec-loaded");
    return photoSource(photo).then(function (source) {
      if (canvas._mockupToken !== token) return;
      var W = width;
      var H = Math.round(width / layout.ratio);
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      layout.boxes.forEach(function (b) {
        var x = Math.round(b[0] / 1000 * W);
        var y = Math.round(b[1] / 1000 * H);
        var w = Math.max(1, Math.round(b[2] / 1000 * W));
        var h = Math.max(1, Math.round(b[3] / 1000 * H));
        var r = coverRect(source.width, source.height, w, h);
        ctx.drawImage(source, r.x, r.y, r.w, r.h, x, y, w, h);
        if (b[4]) toneBox(ctx, x, y, w, h, b[4]);
      });
      canvas.classList.add("ec-loaded");
    }).catch(function () { canvas.classList.add("ec-failed"); });
  }

  function mockupPhotoFor(child, product) {
    var list = product.scope === "group" ? child.groupPhotos : child.photos;
    return list && list.length ? list[0] : null;
  }

  function miniPhotoHtml(photo) {
    return '<canvas style="aspect-ratio:' + photo.width + "/" + photo.height + '" data-photo="' + esc(JSON.stringify(photo)) + '"></canvas>';
  }

  function openPicker(child, opts) {
    var shop = shopOf(child);
    if (!shop || !shop.delivery) return;
    var preset = opts.productId && shop.products.find(function (p) { return p.id === opts.productId; });
    var scope = preset ? preset.scope : opts.scope || "portrait";
    var products = shop.products.filter(function (p) { return p.scope === scope; });
    var photos = scope === "group" ? child.groupPhotos : child.photos;
    if (!products.length || !photos.length) return;
    var sel = {
      productId: preset ? preset.id : products[0].id,
      photoId: opts.photoId && photos.some(function (p) { return p.id === opts.photoId; }) ? opts.photoId : photos[0].id,
      quantity: 1,
    };

    openSheet(
      '<p class="ec-eyebrow">' + esc(childName(child)) + " · " + esc(child.group.name) + "</p>" +
      '<h2 id="ec-sheet-title">Ajouter au panier</h2>' +
      '<div class="ec-pick"><p class="ec-pick-label" id="ec-pick-article">Article</p><div id="ec-pick-select"></div>' +
      '<figure class="ec-pick-visual" id="ec-pick-visual" hidden><canvas class="ec-mockup" role="img"></canvas><img alt="" />' +
      "<figcaption></figcaption></figure></div>" +
      '<fieldset class="ec-pick"><legend>' + (photos.length > 1 ? "Photo choisie" : "Photo") + '</legend><div class="ec-pick-photos' + (scope === "group" ? " ec-pick-wide" : "") + '">' +
      photos.map(function (p) {
        return '<button type="button" class="ec-pick-photo" data-photo-id="' + esc(p.id) + '" aria-pressed="' + (p.id === sel.photoId) + '" aria-label="Choisir cette photo">' + miniPhotoHtml(p) + "</button>";
      }).join("") + "</div></fieldset>" +
      '<div class="ec-pick-foot">' +
      '<div class="ec-qty" role="group" aria-label="Quantité"><button type="button" data-qty="-1" aria-label="Un de moins">−</button><output id="ec-qty">1</output><button type="button" data-qty="1" aria-label="Un de plus">+</button></div>' +
      '<button type="button" class="ec-btn ec-btn-small" id="ec-pick-add"></button></div>' +
      '<p class="ec-error" id="ec-pick-error" role="alert" hidden></p>'
    );

    var addBtn = document.getElementById("ec-pick-add");
    var visual = document.getElementById("ec-pick-visual");
    function refresh() {
      var product = products.find(function (p) { return p.id === sel.productId; });
      document.getElementById("ec-qty").textContent = String(sel.quantity);
      addBtn.textContent = "Ajouter · " + euros(product.priceCents * sel.quantity);
      var photo = photos.find(function (p) { return p.id === sel.photoId; });
      var mockup = visual.querySelector("canvas");
      var img = visual.querySelector("img");
      visual.hidden = !product.layout && !product.preview;
      mockup.hidden = !product.layout;
      img.hidden = Boolean(product.layout) || !product.preview;
      if (product.layout) {
        mockup.style.aspectRatio = String(product.layout.ratio);
        mockup.setAttribute("aria-label", "Aperçu : " + product.name + " avec la photo choisie");
        renderMockup(mockup, product.layout, photo, 640);
        visual.querySelector("figcaption").textContent = "Aperçu avec la photo choisie. Le filigrane n'apparaît pas sur les tirages.";
      } else if (product.preview) {
        img.src = previewUrl(product.preview);
        img.alt = "Composition de la planche : " + product.name;
        visual.querySelector("figcaption").textContent = "Composition de la planche : chaque case reçoit la photo choisie.";
      }
    }
    visualSelect(document.getElementById("ec-pick-select"), {
      options: products.map(function (p) {
        return { value: p.id, label: p.name, sub: p.description, price: euros(p.priceCents), img: previewUrl(p.preview) };
      }),
      value: sel.productId,
      ariaLabel: "Article",
      onChange: function (value) { sel.productId = value; refresh(); },
    });
    refresh();
    el.sheetBody.querySelectorAll("[data-photo-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sel.photoId = btn.getAttribute("data-photo-id");
        el.sheetBody.querySelectorAll("[data-photo-id]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        refresh();
      });
    });
    el.sheetBody.querySelectorAll("[data-qty]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sel.quantity = Math.max(1, Math.min(MAX_QTY, sel.quantity + Number(btn.getAttribute("data-qty"))));
        refresh();
      });
    });
    addBtn.addEventListener("click", function () {
      var other = cartLines().find(function (l) { return l.child.yearId !== child.yearId; });
      if (other) {
        return show(document.getElementById("ec-pick-error"),
          "Votre panier contient déjà des photos de " + other.child.school.name + " : réglez-le d'abord, puis passez une seconde commande.");
      }
      var same = state.cart.find(function (i) { return i.childId === child.id && i.productId === sel.productId && i.photoId === sel.photoId; });
      if (same) same.quantity = Math.min(MAX_QTY, same.quantity + sel.quantity);
      else state.cart.push({ childId: child.id, productId: sel.productId, photoId: sel.photoId, quantity: sel.quantity });
      saveCart();
      closeSheet();
      el.cartbar.classList.remove("ec-bump");
      void el.cartbar.offsetWidth;
      el.cartbar.classList.add("ec-bump");
    });
  }

  function openCart() {
    var lines = cartLines();
    if (!lines.length) return closeSheet();
    var t = cartTotals(lines);
    var byChild = [];
    lines.forEach(function (l, i) {
      var bucket = byChild.find(function (b) { return b.child.id === l.child.id; });
      if (!bucket) byChild.push(bucket = { child: l.child, lines: [] });
      bucket.lines.push({ line: l, index: state.cart.indexOf(l.item) });
      void i;
    });

    openSheet(
      '<h2 id="ec-sheet-title">Votre panier</h2>' +
      byChild.map(function (b) {
        return '<div class="ec-cart-child"><p class="ec-eyebrow">' + esc(childName(b.child)) + " · " + esc(b.child.group.name) + "</p>" +
          '<ul class="ec-cart-lines">' + b.lines.map(function (entry) {
            var l = entry.line;
            return '<li data-index="' + entry.index + '">' +
              '<span class="ec-cart-thumb">' + miniPhotoHtml(l.photo) + "</span>" +
              '<span class="ec-cart-name"><strong>' + esc(l.product.name) + "</strong>" + (l.product.description ? "<small>" + esc(l.product.description) + "</small>" : "") +
              '<button type="button" class="ec-link-btn ec-cart-remove" data-remove>Retirer</button></span>' +
              '<span class="ec-qty ec-qty-small" role="group" aria-label="Quantité"><button type="button" data-step="-1" aria-label="Un de moins">−</button><output>' + l.item.quantity + '</output><button type="button" data-step="1" aria-label="Un de plus">+</button></span>' +
              '<span class="ec-price">' + esc(euros(l.product.priceCents * l.item.quantity)) + "</span></li>";
          }).join("") + "</ul></div>";
      }).join("") +
      '<dl class="ec-cart-totals">' +
      "<div><dt>Articles</dt><dd>" + esc(euros(t.items)) + "</dd></div>" +
      "<div><dt>" + (t.shop.delivery === "home" ? "Livraison à domicile" : "Livraison à l'établissement") + "</dt><dd>" + (t.shipping ? esc(euros(t.shipping)) : "Offerte") + "</dd></div>" +
      '<div class="ec-cart-total"><dt>Total</dt><dd>' + esc(euros(t.total)) + "</dd></div></dl>" +
      '<p class="ec-hint">' + esc(deliveryText(t.shop, lines[0].child)) + (t.shop.delivery === "home" ? " L'adresse vous sera demandée au paiement." : "") + "</p>" +
      '<button type="button" class="ec-btn" id="ec-pay">Payer ' + esc(euros(t.total)) + " en ligne</button>" +
      '<p class="ec-error" id="ec-pay-error" role="alert" hidden></p>' +
      '<p class="ec-hint ec-secure">Paiement sécurisé par Stripe (carte, Bancontact…). Confirmation envoyée à ' + esc(state.data.email) + ".</p>"
    );

    el.sheetBody.querySelectorAll(".ec-cart-lines li").forEach(function (li) {
      var index = Number(li.getAttribute("data-index"));
      li.querySelector("[data-remove]").addEventListener("click", function () {
        state.cart.splice(index, 1);
        saveCart();
        render();
        openCart();
      });
      li.querySelectorAll("[data-step]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var item = state.cart[index];
          item.quantity = Math.max(1, Math.min(MAX_QTY, item.quantity + Number(btn.getAttribute("data-step"))));
          saveCart();
          openCart();
        });
      });
    });
    document.getElementById("ec-pay").addEventListener("click", async function () {
      var btn = this;
      btn.disabled = true;
      show(document.getElementById("ec-pay-error"), "");
      try {
        var result = await api("POST", "/checkout", { items: state.cart });
        location.href = result.url;
      } catch (err) {
        show(document.getElementById("ec-pay-error"), err.message);
        btn.disabled = false;
      }
    });
  }

  // Retour de Stripe : la commande est confirmée sans attendre le webhook.
  async function afterPayment(params) {
    var outcome = params.get("commande");
    if (outcome === "annulee") {
      state.notice = { ok: false, text: "Paiement annulé : votre panier est conservé." };
      return;
    }
    if (outcome !== "merci") return;
    var paid = false;
    try {
      paid = (await api("POST", "/checkout/sync", { sessionId: params.get("session_id") || "" })).paid;
    } catch (err) { /* le webhook confirmera */ }
    state.cart = [];
    saveCart();
    state.notice = paid
      ? { ok: true, text: "Merci ! Votre commande est confirmée : un récapitulatif vient de partir par e-mail." }
      : { ok: true, text: "Merci ! Votre paiement est en cours de confirmation : votre commande apparaîtra ici dans un instant." };
  }

  /* ---------- Photo en grand ---------- */

  function openLightbox(child, key, index) {
    state.lightbox = { child: child, key: key, list: child[key], index: index };
    var scope = key === "groupPhotos" ? "group" : "portrait";
    var shop = shopOf(child);
    el.lightboxOrder.hidden = !(shop && shop.delivery && shop.products.some(function (p) { return p.scope === scope; }));
    el.lightbox.hidden = false;
    document.body.classList.add("ec-locked");
    drawLightbox();
  }
  function drawLightbox() {
    var lb = state.lightbox;
    var photo = lb.list[lb.index];
    var canvas = el.lightboxCanvas;
    canvas.classList.remove("ec-loaded");
    drawPhoto(canvas, photo, 1).then(function () { canvas.classList.add("ec-loaded"); }).catch(function () {});
    document.getElementById("ec-prev").hidden = lb.list.length < 2;
    document.getElementById("ec-next").hidden = lb.list.length < 2;
  }
  function step(delta) {
    var lb = state.lightbox;
    if (!lb) return;
    lb.index = (lb.index + delta + lb.list.length) % lb.list.length;
    drawLightbox();
  }
  function closeLightbox() {
    state.lightbox = null;
    el.lightbox.hidden = true;
    document.body.classList.remove("ec-locked");
    var ctx = el.lightboxCanvas.getContext("2d");
    ctx.clearRect(0, 0, el.lightboxCanvas.width, el.lightboxCanvas.height);
  }
  document.getElementById("ec-lightbox-close").addEventListener("click", closeLightbox);
  el.lightboxOrder.addEventListener("click", function () {
    var lb = state.lightbox;
    if (!lb) return;
    closeLightbox();
    openPicker(lb.child, { scope: lb.key === "groupPhotos" ? "group" : "portrait", photoId: lb.list[lb.index].id });
  });
  document.getElementById("ec-prev").addEventListener("click", function () { step(-1); });
  document.getElementById("ec-next").addEventListener("click", function () { step(1); });
  el.lightbox.addEventListener("click", function (event) { if (event.target === el.lightbox) closeLightbox(); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !el.sheet.hidden) return closeSheet();
    if (!state.lightbox) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  });

  // Pas de clic droit ni de glisser-déposer sur les photos.
  document.addEventListener("contextmenu", function (event) {
    if (event.target.closest("canvas, .ec-thumb")) event.preventDefault();
  });
  document.addEventListener("dragstart", function (event) {
    if (event.target.closest("canvas")) event.preventDefault();
  });

  /* ---------- Démarrage ---------- */

  async function start() {
    var params = new URLSearchParams(location.search);
    var linkToken = params.get("l");
    var code = params.get("c");
    // Lien « Ne plus recevoir de rappels » d'un e-mail : sans connexion.
    var stop = params.get("stop");
    if (stop) {
      history.replaceState(null, "", location.pathname);
      var notice = document.getElementById("ec-login-notice");
      try {
        await api("POST", "/unsubscribe", { token: stop });
        var stopped = "C'est noté : vous ne recevrez plus de rappels de commande. Vous pouvez les réactiver dans votre espace famille.";
        show(notice, stopped);
        state.notice = { ok: true, text: stopped };
      } catch (err) {
        show(notice, err.message);
      }
    }
    if (linkToken) {
      history.replaceState(null, "", location.pathname);
      try {
        var data = await api("POST", "/login-link/verify", { token: linkToken });
        saveSession(data.token, data.expiresIn);
        return enter(data);
      } catch (err) {
        showLogin(err.message);
        return;
      }
    }
    state.token = loadSession();
    if (state.token) {
      try {
        if (params.get("commande")) {
          history.replaceState(null, "", location.pathname);
          await afterPayment(params);
        }
        var me = await api("GET", "/me");
        // Fiche scannée alors qu'on a déjà un espace : on ajoute l'enfant.
        if (code) {
          history.replaceState(null, "", location.pathname);
          try {
            var added = await api("POST", "/children", { code: code });
            return enter(added, added.childId);
          } catch (err) {
            enter(me);
            return;
          }
        }
        return enter(me);
      } catch (err) {
        /* session expirée : retour à la connexion */
      }
    }
    showLogin("");
    if (code) {
      el.code.value = formatCode(code);
      el.email.focus();
    }
  }

  start();
})();
