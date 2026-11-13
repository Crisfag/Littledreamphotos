// Agenda Holypixx intégré au site d'un photographe. À coller dans sa page :
//
//   <div data-holypixx-reservation="mon-studio"></div>
//   <script src="https://www.holypixx.com/reserver-integre.js" async></script>
//
// Chaque bloc reçoit la page de réservation du studio (reserver.html,
// « &integre=1 ») dans un cadre qui prend la hauteur de son contenu : pas
// de barre de défilement en plus. Le paiement de l'acompte s'ouvre en
// pleine page (Stripe ne s'affiche pas dans un cadre).
(function () {
  "use strict";

  var script = document.currentScript;
  var origin = "https://www.holypixx.com";
  try {
    if (script && script.src) origin = new URL(script.src).origin;
  } catch (err) {
    /* adresse par défaut */
  }

  var frames = [];

  function mount(box) {
    if (box.getAttribute("data-holypixx-ready")) return;
    var handle = String(box.getAttribute("data-holypixx-reservation") || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) return;
    box.setAttribute("data-holypixx-ready", "1");
    var frame = document.createElement("iframe");
    frame.src = origin + "/reserver.html?s=" + encodeURIComponent(handle) + "&integre=1";
    frame.title = box.getAttribute("data-titre") || "Réserver une séance";
    frame.loading = "lazy";
    frame.setAttribute("scrolling", "no");
    frame.style.cssText = "display:block;width:100%;min-height:560px;height:560px;border:0;background:transparent;color-scheme:normal;";
    box.appendChild(frame);
    frames.push(frame);
  }

  function mountAll() {
    var boxes = document.querySelectorAll("[data-holypixx-reservation]");
    for (var i = 0; i < boxes.length; i++) mount(boxes[i]);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    var data = event.data || {};
    if (data.type !== "holypixx-reservation-height") return;
    var height = Math.max(320, Math.min(20000, Math.round(Number(data.height) || 0)));
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) frames[i].style.height = height + "px";
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
})();
