// Facture libre envoyée au client : lit la facture au Worker grâce au lien
// secret (?t=…), l'affiche (lignes, TVA, échéancier), propose de régler
// l'échéance suivante en ligne, et gère le retour de Stripe.
(function () {
  "use strict";

  var CONFIG = window.INVOICE_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/+$/, "");
  var params = new URLSearchParams(location.search);
  var token = params.get("t") || "";
  var invoice = null;

  function $(id) { return document.getElementById(id); }
  function euros(cents) {
    return ((cents || 0) / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function dayText(day) {
    return day ? new Date(day + "T12:00:00Z").toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  }
  function tsText(ts) {
    return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
  }
  function today() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
  }
  function endpoint(path) {
    return API + "/api/invoice/" + encodeURIComponent(token) + (path || "");
  }
  async function call(method, path, body) {
    var res = await fetch(endpoint(path), {
      method: method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Le service ne répond pas. Réessayez dans un instant.");
    return data;
  }
  function banner(text, tone) {
    var el = $("fa-banner");
    el.textContent = text;
    el.className = "ct-banner" + (tone ? " ct-banner-" + tone : "");
    el.hidden = !text;
  }
  function lines(target, values) {
    target.textContent = "";
    values.filter(Boolean).forEach(function (v, i) {
      if (i) target.appendChild(document.createElement("br"));
      target.appendChild(document.createTextNode(v));
    });
  }
  function cell(tr, value, numeric) {
    var td = document.createElement("td");
    td.textContent = value;
    if (numeric) td.className = "ct-num";
    tr.appendChild(td);
  }

  function render() {
    var f = invoice;
    var credit = f.kind === "credit";
    document.title = (credit ? "Note de crédit " : "Facture ") + f.number + " — " + f.seller.name;
    $("fa-studio").textContent = f.seller.name;
    $("fa-title").textContent = f.title || (credit ? "Note de crédit" : "Facture");
    $("fa-meta").textContent = (credit ? "Note de crédit n° " : "Facture n° ") + f.number + " · émise le " + tsText(f.issuedAt);
    $("fa-seller").textContent = f.seller.name;
    lines($("fa-seller-lines"), String(f.seller.address || "").split("\n").concat([f.seller.vat ? "TVA " + f.seller.vat : "", f.seller.email]));
    $("fa-client").textContent = f.client.name || f.client.email;
    lines($("fa-client-lines"), String(f.client.address || "").split("\n").concat([f.client.vat ? "TVA " + f.client.vat : "", f.client.name ? f.client.email : ""]));

    var body = $("fa-lines");
    body.textContent = "";
    f.lines.forEach(function (l) {
      var tr = document.createElement("tr");
      var unit = credit ? -Math.abs(l.unitCents) : l.unitCents;
      cell(tr, l.description);
      cell(tr, String(l.quantity).replace(".", ","), true);
      cell(tr, euros(unit), true);
      cell(tr, l.vatRate + " %", true);
      cell(tr, euros(Math.round(l.quantity * unit)), true);
      body.appendChild(tr);
    });

    var totals = $("fa-totals");
    totals.textContent = "";
    function total(label, value, grand) {
      var dt = document.createElement("dt");
      var dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      if (grand) { dt.className = "fa-grand"; dd.className = "fa-grand"; }
      totals.appendChild(dt);
      totals.appendChild(dd);
    }
    total("Total HT", euros(f.netCents));
    f.breakdown.forEach(function (b) { if (b.rate) total("TVA " + b.rate + " %", euros(b.vatCents)); });
    total(credit ? "Total crédité" : "Total TTC", euros(f.totalCents), true);

    var list = $("fa-schedule");
    list.textContent = "";
    var now = today();
    f.schedule.forEach(function (s) {
      var li = document.createElement("li");
      var label = document.createElement("span");
      label.textContent = s.label + " — " + euros(s.amountCents);
      var state = document.createElement("span");
      state.className = "fa-state" + (s.paidAt ? " fa-state-paid" : s.dueDate < now ? " fa-state-late" : "");
      state.textContent = s.paidAt ? "Réglé le " + tsText(s.paidAt) : (s.dueDate < now ? "En retard · prévu le " : "À régler le ") + dayText(s.dueDate);
      li.appendChild(label);
      li.appendChild(state);
      list.appendChild(li);
    });
    $("fa-schedule-title").textContent = f.schedule.length > 1 ? "Échéancier" : "Paiement";
    $("fa-schedule-box").hidden = credit || !f.schedule.length;
    $("fa-notes").textContent = f.notes || "";
    $("fa-notes").hidden = !f.notes;
    $("fa-pdf").href = endpoint("/pdf");
    $("fa-pdf-top").href = endpoint("/pdf");

    var due = f.nextDue;
    if (credit) {
      banner("Cette note de crédit annule une facture précédente.", "");
    } else if (f.status === "credited") {
      banner("Cette facture a été annulée par une note de crédit : rien n'est à régler.", "");
    } else if (!due) {
      banner("Facture réglée, merci !", "ok");
    } else if (due.dueDate < now) {
      banner("L'échéance du " + dayText(due.dueDate) + " est dépassée.", "alert");
    }
    var payable = !credit && f.status !== "credited" && due;
    $("fa-pay-box").hidden = !payable;
    if (payable) {
      $("fa-due-text").textContent = (f.schedule.length > 1 ? due.label + " : " : "À régler : ") + euros(due.amountCents) + " pour le " + dayText(due.dueDate) + ".";
      $("fa-pay").hidden = !f.canPayOnline;
      $("fa-pay").textContent = "Régler " + euros(due.amountCents) + " en ligne";
      $("fa-iban").hidden = !f.seller.iban;
      $("fa-iban").textContent = f.seller.iban ? (f.canPayOnline ? "Ou par virement : " : "Par virement : ") + f.seller.iban + ", communication « facture " + f.number + " »." : "";
    }
    $("fa-loading").hidden = true;
    $("fa-page").hidden = false;
  }

  $("fa-pay").addEventListener("click", async function () {
    var btn = $("fa-pay");
    btn.disabled = true;
    $("fa-error").hidden = true;
    try {
      var result = await call("POST", "/pay", { index: invoice.nextDue.index, returnUrl: location.origin + location.pathname });
      location.href = result.url;
    } catch (err) {
      $("fa-error").textContent = err.message;
      $("fa-error").hidden = false;
      btn.disabled = false;
    }
  });

  function showMissing() {
    $("fa-loading").hidden = true;
    $("fa-missing").hidden = false;
  }

  function load() {
    return call("GET", "").then(function (data) { invoice = data.invoice; render(); });
  }

  if (!token || !API) return showMissing();
  var session = params.get("session_id");
  var start = session
    ? call("POST", "/sync", { sessionId: session }).catch(function () { return null; }).then(function () {
      history.replaceState(null, "", location.pathname + "?t=" + encodeURIComponent(token));
      return load().then(function () { if (!invoice.nextDue || invoice.paidCents) banner("Merci, votre paiement est bien reçu.", "ok"); });
    })
    : load();
  start.catch(showMissing);
})();
