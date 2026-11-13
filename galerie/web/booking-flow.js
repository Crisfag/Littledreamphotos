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
    var booking = { offers: [], offer: null, slot: null, tier: 0, privateToken: new URLSearchParams(location.search).get("creneau") || "", private: null };

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

    function chooseOffer(offer, button) {
      booking.offer = offer;
      booking.slot = null;
      booking.tier = 0;
      pressOnly($("pf-bk-offers"), ".pf-bk-offer", button);
      $("pf-bk-form").hidden = true;
      var days = $("pf-bk-days");
      days.textContent = "";
      var byDay = [];
      var index = {};
      offer.slots.forEach(function (s) {
        var key = slotDay(s.startsAt);
        if (!(key in index)) { index[key] = byDay.length; byDay.push({ label: key, slots: [] }); }
        byDay[index[key]].slots.push(s);
      });
      byDay.forEach(function (day) {
        var wrap = el("div", "pf-bk-day");
        wrap.appendChild(el("h3", "", day.label));
        var times = el("div", "pf-bk-times");
        day.slots.forEach(function (s) {
          var b = el("button", "pf-bk-time", slotTime(s.startsAt));
          b.type = "button";
          b.setAttribute("aria-pressed", "false");
          b.setAttribute("aria-label", day.label + " à " + slotTime(s.startsAt));
          b.addEventListener("click", function () { chooseSlot(s, b); });
          times.appendChild(b);
        });
        wrap.appendChild(times);
        days.appendChild(wrap);
      });
      $("pf-bk-when").hidden = false;
      $("pf-bk-when").scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      $("pf-bk-when").hidden = true;
      $("pf-bk-form").hidden = true;
      if (offers.length === 1) chooseOffer(offers[0], list.firstChild);
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
