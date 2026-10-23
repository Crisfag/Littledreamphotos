/* =====================================================================
   Holypixx — mesure du parcours d'inscription (voir worker/src/funnel.js).
   Compte, sans cookie ni donnée personnelle : une visite par session (sur
   la page d'arrivée) et chaque clic « Créer un compte ». La page et la
   source (Google, Instagram, accès direct…) suivent le lien d'inscription
   pour être gardées sur le compte créé.
   À charger après home.js / guide.js, qui posent les liens d'inscription.
   ===================================================================== */
(function () {
  "use strict";

  var config = window.HOME_CONFIG || {};
  var api = String(config.api || "").replace(/\/+$/, "");
  var KEY = "holypixx-arrivee";

  var PAGES = {
    "/": "accueil", "/index": "accueil", "/en": "accueil-en", "/en/index": "accueil-en",
    "/galerie-photo-mariage": "mariage", "/contrat-photographe": "contrat", "/proteger-ses-photos": "proteger",
    "/fideliser-clients-photographe": "fideliser", "/reservation-seance-photo": "reservation",
  };
  function pageOf(path) {
    var clean = path.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
    return PAGES[clean] || "";
  }

  var SOURCES = [
    [/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/duckduckgo\.com$/, "duckduckgo"],
    [/ecosia\.org$/, "ecosia"], [/qwant\.com$/, "qwant"], [/yahoo\./, "yahoo"],
    [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"], [/instagram\.com$/, "instagram"],
    [/(linkedin\.com|lnkd\.in)$/, "linkedin"], [/pinterest\./, "pinterest"],
    [/(youtube\.com|youtu\.be)$/, "youtube"], [/tiktok\.com$/, "tiktok"],
    [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"], [/(chatgpt\.com|openai\.com)$/, "chatgpt"],
    [/perplexity\.ai$/, "perplexity"], [/claude\.ai$/, "claude"],
  ];
  function sourceOf() {
    var utm = /[?&]utm_source=([^&#]+)/.exec(location.search);
    if (utm) {
      var name = utm[1];
      try { name = decodeURIComponent(name); } catch (err) { /* valeur mal encodée : gardée telle quelle */ }
      return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 30);
    }
    var host = "";
    try { host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ""; } catch (err) { host = ""; }
    if (!host) return "direct";
    if (host === location.hostname || /(^|\.)holypixx\.com$/.test(host)) return "";
    for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i][0].test(host)) return SOURCES[i][1];
    return "autre-site";
  }

  var page = pageOf(location.pathname);
  var source = sourceOf();

  // Première page de la session : sa source vaut pour toute la visite.
  var arrival = null;
  try { arrival = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (err) { arrival = null; }
  var firstPage = !arrival;
  if (!arrival || (source && source !== "direct" && source !== arrival.source)) {
    arrival = { source: source || "direct", page: page };
    try { sessionStorage.setItem(KEY, JSON.stringify(arrival)); } catch (err) { /* navigation privée : pas de session */ }
  }

  function send(step) {
    if (!api || navigator.webdriver) return;
    var body = JSON.stringify({ step: step, page: page, source: arrival.source });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(api + "/api/public/funnel", new Blob([body], { type: "text/plain" }))) return;
    } catch (err) { /* repli ci-dessous */ }
    if (window.fetch) {
      fetch(api + "/api/public/funnel", { method: "POST", body: body, mode: "no-cors", keepalive: true, headers: { "content-type": "text/plain" } })
        .catch(function () { /* mesure perdue, sans conséquence */ });
    }
  }

  if (firstPage) send("visit");

  // Liens d'inscription : la page et la source suivent jusqu'au compte créé.
  var extra = "from=" + encodeURIComponent(page) + "&src=" + encodeURIComponent(arrival.source);
  document.querySelectorAll("[data-signup]").forEach(function (a) {
    var href = a.getAttribute("href") || "";
    if (href.indexOf("#/inscription") === -1 || /[?&]src=/.test(href)) return;
    a.setAttribute("href", href + (href.indexOf("#/inscription?") === -1 ? "?" : "&") + extra);
    a.addEventListener("click", function () { send("signup_click"); });
  });
})();
