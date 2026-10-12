// Mini-site portfolio : lit le portfolio publié au Worker et remplit la page
// (couverture, travaux, présentation, prestations, contact), avec une
// visionneuse plein écran et le formulaire de contact.
(function () {
  "use strict";

  var CONFIG = window.PORTFOLIO_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/+$/, "");
  var handle = String(CONFIG.handle || new URLSearchParams(location.search).get("s") || "").trim().toLowerCase();
  var data = null;
  var current = 0;

  function $(id) { return document.getElementById(id); }

  function photoUrl(photo) {
    return API + "/api/portfolio/" + encodeURIComponent(handle) + "/photo/" + encodeURIComponent(photo.id);
  }

  function showMissing() {
    $("pf-loading").hidden = true;
    $("pf-missing").hidden = false;
    document.title = "Portfolio introuvable — Holypixx";
    // Une page vide n'a rien à faire dans les résultats de recherche.
    var robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.appendChild(robots);
  }

  // Adresse de référence (celle du studio quand il en a une) et données
  // structurées, si le serveur ne les a pas déjà écrites dans la page.
  function setSeo() {
    if (data.url && !document.querySelector('link[rel="canonical"]')) {
      var link = document.createElement("link");
      link.rel = "canonical";
      link.href = data.url;
      document.head.appendChild(link);
    }
    if (document.querySelector('script[type="application/ld+json"]')) return;
    var info = {
      "@context": "https://schema.org",
      "@type": "ProfessionalService",
      name: data.studioName,
      url: data.url || location.href,
    };
    if (data.headline) info.description = data.headline;
    if (data.photos.length) info.image = photoUrl(data.photos[0]);
    if (data.city) info.address = { "@type": "PostalAddress", addressLocality: data.city };
    var sameAs = [data.links.instagram, data.links.website].filter(Boolean);
    if (sameAs.length) info.sameAs = sameAs;
    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(info);
    document.head.appendChild(script);
  }

  function setMeta(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (el) el.setAttribute("content", content);
  }

  // Les photos ne se téléchargent pas d'un clic droit ou d'un glisser.
  function guardImage(img) {
    img.draggable = false;
    img.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  /* ---------- Remplissage ---------- */

  function render() {
    var name = data.studioName;
    document.title = name + (data.city ? " — Photographe à " + data.city : " — Photographe");
    setMeta("description", data.headline || ("Portfolio de " + name + ", photographe" + (data.city ? " à " + data.city : "") + "."));
    setSeo();

    $("pf-brand").textContent = name;
    $("pf-studio").textContent = name;
    $("pf-foot-name").textContent = name;
    $("pf-privacy-name").textContent = name;
    $("pf-year").textContent = new Date().getFullYear();
    if (data.city) { $("pf-city").textContent = data.city; $("pf-city").hidden = false; }
    if (data.headline) { $("pf-headline").textContent = data.headline; $("pf-headline").hidden = false; }

    var hero = $("pf-hero-img");
    if (data.photos.length) {
      hero.src = photoUrl(data.photos[0]);
      guardImage(hero);
    }

    var grid = $("pf-grid");
    data.photos.forEach(function (photo, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pf-tile";
      btn.setAttribute("aria-label", "Agrandir la photo " + (index + 1) + " sur " + data.photos.length);
      var img = document.createElement("img");
      img.alt = "Photo " + (index + 1) + " — " + name;
      img.width = photo.width;
      img.height = photo.height;
      img.loading = index < 4 ? "eager" : "lazy";
      img.decoding = "async";
      img.addEventListener("load", function () { img.classList.add("pf-loaded"); });
      img.src = photoUrl(photo);
      // Déjà en cache (la couverture) : affichée sans attendre l'évènement.
      if (img.complete && img.naturalWidth) img.classList.add("pf-loaded");
      guardImage(img);
      btn.appendChild(img);
      btn.addEventListener("click", function () { openLightbox(index); });
      grid.appendChild(btn);
    });

    var hasBio = Boolean(data.bio);
    var hasServices = data.services && data.services.length > 0;
    if (hasBio || hasServices) {
      $("apropos").hidden = false;
      var bio = $("pf-bio");
      String(data.bio || "").split(/\n{2,}/).forEach(function (block) {
        if (!block.trim()) return;
        var p = document.createElement("p");
        block.split("\n").forEach(function (line, i) {
          if (i) p.appendChild(document.createElement("br"));
          p.appendChild(document.createTextNode(line));
        });
        bio.appendChild(p);
      });
      if (!hasBio) $("pf-about-title").textContent = "Prestations";
      if (hasServices) {
        $("pf-services-wrap").hidden = false;
        if (!hasBio) $("pf-services-wrap").querySelector("h3").hidden = true;
        data.services.forEach(function (s) {
          var li = document.createElement("li");
          li.textContent = s;
          $("pf-services").appendChild(li);
        });
      }
    } else {
      $("pf-nav-about").hidden = true;
    }

    var links = $("pf-links");
    function addLink(label, href, text) {
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.textContent = label;
      var a = document.createElement("a");
      a.href = href;
      a.textContent = text;
      if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
      li.appendChild(span);
      li.appendChild(a);
      links.appendChild(li);
    }
    if (data.links.phone) addLink("Téléphone", "tel:" + data.links.phone.replace(/[^+0-9]/g, ""), data.links.phone);
    if (data.links.instagram) addLink("Instagram", data.links.instagram, "@" + data.links.instagramHandle);
    if (data.links.website) addLink("Site", data.links.website, data.links.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));

    var hasLinks = links.children.length > 0;
    if (data.contact || hasLinks) {
      $("contact").hidden = false;
      $("pf-form").hidden = !data.contact;
      if (!data.contact) $("pf-contact-lede").textContent = "Un projet, une date, une question ? Voici où me joindre.";
    } else {
      $("pf-nav-contact").hidden = true;
      $("pf-hero-cta").hidden = true;
    }

    $("pf-loading").hidden = true;
    $("pf-page").hidden = false;
    onScroll();
  }

  /* ---------- Barre du haut : transparente sur la couverture ---------- */

  function onScroll() {
    var top = document.querySelector(".pf-top");
    var hero = $("pf-hero");
    if (!top || !hero) return;
    top.classList.toggle("pf-top-solid", window.scrollY > hero.offsetHeight - 80);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Visionneuse ---------- */

  var lastFocus = null;

  function showPhoto(index) {
    var count = data.photos.length;
    current = (index + count) % count;
    var img = $("pf-lb-img");
    img.src = photoUrl(data.photos[current]);
    img.alt = "Photo " + (current + 1) + " — " + data.studioName;
    $("pf-lb-count").textContent = (current + 1) + " / " + count;
  }

  function openLightbox(index) {
    lastFocus = document.activeElement;
    showPhoto(index);
    $("pf-lightbox").hidden = false;
    document.body.style.overflow = "hidden";
    $("pf-lb-close").focus();
  }

  function closeLightbox() {
    $("pf-lightbox").hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $("pf-lb-close").addEventListener("click", closeLightbox);
  $("pf-lb-prev").addEventListener("click", function () { showPhoto(current - 1); });
  $("pf-lb-next").addEventListener("click", function () { showPhoto(current + 1); });
  $("pf-lightbox").addEventListener("click", function (e) {
    if (e.target === $("pf-lightbox")) closeLightbox();
  });
  guardImage($("pf-lb-img"));
  document.addEventListener("keydown", function (e) {
    if ($("pf-lightbox").hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") showPhoto(current - 1);
    else if (e.key === "ArrowRight") showPhoto(current + 1);
    else if (e.key === "Tab") {
      // Le focus reste dans la visionneuse tant qu'elle est ouverte.
      var buttons = Array.prototype.filter.call($("pf-lightbox").querySelectorAll("button"), function (b) { return b.offsetParent !== null; });
      var i = buttons.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (!e.shiftKey && i === buttons.length - 1) { e.preventDefault(); buttons[0].focus(); }
    }
  });
  var touchX = null;
  $("pf-lightbox").addEventListener("touchstart", function (e) { touchX = e.touches[0].clientX; }, { passive: true });
  $("pf-lightbox").addEventListener("touchend", function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) showPhoto(current + (dx < 0 ? 1 : -1));
  });

  /* ---------- Formulaire de contact ---------- */

  $("pf-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = $("pf-form-error");
    var fields = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      eventDate: form.elements.eventDate.value.trim(),
      message: form.elements.message.value.trim(),
      website: form.elements.website.value,
    };
    var problem = !fields.name ? "Indiquez votre nom."
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) ? "Indiquez une adresse e-mail valide."
      : fields.message.length < 10 ? "Écrivez quelques mots sur votre projet."
      : "";
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    var submit = $("pf-submit");
    submit.disabled = true;
    submit.textContent = "Envoi…";
    try {
      var res = await fetch(API + "/api/portfolio/" + encodeURIComponent(handle) + "/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || "Le message n'a pas pu partir.");
      form.hidden = true;
      $("pf-sent").hidden = false;
    } catch (err) {
      error.textContent = err.message || "Le message n'a pas pu partir. Réessayez dans un instant.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Envoyer le message";
    }
  });


  /* ---------- Réservation en ligne ---------- */

  var BOOKING_ZONE = "Europe/Brussels";
  var booking = { offers: [], offer: null, slot: null, tier: 0 };

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
  function bookingApi(path) {
    return API + "/api/booking/" + encodeURIComponent(handle) + path;
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
      "Un e-mail de confirmation vient de partir, avec l'invitation pour votre agenda.",
    ];
  }

  function renderOffers(offers) {
    booking.offers = offers;
    var list = $("pf-bk-offers");
    list.textContent = "";
    offers.forEach(function (o) {
      var b = el("button", "pf-bk-offer");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
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
      b.addEventListener("click", function () { chooseOffer(o, b); });
      list.appendChild(b);
    });
    $("pf-bk-when").hidden = true;
    $("pf-bk-form").hidden = true;
    if (offers.length === 1) chooseOffer(offers[0], list.firstChild);
  }

  function loadBooking() {
    return fetch(bookingApi(""))
      .then(function (res) { return res.ok ? res.json() : { offers: [] }; })
      .then(function (json) {
        var offers = json.offers || [];
        if (!offers.length) return false;
        renderOffers(offers);
        $("reserver").hidden = false;
        $("pf-nav-booking").hidden = false;
        // Réserver devient l'appel principal de la couverture.
        $("pf-hero-cta").textContent = "Réserver une séance";
        $("pf-hero-cta").setAttribute("href", "#reserver");
        return true;
      })
      .catch(function () { return false; });
  }

  // Retour de Stripe (paiement de l'acompte réussi ou abandonné).
  function handleBookingReturn() {
    var params = new URLSearchParams(location.search);
    var id = params.get("reservation");
    if (!id) return;
    var cleanUrl = location.pathname + (handle && !CONFIG.handle ? "?s=" + encodeURIComponent(handle) : "") + "#reserver";
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
      tier: booking.offer && booking.offer.tiers && booking.offer.tiers.length ? booking.tier : undefined,
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      message: form.elements.message.value.trim(),
      website: form.elements.website.value,
      returnUrl: location.origin + location.pathname + (handle && !CONFIG.handle ? "?s=" + encodeURIComponent(handle) : ""),
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
      if (body.url) { location.href = body.url; return; }
      var o = booking.offer;
      var chosen = o.tiers && o.tiers.length ? o.tiers[booking.tier] : null;
      showBookingResult("Votre séance est réservée", confirmedLines({
        offerTitle: o.title, startsAt: booking.slot.startsAt, durationMin: o.durationMin, location: o.location, depositCents: 0,
        priceCents: chosen ? chosen.priceCents : o.priceCents, photos: chosen ? chosen.photos : null, tierLabel: chosen ? chosen.label : "",
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

  /* ---------- Démarrage ---------- */

  if (!handle || !API) {
    showMissing();
    return;
  }
  fetch(API + "/api/portfolio/" + encodeURIComponent(handle))
    .then(function (res) {
      if (!res.ok) throw new Error("introuvable");
      return res.json();
    })
    .then(function (json) {
      data = json;
      if (!data.photos || !data.photos.length) throw new Error("vide");
      render();
      document.querySelectorAll(".pf-bk-studio").forEach(function (n) { n.textContent = data.studioName; });
      if (new URLSearchParams(location.search).get("reservation")) handleBookingReturn();
      else loadBooking();
    })
    .catch(showMissing);
})();
