/* =====================================================================
   Holypixx — guide « Mini-séances » : le calculateur. À partir des
   horaires, de la durée, du battement et du prix, il liste les créneaux,
   chiffre la journée complète et rédige l'annonce à publier. Rien n'est
   envoyé : les réglages restent dans le navigateur.
   ===================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("r-form");
  if (!form) return;
  var STORE = "holypixx-mini-seances";
  var FIELDS = ["theme", "date", "start", "end", "lunch", "lunchStart", "lunchEnd", "duration", "gap", "price", "deposit", "photos"];
  var els = {
    title: document.getElementById("r-plan-title"),
    date: document.getElementById("r-plan-date"),
    summary: document.getElementById("r-summary"),
    slots: document.getElementById("r-slots"),
    post: document.getElementById("r-post-text"),
    lunchRow: document.getElementById("r-lunch"),
    toast: document.getElementById("toast"),
  };
  var last = { slots: [], post: "" };

  function minutes(value) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function hhmm(total) {
    var h = Math.floor(total / 60);
    var m = total % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function spoken(total) {
    var h = Math.floor(total / 60);
    var m = total % 60;
    return h + " h" + (m ? " " + (m < 10 ? "0" : "") + m : "");
  }
  function number(value, min, max) {
    var n = parseFloat(String(value || "").replace(/\s/g, "").replace(",", "."));
    if (!isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }
  function euros(n) {
    var whole = Math.round(n * 100) % 100 === 0;
    return n.toLocaleString("fr-BE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }) + " €";
  }

  function read() {
    var d = {};
    FIELDS.forEach(function (name) {
      var el = form.elements[name];
      d[name] = el.type === "checkbox" ? el.checked : String(el.value || "").trim();
    });
    return d;
  }

  // Les créneaux : on avance d'une durée plus un battement ; un créneau qui
  // mordrait sur la pause de midi reprend à la fin de la pause.
  function plan(d) {
    var start = minutes(d.start);
    var end = minutes(d.end);
    var duration = number(d.duration, 5, 240);
    var gap = number(d.gap, 0, 120);
    if (start === null || end === null || !duration || end <= start) return { slots: [], duration: duration };
    var lunchStart = d.lunch ? minutes(d.lunchStart) : null;
    var lunchEnd = d.lunch ? minutes(d.lunchEnd) : null;
    var hasLunch = lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart;
    var slots = [];
    var t = start;
    var guard = 0;
    while (t + duration <= end && guard++ < 500) {
      if (hasLunch && t < lunchEnd && t + duration > lunchStart) {
        t = Math.max(t, lunchEnd);
        continue;
      }
      slots.push({ from: t, to: t + duration });
      t += duration + (gap || 0);
    }
    return { slots: slots, duration: duration };
  }

  function longDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    return new Date(iso + "T12:00:00Z").toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Brussels" });
  }

  function render() {
    var d = read();
    els.lunchRow.hidden = !d.lunch;
    var p = plan(d);
    var slots = p.slots;
    var price = number(d.price, 0, 100000);
    var deposit = number(d.deposit, 0, 100);
    var photos = number(d.photos, 0, 999);
    var theme = d.theme || "Mini-séances";
    var when = longDate(d.date);

    els.title.textContent = theme;
    els.date.textContent = when ? when.charAt(0).toUpperCase() + when.slice(1) : "Date à choisir";

    if (!slots.length) {
      els.summary.textContent = "Aucun créneau ne tient dans ces horaires : avancez le début, reculez la fin ou raccourcissez les séances.";
    } else {
      var text = slots.length + " créneau" + (slots.length > 1 ? "x" : "") + " de " + p.duration + " minutes, de " + spoken(slots[0].from) + " à " + spoken(slots[slots.length - 1].to) + ".";
      if (price) {
        text += " Complète, la journée rapporte " + euros(slots.length * price);
        text += deposit ? ", dont " + euros(slots.length * price * deposit / 100) + " d'acomptes encaissés dès la réservation." : ".";
      }
      els.summary.textContent = text;
    }

    els.slots.textContent = "";
    var lunchMark = false;
    slots.forEach(function (s, i) {
      if (d.lunch && !lunchMark && i > 0 && s.from >= minutes(d.lunchEnd) && slots[i - 1].to <= minutes(d.lunchStart)) {
        var pause = document.createElement("li");
        pause.className = "r-pause";
        pause.textContent = "Pause";
        els.slots.appendChild(pause);
        lunchMark = true;
      }
      var li = document.createElement("li");
      li.textContent = hhmm(s.from) + " – " + hhmm(s.to);
      els.slots.appendChild(li);
    });

    // L'annonce, sobre et complète : ce que les familles demandent toujours.
    var lines = [theme + (when ? " · " + when : "")];
    lines.push("");
    var offer = [];
    if (p.duration) offer.push(p.duration + " minutes de séance");
    if (photos) offer.push(photos + " photo" + (photos > 1 ? "s" : "") + " retouchée" + (photos > 1 ? "s" : ""));
    if (price) offer.push(euros(price) + " par famille");
    if (offer.length) lines.push(offer.join(", ") + ".");
    if (slots.length) lines.push(slots.length + " créneau" + (slots.length > 1 ? "x" : "") + " seulement, de " + spoken(slots[0].from) + " à " + spoken(slots[slots.length - 1].to) + ".");
    lines.push("");
    lines.push("Réservez votre créneau en ligne" + (price && deposit ? " : un acompte de " + euros(price * deposit / 100) + " confirme la réservation." : "."));
    lines.push("Vos photos arrivent dans une galerie privée" + (/no[eë]l|f[eê]tes/i.test(theme) ? ", à temps pour les cadeaux." : "."));
    lines.push("");
    lines.push("[votre lien de réservation]");
    els.post.textContent = lines.join("\n");

    last = { slots: slots, post: lines.join("\n") };
    try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (err) { /* navigation privée */ }
  }

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

  document.getElementById("r-copy-slots").addEventListener("click", function () {
    if (!last.slots.length) { toast("Aucun créneau à copier pour ces horaires."); return; }
    copy(last.slots.map(function (s) { return hhmm(s.from) + " – " + hhmm(s.to); }).join("\n"), "Horaires copiés.");
  });
  document.getElementById("r-copy-post").addEventListener("click", function () {
    copy(last.post, "Annonce copiée : ajoutez votre lien de réservation avant de publier.");
  });

  form.addEventListener("input", render);
  form.addEventListener("change", render);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  render();
})();
