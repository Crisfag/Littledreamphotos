// Page de réservation seule d'un studio (reserver.html) : pour le
// photographe qui n'a pas de mini-site, ou qui partage son agenda depuis son
// propre site (lien, bouton, ou agenda intégré : « &integre=1 », voir
// reserver-integre.js). Le parcours lui-même est celui du mini-site
// (booking-flow.js) ; cette page ajoute l'en-tête du studio et, intégrée,
// transmet sa hauteur à la page qui l'accueille.
(function () {
  "use strict";

  var CONFIG = window.PORTFOLIO_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/+$/, "");
  var params = new URLSearchParams(location.search);
  var handle = String(CONFIG.handle || params.get("s") || "").trim().toLowerCase();
  var embedded = params.get("integre") === "1";
  var studio = null;

  function $(id) { return document.getElementById(id); }

  function showMissing() {
    $("pf-loading").hidden = true;
    $("pf-page").hidden = true;
    $("pf-missing").hidden = false;
    postHeight();
  }

  function safeLink(url) {
    return /^https?:\/\//i.test(String(url || "")) ? url : "";
  }

  function paintStudio(info) {
    if (!info) return;
    studio = info;
    $("pf-resa-studio").textContent = info.name;
    document.title = "Réserver une séance — " + info.name;
    $("pf-resa-city").textContent = info.city || "";
    $("pf-resa-city").hidden = !info.city;
    var website = safeLink(info.website);
    var site = $("pf-resa-website");
    site.hidden = !website;
    if (website) { site.href = website; site.textContent = "Retour au site"; }
    var mini = safeLink(info.miniSite);
    var portfolio = $("pf-resa-portfolio");
    portfolio.hidden = !mini;
    if (mini) portfolio.href = mini;
    // Intégrée, la page sort vers le site hôte, jamais dans le cadre.
    [site, portfolio].forEach(function (a) { a.target = embedded ? "_top" : "_self"; });
    var contact = $("pf-resa-contact");
    contact.textContent = info.phone ? "Une question ? Appelez " + info.name + " au " + info.phone + "." : "";
    contact.hidden = !info.phone;
    document.querySelectorAll(".pf-bk-studio").forEach(function (n) { n.textContent = info.name; });
  }

  function showPage() {
    $("pf-loading").hidden = true;
    $("pf-missing").hidden = true;
    $("pf-page").hidden = false;
    postHeight();
  }

  /* ---------- Intégration : hauteur transmise à la page hôte ---------- */

  var lastHeight = 0;
  function postHeight() {
    if (!embedded || window.parent === window) return;
    var height = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    window.parent.postMessage({ type: "holypixx-reservation-height", height: height }, "*");
  }
  if (embedded) {
    if (window.ResizeObserver) new ResizeObserver(postHeight).observe(document.body);
    window.addEventListener("load", postHeight);
  }

  // Intégrée : Stripe refuse de s'afficher dans un cadre. Le paiement
  // s'ouvre dans toute la fenêtre ; si le navigateur l'interdit, un bouton
  // le propose (un clic du client l'autorise toujours).
  function openPayment(url) {
    try {
      window.top.location.href = url;
      return;
    } catch (err) {
      /* navigation de la page hôte refusée : bouton ci-dessous */
    }
    var error = $("pf-bk-error");
    error.textContent = "";
    var link = document.createElement("a");
    link.href = url;
    link.target = "_top";
    link.className = "pf-btn";
    link.textContent = "Payer l'acompte";
    error.appendChild(document.createTextNode("Dernière étape : le paiement s'ouvre dans une nouvelle page. "));
    error.appendChild(link);
    error.hidden = false;
    postHeight();
  }

  /* ---------- Démarrage ---------- */

  if (!handle || !API || !window.HolypixxBooking) {
    showMissing();
    return;
  }

  var flow = window.HolypixxBooking.create({
    api: API,
    handle: handle,
    page: true,
    // Retour de Stripe : la page seule, en pleine fenêtre (jamais intégrée).
    basePath: function () { return location.pathname + (CONFIG.handle ? "" : "?s=" + encodeURIComponent(handle)); },
    studioName: function () { return studio && studio.name; },
    onData: function (json) {
      if (json.studio) paintStudio(json.studio);
    },
    onAvailable: function () { showPage(); },
    openPayment: embedded ? openPayment : null,
  });

  function start(loaded) {
    if (studio) {
      showPage();
      // Aucun créneau ouvert : un mot, plutôt qu'une page vide.
      if (!loaded) {
        $("reserver").hidden = false;
        $("pf-bk-flow").hidden = true;
        $("pf-resa-empty").hidden = false;
      }
      postHeight();
    } else {
      showMissing();
    }
  }

  if (params.get("reservation")) {
    // Retour de Stripe : le résultat, et l'en-tête du studio.
    fetch(API + "/api/booking/" + encodeURIComponent(handle) + "?page=1")
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (json) {
        paintStudio(json.studio);
        if (studio) showPage(); else showMissing();
        flow.handleReturn();
      })
      .catch(showMissing);
  } else {
    flow.load().then(start, showMissing);
  }
})();
