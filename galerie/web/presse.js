// Salle de presse (presse.html) : la page ouverte par le lien personnel d'un
// destinataire (?t=…) — commanditaire, artiste, média, sponsor — ou la page
// d'accréditation d'un événement (?e=…). Voir worker/src/press.js.
(function () {
  "use strict";

  var CONFIG = window.PRESS_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/+$/, "");
  var params = new URLSearchParams(location.search);
  var TOKEN = params.get("t") || "";
  var EVENT = params.get("e") || "";
  var LANG_KEY = "holypixx-presse-langue";
  var lang = params.get("lang") || readStored() || (navigator.language || "fr").slice(0, 2);
  if (["fr", "en", "nl"].indexOf(lang) === -1) lang = "fr";
  var userPickedLang = Boolean(params.get("lang") || readStored());

  var D = {
    room: ["Salle de presse", "Press room", "Perskamer"],
    loading: ["Chargement…", "Loading…", "Laden…"],
    missingTitle: ["Lien incomplet", "Incomplete link", "Onvolledige link"],
    missing: ["Ouvrez le lien reçu par e-mail en entier, ou demandez-en un nouveau au studio.", "Open the full link from your email, or ask the studio for a new one.", "Open de volledige link uit je e-mail, of vraag de studio om een nieuwe."],
    errorTitle: ["Accès impossible", "Access unavailable", "Geen toegang"],
    role_client: ["Accès commanditaire", "Client access", "Toegang opdrachtgever"],
    role_validator: ["Accès artiste / management", "Artist / management access", "Toegang artiest / management"],
    role_press: ["Accès média", "Media access", "Toegang media"],
    role_sponsor: ["Accès sponsor", "Sponsor access", "Toegang sponsor"],
    role_partner: ["Accès partenaire", "Partner access", "Toegang partner"],
    credit: ["Crédit obligatoire", "Mandatory credit", "Verplichte vermelding"],
    copy: ["Copier", "Copy", "Kopiëren"],
    copied: ["Copié.", "Copied.", "Gekopieerd."],
    notOpenTitle: ["Les photos arrivent bientôt", "The photos are coming soon", "De foto's komen eraan"],
    notOpen: ["Le studio prépare la sélection. Vous recevrez un e-mail dès qu'elle sera disponible ; ce lien restera le même.", "The studio is preparing the selection. You will get an email as soon as it is available; this link stays the same.", "De studio bereidt de selectie voor. Je krijgt een e-mail zodra ze klaar is; deze link blijft dezelfde."],
    embargoTitle: ["Sous embargo", "Under embargo", "Onder embargo"],
    embargo: ["Les photos s'afficheront ici automatiquement le", "The photos will appear here automatically on", "De foto's verschijnen hier automatisch op"],
    days: ["jours", "days", "dagen"], hours: ["heures", "hours", "uur"], minutes: ["minutes", "minutes", "minuten"], seconds: ["secondes", "seconds", "seconden"],
    closedTitle: ["Salle de presse fermée", "Press room closed", "Perskamer gesloten"],
    closed: ["Le studio a fermé cette salle de presse : les téléchargements ne sont plus possibles. Votre licence reste valable pour les fichiers déjà téléchargés.", "The studio has closed this press room: downloads are no longer possible. Your licence remains valid for files already downloaded.", "De studio heeft deze perskamer gesloten: downloaden is niet meer mogelijk. Je licentie blijft geldig voor reeds gedownloade bestanden."],
    licenceTitle: ["Licence d'utilisation", "Usage licence", "Gebruikslicentie"],
    licenceIntro: ["Pour télécharger les fichiers haute définition, lisez et acceptez la licence ci-dessous. Elle précise les usages permis, le crédit et la durée.", "To download the high-resolution files, read and accept the licence below. It sets out the permitted uses, the credit and the term.", "Om de bestanden in hoge resolutie te downloaden, lees en aanvaard je de licentie hieronder. Ze vermeldt het toegestane gebruik, de vermelding en de duur."],
    licenceUpdated: ["Le studio a mis à jour la licence : relisez-la avant de télécharger à nouveau.", "The studio has updated the licence: read it again before downloading.", "De studio heeft de licentie bijgewerkt: lees ze opnieuw voor je opnieuw downloadt."],
    licenceExpired: ["Votre licence est arrivée à échéance : acceptez-la à nouveau pour télécharger.", "Your licence has expired: accept it again to download.", "Je licentie is verlopen: aanvaard ze opnieuw om te downloaden."],
    readLicence: ["Lire la licence", "Read the licence", "Lees de licentie"],
    hideLicence: ["Masquer la licence", "Hide the licence", "Licentie verbergen"],
    yourName: ["Votre nom", "Your name", "Je naam"],
    accept: ["J'ai lu cette licence et je l'accepte au nom de", "I have read this licence and accept it on behalf of", "Ik heb deze licentie gelezen en aanvaard ze namens"],
    acceptBtn: ["Accepter et accéder aux fichiers", "Accept and access the files", "Aanvaarden en naar de bestanden"],
    accepted: ["Licence acceptée le", "Licence accepted on", "Licentie aanvaard op"],
    by: ["par", "by", "door"],
    until: ["valable jusqu'au", "valid until", "geldig tot"],
    seeText: ["Voir le texte", "View the text", "Bekijk de tekst"],
    all: ["Toutes", "All", "Alle"],
    pending: ["À valider", "To approve", "Goed te keuren"],
    approved: ["Validées", "Approved", "Goedgekeurd"],
    rejected: ["Refusées", "Rejected", "Afgekeurd"],
    st_pending: ["À valider", "To approve", "Goed te keuren"],
    st_approved: ["Validée", "Approved", "Goedgekeurd"],
    st_rejected: ["Refusée", "Rejected", "Afgekeurd"],
    approve: ["Valider", "Approve", "Goedkeuren"],
    reject: ["Refuser", "Reject", "Afkeuren"],
    approveAll: ["Tout valider", "Approve all", "Alles goedkeuren"],
    approveAllConfirm: ["Valider toutes les photos encore à valider ?", "Approve all photos still awaiting approval?", "Alle nog goed te keuren foto's goedkeuren?"],
    rejectWhy: ["Motif du refus (facultatif, visible du studio) :", "Reason for rejection (optional, seen by the studio):", "Reden van afkeuring (optioneel, zichtbaar voor de studio):"],
    saved: ["Enregistré.", "Saved.", "Opgeslagen."],
    validateHint: ["Validez les photos qui peuvent être diffusées : les médias et sponsors ne verront que celles-là.", "Approve the photos that may be released: media and sponsors will only see those.", "Keur de foto's goed die verspreid mogen worden: media en sponsors zien alleen die."],
    download: ["Télécharger en HD", "Download HD", "Download in HD"],
    downloadAll: ["Tout télécharger (ZIP)", "Download all (ZIP)", "Alles downloaden (ZIP)"],
    parts: ["Le ZIP est découpé en plusieurs parties :", "The ZIP is split into several parts:", "De ZIP is opgesplitst in meerdere delen:"],
    part: ["Partie", "Part", "Deel"],
    preparing: ["Préparation du téléchargement…", "Preparing the download…", "Download wordt voorbereid…"],
    block_pending: ["En attente de validation", "Awaiting approval", "Wacht op goedkeuring"],
    block_rejected: ["Non diffusable", "Not for release", "Niet voor verspreiding"],
    block_rights: ["Usage éditorial seulement", "Editorial use only", "Alleen redactioneel gebruik"],
    block_nohd: ["Fichier HD bientôt disponible", "HD file coming soon", "HD-bestand binnenkort beschikbaar"],
    block_licence: ["Acceptez la licence pour télécharger", "Accept the licence to download", "Aanvaard de licentie om te downloaden"],
    copyCaption: ["Copier légende et crédit", "Copy caption and credit", "Bijschrift en vermelding kopiëren"],
    photo: ["Photo", "Photo", "Foto"],
    empty: ["Aucune photo ici pour l'instant.", "No photos here yet.", "Hier nog geen foto's."],
    photos: ["photos", "photos", "foto's"],
    footer: ["Photographies protégées par le droit d'auteur. Toute utilisation est soumise à la licence acceptée ; chaque fichier contient le crédit et la licence. Fouille de textes et de données et entraînement d'IA réservés (art. 4, § 3, directive (UE) 2019/790).", "Photographs protected by copyright. Any use is subject to the accepted licence; each file contains the credit and the licence. Text and data mining and AI training reserved (Art. 4(3), Directive (EU) 2019/790).", "Foto's beschermd door auteursrecht. Elk gebruik valt onder de aanvaarde licentie; elk bestand bevat de vermelding en de licentie. Tekst- en datamining en AI-training voorbehouden (art. 4, lid 3, Richtlijn (EU) 2019/790)."],
    accrTitle: ["Demande d'accréditation", "Accreditation request", "Accreditatieaanvraag"],
    accrIntro: ["Journalistes et médias : demandez l'accès aux photos officielles. Le studio vous enverra un lien personnel après vérification.", "Journalists and media: request access to the official photos. The studio will send you a personal link after checking.", "Journalisten en media: vraag toegang tot de officiële foto's. De studio stuurt je na controle een persoonlijke link."],
    name: ["Nom et prénom", "Full name", "Voor- en achternaam"],
    outlet: ["Média", "Media outlet", "Medium"],
    email: ["E-mail professionnel", "Work email", "Professioneel e-mailadres"],
    card: ["N° de carte de presse (facultatif)", "Press card number (optional)", "Perskaartnummer (optioneel)"],
    message: ["Message (facultatif)", "Message (optional)", "Bericht (optioneel)"],
    send: ["Envoyer la demande", "Send the request", "Aanvraag versturen"],
    sentAccr: ["Demande envoyée. Vous recevrez votre lien personnel par e-mail dès qu'elle sera acceptée.", "Request sent. You will receive your personal link by email once it is accepted.", "Aanvraag verstuurd. Je krijgt je persoonlijke link per e-mail zodra ze aanvaard is."],
    accrClosedTitle: ["Accréditations fermées", "Accreditation closed", "Accreditatie gesloten"],
    organisedBy: ["Organisation", "Organiser", "Organisatie"],
    close: ["Fermer", "Close", "Sluiten"],
  };
  // Messages du serveur (en français) traduits pour l'anglais et le néerlandais.
  var SERVER = {
      "Lien invalide ou expiré : demandez un nouveau lien au studio": [
          "Invalid or expired link: ask the studio for a new one",
          "Ongeldige of verlopen link: vraag de studio om een nieuwe"
      ],
      "Cet accès a été retiré par le studio": [
          "The studio has removed this access",
          "De studio heeft deze toegang ingetrokken"
      ],
      "Salle de presse introuvable": [
          "Press room not found",
          "Perskamer niet gevonden"
      ],
      "Cette salle de presse est fermée": [
          "This press room is closed",
          "Deze perskamer is gesloten"
      ],
      "Indiquez votre nom pour accepter la licence": [
          "Enter your name to accept the licence",
          "Vul je naam in om de licentie te aanvaarden"
      ],
      "Cochez la case d'acceptation": [
          "Tick the acceptance box",
          "Vink het aanvaardingsvakje aan"
      ],
      "La licence vient d'être mise à jour par le studio : relisez-la avant d'accepter": [
          "The studio has just updated the licence: read it again before accepting",
          "De studio heeft de licentie net bijgewerkt: lees ze opnieuw voor je aanvaardt"
      ],
      "La validation est réservée au commanditaire et à l'artiste": [
          "Approval is reserved for the client and the artist",
          "Goedkeuren is voorbehouden aan de opdrachtgever en de artiest"
      ],
      "La salle de presse n'est pas encore ouverte": [
          "The press room is not open yet",
          "De perskamer is nog niet open"
      ],
      "Cette salle de presse est fermée : plus aucun téléchargement": [
          "This press room is closed: no more downloads",
          "Deze perskamer is gesloten: geen downloads meer"
      ],
      "Acceptez la licence avant de télécharger": [
          "Accept the licence before downloading",
          "Aanvaard de licentie voor je downloadt"
      ],
      "Embargo en cours": [
          "Embargo in progress",
          "Embargo loopt"
      ],
      "Cette photo n'est pas téléchargeable avec votre licence": [
          "This photo cannot be downloaded with your licence",
          "Deze foto kan niet gedownload worden met je licentie"
      ],
      "Aucune photo téléchargeable pour le moment": [
          "No photos to download yet",
          "Nog geen foto's om te downloaden"
      ],
      "Lien expiré : relancez le téléchargement depuis la salle de presse": [
          "Link expired: start the download again from the press room",
          "Link verlopen: start de download opnieuw vanuit de perskamer"
      ],
      "Les demandes d'accréditation sont fermées pour cet événement": [
          "Accreditation requests are closed for this event",
          "Accreditatieaanvragen zijn gesloten voor dit evenement"
      ],
      "Indiquez votre nom et votre média": [
          "Enter your name and your media outlet",
          "Vul je naam en je medium in"
      ],
      "Adresse e-mail invalide": [
          "Invalid email address",
          "Ongeldig e-mailadres"
      ],
      "Trop de demandes : réessayez dans une heure": [
          "Too many requests: try again in an hour",
          "Te veel aanvragen: probeer over een uur opnieuw"
      ],
      "Cette photo n'est plus téléchargeable": [
          "This photo can no longer be downloaded",
          "Deze foto kan niet meer gedownload worden"
      ]
  };
  function serverText(text) {
    var v = SERVER[text];
    return v && lang !== "fr" ? v[lang === "en" ? 0 : 1] : text;
  }
  function t(key) {
    var v = D[key];
    return v ? v[lang === "en" ? 1 : lang === "nl" ? 2 : 0] : key;
  }
  function readStored() {
    try { return localStorage.getItem(LANG_KEY) || ""; } catch (e) { return ""; }
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function locale() { return lang === "en" ? "en-GB" : lang === "nl" ? "nl-BE" : "fr-BE"; }
  function when(ts, time) {
    var o = { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" };
    if (time) { o.hour = "2-digit"; o.minute = "2-digit"; }
    return new Date(ts * 1000).toLocaleString(locale(), o);
  }
  function mb(bytes) { return (bytes / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 }) + (lang === "en" ? " MB" : " Mo"); }
  function toast(text, isError) {
    var el = document.createElement("div");
    el.className = "pr-toast" + (isError ? " is-error" : "");
    el.setAttribute("role", "status");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3600);
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast(t("copied")); })
      .catch(function () { window.prompt(t("copy"), text); });
  }

  async function call(method, path, body) {
    var res = await fetch(API + "/api/press" + path, {
      method: method,
      headers: Object.assign({ "content-type": "application/json" }, TOKEN ? { authorization: "Bearer " + TOKEN } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = new Error(serverText(data.error || "Erreur " + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function paintLangs() {
    document.documentElement.lang = lang;
    $("pr-langs").querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang)); });
    $("pr-foot").textContent = t("footer");
    $("pr-lb-close").setAttribute("aria-label", t("close"));
  }
  $("pr-langs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-lang]");
    if (!b) return;
    lang = b.getAttribute("data-lang");
    userPickedLang = true;
    try { localStorage.setItem(LANG_KEY, lang); } catch (err) { /* rien */ }
    paintLangs();
    if (TOKEN) loadRoom();
    else if (EVENT) loadAccreditation();
  });

  function stateCard(title, text) {
    $("pr-main").innerHTML = '<div class="pr-state"><h1>' + esc(title) + "</h1><p>" + esc(text) + "</p></div>";
  }

  /* ---------- Tuiles (aperçus filigranés) ---------- */

  var tileCache = {};
  var tileQueue = [];
  var tileActive = 0;
  function tileUrl(photoId, level, col, row) {
    var key = photoId + "/" + level + "/" + col + "/" + row;
    if (tileCache[key]) return tileCache[key];
    tileCache[key] = new Promise(function (resolve) {
      tileQueue.push({ path: "/tile/" + encodeURIComponent(photoId) + "/" + level + "/" + col + "/" + row, resolve: resolve });
      pumpTiles();
    });
    return tileCache[key];
  }
  function pumpTiles() {
    while (tileActive < 6 && tileQueue.length) {
      var job = tileQueue.shift();
      tileActive++;
      fetch(API + "/api/press" + job.path, { headers: { authorization: "Bearer " + TOKEN } })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (blob) { return blob ? URL.createObjectURL(blob) : ""; }, function () { return ""; })
        .then((function (j) { return function (url) { tileActive--; j.resolve(url); pumpTiles(); }; })(job));
    }
  }
  function fillTiles(container, photoId, level, cols, rows) {
    container.innerHTML = "";
    container.style.gridTemplateColumns = "repeat(" + cols + ",1fr)";
    container.style.gridTemplateRows = "repeat(" + rows + ",1fr)";
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        container.appendChild(img);
        tileUrl(photoId, level, c, r).then((function (el) { return function (url) { if (url) el.src = url; }; })(img));
      }
    }
  }

  /* ---------- Salle de presse d'un destinataire ---------- */

  var room = { data: null, tab: "", showLicence: false, lb: -1, timer: null };

  async function loadRoom() {
    try {
      var data = await call("GET", "/me?lang=" + lang);
      if (!userPickedLang && data.recipient && data.recipient.lang && data.recipient.lang !== lang) {
        lang = data.recipient.lang;
        userPickedLang = true;
        paintLangs();
        data = await call("GET", "/me?lang=" + lang);
      }
      room.data = data;
      if (!room.tab) room.tab = data.canValidate && data.counts.pending ? "pending" : "all";
      paintRoom();
    } catch (err) {
      stateCard(t("errorTitle"), err.message);
    }
  }

  function visiblePhotos() {
    var d = room.data;
    if (!d.canValidate || room.tab === "all") return d.photos;
    return d.photos.filter(function (p) { return p.status === room.tab; });
  }

  function heroHtml(d) {
    var ev = d.event;
    var meta = [ev.eventDateLabel, ev.venue, ev.city].filter(Boolean).join(" · ");
    return '<section class="pr-hero"><div class="pr-eyebrow"><span class="pr-chip pr-chip-accent">' + esc(t("role_" + d.recipient.role)) + "</span>" +
      (d.recipient.organisation ? '<span class="pr-chip">' + esc(d.recipient.organisation) + "</span>" : "") + "</div>" +
      "<h1>" + esc(ev.title) + "</h1>" + (meta ? '<p class="pr-meta">' + esc(meta) + (ev.organiser ? " · " + esc(ev.organiser) : "") + "</p>" : "") + "</section>";
  }

  function licenceHtml(d) {
    var l = d.licence;
    if (!l.needed && l.accepted) {
      return '<div class="pr-licence-ok"><span>✓ ' + esc(t("accepted")) + " " + esc(when(l.accepted.acceptedAt)) + " " + esc(t("by")) + " " + esc(l.accepted.signerName) +
        (l.accepted.expiresAt ? " · " + esc(t("until")) + " " + esc(when(l.accepted.expiresAt)) : "") + '</span><button type="button" class="pr-link" id="pr-licence-toggle">' + esc(room.showLicence ? t("hideLicence") : t("seeText")) + "</button></div>" +
        (room.showLicence ? '<section class="pr-licence"><pre>' + esc(l.text) + "</pre></section>" : "");
    }
    var licensee = d.recipient.organisation || d.recipient.name || "";
    return '<section class="pr-licence" id="pr-licence"><h2>' + esc(t("licenceTitle")) + " · " + esc(l.name) + "</h2>" +
      "<p>" + esc(l.expired ? t("licenceExpired") : l.accepted ? t("licenceUpdated") : t("licenceIntro")) + "</p>" +
      '<button type="button" class="pr-link" id="pr-licence-toggle" style="margin-top:.6rem">' + esc(room.showLicence ? t("hideLicence") : t("readLicence")) + "</button>" +
      (room.showLicence ? "<pre>" + esc(l.text) + "</pre>" : "") +
      '<form id="pr-accept"><label class="pr-field">' + esc(t("yourName")) + '<input name="name" required minlength="2" maxlength="120" autocomplete="name" value="' + esc(d.recipient.name) + '" /></label>' +
      '<label class="pr-check"><input type="checkbox" name="accept" required /> <span>' + esc(t("accept")) + " " + esc(licensee) + ".</span></label>" +
      '<div><button type="submit" class="pr-btn pr-btn-primary">' + esc(t("acceptBtn")) + "</button></div></form></section>";
  }

  function waitHtml(d) {
    if (d.state === "closed") return '<section class="pr-wait"><h2>' + esc(t("closedTitle")) + "</h2><p>" + esc(t("closed")) + "</p></section>";
    if (d.event.embargoed) {
      return '<section class="pr-wait"><span class="pr-chip pr-chip-warn">' + esc(t("embargoTitle")) + "</span>" +
        '<div class="pr-count" id="pr-count"></div><p>' + esc(t("embargo")) + " " + esc(when(d.event.embargoAt, true)) + ".</p></section>";
    }
    return '<section class="pr-wait"><h2>' + esc(t("notOpenTitle")) + "</h2><p>" + esc(t("notOpen")) + "</p></section>";
  }

  function cardHtml(p, i) {
    var d = room.data;
    var ratio = p.width + "/" + p.height;
    var status = d.canValidate ? '<span class="pr-status pr-chip ' + (p.status === "approved" ? "pr-chip-ok" : p.status === "rejected" ? "" : "pr-chip-warn") + '">' + esc(t("st_" + p.status)) + "</span>" : "";
    var action = p.block === ""
      ? '<button type="button" class="pr-btn pr-btn-primary pr-btn-small" data-dl="' + esc(p.id) + '">' + esc(t("download")) + "</button>"
      : '<span class="pr-block">' + esc(t("block_" + p.block)) + "</span>";
    var decide = d.canValidate
      ? '<span class="pr-decide"><button type="button" class="pr-btn pr-btn-small" data-decide="approved" data-id="' + esc(p.id) + '" aria-pressed="' + (p.status === "approved") + '">✓ ' + esc(t("approve")) + "</button>" +
        '<button type="button" class="pr-btn pr-btn-small" data-decide="rejected" data-id="' + esc(p.id) + '" aria-pressed="' + (p.status === "rejected") + '">✕ ' + esc(t("reject")) + "</button></span>"
      : "";
    return '<article class="pr-card is-' + esc(p.status) + '"><button type="button" class="pr-thumb" data-open="' + i + '" style="aspect-ratio:' + ratio + '" data-thumb="' + esc(p.id) + '" aria-label="' + esc(t("photo") + " " + (i + 1)) + '"></button>' + status +
      '<div class="pr-card-body">' + (p.headline ? '<p class="pr-card-title">' + esc(p.headline) + "</p>" : "") + (p.caption ? '<p class="pr-card-caption">' + esc(p.caption) + "</p>" : "") +
      '<div class="pr-card-foot">' + decide + action + (p.block === "" && p.hdSize ? '<span class="pr-size">' + esc(mb(p.hdSize)) + "</span>" : "") + "</div></div></article>";
  }

  function paintRoom() {
    var d = room.data;
    $("pr-studio").innerHTML = esc(d.studio.name) + " <span>· " + esc(t("room")) + "</span>";
    document.title = d.event.title + " · " + t("room");
    var list = d.open ? visiblePhotos() : [];
    var downloadable = d.photos.filter(function (p) { return p.block === ""; });
    var tabs = d.canValidate
      ? '<div class="pr-tabs">' + [["pending", d.counts.pending], ["approved", d.counts.approved], ["rejected", d.counts.rejected], ["all", d.counts.total]].map(function (x) {
          return '<button type="button" class="pr-tab" data-tab="' + x[0] + '" aria-pressed="' + (room.tab === x[0]) + '">' + esc(t(x[0])) + " <span>" + x[1] + "</span></button>";
        }).join("") + "</div>"
      : '<p class="pr-meta">' + d.photos.length + " " + esc(t("photos")) + "</p>";
    $("pr-main").innerHTML = heroHtml(d) +
      '<div class="pr-credit"><span><b>' + esc(t("credit")) + "</b> · <code>" + esc(d.event.credit) + '</code></span><button type="button" class="pr-btn pr-btn-small" id="pr-copy-credit">' + esc(t("copy")) + "</button></div>" +
      (d.open && d.state !== "closed" ? licenceHtml(d) : "") +
      (d.open
        ? (d.canValidate ? '<p class="pr-meta" style="margin:.2rem 0 .4rem">' + esc(t("validateHint")) + "</p>" : "") +
          '<div class="pr-bar">' + tabs + '<div class="pr-bar-actions">' +
          (d.canValidate && d.counts.pending ? '<button type="button" class="pr-btn pr-btn-small" id="pr-approve-all">✓ ' + esc(t("approveAll")) + " (" + d.counts.pending + ")</button>" : "") +
          (downloadable.length ? '<button type="button" class="pr-btn pr-btn-primary pr-btn-small" id="pr-zip">' + esc(t("downloadAll")) + " · " + downloadable.length + "</button>" : "") +
          '</div></div><div id="pr-parts"></div>' +
          (list.length ? '<div class="pr-grid">' + list.map(cardHtml).join("") + "</div>" : '<p class="pr-state">' + esc(t("empty")) + "</p>")
        : waitHtml(d));
    bindRoom();
  }

  var thumbObserver = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      thumbObserver.unobserve(e.target);
      fillTiles(e.target, e.target.getAttribute("data-thumb"), 0, 2, 2);
    });
  }, { rootMargin: "400px" }) : null;

  function bindRoom() {
    var d = room.data;
    $("pr-copy-credit").addEventListener("click", function () { copy(d.event.credit); });
    var toggle = $("pr-licence-toggle");
    if (toggle) toggle.addEventListener("click", function () { room.showLicence = !room.showLicence; paintRoom(); });
    var form = $("pr-accept");
    if (form) form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        await call("POST", "/me/licence", { name: form.elements.name.value, accept: form.elements.accept.checked, sha256: d.licence.sha256, lang: lang });
        room.showLicence = false;
        await loadRoom();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        if (err.status === 409) loadRoom();
      }
    });
    document.querySelectorAll("[data-thumb]").forEach(function (el) {
      if (thumbObserver) thumbObserver.observe(el);
      else fillTiles(el, el.getAttribute("data-thumb"), 0, 2, 2);
    });
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () { room.tab = b.getAttribute("data-tab"); paintRoom(); });
    });
    document.querySelectorAll("[data-open]").forEach(function (b) {
      b.addEventListener("click", function () { openLightbox(Number(b.getAttribute("data-open"))); });
    });
    document.querySelectorAll("[data-decide]").forEach(function (b) {
      b.addEventListener("click", function () { decide([b.getAttribute("data-id")], b.getAttribute("data-decide")); });
    });
    document.querySelectorAll("[data-dl]").forEach(function (b) {
      b.addEventListener("click", function () { downloadOne(b.getAttribute("data-dl"), b); });
    });
    var all = $("pr-approve-all");
    if (all) all.addEventListener("click", function () {
      if (!window.confirm(t("approveAllConfirm"))) return;
      decide(d.photos.filter(function (p) { return p.status === "pending"; }).map(function (p) { return p.id; }), "approved");
    });
    var zip = $("pr-zip");
    if (zip) zip.addEventListener("click", function () { downloadZip(zip); });
    if (room.timer) { clearInterval(room.timer); room.timer = null; }
    if (!d.open && d.event.embargoed && d.event.embargoAt) startCountdown(d.event.embargoAt);
  }

  function startCountdown(at) {
    var box = $("pr-count");
    var tick = function () {
      var left = Math.max(0, Math.floor(at - Date.now() / 1000));
      if (left <= 0) {
        clearInterval(room.timer);
        room.timer = null;
        setTimeout(loadRoom, 1500);
      }
      var parts = [[Math.floor(left / 86400), "days"], [Math.floor(left % 86400 / 3600), "hours"], [Math.floor(left % 3600 / 60), "minutes"], [left % 60, "seconds"]];
      if (parts[0][0] === 0) parts.shift();
      if (box) box.innerHTML = parts.map(function (p) { return "<div><b>" + String(p[0]).padStart(2, "0") + "</b><span>" + esc(t(p[1])) + "</span></div>"; }).join("");
    };
    tick();
    room.timer = setInterval(tick, 1000);
  }

  async function decide(ids, status) {
    if (!ids.length) return;
    var note = "";
    if (status === "rejected" && ids.length === 1) {
      note = window.prompt(t("rejectWhy"), "");
      if (note === null) return;
    }
    try {
      await call("POST", "/me/decide", { ids: ids, status: status, note: note });
      room.data.photos.forEach(function (p) { if (ids.indexOf(p.id) !== -1) p.status = status; });
      var counts = { total: room.data.photos.length, pending: 0, approved: 0, rejected: 0 };
      room.data.photos.forEach(function (p) { counts[p.status]++; });
      room.data.counts = counts;
      toast(t("saved"));
      await loadRoom();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function downloadOne(id, btn) {
    if (btn) btn.disabled = true;
    try {
      var res = await call("POST", "/me/link", { photo: id });
      location.href = res.urls[0];
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (btn) setTimeout(function () { btn.disabled = false; }, 1500);
    }
  }

  async function downloadZip(btn) {
    btn.disabled = true;
    toast(t("preparing"));
    try {
      var res = await call("POST", "/me/link", { all: true });
      if (res.urls.length === 1) location.href = res.urls[0];
      else {
        $("pr-parts").innerHTML = '<div class="pr-licence-ok"><span>' + esc(t("parts")) + "</span><span>" + res.urls.map(function (u, i) {
          return '<a class="pr-btn pr-btn-small" href="' + esc(u) + '">' + esc(t("part")) + " " + (i + 1) + "</a>";
        }).join(" ") + "</span></div>";
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      setTimeout(function () { btn.disabled = false; }, 1500);
    }
  }

  /* ---------- Visionneuse ---------- */

  function openLightbox(index) {
    var list = visiblePhotos();
    if (!list[index]) return;
    room.lb = index;
    var p = list[index];
    var box = $("pr-lb-image");
    var maxH = window.innerHeight - 32;
    var maxW = window.innerWidth > 860 ? Math.min(window.innerWidth - 32 - 340, 1300) : window.innerWidth - 32;
    var scale = Math.min(maxW / p.width, maxH / p.height);
    box.style.width = Math.round(p.width * scale) + "px";
    box.style.height = Math.round(p.height * scale) + "px";
    fillTiles(box, p.id, 1, p.cols, p.rows);
    var d = room.data;
    var credit = d.event.credit;
    var captionText = [p.headline, p.caption].filter(Boolean).join(". ");
    $("pr-lb-side").innerHTML =
      (d.canValidate ? '<span class="pr-chip">' + esc(t("st_" + p.status)) + "</span>" : "") +
      (p.headline ? "<h2>" + esc(p.headline) + "</h2>" : "") + (p.caption ? "<p>" + esc(p.caption) + "</p>" : "") +
      "<p><b>" + esc(t("credit")) + "</b> · " + esc(credit) + "</p>" +
      '<div style="display:flex;flex-wrap:wrap;gap:.45rem">' +
      (d.canValidate ? '<button type="button" class="pr-btn pr-btn-small" data-lb-decide="approved">✓ ' + esc(t("approve")) + '</button><button type="button" class="pr-btn pr-btn-small" data-lb-decide="rejected">✕ ' + esc(t("reject")) + "</button>" : "") +
      (p.block === "" ? '<button type="button" class="pr-btn pr-btn-primary pr-btn-small" data-lb-dl>' + esc(t("download")) + "</button>" : '<span class="pr-block">' + esc(t("block_" + p.block)) + "</span>") +
      '<button type="button" class="pr-btn pr-btn-small" data-lb-copy>' + esc(t("copyCaption")) + "</button></div>";
    $("pr-lb-side").querySelectorAll("[data-lb-decide]").forEach(function (b) {
      b.addEventListener("click", function () { closeLightbox(); decide([p.id], b.getAttribute("data-lb-decide")); });
    });
    var dl = $("pr-lb-side").querySelector("[data-lb-dl]");
    if (dl) dl.addEventListener("click", function () { downloadOne(p.id, dl); });
    $("pr-lb-side").querySelector("[data-lb-copy]").addEventListener("click", function () {
      copy((captionText ? captionText + " " : "") + "© " + credit);
    });
    $("pr-lightbox").hidden = false;
    $("pr-lb-close").focus();
  }
  function closeLightbox() {
    $("pr-lightbox").hidden = true;
    room.lb = -1;
  }
  $("pr-lb-close").addEventListener("click", closeLightbox);
  $("pr-lb-prev").addEventListener("click", function () { var n = visiblePhotos().length; openLightbox((room.lb - 1 + n) % n); });
  $("pr-lb-next").addEventListener("click", function () { var n = visiblePhotos().length; openLightbox((room.lb + 1) % n); });
  $("pr-lightbox").addEventListener("click", function (e) { if (e.target === $("pr-lightbox")) closeLightbox(); });
  document.addEventListener("keydown", function (e) {
    if ($("pr-lightbox").hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") $("pr-lb-prev").click();
    if (e.key === "ArrowRight") $("pr-lb-next").click();
  });
  document.addEventListener("contextmenu", function (e) { if (e.target.closest(".pr-thumb, .pr-lb-image")) e.preventDefault(); });

  /* ---------- Page d'accréditation ---------- */

  async function loadAccreditation() {
    var data;
    try {
      data = await call("GET", "/event/" + encodeURIComponent(EVENT) + "?lang=" + lang);
    } catch (err) {
      stateCard(t("accrClosedTitle"), err.message);
      return;
    }
    if (!userPickedLang && data.event.language && data.event.language !== lang) {
      lang = data.event.language;
      userPickedLang = true;
      paintLangs();
      return loadAccreditation();
    }
    var ev = data.event;
    $("pr-studio").innerHTML = esc(data.studio.name) + " <span>· " + esc(t("room")) + "</span>";
    document.title = ev.title + " · " + t("accrTitle");
    var meta = [ev.eventDateLabel, ev.venue, ev.city].filter(Boolean).join(" · ");
    $("pr-main").innerHTML = '<div class="pr-accr"><section class="pr-accr-info pr-hero"><div class="pr-eyebrow"><span class="pr-chip pr-chip-accent">' + esc(t("accrTitle")) + "</span></div>" +
      "<h1>" + esc(ev.title) + "</h1>" + (meta ? '<p class="pr-meta">' + esc(meta) + "</p>" : "") +
      (ev.organiser ? '<p class="pr-meta">' + esc(t("organisedBy")) + " · " + esc(ev.organiser) + "</p>" : "") +
      (ev.description ? "<p>" + esc(ev.description) + "</p>" : "") + "<p>" + esc(t("accrIntro")) + "</p></section>" +
      '<form class="pr-form-card" id="pr-accr-form"><h2>' + esc(t("accrTitle")) + "</h2>" +
      '<label class="pr-field">' + esc(t("name")) + '<input name="name" required minlength="2" maxlength="120" autocomplete="name" /></label>' +
      '<label class="pr-field">' + esc(t("outlet")) + '<input name="organisation" required minlength="2" maxlength="160" autocomplete="organization" /></label>' +
      '<label class="pr-field">' + esc(t("email")) + '<input type="email" name="email" required maxlength="200" autocomplete="email" /></label>' +
      '<label class="pr-field">' + esc(t("card")) + '<input name="pressCard" maxlength="60" /></label>' +
      '<label class="pr-field">' + esc(t("message")) + '<textarea name="message" rows="3" maxlength="600"></textarea></label>' +
      '<label class="pr-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off" /></label>' +
      '<div id="pr-accr-note"></div><button type="submit" class="pr-btn pr-btn-primary">' + esc(t("send")) + "</button></form></div>";
    var form = $("pr-accr-form");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var f = form.elements;
      var btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        await call("POST", "/event/" + encodeURIComponent(EVENT) + "/accreditation", {
          name: f.name.value, organisation: f.organisation.value, email: f.email.value, pressCard: f.pressCard.value, message: f.message.value, website: f.website.value, lang: lang,
        });
        form.innerHTML = '<h2>' + esc(t("accrTitle")) + '</h2><p class="pr-note pr-note-ok">' + esc(t("sentAccr")) + "</p>";
      } catch (err) {
        $("pr-accr-note").innerHTML = '<p class="pr-note pr-note-err">' + esc(err.message) + "</p>";
        btn.disabled = false;
      }
    });
  }

  paintLangs();
  if (TOKEN) loadRoom();
  else if (EVENT) loadAccreditation();
  else stateCard(t("missingTitle"), t("missing"));
})();
