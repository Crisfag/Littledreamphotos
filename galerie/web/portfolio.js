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


  /* ---------- Réservation en ligne (booking-flow.js) ---------- */

  var bookingFlow = window.HolypixxBooking.create({
    api: API,
    handle: handle,
    basePath: function () { return location.pathname + (handle && !CONFIG.handle ? "?s=" + encodeURIComponent(handle) : ""); },
    studioName: function () { return data && data.studioName; },
    onAvailable: function (info) {
      $("pf-nav-booking").hidden = false;
      if (info.private) return;
      // Réserver devient l'appel principal de la couverture.
      $("pf-hero-cta").textContent = "Réserver une séance";
      $("pf-hero-cta").setAttribute("href", "#reserver");
    },
  });
  // Petits outils d'affichage partagés avec les bons cadeaux.
  var el = bookingFlow.el;
  var euros = bookingFlow.euros;
  var duration = bookingFlow.duration;
  var pressOnly = bookingFlow.pressOnly;
  var photosText = bookingFlow.photosText;

  /* ---------- Bons cadeaux ---------- */

  // Une séance du photographe (et son forfait s'il en a plusieurs), ou une
  // valeur libre ; montant au choix, au moins le minimum du studio.
  var gift = { settings: null, offer: null, tier: 0, amountTouched: false };

  function giftApi(path) {
    return API + "/api/giftcard/" + encodeURIComponent(handle) + path;
  }
  function parseAmount(value) {
    var text = String(value || "").replace(/[€\s]/g, "").replace(",", ".");
    return /^\d+(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : NaN;
  }
  function amountInput(cents) {
    return (cents / 100).toLocaleString("fr-BE", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2, useGrouping: false });
  }
  function giftSuggestedCents() {
    var o = gift.offer;
    var min = gift.settings.minCents;
    if (!o) return min;
    var price = o.tiers.length ? o.tiers[gift.tier].priceCents : o.priceCents;
    return Math.max(price || 0, min);
  }

  function renderGiftTiers() {
    var o = gift.offer;
    var tiers = o ? o.tiers : [];
    var box = $("pf-gift-tiers");
    box.textContent = "";
    $("pf-gift-tier-step").hidden = !tiers.length;
    if (gift.tier >= tiers.length) gift.tier = 0;
    tiers.forEach(function (t, i) {
      var b = el("button", "pf-bk-tier");
      b.type = "button";
      b.setAttribute("aria-pressed", String(i === gift.tier));
      b.appendChild(el("strong", "", photosText(t.photos)));
      b.appendChild(el("span", "pf-bk-tier-price", euros(t.priceCents)));
      if (t.label) b.appendChild(el("span", "pf-bk-tier-label", t.label));
      b.addEventListener("click", function () {
        gift.tier = i;
        pressOnly(box, ".pf-bk-tier", b);
        gift.amountTouched = false;
        updateGift();
      });
      box.appendChild(b);
    });
  }

  function updateGift() {
    var form = $("pf-gift-form");
    if (!gift.amountTouched) form.elements.amount.value = amountInput(giftSuggestedCents());
    var cents = parseAmount(form.elements.amount.value);
    var o = gift.offer;
    var tier = o && o.tiers.length ? o.tiers[gift.tier] : null;
    $("pf-gift-summary").textContent = [
      o ? o.title + (o.durationMin ? " (" + duration(o.durationMin) + ")" : "") + (tier ? ", " + photosText(tier.photos) : "") : "Une séance au choix",
      isNaN(cents) ? "" : "bon de " + euros(cents),
      "valable " + gift.settings.validityMonths + " mois",
    ].filter(Boolean).join(" · ");
    $("pf-gift-submit").textContent = isNaN(cents) ? "Offrir ce bon" : "Payer " + euros(cents) + " et recevoir le bon";
  }

  function chooseGiftOffer(offer, button) {
    gift.offer = offer;
    gift.tier = 0;
    gift.amountTouched = false;
    pressOnly($("pf-gift-offers"), ".pf-gift-offer", button);
    renderGiftTiers();
    updateGift();
  }

  function renderGift(settings) {
    gift.settings = settings;
    var list = $("pf-gift-offers");
    list.textContent = "";
    var choices = settings.offers.concat([null]);
    choices.forEach(function (o) {
      var b = el("button", "pf-gift-offer");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      if (o) {
        b.appendChild(el("strong", "", o.title));
        var tiers = o.tiers || [];
        b.appendChild(el("span", "pf-bk-meta", [
          o.durationMin ? duration(o.durationMin) : "",
          tiers.length ? "à partir de " + euros(tiers[0].priceCents) : (o.priceCents ? euros(o.priceCents) : ""),
        ].filter(Boolean).join(" · ")));
      } else {
        b.appendChild(el("strong", "", "Un montant libre"));
        b.appendChild(el("span", "pf-bk-meta", "La séance de son choix, à partir de " + euros(settings.minCents)));
      }
      b.addEventListener("click", function () { chooseGiftOffer(o, b); });
      list.appendChild(b);
    });
    $("pf-gift-min").textContent = "Au moins " + euros(settings.minCents) + ". Vous pouvez offrir plus.";
    $("pf-gift-terms").textContent = "Le bon est valable " + settings.validityMonths + " mois à partir de l'achat. Vous le recevez aussitôt par e-mail, en PDF à imprimer." +
      (settings.terms ? " " + settings.terms : "");
    chooseGiftOffer(settings.offers[0] || null, list.firstChild);
    $("offrir").hidden = false;
    $("pf-nav-gift").hidden = false;
  }

  function loadGift() {
    return fetch(giftApi(""))
      .then(function (res) { return res.ok ? res.json() : { enabled: false }; })
      .then(function (json) {
        if (!json.enabled) return false;
        renderGift(json);
        return true;
      })
      .catch(function () { return false; });
  }

  function showGiftResult(title, lines, done) {
    var box = $("pf-gift-result");
    box.textContent = "";
    box.appendChild(el("h3", "", title));
    lines.filter(Boolean).forEach(function (line) {
      if (typeof line === "string") box.appendChild(el("p", "", line));
      else box.appendChild(line);
    });
    box.hidden = false;
    $("pf-gift-form").hidden = Boolean(done);
    $("offrir").hidden = false;
  }

  // Retour de Stripe : le bon payé, son code et ses liens.
  function handleGiftReturn() {
    var params = new URLSearchParams(location.search);
    var id = params.get("bon");
    if (!id) return false;
    history.replaceState(null, "", location.pathname + (handle && !CONFIG.handle ? "?s=" + encodeURIComponent(handle) : "") + "#offrir");
    if (params.get("annule")) {
      loadGift().then(function () {
        showGiftResult("Paiement interrompu", ["Votre bon cadeau n'a pas été acheté. Vous pouvez recommencer quand vous voulez."]);
        $("offrir").scrollIntoView();
      });
      return true;
    }
    var session = params.get("session_id") || "";
    var attempts = 0;
    (function poll() {
      fetch(giftApi("/order/" + encodeURIComponent(id) + "?session_id=" + encodeURIComponent(session)))
        .then(function (res) { return res.json(); })
        .then(function (r) {
          if (r.code) {
            var code = el("p", "", "Code du bon : ");
            code.appendChild(el("span", "pf-gift-code", r.code));
            var actions = el("div", "pf-gift-actions");
            var view = el("a", "pf-btn", "Voir le bon cadeau");
            view.href = r.pageUrl;
            var pdf = el("a", "pf-btn pf-btn-ghost", "Télécharger le PDF");
            pdf.href = API + "/api/gift/" + encodeURIComponent(r.code.replace(/[^A-Z0-9]/g, "")) + "/pdf";
            actions.appendChild(view);
            actions.appendChild(pdf);
            showGiftResult("Merci ! Le bon cadeau pour " + r.toName + " est prêt", [
              "Il vient de partir par e-mail à " + r.email + (r.recipientEmail ? ", et à " + r.recipientEmail : "") + ", en PDF à imprimer.",
              code,
              actions,
            ], true);
          } else if (r.status === "pending" && attempts++ < 5) {
            showGiftResult("Confirmation du paiement…", ["Un instant, nous attendons la confirmation de votre banque."], true);
            setTimeout(poll, 2000);
            return;
          } else {
            showGiftResult("Paiement en cours de confirmation", ["Vous recevrez le bon par e-mail dès que votre banque aura confirmé le paiement."], true);
          }
          $("offrir").scrollIntoView();
        })
        .catch(function () {
          showGiftResult("Bon cadeau introuvable", ["Contactez directement le studio si vous avez réglé un bon."], true);
        });
    })();
    return true;
  }

  $("pf-gift-form").elements.amount.addEventListener("input", function () {
    gift.amountTouched = true;
    updateGift();
  });

  $("pf-gift-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = $("pf-gift-error");
    var cents = parseAmount(form.elements.amount.value);
    var fields = {
      offerId: gift.offer ? gift.offer.id : "",
      tier: gift.offer && gift.offer.tiers.length ? gift.tier : undefined,
      amount: form.elements.amount.value.trim(),
      fromName: form.elements.fromName.value.trim(),
      toName: form.elements.toName.value.trim(),
      message: form.elements.message.value.trim(),
      email: form.elements.email.value.trim(),
      recipientEmail: form.elements.recipientEmail.value.trim(),
      website: form.elements.website.value,
      returnUrl: location.origin + location.pathname + (handle && !CONFIG.handle ? "?s=" + encodeURIComponent(handle) : ""),
    };
    var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var problem = isNaN(cents) ? "Indiquez la valeur du bon, par exemple 80."
      : cents < gift.settings.minCents ? "La valeur d'un bon cadeau est d'au moins " + euros(gift.settings.minCents) + "."
      : !fields.fromName ? "Indiquez de la part de qui est le bon."
      : !fields.toName ? "Indiquez à qui vous l'offrez."
      : !emailRe.test(fields.email) ? "Indiquez votre adresse e-mail : le bon vous y sera envoyé."
      : fields.recipientEmail && !emailRe.test(fields.recipientEmail) ? "L'e-mail de la personne gâtée semble incomplet."
      : "";
    if (problem) { error.textContent = problem; error.hidden = false; return; }
    error.hidden = true;
    var submit = $("pf-gift-submit");
    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Un instant…";
    try {
      var res = await fetch(giftApi("/buy"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fields) });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || "Le bon n'a pas pu être préparé.");
      location.href = body.url;
    } catch (err) {
      error.textContent = err.message || "Le bon n'a pas pu être préparé. Réessayez dans un instant.";
      error.hidden = false;
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
      if (new URLSearchParams(location.search).get("reservation")) bookingFlow.handleReturn();
      else bookingFlow.load();
      if (!handleGiftReturn()) loadGift();
    })
    .catch(showMissing);
})();
