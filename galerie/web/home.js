/* =====================================================================
   Holypixx — page d'accueil : liens vers l'interface photographe, menu,
   recomposition des photos en tuiles (jouée une fois), styles de galerie,
   labo de protection, rythme de paiement des tarifs et offre Fondateurs.
   ===================================================================== */
(function () {
  "use strict";

  var config = window.HOME_CONFIG || {};
  // Page anglaise (/en/) : mêmes comportements, textes en anglais.
  var EN = document.documentElement.lang === "en";
  function T(fr, en) { return EN ? en : fr; }
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Liens et année ---------- */

  var admin = config.adminUrl || "#";
  // Lien de parrainage (?parrain=CODE) : gardé dans le navigateur et transmis
  // à l'inscription, qui crédite le −50 % au premier paiement.
  var referral = "";
  try {
    var refMatch = /[?&]parrain=([A-Za-z0-9-]{6,20})/.exec(location.search);
    referral = refMatch ? refMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    if (referral) localStorage.setItem("holypixx-parrain", referral);
    else referral = localStorage.getItem("holypixx-parrain") || "";
  } catch (err) { /* navigation privée : seul le lien compte */ }
  var signupUrl = admin + "#/inscription" + (referral ? "?parrain=" + encodeURIComponent(referral) : "");
  document.querySelectorAll("[data-admin]").forEach(function (a) { a.href = admin; });
  document.querySelectorAll("[data-signup]").forEach(function (a) { a.href = signupUrl; });
  var referralNote = document.getElementById("referral-note");
  if (referral && referralNote && config.api && window.fetch) {
    fetch(String(config.api).replace(/\/+$/, "") + "/api/public/referral/" + encodeURIComponent(referral))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.studio) return;
        referralNote.querySelector("strong").textContent = data.studio;
        referralNote.querySelector("[data-ref-percent]").textContent = String(Number(data.discountPercent) || 50);
        referralNote.hidden = false;
      })
      .catch(function () { /* sans réponse, le lien garde le code */ });
  }
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- Navigation ---------- */

  var nav = document.getElementById("nav");
  var onScroll = function () { nav.classList.toggle("nav-solid", window.scrollY > 8); };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  function setMenu(open) {
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? T("Fermer le menu", "Close menu") : T("Ouvrir le menu", "Open menu"));
    toggle.querySelector("use").setAttribute("href", open ? "#i-close" : "#i-menu");
  }
  toggle.addEventListener("click", function () { setMenu(!links.classList.contains("open")); });
  links.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && links.classList.contains("open")) { setMenu(false); toggle.focus(); }
  });

  /* ---------- Recomposition en tuiles ---------- */
  // Les photos d'une galerie Holypixx arrivent tuile par tuile : l'ouverture
  // le montre une fois, puis les notifications de la séance apparaissent.

  var notes = Array.prototype.slice.call(document.querySelectorAll(".note"));
  function showNotes() {
    notes.forEach(function (note, i) {
      setTimeout(function () { note.classList.add("in"); }, still ? 0 : 900 + i * 650);
    });
  }

  /* ---------- Avant la séance : le moment de la réservation ---------- */
  // Joué une fois quand le bureau arrive à l'écran : le créneau se prend,
  // la signature se trace, le tampon tombe, l'acompte arrive. Sans script,
  // sans IntersectionObserver ou en mouvement réduit : l'état final, direct.

  var desk = document.getElementById("prep-desk");
  if (desk && !still && "IntersectionObserver" in window) {
    desk.classList.add("armed");
    var deskSeen = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      deskSeen.disconnect();
      desk.classList.add("play");
      setTimeout(function () { desk.classList.add("settled"); }, 700);
    }, { threshold: 0.35 });
    deskSeen.observe(desk);
  }

  var tiled = Array.prototype.slice.call(document.querySelectorAll(".tiled"));
  if (still || !tiled.length) {
    showNotes();
  } else {
    tiled.forEach(function (ph, p) {
      var layer = document.createElement("span");
      layer.className = "tiles";
      layer.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 16; i++) {
        var cell = document.createElement("i");
        // Ordre pseudo-aléatoire stable, comme des tuiles qui arrivent du réseau.
        cell.style.transitionDelay = (p * 90 + ((i * 7 + p * 5) % 16) * 38) + "ms";
        layer.appendChild(cell);
      }
      ph.appendChild(layer);
    });
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      requestAnimationFrame(function () {
        document.querySelectorAll(".tiles").forEach(function (l) { l.classList.add("go"); });
      });
      showNotes();
    };
    var first = tiled[0].querySelector("img");
    if (first.complete) setTimeout(start, 150);
    else { first.addEventListener("load", function () { setTimeout(start, 150); }); first.addEventListener("error", start); }
    setTimeout(start, 2500);
  }

  /* ---------- Styles de galerie ---------- */
  // Survoler un style l'essaie, cliquer le garde (comme dans l'espace
  // photographe). Sans script : le style Éditorial, affiché tel quel.

  var sty = document.getElementById("sty");
  if (sty) {
    var STYLE_INFO = {
      classique: [T("Classique", "Classic"), "Cormorant Garamond", "Jost"],
      doux: [T("Doux", "Soft"), "Cormorant Garamond", "Nunito Sans"],
      architectural: ["Architectural", "Josefin Sans", "Work Sans"],
      moderne: [T("Moderne", "Modern"), "Manrope", "Manrope"],
      nuit: [T("Nuit", "Night"), "Cormorant Garamond", "Jost"],
      editorial: [T("Éditorial", "Editorial"), "Bodoni Moda", "Karla"],
      romantique: [T("Romantique", "Romantic"), "Great Vibes", "Lora"],
      boheme: [T("Bohème", "Boho"), "Fraunces", "Karla"],
      galerie: [T("Galerie d'art", "Art gallery"), "Marcellus", "Work Sans"],
    };
    var styPage = document.getElementById("sty-page");
    var styWin = document.getElementById("sty-win");
    var styCaption = document.getElementById("sty-caption");
    var styList = sty.querySelector(".sty-list");
    var chosen = styPage.getAttribute("data-style");

    var showStyle = function (key) {
      var info = STYLE_INFO[key];
      if (!info || styPage.getAttribute("data-style") === key) return;
      styPage.setAttribute("data-style", key);
      styWin.setAttribute("aria-label", T("Aperçu d'une galerie client au style ", "Preview of a client gallery in the style ") + info[0]);
      styCaption.innerHTML = info[1] === info[2]
        ? T("Titres et texte en <b>" + info[1] + "</b>&nbsp;: changez-les librement.", "Headings and text in <b>" + info[1] + "</b>: change them freely.")
        : T("Titres en <b>" + info[1] + "</b>, texte en <b>" + info[2] + "</b>&nbsp;: changez-les librement.",
            "Headings in <b>" + info[1] + "</b>, text in <b>" + info[2] + "</b>: change them freely.");
    };

    styList.querySelectorAll(".sty-opt").forEach(function (btn) {
      var key = btn.getAttribute("data-style");
      btn.addEventListener("click", function () {
        chosen = key;
        scrollPreview(false);
        styList.querySelectorAll(".sty-opt").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        showStyle(key);
      });
      btn.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") showStyle(key); });
    });
    styList.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") showStyle(chosen); });

    // La fenêtre défile comme une vraie page : vers les photos pour une mise
    // en page, vers le haut pour un style ou un en-tête.
    var styScroll = document.getElementById("sty-scroll");
    var scrollPreview = function (toGrid) {
      var grid = styScroll.querySelector(".sty-grid");
      styScroll.scrollTo({ top: toGrid ? grid.offsetTop - 16 : 0 });
    };

    sty.querySelectorAll(".seg-opt").forEach(function (btn) {
      var attr = btn.hasAttribute("data-head") ? "data-head" : "data-layout";
      btn.addEventListener("click", function () {
        styPage.setAttribute(attr, btn.getAttribute(attr));
        scrollPreview(attr === "data-layout");
        btn.parentNode.querySelectorAll(".seg-opt").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      });
    });

    // Les noms des styles s'affichent dans leur police de titre : les
    // polices ne se chargent qu'à l'approche de la section.
    if ("IntersectionObserver" in window) {
      var styNear = new IntersectionObserver(function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        styNear.disconnect();
        sty.classList.add("near");
      }, { rootMargin: "600px 0px" });
      styNear.observe(sty);
    } else {
      sty.classList.add("near");
    }
  }

  /* ---------- Labo de protection ---------- */

  var photo = document.querySelector(".lab-photo");
  var result = document.getElementById("lab-result");
  var captureBtn = document.getElementById("lab-capture");
  document.querySelectorAll(".lab-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var on = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(on));
      photo.setAttribute("data-" + btn.getAttribute("data-layer"), on ? "on" : "off");
    });
  });

  function capture() {
    photo.classList.remove("flash");
    void photo.offsetWidth;
    photo.classList.add("flash", "captured");
    ["wm", "print"].forEach(function (layer) {
      photo.setAttribute("data-" + layer, "on");
      var b = document.querySelector('.lab-toggle[data-layer="' + layer + '"]');
      if (b) b.setAttribute("aria-pressed", "true");
    });
    result.hidden = false;
    captureBtn.innerHTML = '<svg class="ico"><use href="#i-camera"/></svg>' + T("Recommencer", "Start again");
    setTimeout(function () { photo.classList.remove("captured"); }, 1600);
  }
  captureBtn.addEventListener("click", function () {
    if (!result.hidden && captureBtn.textContent.indexOf(T("Recommencer", "Start again")) !== -1) {
      result.hidden = true;
      captureBtn.innerHTML = '<svg class="ico"><use href="#i-camera"/></svg>' + T("Simuler une capture d'écran", "Simulate a screenshot");
      return;
    }
    capture();
  });

  // Une vraie touche Impr. écran sur cette page : on montre ce que le
  // photographe recevrait.
  var toast = document.getElementById("toast");
  var toastTimer = 0;
  document.addEventListener("keyup", function (e) {
    if (e.key !== "PrintScreen") return;
    toast.textContent = T("Capture repérée. Sur une galerie Holypixx, le photographe en serait prévenu par e-mail, avec la photo affichée.",
      "Screenshot spotted. On a Holypixx gallery, the photographer would get an email about it, naming the photo on screen.");
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  });

  /* ---------- Scolaire : fiche avec QR et planche ---------- */

  // QR d'illustration (motif, pas un vrai code) : trois repères et un
  // remplissage stable.
  var qr = document.getElementById("coupon-qr");
  if (qr) {
    var cells = [];
    var finder = function (x, y) {
      cells.push([x, y, 7, 1], [x, y + 6, 7, 1], [x, y, 1, 7], [x + 6, y, 1, 7], [x + 2, y + 2, 3, 3]);
    };
    finder(0, 0); finder(18, 0); finder(0, 18);
    var seed = 7;
    for (var y = 0; y < 25; y++) {
      for (var x = 0; x < 25; x++) {
        var inFinder = (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
        if (inFinder) continue;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        if (seed % 100 < 46) cells.push([x, y, 1, 1]);
      }
    }
    qr.innerHTML = cells.map(function (c) { return '<rect x="' + c[0] + '" y="' + c[1] + '" width="' + c[2] + '" height="' + c[3] + '"/>'; }).join("");
  }

  // Planche « 3 photos 6×9 + 4 photos d'identité » sur 13×18, remplie avec
  // la photo de l'enfant, comme dans l'espace famille.
  var planche = document.getElementById("planche");
  if (planche) {
    [[31, 10, 472, 500], [508, 10, 488, 500], [31, 516, 472, 484], [508, 516, 228, 247], [740, 516, 228, 247], [508, 767, 228, 233], [740, 767, 228, 233]]
      .forEach(function (b) {
        var cell = document.createElement("span");
        cell.className = "cell";
        cell.style.left = b[0] / 10 + "%";
        cell.style.top = b[1] / 10 + "%";
        cell.style.width = b[2] / 10 + "%";
        cell.style.height = b[3] / 10 + "%";
        cell.innerHTML = '<img src="assets/home/garcon.webp" alt="" loading="lazy" />';
        planche.insertBefore(cell, planche.firstChild);
      });
  }

  /* ---------- Tarifs : mensuel ou annuel, offre Fondateurs ---------- */

  var PRICES = {
    essentiel: { month: 15, year: 150, founderMonth: 12, founderYear: 120 },
    pro: { month: 29, year: 290, founderMonth: 24, founderYear: 240 },
  };
  var billing = "month";
  var founders = false;

  function euros(n) { return EN ? "€" + n.toLocaleString("en-GB") : n.toLocaleString("fr-BE") + " €"; }

  function renderPrices() {
    Object.keys(PRICES).forEach(function (key) {
      var p = PRICES[key];
      var amount = document.querySelector('[data-plan="' + key + '"]');
      var alt = document.querySelector('[data-alt="' + key + '"]');
      if (!amount || !alt) return;
      if (billing === "year") {
        amount.innerHTML = '<span class="plan-amount">' + euros(founders ? p.founderYear : p.year) + '</span><span class="plan-per">' + T("/ an", "/ year") + "</span>";
        alt.innerHTML = founders
          ? "la 1<sup>re</sup> année, puis " + euros(p.year) + " par an"
          : T("soit ", "that's ") + euros(Math.round(p.year / 12 * 100) / 100).replace(",00", "") + T(" par mois", " a month");
      } else {
        amount.innerHTML = '<span class="plan-amount">' + euros(founders ? p.founderMonth : p.month) + '</span><span class="plan-per">' + T("/ mois", "/ month") + "</span>";
        alt.innerHTML = founders
          ? "la 1<sup>re</sup> année, puis " + euros(p.month) + " par mois"
          : T("ou ", "or ") + euros(p.year) + T(" par an", " a year");
      }
    });
    document.querySelectorAll("[data-founder]").forEach(function (el) {
      var p = PRICES[el.getAttribute("data-founder")];
      el.textContent = billing === "year" ? euros(p.founderYear) + " par an" : euros(p.founderMonth) + " par mois";
    });
  }

  document.querySelectorAll(".billing-opt").forEach(function (btn) {
    btn.addEventListener("click", function () {
      billing = btn.getAttribute("data-billing");
      document.querySelectorAll(".billing-opt").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      renderPrices();
    });
  });
  renderPrices();

  // L'offre Fondateurs n'apparaît que tant qu'il reste des places (page
  // française : l'inscription y est ouverte).
  if (config.api && window.fetch && !EN) {
    fetch(String(config.api).replace(/\/+$/, "") + "/api/public/plans")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        // Fondateurs Studio : prix de la première année dans la carte Studio.
        var studioLeft = data && data.studioFounders ? data.studioFounders.remaining : 0;
        var studio = data && data.plans && data.plans.filter(function (p) { return p.key === "studio"; })[0];
        if (studioLeft && studio && studio.founderYearlyCents) {
          document.querySelector("[data-studio-amount]").textContent = euros(studio.founderYearlyCents / 100);
          // Montants et nombre de places viennent de notre API (nombres).
          document.querySelector("[data-studio-alt]").innerHTML = "la 1<sup>re</sup> année, puis " + euros(studio.yearlyCents / 100) +
            " par an · Fondateurs : plus que " + Number(studioLeft) + " place" + (studioLeft > 1 ? "s" : "");
        }
        var left = data && data.founders ? data.founders.remaining : 0;
        if (!left) return;
        founders = true;
        document.getElementById("founders-left").textContent = "Plus que " + left + " place" + (left > 1 ? "s" : "");
        document.getElementById("founders").hidden = false;
        renderPrices();
      })
      .catch(function () { /* sans réponse, l'offre n'est simplement pas affichée */ });
  }

  /* ---------- Liste d'attente (page anglaise) ---------- */
  // « Holypixx in English » : e-mail, pays et spécialité, envoyés au Worker.
  // Même réponse que l'adresse soit nouvelle ou déjà inscrite.

  var wlForm = document.getElementById("waitlist-form");
  if (wlForm) {
    var wlStatus = document.getElementById("waitlist-status");
    var wlSubmit = document.getElementById("waitlist-submit");
    var setWl = function (text, kind) {
      wlStatus.textContent = text;
      wlStatus.className = "wl-status" + (kind ? " " + kind : "");
    };
    wlForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = wlForm.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setWl("Please enter a valid email address.", "err");
        wlForm.email.focus();
        return;
      }
      if (!config.api || !window.fetch) return setWl("Something went wrong. Please try again in a moment.", "err");
      wlSubmit.disabled = true;
      setWl("Adding you…");
      fetch(String(config.api).replace(/\/+$/, "") + "/api/public/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email, country: wlForm.country.value, specialty: wlForm.specialty.value,
          website: wlForm.website.value, lang: "en",
        }),
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (data) {
            if (!r.ok) throw new Error(data.error || "");
          });
        })
        .then(function () {
          wlForm.reset();
          setWl("You're on the list. We'll email you once, the day Holypixx opens in English.", "ok");
        })
        .catch(function (err) {
          setWl(err.message || "Something went wrong. Please try again in a moment.", "err");
        })
        .then(function () { wlSubmit.disabled = false; });
    });
  }
})();
