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
  };

  var state = { token: "", data: null, childId: "", lightbox: null };

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
        '<section class="ec-section ec-order"><h3>Commander</h3><p class="ec-hint">La commande de tirages et de pochettes ouvre très bientôt dans cet espace.</p></section>';
    }

    el.view.innerHTML =
      tabs +
      '<header class="ec-child-head"><p class="ec-eyebrow">' + esc(child.school.name) + "</p>" +
      "<h1>" + esc(childName(child)) + "</h1>" +
      '<p class="ec-sub">' + esc(child.vocabulary.group + " " + child.group.name + (child.group.leader ? " · " + child.group.leader : "") + " · " + child.year.label) + "</p></header>" +
      body +
      '<section class="ec-section ec-family"><h3>Un autre enfant ?</h3>' +
      "<p class=\"ec-hint\">Frère, sœur, autre école : ajoutez-le avec le code de sa fiche pour tout retrouver ici, et commander en une fois.</p>" +
      addChildFormHtml() +
      '<p class="ec-hint ec-remove"><button type="button" class="ec-link-btn" id="ec-remove">Retirer ' + esc(childName(child)) + " de cet espace</button></p>" +
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
        openLightbox(child[btn.getAttribute("data-list")], Number(btn.getAttribute("data-index")));
      });
    });
    wireAddChild();
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

  /* ---------- Photo en grand ---------- */

  function openLightbox(list, index) {
    state.lightbox = { list: list, index: index };
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
  document.getElementById("ec-prev").addEventListener("click", function () { step(-1); });
  document.getElementById("ec-next").addEventListener("click", function () { step(1); });
  el.lightbox.addEventListener("click", function (event) { if (event.target === el.lightbox) closeLightbox(); });
  document.addEventListener("keydown", function (event) {
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
