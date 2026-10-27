// Page privée d'un bon cadeau : lit le bon au Worker d'après son code (dans
// l'adresse « ?c=… » du QR code, ou saisi à la main) et le met en page :
// pour qui, de la part de qui, le petit mot, la séance offerte, comment en
// profiter, le QR code et le PDF à imprimer.
(function () {
  "use strict";

  var CONFIG = window.GIFT_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/+$/, "");

  function $(id) { return document.getElementById(id); }

  function normalize(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  }

  function euros(cents) {
    return (cents / 100).toLocaleString("fr-BE", { style: "currency", currency: "EUR" });
  }

  function longDate(ts) {
    return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
  }

  function duration(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (!h) return m + " min";
    return m ? h + " h " + String(m).padStart(2, "0") : h + " h";
  }

  function show(id) {
    ["gc-loading", "gc-enter", "gc-card"].forEach(function (key) { $(key).hidden = key !== id; });
  }

  function showError(text) {
    show("gc-enter");
    $("gc-error").textContent = text;
    $("gc-error").hidden = !text;
  }

  var STATUS = {
    valid: function (v) { return "Valable jusqu'au " + longDate(v.validUntil); },
    redeemed: function (v) { return v.redeemedAt ? "Utilisé le " + longDate(v.redeemedAt) : "Déjà utilisé"; },
    expired: function (v) { return "Périmé depuis le " + longDate(v.validUntil); },
    cancelled: function () { return "Ce bon a été annulé"; },
  };

  function fact(list, label, value) {
    var row = document.createElement("div");
    var dt = document.createElement("dt");
    var dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.appendChild(dt);
    row.appendChild(dd);
    list.appendChild(row);
  }

  function render(v, code) {
    document.title = "Bon cadeau pour " + v.toName + " — " + v.studioName;
    $("gc-studio").textContent = v.studioName;
    $("gc-status").textContent = (STATUS[v.status] || STATUS.valid)(v);
    $("gc-status").setAttribute("data-status", v.status);
    $("gc-to").textContent = v.toName;
    $("gc-from").innerHTML = "";
    if (v.fromName) {
      $("gc-from").appendChild(document.createTextNode("De la part de "));
      var who = document.createElement("strong");
      who.textContent = v.fromName;
      $("gc-from").appendChild(who);
    }
    $("gc-message").textContent = v.message || "";
    $("gc-message").hidden = !v.message;

    if (v.hasImage) {
      $("gc-image").src = API + "/api/gift/" + encodeURIComponent(code) + "/image";
      $("gc-image").alt = v.offerTitle;
      $("gc-image").addEventListener("error", function () { $("gc-figure").hidden = true; });
      $("gc-figure").hidden = false;
    }

    $("gc-gift-title").textContent = v.offerTitle || "Une séance photo, au choix";
    $("gc-description").textContent = v.description || "";
    $("gc-description").hidden = !v.description;
    var facts = $("gc-facts");
    facts.innerHTML = "";
    if (v.durationMin) fact(facts, "Durée", duration(v.durationMin));
    if (v.tierPhotos) fact(facts, "Photos", v.tierPhotos + (v.tierLabel ? " · " + v.tierLabel : ""));
    else if (v.tierLabel) fact(facts, "Forfait", v.tierLabel);
    fact(facts, "Valeur", euros(v.amountCents));
    fact(facts, "Valable jusqu'au", longDate(v.validUntil));
    var included = String(v.included || "").split(/\n+/).map(function (l) { return l.replace(/^[-•*·\s]+/, "").trim(); }).filter(Boolean);
    $("gc-included-list").innerHTML = "";
    included.forEach(function (line) {
      var li = document.createElement("li");
      li.textContent = line;
      $("gc-included-list").appendChild(li);
    });
    $("gc-included").hidden = !included.length;

    $("gc-use-lede").textContent = v.status === "valid"
      ? "Contactez " + v.studioName + " pour convenir de votre séance, en indiquant le code de votre bon."
      : "Une question sur ce bon ? Contactez " + v.studioName + ".";
    var contact = $("gc-contact");
    contact.innerHTML = "";
    if (v.studioEmail) {
      var mail = document.createElement("a");
      mail.href = "mailto:" + v.studioEmail + "?subject=" + encodeURIComponent("Mon bon cadeau " + v.code);
      mail.textContent = v.studioEmail;
      contact.appendChild(document.createElement("li")).appendChild(mail);
    }
    if (v.studioPhone) {
      var tel = document.createElement("a");
      tel.href = "tel:" + v.studioPhone.replace(/\s+/g, "");
      tel.textContent = v.studioPhone;
      contact.appendChild(document.createElement("li")).appendChild(tel);
    }
    $("gc-book").hidden = !(v.siteUrl && v.status === "valid");
    if (v.siteUrl) $("gc-book").href = v.siteUrl + "#reserver";
    $("gc-pdf").href = API + "/api/gift/" + encodeURIComponent(code) + "/pdf";

    var qr = $("gc-qr");
    qr.setAttribute("viewBox", "0 0 " + v.qr.size + " " + v.qr.size);
    qr.innerHTML = '<path fill="#1f1915" d="' + v.qr.path + '"/>';
    $("gc-code-text").textContent = v.code;
    $("gc-terms").textContent = v.terms || "";
    $("gc-terms").hidden = !v.terms;
    show("gc-card");
  }

  function load(code) {
    show("gc-loading");
    fetch(API + "/api/gift/" + encodeURIComponent(code), { cache: "no-store" })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (!r.ok || !r.body.voucher) return showError(r.body.error || "Ce bon cadeau est introuvable.");
        render(r.body.voucher, code);
      })
      .catch(function () { showError("Connexion impossible. Vérifiez votre réseau et réessayez."); });
  }

  $("gc-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = normalize($("gc-code").value);
    if (code.length !== 8) return showError("Le code compte 8 caractères, par exemple ABCD-2345.");
    $("gc-error").hidden = true;
    history.replaceState(null, "", location.pathname + "?c=" + code);
    load(code);
  });
  $("gc-print").addEventListener("click", function () { window.print(); });

  var initial = normalize(new URLSearchParams(location.search).get("c"));
  if (initial) load(initial);
  else show("gc-enter");
})();
