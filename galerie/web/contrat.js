// Devis et contrat à signer : lit le document au Worker grâce au lien
// secret (?t=…), l'affiche, recueille la signature (case d'acceptation +
// nom tapé), envoie vers le paiement de l'acompte s'il y en a un, et gère
// le retour de Stripe.
(function () {
  "use strict";

  var CONFIG = window.CONTRACT_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/+$/, "");
  var params = new URLSearchParams(location.search);
  var token = params.get("t") || "";
  var contract = null;

  function $(id) { return document.getElementById(id); }
  function euros(cents) {
    return ((cents || 0) / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function day(ts) {
    return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
  }
  function moment(ts) {
    return new Date(ts * 1000).toLocaleString("fr-BE", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  }
  function endpoint(path) {
    return API + "/api/contract/" + encodeURIComponent(token) + (path || "");
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
    var el = $("ct-banner");
    el.textContent = text;
    el.className = "ct-banner" + (tone ? " ct-banner-" + tone : "");
    el.hidden = !text;
  }

  function render() {
    var c = contract;
    document.title = c.title + " — " + c.studioName;
    $("ct-studio").textContent = c.studioName;
    $("ct-title").textContent = c.title;
    $("ct-meta").textContent = "Devis et contrat n° " + c.number + (c.validUntil ? " · valable jusqu'au " + day(c.validUntil) : "");
    $("ct-seller").textContent = c.studioName;
    $("ct-seller-email").textContent = c.studioEmail || "";
    $("ct-client").textContent = c.clientName;
    $("ct-client-email").textContent = c.clientEmail;
    if (c.sessionDate) { $("ct-session").textContent = "Date prévue : " + c.sessionDate; $("ct-session").hidden = false; }

    var body = $("ct-lines");
    body.textContent = "";
    c.lines.forEach(function (line) {
      var tr = document.createElement("tr");
      var label = document.createElement("td");
      label.textContent = line.label;
      var amount = document.createElement("td");
      amount.className = "ct-num";
      amount.textContent = euros(line.amountCents);
      tr.appendChild(label);
      tr.appendChild(amount);
      body.appendChild(tr);
    });
    $("ct-total").textContent = euros(c.totalCents);
    if (c.depositCents) { $("ct-deposit").textContent = euros(c.depositCents); $("ct-deposit-row").hidden = false; }
    $("ct-terms").textContent = c.terms;

    var signable = (c.status === "sent" || c.status === "viewed") && !c.expired;
    $("ct-sign").hidden = !signable;
    $("ct-sign-submit").textContent = c.depositOnline ? "Signer et régler l'acompte (" + euros(c.depositCents) + ")" : "Signer le contrat";

    var signed = c.status === "signed" || c.status === "paid";
    $("ct-done").hidden = !signed;
    if (signed) {
      $("ct-done-text").textContent = "Signé électroniquement par " + c.signerName + " le " + moment(c.signedAt) + "." +
        (c.paidAt ? " Acompte de " + euros(c.depositCents) + " réglé le " + day(c.paidAt) + "." : "");
      $("ct-pdf").href = endpoint("/pdf");
      $("ct-pay").hidden = !c.depositDue;
      $("ct-pay").textContent = "Régler l'acompte (" + euros(c.depositCents) + ")";
    }

    if (c.status === "paid") banner("Contrat signé et acompte reçu : votre réservation est confirmée.", "ok");
    else if (c.status === "signed") banner(c.depositDue ? "Contrat signé. Il reste à régler l'acompte pour confirmer la réservation." : "Contrat signé : merci !", c.depositDue ? "warn" : "ok");
    else if (c.status === "declined") banner("Vous avez refusé ce devis. Le photographe en a été prévenu.", "");
    else if (c.status === "cancelled") banner("Ce devis a été retiré par le photographe.", "alert");
    else if (c.expired) banner("Ce devis a expiré : demandez-en un nouveau au photographe.", "alert");
    else banner("", "");
  }

  async function pay(button) {
    button.disabled = true;
    try {
      var data = await call("POST", "/pay", { returnUrl: location.origin + location.pathname });
      if (data.url) location.href = data.url;
    } catch (err) {
      banner(err.message, "alert");
      button.disabled = false;
    }
  }

  $("ct-sign-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = $("ct-sign-error");
    var signerName = form.elements.signerName.value.trim();
    var problem = !form.elements.accept.checked ? "Cochez la case pour accepter le devis et les conditions."
      : signerName.length < 3 ? "Tapez votre nom complet pour signer."
      : "";
    if (problem) { error.textContent = problem; error.hidden = false; return; }
    error.hidden = true;
    var submit = $("ct-sign-submit");
    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Signature…";
    try {
      var data = await call("POST", "/sign", { accept: true, signerName: signerName, returnUrl: location.origin + location.pathname });
      contract = data.contract;
      if (data.url) { location.href = data.url; return; }
      render();
      if (data.paymentError) banner("Contrat signé. " + data.paymentError + " Vous pourrez régler l'acompte depuis ce même lien.", "warn");
      $("ct-done").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  $("ct-pay").addEventListener("click", function () { pay($("ct-pay")); });
  $("ct-decline-open").addEventListener("click", function () { $("ct-decline-form").hidden = false; $("ct-decline-form").elements.reason.focus(); });
  $("ct-decline-cancel").addEventListener("click", function () { $("ct-decline-form").hidden = true; });
  $("ct-decline-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    try {
      var data = await call("POST", "/decline", { reason: e.currentTarget.elements.reason.value });
      contract = data.contract;
      render();
    } catch (err) {
      banner(err.message, "alert");
    }
  });

  function showMissing() {
    $("ct-loading").hidden = true;
    $("ct-missing").hidden = false;
  }

  if (!token || !API) { showMissing(); return; }
  var returning = params.get("paye") === "1" ? params.get("session_id") || "" : "";
  // Le lien secret reste dans l'adresse ; les paramètres de retour de Stripe, non.
  if (params.get("paye") || params.get("session_id")) history.replaceState(null, "", location.pathname + "?t=" + encodeURIComponent(token));
  (returning ? call("POST", "/sync", { sessionId: returning }) : call("GET", ""))
    .then(function (data) {
      contract = data.contract;
      $("ct-loading").hidden = true;
      $("ct-page").hidden = false;
      render();
    })
    .catch(showMissing);
})();
