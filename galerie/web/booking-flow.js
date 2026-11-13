// Réservation en ligne : le parcours commun au mini-site (portfolio.js) et à
// la page de réservation seule (reserver.html, reserver.js) — formules,
// créneaux, tarifs, coordonnées, acompte par Stripe, créneau privé ouvert par
// son lien (?creneau=…). Les deux pages portent les mêmes éléments
// (#reserver, #pf-bk-…).
//
//   var flow = HolypixxBooking.create({ api, handle, page, basePath, studioName, onAvailable });
//   flow.load();          // ou flow.handleReturn() au retour de Stripe
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function create(options) {
    var API = options.api;
    var handle = options.handle;
    var pageMode = Boolean(options.page);


    var BOOKING_ZONE = "Europe/Brussels";
    // Créneau privé : lien secret envoyé par le photographe (?creneau=…), qui
    // n'affiche que ce créneau et pré-remplit les coordonnées du client.
    var booking = { offers: [], offer: null, slot: null, tier: 0, filter: "", date: "", month: "", privateToken: new URLSearchParams(location.search).get("creneau") || "", private: null };

    function euros(cents) {
      return (cents / 100).toLocaleString("fr-BE", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
    }
    function duration(minutes) {
      if (minutes < 60) return minutes + " min";
      var m = minutes % 60;
      return Math.floor(minutes / 60) + " h" + (m ? " " + String(m).padStart(2, "0") : "");
    }
    function slotDay(ts) {
      return new Date(ts * 1000).toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: BOOKING_ZONE });
    }
    function slotTime(ts) {
      return new Date(ts * 1000).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: BOOKING_ZONE }).replace(":", " h ");
    }
    // ?page=1 : appel depuis la page de réservation seule (le Worker vérifie
    // que cette porte d'entrée est ouverte).
    function bookingApi(path) {
      var url = API + "/api/booking/" + encodeURIComponent(handle) + path;
      return pageMode ? url + (url.indexOf("?") === -1 ? "?" : "&") + "page=1" : url;
    }
    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function pressOnly(container, selector, active) {
      container.querySelectorAll(selector).forEach(function (n) { n.setAttribute("aria-pressed", String(n === active)); });
    }

    /* ---------- Agenda : un mois, les jours où une séance est libre ---------- */

    // « 2026-11-30 » à l'heure de Bruxelles.
    function dayKey(ts) {
      return new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: BOOKING_ZONE });
    }
    function keyLabel(key) {
      var p = key.split("-").map(Number);
      return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    }
    function monthOf(key) { return key.slice(0, 7); }
    function shiftMonth(month, delta) {
      var p = month.split("-").map(Number);
      var d = new Date(Date.UTC(p[0], p[1] - 1 + delta, 1));
      return d.toISOString().slice(0, 7);
    }

    // Créneaux visibles (formule choisie, ou toutes), groupés par jour.
    function slotsByDay() {
      var map = {};
      booking.offers.forEach(function (o) {
        if (booking.filter && booking.filter !== o.id) return;
        o.slots.forEach(function (s) {
          var key = dayKey(s.startsAt);
          (map[key] = map[key] || []).push({ slot: s, offer: o });
        });
      });
      Object.keys(map).forEach(function (k) { map[k].sort(function (a, b) { return a.slot.startsAt - b.slot.startsAt; }); });
      return map;
    }

    function renderCalendar() {
      var map = slotsByDay();
      var keys = Object.keys(map).sort();
      var cal = $("pf-bk-cal");
      cal.textContent = "";
      if (!keys.length) {
        cal.appendChild(el("p", "pf-bk-cal-empty", "Plus aucun créneau libre pour cette séance. Choisissez-en une autre, ou contactez le studio."));
        $("pf-bk-days").textContent = "";
        return;
      }
      var first = monthOf(keys[0]);
      var last = monthOf(keys[keys.length - 1]);
      if (!booking.month || booking.month < first) booking.month = first;
      if (booking.month > last) booking.month = last;
      var month = booking.month;
      var p = month.split("-").map(Number);

      var head = el("div", "pf-bk-cal-head");
      var prev = el("button", "pf-bk-cal-nav", "‹");
      prev.type = "button";
      prev.setAttribute("aria-label", "Mois précédent");
      prev.disabled = month <= first;
      prev.addEventListener("click", function () { booking.month = shiftMonth(month, -1); renderCalendar(); });
      var next = el("button", "pf-bk-cal-nav", "›");
      next.type = "button";
      next.setAttribute("aria-label", "Mois suivant");
      next.disabled = month >= last;
      next.addEventListener("click", function () { booking.month = shiftMonth(month, 1); renderCalendar(); });
      var title = el("h3", "pf-bk-cal-month", new Date(Date.UTC(p[0], p[1] - 1, 1)).toLocaleDateString("fr-BE", { month: "long", year: "numeric", timeZone: "UTC" }));
      title.id = "pf-bk-cal-title";
      head.appendChild(prev);
      head.appendChild(title);
      head.appendChild(next);
      cal.appendChild(head);

      var grid = el("div", "pf-bk-cal-grid");
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-labelledby", "pf-bk-cal-title");
      ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].forEach(function (d) {
        var h = el("span", "pf-bk-cal-wd", d);
        h.setAttribute("aria-hidden", "true");
        grid.appendChild(h);
      });
      var offset = (new Date(Date.UTC(p[0], p[1] - 1, 1)).getUTCDay() + 6) % 7;
      for (var i = 0; i < offset; i++) grid.appendChild(el("span", "pf-bk-cal-pad"));
      var daysInMonth = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
      var today = new Date().toLocaleDateString("en-CA", { timeZone: BOOKING_ZONE });
      for (var d = 1; d <= daysInMonth; d++) {
        var key = month + "-" + String(d).padStart(2, "0");
        var list = map[key];
        if (!list) {
          var off = el("span", "pf-bk-cal-day" + (key === today ? " pf-bk-cal-today" : ""), String(d));
          off.setAttribute("aria-hidden", "true");
          grid.appendChild(off);
          continue;
        }
        var b = el("button", "pf-bk-cal-day pf-bk-cal-open" + (key === today ? " pf-bk-cal-today" : ""));
        b.type = "button";
        b.appendChild(el("span", "pf-bk-cal-num", String(d)));
        // Un point par créneau (trois au plus) : le nombre exact est dans l'étiquette.
        var dots = el("span", "pf-bk-cal-count");
        dots.setAttribute("data-count", String(list.length));
        for (var k = 0; k < Math.min(3, list.length); k++) dots.appendChild(el("i"));
        b.appendChild(dots);
        b.setAttribute("aria-pressed", String(key === booking.date));
        b.setAttribute("aria-label", keyLabel(key) + " : " + list.length + " créneau" + (list.length > 1 ? "x" : "") + " libre" + (list.length > 1 ? "s" : ""));
        b.setAttribute("data-date", key);
        b.addEventListener("click", (function (k) { return function () { chooseDate(k, true); }; })(key));
        grid.appendChild(b);
      }
      cal.appendChild(grid);
    }

    // Les séances libres d'un jour, groupées par formule.
    function chooseDate(key, byUser) {
      booking.date = key;
      booking.month = monthOf(key);
      booking.slot = null;
      $("pf-bk-form").hidden = true;
      renderCalendar();
      var list = slotsByDay()[key] || [];
      var days = $("pf-bk-days");
      days.textContent = "";
      var label = keyLabel(key);
      var heading = el("h3", "pf-bk-day-title", label.charAt(0).toUpperCase() + label.slice(1));
      heading.appendChild(el("span", "pf-bk-day-count", list.length + " créneau" + (list.length > 1 ? "x" : "") + " libre" + (list.length > 1 ? "s" : "")));
      days.appendChild(heading);
      var groups = [];
      var index = {};
      list.forEach(function (item) {
        if (!(item.offer.id in index)) { index[item.offer.id] = groups.length; groups.push({ offer: item.offer, slots: [] }); }
        groups[index[item.offer.id]].slots.push(item.slot);
      });
      groups.forEach(function (g) {
        var o = g.offer;
        var wrap = el("div", "pf-bk-day");
        var name = el("p", "pf-bk-day-offer");
        name.appendChild(el("strong", "", o.title));
        var tiers = o.tiers || [];
        name.appendChild(el("span", "", " · " + [duration(o.durationMin), tiers.length ? "dès " + euros(o.priceCents) : (o.priceCents ? euros(o.priceCents) : "")].filter(Boolean).join(" · ")));
        wrap.appendChild(name);
        var times = el("div", "pf-bk-times");
        g.slots.forEach(function (s) {
          var b = el("button", "pf-bk-time", slotTime(s.startsAt));
          b.type = "button";
          b.setAttribute("aria-pressed", "false");
          b.setAttribute("aria-label", o.title + ", " + label + " à " + slotTime(s.startsAt));
          b.addEventListener("click", function () {
            if (booking.offer !== o) booking.tier = 0;
            booking.offer = o;
            chooseSlot(s, b);
          });
          times.appendChild(b);
        });
        wrap.appendChild(times);
        days.appendChild(wrap);
      });
      if (byUser) days.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // Une formule choisie filtre l'agenda ; un second clic les remontre toutes.
    function chooseOffer(offer, button) {
      var all = booking.offers.length > 1 && booking.filter === offer.id;
      booking.filter = all ? "" : offer.id;
      pressOnly($("pf-bk-offers"), ".pf-bk-offer", all ? null : button);
      showCalendar(true);
    }

    function showCalendar(byUser) {
      var map = slotsByDay();
      var keys = Object.keys(map).sort();
      if (!booking.date || !map[booking.date]) booking.date = keys[0] || "";
      booking.month = booking.date ? monthOf(booking.date) : "";
      $("pf-bk-when").hidden = false;
      if (booking.date) chooseDate(booking.date, false);
      else renderCalendar();
      if (byUser) $("pf-bk-when").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function photosText(n) {
      return n + " photo" + (n > 1 ? "s" : "");
    }

    // Formule à plusieurs tarifs : « 10 photos · 120 € », au choix du client.
    function renderTiers(o) {
      var tiers = o.tiers || [];
      var box = $("pf-bk-tiers");
      box.textContent = "";
      $("pf-bk-tier-step").hidden = !tiers.length;
      $("pf-bk-step-contact").textContent = (tiers.length ? "4" : "3") + ". Vos coordonnées";
      if (booking.tier >= tiers.length) booking.tier = 0;
      tiers.forEach(function (t, i) {
        var b = el("button", "pf-bk-tier");
        b.type = "button";
        b.setAttribute("aria-pressed", String(i === booking.tier));
        b.appendChild(el("strong", "", photosText(t.photos)));
        b.appendChild(el("span", "pf-bk-tier-price", euros(t.priceCents)));
        if (t.label) b.appendChild(el("span", "pf-bk-tier-label", t.label));
        b.addEventListener("click", function () {
          booking.tier = i;
          pressOnly(box, ".pf-bk-tier", b);
          updateSummary();
        });
        box.appendChild(b);
      });
    }

    function updateSummary() {
      var o = booking.offer;
      var slot = booking.slot;
      var tier = o.tiers && o.tiers.length ? o.tiers[booking.tier] : null;
      $("pf-bk-summary").textContent = o.title + " · " + slotDay(slot.startsAt) + " à " + slotTime(slot.startsAt) + " · " + duration(o.durationMin) +
        (tier ? " · " + photosText(tier.photos) + ", " + euros(tier.priceCents) : "") +
        (o.location ? " · " + o.location : "");
      $("pf-bk-dress-text").textContent = o.dressCode || "";
      $("pf-bk-dress").hidden = !o.dressCode;
    }

    function chooseSlot(slot, button) {
      booking.slot = slot;
      pressOnly($("pf-bk-days"), ".pf-bk-time", button);
      var o = booking.offer;
      renderTiers(o);
      updateSummary();
      $("pf-bk-submit").textContent = o.depositCents ? "Réserver et payer l'acompte (" + euros(o.depositCents) + ")" : "Confirmer la réservation";
      $("pf-bk-error").hidden = true;
      $("pf-bk-form").hidden = false;
      $("pf-bk-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function showBookingResult(title, lines, retry) {
      var box = $("pf-bk-result");
      box.textContent = "";
      box.appendChild(el("h3", "", title));
      lines.filter(Boolean).forEach(function (line) { box.appendChild(el("p", "", line)); });
      if (retry === true) {
        var again = el("button", "pf-btn pf-btn-ghost", "Choisir un autre créneau");
        again.type = "button";
        again.addEventListener("click", function () { box.hidden = true; $("pf-bk-flow").hidden = false; loadBooking(); });
        box.appendChild(again);
      }
      box.hidden = false;
      // Après un échec, le parcours reste affiché sous le message ; après une
      // réservation réussie, seul le message reste.
      $("pf-bk-flow").hidden = retry !== true;
      $("reserver").hidden = false;
    }

    function confirmedLines(r) {
      var rest = r.priceCents > r.depositCents ? r.priceCents - r.depositCents : 0;
      return [
        r.offerTitle + ", " + slotDay(r.startsAt) + " à " + slotTime(r.startsAt) + " (" + duration(r.durationMin) + ")" + (r.location ? ", " + r.location : "") + ".",
        r.photos ? "Votre formule : " + photosText(r.photos) + " retouchée" + (r.photos > 1 ? "s" : "") + (r.tierLabel ? " (" + r.tierLabel + ")" : "") + ", " + euros(r.priceCents) + "." : "",
        r.depositCents ? "Acompte réglé : " + euros(r.depositCents) + (rest ? " ; reste à régler : " + euros(rest) + "." : ".") : "",
        r.dressCode ? "Conseil vestimentaire : " + r.dressCode : "",
        "Un e-mail de confirmation vient de partir, avec l'invitation pour votre agenda.",
      ];
    }

    function renderOffers(offers) {
      booking.offers = offers;
      var list = $("pf-bk-offers");
      list.textContent = "";
      offers.forEach(function (o) {
        var b = el("button", "pf-bk-offer" + (o.imageId ? " pf-bk-offer-pic" : ""));
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        if (o.imageId) {
          var pic = el("img", "pf-bk-offer-img");
          pic.src = bookingApi("/image/" + encodeURIComponent(o.imageId));
          pic.alt = "";
          pic.loading = "lazy";
          pic.decoding = "async";
          pic.addEventListener("error", function () { pic.remove(); b.classList.remove("pf-bk-offer-pic"); });
          b.appendChild(pic);
        }
        b.appendChild(el("strong", "", o.title));
        var tiers = o.tiers || [];
        var fewest = tiers.length ? Math.min.apply(null, tiers.map(function (t) { return t.photos; })) : 0;
        var most = tiers.length ? Math.max.apply(null, tiers.map(function (t) { return t.photos; })) : 0;
        b.appendChild(el("span", "pf-bk-meta", [
          duration(o.durationMin),
          tiers.length ? (fewest === most ? photosText(fewest) : fewest + " à " + most + " photos") + ", à partir de " + euros(o.priceCents) : (o.priceCents ? euros(o.priceCents) : ""),
          o.depositCents ? "acompte de " + euros(o.depositCents) + " à la réservation" : "",
          o.location,
        ].filter(Boolean).join(" · ")));
        if (o.description) b.appendChild(el("span", "pf-bk-desc", o.description));
        // « Compris dans votre forfait » : une ligne par élément.
        var included = String(o.included || "").split(/\n+/).map(function (l) { return l.replace(/^[-•*·\s]+/, "").trim(); }).filter(Boolean);
        if (included.length) {
          var box = el("span", "pf-bk-included");
          box.appendChild(el("span", "pf-bk-included-title", "Compris dans votre forfait"));
          included.forEach(function (line) { box.appendChild(el("span", "pf-bk-included-item", line)); });
          b.appendChild(box);
        }
        b.addEventListener("click", function () { chooseOffer(o, b); });
        list.appendChild(b);
      });
      $("pf-bk-form").hidden = true;
      // Une seule formule : choisie d'office ; plusieurs : l'agenda les montre toutes.
      booking.filter = offers.length === 1 ? offers[0].id : "";
      booking.date = "";
      if (offers.length === 1) pressOnly(list, ".pf-bk-offer", list.firstChild);
      var hint = $("pf-bk-offers-hint");
      if (hint) hint.hidden = offers.length < 2;
      showCalendar(false);
    }

    function showPrivateNote(text, isError) {
      var note = $("pf-bk-private");
      if (!note) return;
      note.textContent = text || "";
      note.className = "pf-bk-private" + (isError ? " pf-bk-private-error" : "");
      note.hidden = !text;
    }

    function loadBooking() {
      var token = booking.privateToken;
      return fetch(bookingApi(token ? "?creneau=" + encodeURIComponent(token) : ""))
        .then(function (res) { return res.ok ? res.json() : { offers: [] }; })
        .then(function (json) {
          var offers = json.offers || [];
          if (options.onData) options.onData(json);
          booking.private = json.private || null;
          if (booking.private) {
            var studio = (options.studioName && options.studioName()) || json.studioName || "Le studio";
            showPrivateNote(studio + " a gardé ce créneau pour vous : il n'est visible par personne d'autre. Il ne reste qu'à le confirmer.");
            renderOffers([booking.private.offer]);
            var only = $("pf-bk-days").querySelector(".pf-bk-time");
            if (only) only.click();
            var form = $("pf-bk-form");
            if (!form.elements.name.value) form.elements.name.value = booking.private.clientName || "";
            if (!form.elements.email.value) form.elements.email.value = booking.private.clientEmail || "";
            $("reserver").hidden = false;
            if (options.onAvailable) options.onAvailable({ private: true, data: json });
            $("reserver").scrollIntoView();
            return true;
          }
          if (json.privateError) {
            showPrivateNote(json.privateError + (offers.length ? " Voici les autres disponibilités du studio." : ""), true);
            booking.privateToken = "";
            if (!offers.length) {
              $("pf-bk-flow").hidden = true;
              $("reserver").hidden = false;
              $("reserver").scrollIntoView();
              return true;
            }
          }
          if (!offers.length) return false;
          renderOffers(offers);
          if (json.privateError) $("reserver").scrollIntoView();
          $("reserver").hidden = false;
          if (options.onAvailable) options.onAvailable({ private: false, data: json });
          return true;
        })
        .catch(function () { return false; });
    }

    // Retour de Stripe (paiement de l'acompte réussi ou abandonné).
    function handleBookingReturn() {
      var params = new URLSearchParams(location.search);
      var id = params.get("reservation");
      if (!id) return;
      var cleanUrl = options.basePath() + "#reserver";
      history.replaceState(null, "", cleanUrl);
      if (params.get("annule")) {
        fetch(bookingApi("/release/" + encodeURIComponent(id)), { method: "POST" }).finally(function () {
          loadBooking().then(function () {
            showBookingResult("Paiement interrompu", ["Votre créneau n'a pas été réservé. Vous pouvez en choisir un autre, ou le même s'il est toujours libre."], true);
            $("reserver").scrollIntoView();
          });
        });
        return;
      }
      var session = params.get("session_id") || "";
      var attempts = 0;
      (function poll() {
        fetch(bookingApi("/reservation/" + encodeURIComponent(id) + (session ? "?session_id=" + encodeURIComponent(session) : "")))
          .then(function (res) { return res.json(); })
          .then(function (json) {
            var r = json.reservation;
            if (!r) throw new Error();
            if (r.status === "confirmed") {
              showBookingResult("Votre séance est réservée", confirmedLines(r), "hide");
            } else if (r.status === "pending" && attempts++ < 5) {
              showBookingResult("Confirmation du paiement…", ["Un instant, nous attendons la confirmation de votre banque."], "hide");
              setTimeout(poll, 2000);
              return;
            } else if (r.status === "pending") {
              showBookingResult("Paiement en cours de confirmation", ["Vous recevrez un e-mail dès que votre banque l'aura confirmé."], "hide");
            } else {
              showBookingResult("Réservation non aboutie", ["Le délai de paiement est dépassé ou le créneau n'est plus disponible. Choisissez-en un autre."], true);
              loadBooking();
            }
            $("reserver").scrollIntoView();
          })
          .catch(function () {
            showBookingResult("Réservation introuvable", ["Contactez directement le studio si vous avez réglé un acompte."], "hide");
          });
      })();
    }

    $("pf-bk-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var error = $("pf-bk-error");
      var fields = {
        slotId: booking.slot && booking.slot.id,
        privateToken: booking.private ? booking.privateToken : undefined,
        tier: booking.offer && booking.offer.tiers && booking.offer.tiers.length ? booking.tier : undefined,
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        phone: form.elements.phone.value.trim(),
        message: form.elements.message.value.trim(),
        website: form.elements.website.value,
        returnUrl: location.origin + options.basePath(),
      };
      var problem = !fields.slotId ? "Choisissez un créneau."
        : !fields.name ? "Indiquez votre nom."
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) ? "Indiquez une adresse e-mail valide."
        : "";
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      error.hidden = true;
      var submit = $("pf-bk-submit");
      var label = submit.textContent;
      submit.disabled = true;
      submit.textContent = "Un instant…";
      try {
        var res = await fetch(bookingApi("/book"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fields),
        });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          if (res.status === 409) loadBooking();
          throw new Error(body.error || "La réservation n'a pas pu aboutir.");
        }
        if (body.url) {
          // Page intégrée à un autre site : le paiement Stripe ne s'ouvre
          // pas dans un cadre, la page hôte décide (reserver.js).
          if (options.openPayment) options.openPayment(body.url);
          else location.href = body.url;
          return;
        }
        var o = booking.offer;
        var chosen = o.tiers && o.tiers.length ? o.tiers[booking.tier] : null;
        showBookingResult("Votre séance est réservée", confirmedLines({
          offerTitle: o.title, startsAt: booking.slot.startsAt, durationMin: o.durationMin, location: o.location, depositCents: 0,
          priceCents: chosen ? chosen.priceCents : o.priceCents, photos: chosen ? chosen.photos : null, tierLabel: chosen ? chosen.label : "",
          dressCode: o.dressCode || "",
        }), "hide");
        $("reserver").scrollIntoView();
      } catch (err) {
        error.textContent = err.message || "La réservation n'a pas pu aboutir. Réessayez dans un instant.";
        error.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = label;
      }
    });

    return { load: loadBooking, handleReturn: handleBookingReturn, euros: euros, duration: duration, el: el, pressOnly: pressOnly, photosText: photosText };
  }

  window.HolypixxBooking = { create: create };
})();
