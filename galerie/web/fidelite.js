/* =====================================================================
   Holypixx — guide « Fidéliser ses clients » : le calendrier. À partir
   d'une séance (bébé, grossesse, enfant, mariage, famille), il liste les
   occasions de revenir sur deux ans, la date à laquelle écrire, et rédige
   le message ; le tout s'ajoute à l'agenda (.ics). Rien n'est envoyé :
   les réglages restent dans le navigateur.
   ===================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("f-form");
  if (!form) return;
  var STORE = "holypixx-fidelite";
  var FIELDS = ["kind", "name", "date", "age", "lead", "s_noel", "s_meres", "s_peres", "s_valentin", "s_rentree", "price", "sign"];
  var WINDOW_MONTHS = 24;
  // Mêmes étapes que les fiches clients de Holypixx.
  var BABY_STEPS = [3, 6, 9, 12, 18];
  // Séances de saison : date indicative des séances, et de quoi écrire.
  var SEASONS = [
    { key: "valentin", md: "02-01", name: "Séances de la Saint-Valentin", hook: "La Saint-Valentin approche !", line: "Une séance à deux, ou une carte cadeau à offrir." },
    { key: "meres", md: "04-25", name: "Séances pour la fête des mères", hook: "La fête des mères approche !", line: "Une séance avec les enfants, ou une carte cadeau : le cadeau qui ne finit pas dans un tiroir." },
    { key: "peres", md: "05-25", name: "Séances pour la fête des pères", hook: "La fête des pères approche !", line: "Une séance avec les enfants, ou une carte cadeau à glisser dans la poche." },
    { key: "rentree", md: "08-25", name: "Séances de rentrée", hook: "C'est bientôt la rentrée !", line: "Un portrait pour marquer la nouvelle année, avant que tout le monde ait encore grandi." },
    { key: "noel", md: "11-20", name: "Séances de Noël", hook: "Les séances de Noël reviennent !", line: "Vos photos seront prêtes à temps pour les cartes de vœux et les cadeaux." },
  ];
  // Au moins six semaines pour une séance de saison : les créneaux partent vite.
  var SEASON_LEAD = 42;
  var NOCES = { 1: "noces de coton", 2: "noces de cuir", 3: "noces de froment" };
  var LABELS = {
    baby: { name: "Prénom du bébé", date: "Date de la séance", who: "votre bébé", title: "Le calendrier de " },
    pregnancy: { name: "Prénom du bébé (s'il est choisi)", date: "Naissance prévue", who: "bébé", title: "Le calendrier de " },
    child: { name: "Prénom de l'enfant", date: "Date de naissance", who: "votre enfant", title: "Le calendrier de " },
    wedding: { name: "Prénoms des mariés", date: "Date du mariage", who: "", title: "Le calendrier de " },
    family: { name: "Nom de la famille", date: "Date de la séance", who: "", title: "Le calendrier de la famille " },
  };
  var NUANCE = {
    3: "C'est l'âge des premiers vrais sourires et des premiers gazouillis.",
    6: "C'est l'âge où l'on commence à tenir assis, à attraper ses pieds et à rire aux éclats.",
    9: "C'est l'âge où l'on explore tout, à quatre pattes ou déjà debout.",
    12: "Un an, c'est le moment des premiers pas, et du gâteau à écraser pour la séance « smash the cake ».",
    18: "Dix-huit mois, c'est l'âge où la personnalité se révèle : des photos qui ne ressembleront à aucune autre.",
  };

  var els = {
    title: document.getElementById("f-plan-title"),
    summary: document.getElementById("f-summary"),
    list: document.getElementById("f-list"),
    msgTitle: document.getElementById("f-msg-title"),
    msg: document.getElementById("f-msg-text"),
    nameLabel: document.getElementById("f-name-label"),
    dateLabel: document.getElementById("f-date-label"),
    age: document.getElementById("f-age"),
    toast: document.getElementById("toast"),
  };
  var state = { items: [], selected: 0, d: null };

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

  /* ---------- Mots ---------- */

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  // « de Léa », « d'Alexandre ».
  function ofName(name) { return (/^[aeiouyéèêàâîïôûh]/i.test(name) ? "d'" : "de ") + name; }
  function stepLabel(months) {
    if (months === 12) return "1 an";
    if (months % 12 === 0) return months / 12 + " ans";
    return months + " mois";
  }
  function euros(n) {
    return Math.round(n).toLocaleString("fr-BE") + " €";
  }
  function number(value, min, max) {
    var n = parseFloat(String(value || "").replace(/\s/g, "").replace(",", "."));
    if (!isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }

  function read() {
    var d = {};
    FIELDS.forEach(function (name) {
      var el = form.elements[name];
      d[name] = el.type === "checkbox" ? el.checked : String(el.value || "").trim();
    });
    return d;
  }

  /* ---------- Occasions ---------- */

  function occasions(d, today) {
    var out = [];
    var end = addMonths(today, WINDOW_MONTHS);
    var lead = Number(d.lead) || 30;
    var sign = d.sign || "[votre prénom]";
    var name = d.name;
    var who = name || LABELS[d.kind].who;
    var link = "[votre lien de réservation]";
    var stop = "Si vous préférez ne plus recevoir mes propositions, répondez simplement à ce message.";

    function push(event, item, itemLead) {
      if (event < today || event > end) return;
      var contact = addDays(event, -(itemLead || lead));
      item.event = event;
      item.now = contact <= today;
      item.contact = item.now ? today : contact;
      item.message += "\n\n" + stop;
      out.push(item);
    }

    function babyItem(birth, months) {
      var label = stepLabel(months);
      var event = addMonths(birth, months);
      var nuance = NUANCE[months] || "Chaque année, un portrait de plus pour garder ce qui change si vite.";
      push(event, {
        title: label + " " + (name ? ofName(name) : "de bébé"),
        message: "Bonjour,\n\n" + cap(who) + " aura " + label + " le " + longDate(event) + " ! " + nuance +
          "\n\nJe vous propose une séance " + label + " pour garder ce moment. Vous pouvez choisir votre créneau ici :\n" + link +
          "\n\nÀ très bientôt,\n" + sign,
      });
    }

    if (!parseDay(d.date)) return out;

    if (d.kind === "baby") {
      var age = Number(d.age) || 0;
      // Nouveau-né : une dizaine de jours à la séance.
      var birth = age > 0 ? addMonths(d.date, -age) : addDays(d.date, -10);
      BABY_STEPS.forEach(function (m) { if (m > age) babyItem(birth, m); });
      for (var y = 2; y <= 6; y++) if (y * 12 > age) babyItem(birth, y * 12);
    } else if (d.kind === "pregnancy") {
      var due = d.date;
      var newborn = addDays(due, 7);
      push(newborn, {
        title: "Séance nouveau-né" + (name ? " " + ofName(name) : ""),
        message: "Bonjour,\n\nLa naissance approche ! Les photos de nouveau-né se font idéalement dans les quinze premiers jours, quand bébé dort encore beaucoup et se laisse installer." +
          "\n\nJe vous propose de réserver dès maintenant une date autour du " + longDate(newborn) + " : nous l'ajusterons simplement à l'arrivée de bébé.\n" + link +
          "\n\nPrenez soin de vous,\n" + sign,
      });
      [6, 12].forEach(function (m) { babyItem(due, m); });
    } else if (d.kind === "child") {
      for (var n = 1; n <= 18; n++) {
        var bday = addMonths(d.date, n * 12);
        push(bday, {
          title: n + (n > 1 ? " ans " : " an ") + (name ? ofName(name) : "de l'enfant"),
          message: "Bonjour,\n\n" + cap(who) + " va fêter " + (n > 1 ? "ses " + n + " ans" : "son premier anniversaire") + " le " + longDate(bday) + " ! " +
            "Je vous propose une séance d'anniversaire, pour garder une photo de chaque année." +
            "\n\nVos créneaux sont ici :\n" + link + "\n\nÀ très bientôt,\n" + sign,
        });
      }
    } else if (d.kind === "wedding") {
      for (var w = 1; w <= 5; w++) {
        var anniv = addMonths(d.date, w * 12);
        var years = w + (w > 1 ? " ans" : " an");
        push(anniv, {
          title: years + " de mariage" + (name ? " · " + name : ""),
          message: "Bonjour" + (name ? " " + name : "") + ",\n\nDéjà " + years + " depuis votre mariage, le " + longDate(d.date, true) + " ! " +
            "Pour fêter " + (NOCES[w] ? "vos " + NOCES[w] : "cet anniversaire") + ", je vous propose une séance couple, sans la pression du grand jour : juste vous deux, dans un lieu qui vous ressemble." +
            "\n\nVos créneaux sont ici :\n" + link + "\n\nBel anniversaire de mariage d'avance,\n" + sign,
        });
      }
    } else if (d.kind === "family") {
      for (var f = 1; f <= 2; f++) {
        var again = addMonths(d.date, f * 12);
        push(again, {
          title: "Portrait de l'année" + (name ? " · famille " + name : ""),
          message: "Bonjour,\n\nIl y a " + (f > 1 ? f + " ans" : "un an") + ", nous faisions votre séance photo de famille. En un an, tout le monde a changé, et ces photos-là ne se refont pas." +
            "\n\nJe vous propose de nous retrouver pour votre portrait de l'année. Vos créneaux sont ici :\n" + link + "\n\nÀ très bientôt,\n" + sign,
        });
      }
    }

    var startYear = parseDay(today).y;
    SEASONS.forEach(function (s) {
      if (!d["s_" + s.key]) return;
      for (var sy = startYear; sy <= startYear + 2; sy++) {
        var when = sy + "-" + s.md;
        push(when, {
          season: true,
          title: s.name + " " + sy,
          message: "Bonjour,\n\n" + s.hook + " J'organise quelques créneaux autour du " + longDate(when) + ". " + s.line +
            "\n\nComme vous faites partie de mes clients, je vous les propose avant de les annoncer à tout le monde :\n" + link +
            "\n\nÀ bientôt,\n" + sign,
        }, Math.max(lead, SEASON_LEAD));
      }
    });

    out.sort(function (a, b) { return a.contact < b.contact ? -1 : a.contact > b.contact ? 1 : a.event < b.event ? -1 : 1; });
    return out;
  }

  /* ---------- Rendu ---------- */

  function renderLabels(d) {
    var L = LABELS[d.kind] || LABELS.baby;
    els.nameLabel.textContent = L.name;
    els.dateLabel.textContent = L.date;
    els.age.hidden = d.kind !== "baby";
  }

  function renderMessage() {
    var item = state.items[state.selected];
    if (!item) {
      els.msgTitle.textContent = "Le message";
      els.msg.textContent = "Choisissez une date de séance pour voir les messages.";
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
    renderLabels(d);
    var L = LABELS[d.kind] || LABELS.baby;
    els.title.textContent = d.name ? L.title + d.name : "Le calendrier de votre client";

    var items = occasions(d, today);
    state.items = items;
    state.d = d;
    // Par défaut, la première occasion propre au client plutôt qu'une saison.
    if (!keepSelection) {
      var first = 0;
      for (var k = 0; k < items.length; k++) if (!items[k].season) { first = k; break; }
      state.selected = first;
    }
    if (state.selected >= items.length) state.selected = 0;

    var personal = items.filter(function (it) { return !it.season; }).length;
    var price = number(d.price, 0, 100000);
    if (!parseDay(d.date)) {
      els.summary.textContent = "Indiquez la date pour voir le calendrier.";
    } else if (!items.length) {
      els.summary.textContent = "Aucune occasion dans les deux prochaines années : vérifiez la date, ou cochez une séance de saison.";
    } else {
      var text = items.length + " occasion" + (items.length > 1 ? "s" : "") + " de revenir dans les deux prochaines années";
      text += personal && personal < items.length ? ", dont " + personal + " rien que pour ce client." : ".";
      var won = Math.max(1, Math.round(items.length / 3));
      if (price) text += " Si une proposition sur trois aboutit, c'est environ " + euros(won * price) + " de séances en plus, sans un euro de publicité.";
      els.summary.textContent = text;
    }

    els.list.textContent = "";
    items.forEach(function (it, i) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "f-item" + (it.season ? " f-item-season" : "");
      btn.setAttribute("aria-pressed", String(i === state.selected));
      var when = document.createElement("span");
      when.className = "f-when";
      when.textContent = it.now ? "Maintenant" : shortDate(it.contact);
      if (it.now) when.classList.add("f-now");
      var what = document.createElement("span");
      what.className = "f-what";
      var strong = document.createElement("strong");
      strong.textContent = it.title;
      var em = document.createElement("em");
      em.textContent = (it.season ? "Séances vers le " : "Le ") + longDate(it.event, true);
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
  function ics(items) {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Holypixx//Calendrier de fidelite//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    items.forEach(function (it, i) {
      var day = it.contact.replace(/-/g, "");
      lines.push(
        "BEGIN:VEVENT",
        "UID:fidelite-" + day + "-" + i + "-" + Math.random().toString(36).slice(2, 10) + "@holypixx.com",
        "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + day,
        "DTEND;VALUE=DATE:" + addDays(it.contact, 1).replace(/-/g, ""),
        fold("SUMMARY:" + icsText("Proposer : " + it.title)),
        fold("DESCRIPTION:" + icsText((it.season ? "Séances vers le " : "Date : ") + longDate(it.event, true) + "\n\n" + it.message)),
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

  document.getElementById("f-copy").addEventListener("click", function () {
    var item = state.items[state.selected];
    if (!item) { toast("Aucun message à copier : indiquez d'abord la date."); return; }
    copy(item.message, "Message copié : ajoutez votre lien de réservation avant d'envoyer.");
  });
  document.getElementById("f-ics").addEventListener("click", function () {
    if (!state.items.length) { toast("Aucune occasion à ajouter pour cette date."); return; }
    var blob = new Blob([ics(state.items)], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "calendrier-" + (state.d && state.d.name ? state.d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client" : "client") + ".ics";
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
  if (!form.elements.date.value) form.elements.date.value = todayIso();

  form.addEventListener("input", function () { render(false); });
  form.addEventListener("change", function () { render(false); });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  render(false);
})();
