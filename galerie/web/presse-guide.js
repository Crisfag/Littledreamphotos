/* =====================================================================
   Holypixx — guide « Salle de presse pour photographes » : le générateur.
   À partir de l'événement, du crédit et de l'usage autorisé, il rédige le
   crédit à imposer, une légende au format des rédactions et les
   conditions à joindre à un envoi presse. Rien n'est envoyé : les
   réglages restent dans le navigateur.
   ===================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("p-form");
  if (!form) return;
  var STORE = "holypixx-presse-guide";
  var FIELDS = ["event", "city", "date", "venue", "studio", "org", "use", "months", "territory", "embargo", "ai"];
  var out = { credit: document.getElementById("p-credit"), caption: document.getElementById("p-caption"), terms: document.getElementById("p-terms") };

  var USES = {
    editorial: {
      name: "usage éditorial",
      what: "presse écrite, sites d'information, réseaux sociaux des médias, télévision",
      limit: "Usage éditorial uniquement, pour l'information et la couverture de l'événement : aucune publicité, promotion commerciale ou association à une marque.",
    },
    communication: {
      name: "communication de l'organisateur",
      what: "site web, réseaux sociaux (publications non sponsorisées), newsletters, communication interne et rapports de l'organisateur",
      limit: "Usage limité à la communication de l'organisateur sur l'événement : pas de publicité payante ni de cession à un sponsor.",
    },
    advertising: {
      name: "publicité",
      what: "annonces, bannières, publicités sponsorisées sur les réseaux sociaux, affichage",
      limit: "Usage publicitaire limité aux photos marquées comme autorisées : les personnes reconnaissables doivent avoir donné leur accord.",
    },
  };

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dayLabel(value, upper) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
    var d = new Date(value + "T12:00:00");
    var text = d.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" });
    return upper ? text.toUpperCase() : text;
  }
  function momentLabel(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("fr-BE", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function values() {
    var f = form.elements;
    return {
      event: f.event.value.trim(), city: f.city.value.trim(), date: f.date.value, venue: f.venue.value.trim(),
      studio: f.studio.value.trim() || "Votre studio", org: f.org.value.trim(), use: f.use.value,
      months: Number(f.months.value) || 0, territory: f.territory.value, embargo: f.embargo.value, ai: f.ai.checked,
    };
  }

  function render() {
    var v = values();
    var credit = "© " + v.studio + (v.org ? " / " + v.org : "");
    out.credit.textContent = credit;

    var place = [v.city ? v.city.toUpperCase() : "", dayLabel(v.date, true)].filter(Boolean).join(", ");
    var where = [v.event, v.venue].filter(Boolean).join(", ");
    out.caption.textContent = (place ? place + " — " : "") + "[Ce qu'on voit sur la photo]" + (where ? ". " + where + "." : ".") + " " + credit;

    var use = USES[v.use] || USES.editorial;
    var lines = [];
    lines.push("Conditions d'utilisation — " + (v.event || "photographies de l'événement"));
    lines.push("");
    lines.push("Les photographies jointes sont l'œuvre de " + v.studio + ", qui en reste l'auteur et le titulaire des droits.");
    lines.push("Licence non exclusive et non transférable pour : " + use.what + ". Territoire : " + v.territory + ". Durée : " + (v.months ? v.months + " mois à compter de la réception" : "sans limite de durée") + ".");
    lines.push(use.limit);
    lines.push("Crédit obligatoire à côté de chaque photo publiée : « " + credit + " ».");
    var embargo = momentLabel(v.embargo);
    if (embargo) lines.push("Embargo : aucune publication avant le " + embargo + ".");
    lines.push("Interdits : la revente ou la cession à un tiers, la modification au-delà du recadrage et du redimensionnement" +
      (v.ai ? ", et l'utilisation pour l'entraînement de systèmes d'intelligence artificielle (réserve au sens de l'article 4, § 3, de la directive (UE) 2019/790)" : "") + ".");
    lines.push("Toute autre utilisation demande l'accord écrit préalable de " + v.studio + ".");
    out.terms.textContent = lines.join("\n");

    try {
      var saved = {};
      FIELDS.forEach(function (k) { saved[k] = form.elements[k].type === "checkbox" ? form.elements[k].checked : form.elements[k].value; });
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch (err) { /* stockage indisponible : sans conséquence */ }
  }

  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved) FIELDS.forEach(function (k) {
      if (!(k in saved) || !form.elements[k]) return;
      if (form.elements[k].type === "checkbox") form.elements[k].checked = Boolean(saved[k]);
      else form.elements[k].value = saved[k];
    });
  } catch (err) { /* rien */ }
  if (!form.elements.date.value) form.elements.date.value = today();

  form.addEventListener("input", render);
  form.addEventListener("change", render);
  form.addEventListener("submit", function (e) { e.preventDefault(); });

  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = document.getElementById(btn.getAttribute("data-copy")).textContent;
      var fallback = function () { window.prompt("Copiez ce texte :", text); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast("Copié dans le presse-papiers."); }).catch(fallback);
      else fallback();
    });
  });

  render();
})();
