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
    })
    .catch(showMissing);
})();
