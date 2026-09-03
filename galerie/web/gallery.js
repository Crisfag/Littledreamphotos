/* =====================================================================
   Galerie protégée — affichage client
   ---------------------------------------------------------------------
   Les photos ne sont jamais des éléments <img> : chacune est réassemblée
   dans un <canvas> à partir de tuiles chargées avec un jeton de session.
   Conséquences concrètes :
     · « Enregistrer l'image sous » ne propose rien ;
     · aucune URL du réseau ne renvoie une photo entière ;
     · un aspirateur de site ne trouve aucun fichier à récupérer.

   Ce que ce code ne fait PAS, et ne peut pas faire : empêcher une capture
   d'écran. C'est le système d'exploitation qui capture l'écran, aucun
   JavaScript n'a autorité là-dessus. Les gardes ci-dessous découragent le
   geste réflexe et le consignent ; la vraie protection est ailleurs — basse
   définition, filigrane en trame, et empreinte invisible qui rend chaque
   photo traçable jusqu'à la galerie dont elle provient.
   ===================================================================== */

(function () {
  "use strict";

  var CONFIG = window.GALERIE_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/$/, "");
  var CLIPBOARD_GUARD = CONFIG.clipboardGuard !== false;
  var LEVEL_PREVIEW = 0;
  var LEVEL_FULL = 1;
  var PREVIEW_COLS = 2;
  var PREVIEW_ROWS = 2;
  var PARALLEL_TILES = 6;

  var state = {
    slug: null,
    token: null,
    photos: [],
    gallery: null,
    current: -1,
    drawn: {},
  };

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------- Réseau ---------- */

  function apiUrl(path) {
    return API + "/api/gallery/" + encodeURIComponent(state.slug) + path;
  }

  function authHeaders() {
    return { authorization: "Bearer " + state.token };
  }

  function logEvent(event, detail) {
    if (!state.token) return;
    // `keepalive` : l'évènement part même si la page se ferme juste après.
    fetch(apiUrl("/event"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ event: event, detail: detail || "" }),
      keepalive: true,
    }).catch(function () {});
  }

  function sessionLost(message) {
    state.token = null;
    state.drawn = {};
    closeViewer();
    show(el.login);
    hide(el.gallery);
    el.error.textContent = message;
    el.error.hidden = false;
    el.password.value = "";
  }

  /* ---------- Assemblage des tuiles ---------- */

  // La même formule que côté préparation : les tuiles se rejoignent au pixel
  // près, sans trou ni chevauchement, quelles que soient les dimensions.
  function tileRect(width, height, cols, rows, col, row) {
    var x = Math.floor((col * width) / cols);
    var y = Math.floor((row * height) / rows);
    return {
      x: x,
      y: y,
      w: Math.floor(((col + 1) * width) / cols) - x,
      h: Math.floor(((row + 1) * height) / rows) - y,
    };
  }

  function decode(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    // Repli pour les navigateurs sans createImageBitmap.
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("tuile illisible"));
      };
      img.src = url;
    });
  }

  function fetchTile(photoId, level, col, row) {
    return fetch(apiUrl("/tile/" + photoId + "/" + level + "/" + col + "/" + row), {
      headers: authHeaders(),
      cache: "no-store",
    }).then(function (response) {
      if (response.status === 401) throw new Error("session");
      if (!response.ok) throw new Error("tuile " + response.status);
      return response.blob().then(decode);
    });
  }

  /**
   * Peint une photo dans un canvas, tuile par tuile.
   * Les tuiles sont chargées par petits paquets : la photo apparaît
   * progressivement au lieu de faire attendre devant un cadre vide.
   */
  function paint(canvas, photo, level) {
    var cols = level === LEVEL_PREVIEW ? PREVIEW_COLS : photo.cols;
    var rows = level === LEVEL_PREVIEW ? PREVIEW_ROWS : photo.rows;
    var width = level === LEVEL_PREVIEW ? photo.previewWidth || photo.width : photo.width;
    var height = level === LEVEL_PREVIEW ? photo.previewHeight || photo.height : photo.height;

    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#efe6db";
    ctx.fillRect(0, 0, width, height);

    var queue = [];
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) queue.push([col, row]);
    }

    var failed = false;
    function next() {
      var job = queue.shift();
      if (!job) return Promise.resolve();
      var col = job[0];
      var row = job[1];
      return fetchTile(photo.id, level, col, row)
        .then(function (bitmap) {
          var rect = tileRect(width, height, cols, rows, col, row);
          ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
          if (bitmap.close) bitmap.close();
        })
        .catch(function (err) {
          if (err.message === "session") {
            failed = true;
            queue.length = 0;
            sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
          }
        })
        .then(next);
    }

    var workers = [];
    for (var i = 0; i < PARALLEL_TILES; i++) workers.push(next());
    return Promise.all(workers).then(function () {
      return !failed;
    });
  }

  /* ---------- Grille ---------- */

  function buildGrid() {
    el.grid.innerHTML = "";
    state.photos.forEach(function (photo, index) {
      var figure = document.createElement("figure");
      figure.className = "gp-item";
      var ratio = (photo.height / photo.width) * 100;
      figure.style.setProperty("--ratio", ratio.toFixed(3) + "%");

      var canvas = document.createElement("canvas");
      canvas.className = "gp-canvas";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Photo " + (index + 1) + " sur " + state.photos.length);
      figure.appendChild(canvas);

      var button = document.createElement("button");
      button.type = "button";
      button.className = "gp-open";
      button.setAttribute("aria-label", "Agrandir la photo " + (index + 1));
      button.addEventListener("click", function () {
        openViewer(index);
      });
      figure.appendChild(button);

      el.grid.appendChild(figure);
      paint(canvas, photo, LEVEL_PREVIEW);
    });
  }

  /* ---------- Visionneuse ---------- */

  function openViewer(index) {
    if (index < 0 || index >= state.photos.length) return;
    state.current = index;
    var photo = state.photos[index];

    el.viewer.hidden = false;
    document.body.classList.add("gp-locked");
    el.counter.textContent = index + 1 + " / " + state.photos.length;
    el.prev.disabled = index === 0;
    el.next.disabled = index === state.photos.length - 1;
    el.closeBtn.focus();

    var canvas = el.viewerCanvas;
    canvas.style.aspectRatio = photo.width + " / " + photo.height;
    paint(canvas, photo, LEVEL_FULL);
    logEvent("view", photo.id);
  }

  function closeViewer() {
    el.viewer.hidden = true;
    document.body.classList.remove("gp-locked");
    state.current = -1;
  }

  function step(delta) {
    var target = state.current + delta;
    if (target >= 0 && target < state.photos.length) openViewer(target);
  }

  /* ---------- Voile de dissuasion ---------- */

  var veilTimer = null;

  // Masquer les photos dès que l'attention quitte la page : la plupart des
  // outils de capture prennent le focus, et un raccourci de capture se voit.
  // Ce n'est pas un blocage — c'est un rappel, et une trace dans le journal.
  function veil(reason) {
    el.veil.hidden = false;
    document.body.classList.add("gp-veiled");
    if (reason) logEvent(reason === "print" ? "print" : "capture_suspected", reason);
    clearTimeout(veilTimer);
  }

  function unveil() {
    clearTimeout(veilTimer);
    veilTimer = setTimeout(function () {
      el.veil.hidden = true;
      document.body.classList.remove("gp-veiled");
    }, 220);
  }

  // Meilleur effort : remplacer le presse-papiers juste après une capture.
  // Ne fonctionne pas partout, et ne touche que ce qui vient d'y être mis
  // depuis cette page. Désactivable via GALERIE_CONFIG.clipboardGuard.
  function poisonClipboard() {
    if (!CLIPBOARD_GUARD || !navigator.clipboard || !window.ClipboardItem) return;
    try {
      var canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#2b2521";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f7f2ec";
      ctx.font = "600 42px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Photographies protégées", canvas.width / 2, 290);
      ctx.font = "300 28px Helvetica, Arial, sans-serif";
      ctx.fillText("Merci de ne pas les copier.", canvas.width / 2, 350);
      canvas.toBlob(function (blob) {
        if (!blob) return;
        navigator.clipboard
          .write([new window.ClipboardItem({ "image/png": blob })])
          .catch(function () {});
      });
    } catch (err) {
      /* sans conséquence : ce garde-fou est facultatif */
    }
  }

  function installGuards() {
    ["contextmenu", "dragstart", "selectstart"].forEach(function (type) {
      document.addEventListener(type, function (event) {
        event.preventDefault();
      });
    });

    document.addEventListener("copy", function (event) {
      event.preventDefault();
    });

    // Sur Windows, « Impr. écran » ne déclenche souvent que keyup : on écoute
    // les deux. Sur macOS, la capture passe par Cmd + Maj + 3/4/5.
    function onKey(event) {
      var key = event.key;
      var meta = event.metaKey || event.ctrlKey;

      if (key === "PrintScreen" || key === "Snapshot") {
        veil("impr-ecran");
        poisonClipboard();
        return;
      }
      if (event.metaKey && event.shiftKey && ["3", "4", "5", "6"].indexOf(key) !== -1) {
        veil("capture-macos");
        return;
      }
      if (meta && (key === "s" || key === "S")) {
        event.preventDefault();
        veil("enregistrer");
        return;
      }
      if (meta && (key === "p" || key === "P")) {
        event.preventDefault();
        veil("print");
        return;
      }
      if (key === "F12" || (meta && event.shiftKey && ["I", "J", "C"].indexOf(key.toUpperCase()) !== -1)) {
        logEvent("devtools", key);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);

    window.addEventListener("blur", function () {
      veil("perte-focus");
    });
    window.addEventListener("focus", unveil);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) veil("onglet-masque");
      else unveil();
    });

    // Impression : la feuille de style dédiée vide la page, on double d'un voile.
    if (window.matchMedia) {
      var printQuery = window.matchMedia("print");
      if (printQuery.addEventListener) {
        printQuery.addEventListener("change", function (event) {
          if (event.matches) veil("print");
        });
      }
    }

    // Navigation clavier de la visionneuse.
    document.addEventListener("keydown", function (event) {
      if (el.viewer.hidden) return;
      if (event.key === "Escape") closeViewer();
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
    });

    // Balayage tactile.
    var startX = null;
    el.viewer.addEventListener("touchstart", function (event) {
      startX = event.touches[0].clientX;
    }, { passive: true });
    el.viewer.addEventListener("touchend", function (event) {
      if (startX === null) return;
      var delta = event.changedTouches[0].clientX - startX;
      if (Math.abs(delta) > 50) step(delta < 0 ? 1 : -1);
      startX = null;
    }, { passive: true });
  }

  /* ---------- Ouverture de session ---------- */

  function show(node) {
    node.hidden = false;
  }
  function hide(node) {
    node.hidden = true;
  }

  function login(password) {
    el.error.hidden = true;
    el.submit.disabled = true;
    el.submit.textContent = "Ouverture…";

    return fetch(apiUrl("/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: password }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data.error || "Accès refusé");
        state.token = result.data.token;
        state.gallery = result.data.gallery;
        state.photos = result.data.photos;

        el.title.textContent = state.gallery.title;
        el.subtitle.textContent = state.gallery.clientName
          ? "Galerie de " + state.gallery.clientName
          : "";
        if (state.gallery.expiresAt) {
          var date = new Date(state.gallery.expiresAt * 1000);
          el.expiry.textContent =
            "Accès valable jusqu'au " +
            date.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" });
          el.expiry.hidden = false;
        }

        hide(el.login);
        show(el.gallery);
        if (state.photos.length === 0) {
          el.empty.hidden = false;
        } else {
          buildGrid();
        }

        // La session expire : on prévient avant que les tuiles cessent d'arriver.
        setTimeout(function () {
          if (state.token) sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
        }, Math.max(60, (result.data.expiresIn || 7200) - 30) * 1000);
      })
      .catch(function (err) {
        el.error.textContent = err.message || "Accès refusé";
        el.error.hidden = false;
      })
      .then(function () {
        el.submit.disabled = false;
        el.submit.textContent = "Voir mes photos";
      });
  }

  /* ---------- Démarrage ---------- */

  function readSlug() {
    var params = new URLSearchParams(window.location.search);
    var slug = params.get("g") || window.location.hash.replace(/^#/, "");
    return slug ? slug.toLowerCase().replace(/[^a-z0-9-]/g, "") : "";
  }

  function init() {
    el = {
      login: $("gp-login"),
      gallery: $("gp-gallery"),
      form: $("gp-form"),
      password: $("gp-password"),
      submit: $("gp-submit"),
      error: $("gp-error"),
      title: $("gp-title"),
      subtitle: $("gp-subtitle"),
      expiry: $("gp-expiry"),
      grid: $("gp-grid"),
      empty: $("gp-empty"),
      viewer: $("gp-viewer"),
      viewerCanvas: $("gp-viewer-canvas"),
      counter: $("gp-counter"),
      prev: $("gp-prev"),
      next: $("gp-next"),
      closeBtn: $("gp-close"),
      veil: $("gp-veil"),
      missing: $("gp-missing"),
    };

    state.slug = readSlug();
    if (!API) {
      el.error.textContent = "Configuration manquante : renseignez GALERIE_CONFIG.api.";
      el.error.hidden = false;
      el.submit.disabled = true;
      return;
    }
    if (!state.slug) {
      hide(el.login);
      show(el.missing);
      return;
    }

    el.form.addEventListener("submit", function (event) {
      event.preventDefault();
      login(el.password.value);
    });
    el.prev.addEventListener("click", function () {
      step(-1);
    });
    el.next.addEventListener("click", function () {
      step(1);
    });
    el.closeBtn.addEventListener("click", closeViewer);
    el.viewer.addEventListener("click", function (event) {
      if (event.target === el.viewer) closeViewer();
    });

    installGuards();
    el.password.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
