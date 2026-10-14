/* =====================================================================
   Holypixx — guide « Galerie photo de mariage » : le planning. À partir
   de la date du mariage et des délais du photographe, il liste chaque
   rendez-vous avec les mariés (questionnaire, aperçu, galerie, invités,
   album, fermeture, premier anniversaire), la date à laquelle écrire, et
   rédige le message ; le tout s'ajoute à l'agenda (.ics). Rien n'est
   envoyé : les réglages restent dans le navigateur.
   ===================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("m-form");
  if (!form) return;
  var STORE = "holypixx-mariage";
  var FIELDS = ["names", "date", "peek", "weeks", "album", "albumWeeks", "online", "guests", "sign"];

  var els = {
    title: document.getElementById("m-plan-title"),
    summary: document.getElementById("m-summary"),
    list: document.getElementById("m-list"),
    msgTitle: document.getElementById("m-msg-title"),
    msg: document.getElementById("m-msg-text"),
    albumWeeks: document.getElementById("m-album-weeks"),
    toast: document.getElementById("toast"),
  };
  var state = { items: [], selected: 0, d: null, past: 0 };

  /* ---------- Dates (chaînes AAAA-MM-JJ, en UTC) ---------- */

  function parseDay(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return { y: y, mo: mo, d: d };
  }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function ms(day) { var p = parseDay(day); return Date.UTC(p.y, p.mo - 1, p.d); }
  function addDays(day, n) { return iso(ms(day) + n * 86400000); }
  // 31 janvier + 1 mois = dernier jour de février.
  function addMonths(day, n) {
    var p = parseDay(day);
    var total = p.y * 12 + (p.mo - 1) + n;
    var y = Math.floor(total / 12);
    var mo = total - y * 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return iso(Date.UTC(y, mo, Math.min(p.d, last)));
  }
  function todayIso() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
  }
  function longDate(day, withYear) {
    var opts = { day: "numeric", month: "long", timeZone: "UTC" };
    if (withYear) opts.year = "numeric";
    return new Date(day + "T12:00:00Z").toLocaleDateString("fr-BE", opts);
  }
  function shortDate(day) {
    return new Date(day + "T12:00:00Z").toLocaleDateString("fr-BE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  function read() {
    var d = {};
    FIELDS.forEach(function (name) {
      var el = form.elements[name];
      d[name] = el.type === "checkbox" ? el.checked : String(el.value || "").trim();
    });
    return d;
  }

  /* ---------- Étapes ---------- */

  function steps(d) {
    var out = [];
    if (!parseDay(d.date)) return out;
    var wedding = d.date;
    var names = d.names;
    var hello = "Bonjour" + (names ? " " + names : "") + ",";
    var sign = d.sign || "[votre prénom]";
    var gallery = "[lien de la galerie]\nMot de passe : [mot de passe]";
    var peek = Number(d.peek) || 0;
    var weeks = Number(d.weeks) || 6;
    var delivery = addDays(wedding, weeks * 7);
    var online = Number(d.online) || 6;
    var closes = addMonths(delivery, online);

    function push(item) { out.push(item); }

    push({
      contact: addDays(wedding, -30),
      event: wedding,
      title: "Le questionnaire du jour J",
      detail: "Un mois avant le mariage",
      message: hello + "\n\nPlus qu'un mois avant votre mariage ! Pour que je ne manque rien le " + longDate(wedding) + ", pouvez-vous me dire en quelques lignes :" +
        "\n\n– le déroulé de la journée et les horaires (préparatifs, cérémonie, vin d'honneur, repas) ;" +
        "\n– les photos de groupe que vous souhaitez, et les personnes à ne surtout pas oublier ;" +
        "\n– un témoin ou un proche que je peux appeler le jour même." +
        "\n\nMerci, et profitez bien de ces dernières semaines,\n" + sign,
    });
    push({
      contact: addDays(wedding, -7),
      event: wedding,
      title: "Le planning final",
      detail: "Une semaine avant",
      message: hello + "\n\nJ'ai bien tout noté pour le " + longDate(wedding) + ". Je serai là dès les préparatifs, comme prévu. S'il y a un changement d'horaire ou de lieu d'ici là, écrivez-moi simplement." +
        "\n\nJe me réjouis de partager cette journée avec vous,\n" + sign,
    });
    if (peek) {
      var peekDay = addDays(wedding, peek);
      push({
        contact: peekDay,
        event: peekDay,
        title: "L'aperçu",
        detail: (peek === 2 ? "48 heures" : "Une semaine") + " après le mariage",
        message: hello + "\n\nVoici un premier aperçu de votre mariage : une vingtaine de photos, en attendant les autres. Partagez-les autant que vous voulez !" +
          "\n\n" + gallery +
          "\n\nLa galerie complète arrive le " + longDate(delivery) + ", comme prévu.\n\nÀ très vite,\n" + sign,
      });
    }
    push({
      contact: delivery,
      event: delivery,
      title: "La galerie complète",
      detail: weeks + " semaines après le mariage",
      message: hello + "\n\nVotre galerie est prête ! Toutes les photos de votre journée vous attendent, dans l'ordre, des préparatifs à la soirée." +
        "\n\n" + gallery +
        (d.album ? "\n\nMarquez vos coups de cœur pour l'album : vous avez jusqu'au " + longDate(addDays(delivery, Number(d.albumWeeks || 3) * 7)) + " pour faire votre choix." : "") +
        "\n\nLa galerie reste en ligne jusqu'au " + longDate(closes, true) + ".\n\nBelle découverte,\n" + sign,
    });
    if (d.guests) {
      var guestsDay = addDays(delivery, 2);
      push({
        contact: guestsDay,
        event: guestsDay,
        title: "Le message pour les invités",
        detail: "À transmettre par les mariés",
        message: hello + "\n\nVos proches vont vouloir leurs photos ! Voici un message tout prêt à leur transférer :" +
          "\n\n« Les photos de notre mariage sont en ligne ! Retrouvez-les ici, avec le mot de passe ci-dessous. Vous pouvez y garder vos préférées et commander vos tirages, livrés chez vous.\n" + gallery + " »" +
          "\n\nBelle journée,\n" + sign,
      });
    }
    if (d.album) {
      var albumDue = addDays(delivery, Number(d.albumWeeks || 3) * 7);
      push({
        contact: addDays(albumDue, -7),
        event: albumDue,
        title: "Le rappel de l'album",
        detail: "Une semaine avant la date limite",
        message: hello + "\n\nPetit rappel : il reste une semaine, jusqu'au " + longDate(albumDue) + ", pour choisir les photos de votre album. Un conseil : commencez par vos vingt préférées, le reste vient tout seul." +
          "\n\n" + gallery + "\n\nÀ bientôt,\n" + sign,
      });
    }
    push({
      contact: addMonths(closes, -1),
      event: closes,
      title: "Avant la fermeture",
      detail: "Un mois avant la fermeture de la galerie",
      message: hello + "\n\nVotre galerie fermera le " + longDate(closes, true) + ". D'ici là, pensez à télécharger vos fichiers et à commander les tirages pour vos proches : une toile pour le salon, les cartes de remerciement, les cadeaux pour les parents." +
        "\n\n" + gallery + "\n\nÀ bientôt,\n" + sign,
    });
    var anniversary = addMonths(wedding, 12);
    push({
      contact: addDays(anniversary, -30),
      event: anniversary,
      title: "Les noces de coton",
      detail: "Un mois avant le premier anniversaire",
      message: hello + "\n\nDéjà un an depuis votre mariage, le " + longDate(wedding, true) + " ! Pour fêter vos noces de coton, je vous propose une séance couple, sans la pression du grand jour : juste vous deux, dans un lieu qui vous ressemble." +
        "\n\nVos créneaux sont ici :\n[votre lien de réservation]\n\nBel anniversaire de mariage d'avance,\n" + sign +
        "\n\nSi vous préférez ne plus recevoir mes propositions, répondez simplement à ce message.",
    });

    out.sort(function (a, b) { return a.contact < b.contact ? -1 : a.contact > b.contact ? 1 : 0; });
    return out;
  }

  /* ---------- Rendu ---------- */

  function renderMessage() {
    var item = state.items[state.selected];
    if (!item) {
      els.msgTitle.textContent = "Le message";
      els.msg.textContent = state.past ? "Toutes les étapes de ce mariage sont passées." : "Indiquez la date du mariage pour voir les messages.";
      return;
    }
    els.msgTitle.textContent = "Le message · " + item.title;
    els.msg.textContent = item.message;
  }

  function select(i, focus) {
    state.selected = i;
    Array.prototype.forEach.call(els.list.querySelectorAll(".f-item"), function (btn, n) {
      btn.setAttribute("aria-pressed", String(n === i));
      if (n === i && focus) btn.focus();
    });
    renderMessage();
  }

  function render(keepSelection) {
    var d = read();
    var today = todayIso();
    els.albumWeeks.hidden = !d.album;
    els.title.textContent = d.names ? "Le planning de " + d.names : "Le planning du mariage";

    var all = steps(d);
    // Les étapes déjà passées ne s'affichent plus ; l'heure d'écrire est venue
    // pour celles du jour.
    var items = all.filter(function (it) { return it.contact >= today; });
    state.past = all.length - items.length;
    state.items = items;
    state.d = d;
    if (!keepSelection || state.selected >= items.length) state.selected = 0;

    if (!parseDay(d.date)) {
      els.summary.textContent = "Indiquez la date du mariage pour voir le planning.";
    } else if (!items.length) {
      els.summary.textContent = "Toutes les étapes de ce mariage sont passées : choisissez une date plus récente.";
    } else {
      var delivery = addDays(d.date, (Number(d.weeks) || 6) * 7);
      var text = items.length + " rendez-vous avec les mariés. Galerie complète le " + longDate(delivery, true) +
        ", en ligne jusqu'au " + longDate(addMonths(delivery, Number(d.online) || 6), true) + ".";
      if (state.past) text += " " + state.past + " étape" + (state.past > 1 ? "s" : "") + " déjà passée" + (state.past > 1 ? "s" : "") + ".";
      els.summary.textContent = text;
    }

    els.list.textContent = "";
    items.forEach(function (it, i) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "f-item";
      btn.setAttribute("aria-pressed", String(i === state.selected));
      var when = document.createElement("span");
      when.className = "f-when";
      when.textContent = it.contact === today ? "Aujourd'hui" : shortDate(it.contact);
      if (it.contact === today) when.classList.add("f-now");
      var what = document.createElement("span");
      what.className = "f-what";
      var strong = document.createElement("strong");
      strong.textContent = it.title;
      var em = document.createElement("em");
      em.textContent = it.detail;
      what.appendChild(strong);
      what.appendChild(em);
      btn.appendChild(when);
      btn.appendChild(what);
      btn.addEventListener("click", function () { select(i); });
      btn.addEventListener("keydown", function (e) {
        var next = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : null;
        if (next === null || next < 0 || next >= state.items.length) return;
        e.preventDefault();
        select(next, true);
      });
      li.appendChild(btn);
      els.list.appendChild(li);
    });
    renderMessage();

    try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (err) { /* navigation privée */ }
  }

  /* ---------- Agenda (.ics) ---------- */

  function icsText(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  // Lignes de 75 octets au plus (les accents comptent double ou triple).
  function fold(line) {
    var parts = [];
    var current = "";
    var bytes = 0;
    Array.from(line).forEach(function (ch) {
      var c = ch.codePointAt(0);
      var size = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
      if (bytes + size > (parts.length ? 74 : 75)) { parts.push(current); current = ""; bytes = 0; }
      current += ch;
      bytes += size;
    });
    parts.push(current);
    return parts.join("\r\n ");
  }
  function ics(items, names) {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Holypixx//Planning de mariage//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    items.forEach(function (it, i) {
      var day = it.contact.replace(/-/g, "");
      lines.push(
        "BEGIN:VEVENT",
        "UID:mariage-" + day + "-" + i + "-" + Math.random().toString(36).slice(2, 10) + "@holypixx.com",
        "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + day,
        "DTEND;VALUE=DATE:" + addDays(it.contact, 1).replace(/-/g, ""),
        fold("SUMMARY:" + icsText(it.title + (names ? " · " + names : ""))),
        fold("DESCRIPTION:" + icsText(it.detail + "\n\n" + it.message)),
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  /* ---------- Copie, téléchargement, toast ---------- */

  var toastTimer = null;
  function toast(text) {
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 3200);
  }
  function copy(text, done) {
    var fallback = function () {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      area.remove();
      toast(ok ? done : "Copie impossible ici : sélectionnez le texte à la main.");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(done); }).catch(fallback);
    else fallback();
  }

  document.getElementById("m-copy").addEventListener("click", function () {
    var item = state.items[state.selected];
    if (!item) { toast("Aucun message à copier : indiquez d'abord la date du mariage."); return; }
    copy(item.message, "Message copié : remplacez les crochets avant d'envoyer.");
  });
  document.getElementById("m-ics").addEventListener("click", function () {
    if (!state.items.length) { toast("Aucune étape à ajouter pour cette date."); return; }
    var names = state.d && state.d.names;
    var blob = new Blob([ics(state.items, names)], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    var slug = names ? names.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
    a.download = "mariage-" + (slug || "planning") + ".ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast(state.items.length + " rappel" + (state.items.length > 1 ? "s" : "") + " prêt" + (state.items.length > 1 ? "s" : "") + " : ouvrez le fichier pour les ajouter à votre agenda.");
  });

  /* ---------- Reprise des réglages ---------- */

  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved) {
      FIELDS.forEach(function (name) {
        var el = form.elements[name];
        if (saved[name] === undefined) return;
        if (el.type === "checkbox") el.checked = Boolean(saved[name]);
        else el.value = saved[name];
      });
    }
  } catch (err) { /* rien à reprendre */ }
  // Par défaut, un mariage dans six semaines : tout le planning est à venir.
  if (!form.elements.date.value) form.elements.date.value = addDays(todayIso(), 42);

  form.addEventListener("input", function () { render(false); });
  form.addEventListener("change", function () { render(false); });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  render(false);
})();
