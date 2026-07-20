/* =====================================================================
   Little Dream Photography — Interactions
   Vanilla JS, sans dépendance. Progressive enhancement.
   ===================================================================== */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    setYear();
    stickyHeader();
    mobileNav();
    revealOnScroll();
    galleryFilter();
    lightbox();
    testimonials();
    contactForm();
  }

  /* ---------- Année dynamique du footer ---------- */
  function setYear() {
    var y = document.getElementById("year");
    if (y) y.textContent = new Date().getFullYear();
  }

  /* ---------- Header solide au défilement ---------- */
  function stickyHeader() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 40);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Menu mobile ---------- */
  function mobileNav() {
    var toggle = document.getElementById("navToggle");
    var links = document.getElementById("navLinks");
    if (!toggle || !links) return;

    var close = function () {
      links.classList.remove("open");
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Ouvrir le menu");
    };

    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    });

    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", close);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
  }

  /* ---------- Animations d'apparition ---------- */
  function revealOnScroll() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Filtres de la galerie ---------- */
  function galleryFilter() {
    var buttons = document.querySelectorAll(".filter");
    var items = document.querySelectorAll(".g-item");
    if (!buttons.length) return;

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        var f = btn.getAttribute("data-filter");
        items.forEach(function (item) {
          var show = f === "all" || item.getAttribute("data-cat") === f;
          item.classList.toggle("is-hidden", !show);
        });
      });
    });
  }

  /* ---------- Lightbox ---------- */
  function lightbox() {
    var lb = document.getElementById("lightbox");
    var figure = document.getElementById("lbFigure");
    var closeBtn = document.getElementById("lbClose");
    var prevBtn = document.getElementById("lbPrev");
    var nextBtn = document.getElementById("lbNext");
    if (!lb || !figure) return;

    var current = -1;

    function visibleItems() {
      return Array.prototype.filter.call(
        document.querySelectorAll(".g-item"),
        function (el) { return !el.classList.contains("is-hidden"); }
      );
    }

    function show(index) {
      var items = visibleItems();
      if (!items.length) return;
      current = (index + items.length) % items.length;
      var el = items[current];
      figure.setAttribute("data-label", el.getAttribute("data-label") || "");
      figure.setAttribute("data-cat", el.getAttribute("data-cat") || "");
      lb.hidden = false;
      document.body.style.overflow = "hidden";
      closeBtn.focus();
    }

    function open(el) {
      var items = visibleItems();
      show(items.indexOf(el));
    }

    function close() {
      lb.hidden = true;
      document.body.style.overflow = "";
      current = -1;
    }

    document.querySelectorAll(".g-item").forEach(function (el) {
      el.addEventListener("click", function () { open(el); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(el); }
      });
    });

    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function () { show(current - 1); });
    nextBtn.addEventListener("click", function () { show(current + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    document.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(current - 1);
      else if (e.key === "ArrowRight") show(current + 1);
    });
  }

  /* ---------- Carrousel de témoignages ---------- */
  function testimonials() {
    var slides = document.querySelectorAll(".t-slide");
    var dotsWrap = document.getElementById("tDots");
    if (!slides.length || !dotsWrap) return;

    var index = 0;
    var timer;

    slides.forEach(function (_, i) {
      var dot = document.createElement("button");
      dot.setAttribute("aria-label", "Témoignage " + (i + 1));
      if (i === 0) dot.classList.add("is-active");
      dot.addEventListener("click", function () { go(i); restart(); });
      dotsWrap.appendChild(dot);
    });
    var dots = dotsWrap.querySelectorAll("button");

    function go(i) {
      slides[index].classList.remove("is-active");
      dots[index].classList.remove("is-active");
      index = (i + slides.length) % slides.length;
      slides[index].classList.add("is-active");
      dots[index].classList.add("is-active");
    }

    function next() { go(index + 1); }

    function start() { timer = setInterval(next, 6000); }
    function restart() { clearInterval(timer); start(); }

    start();
  }

  /* ---------- Validation du formulaire de contact ---------- */
  function contactForm() {
    var form = document.getElementById("contactForm");
    if (!form) return;
    var success = document.getElementById("formSuccess");

    function validateField(field) {
      var wrap = field.closest(".field");
      var ok = field.checkValidity() && field.value.trim() !== "";
      if (wrap) wrap.classList.toggle("invalid", !ok);
      return ok;
    }

    form.querySelectorAll("[required]").forEach(function (field) {
      field.addEventListener("blur", function () { validateField(field); });
      field.addEventListener("input", function () {
        var wrap = field.closest(".field");
        if (wrap && wrap.classList.contains("invalid")) validateField(field);
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var allOk = true;
      form.querySelectorAll("[required]").forEach(function (field) {
        if (!validateField(field)) allOk = false;
      });
      if (!allOk) {
        var firstInvalid = form.querySelector(".field.invalid input, .field.invalid select, .field.invalid textarea");
        if (firstInvalid) firstInvalid.focus();
        return;
      }
      // Démo : pas de backend. On affiche un message de confirmation.
      // Pour un envoi réel, brancher un service (Formspree, Netlify Forms, EmailJS…).
      form.querySelectorAll("input, select, textarea, button").forEach(function (el) {
        if (el.type !== "submit") el.disabled = true;
      });
      if (success) {
        success.hidden = false;
        success.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
})();
