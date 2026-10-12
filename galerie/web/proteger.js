/* =====================================================================
   Holypixx — guide « Protéger ses photos en ligne » : la démonstration.
   Chaque interrupteur ajoute une protection sur la photo ; le verdict dit
   ce que vaudrait une capture d'écran ; « Faire une capture » montre ce
   que le photographe en apprend.
   ===================================================================== */
(function () {
  "use strict";

  var photo = document.getElementById("p-photo");
  if (!photo) return;
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var toggles = Array.prototype.slice.call(document.querySelectorAll(".p-toggle"));
  var verdict = document.getElementById("p-verdict-text");
  var bar = document.getElementById("p-meter-bar");
  var alertBox = document.getElementById("p-alert");
  var toastEl = document.getElementById("toast");
  var state = { res: false, wm: false, tiles: false, print: false, alert: false };
  // Ce que chaque protection retire de la valeur d'une copie.
  var WEIGHT = { res: 30, wm: 25, tiles: 15, print: 15, alert: 15 };

  function sentence() {
    if (!state.res && !state.wm && !state.tiles && !state.print && !state.alert) {
      return "Une copie parfaite : nette, imprimable en grand format, sans votre nom. Et vous n'en saurez rien.";
    }
    var parts = [];
    parts.push("La copie est " + (state.res ? "floue dès qu'on l'agrandit, trop petite pour un tirage" : "nette et imprimable") + ", " + (state.wm ? "barrée de votre nom" : "sans votre nom") + ".");
    parts.push(state.tiles ? "Aucun fichier d'origine à enregistrer : seulement une capture." : "Le fichier d'origine s'enregistre d'un clic droit.");
    if (state.print && state.alert) parts.push("Elle dit de quelle galerie elle sort, et un e-mail vous prévient de la tentative.");
    else if (state.print) parts.push("Elle dit de quelle galerie elle sort.");
    else if (state.alert) parts.push("Un e-mail vous prévient de la tentative.");
    return parts.join(" ");
  }

  function render() {
    Object.keys(state).forEach(function (key) { photo.setAttribute("data-" + key, state[key] ? "on" : "off"); });
    toggles.forEach(function (t) { t.setAttribute("aria-pressed", String(state[t.getAttribute("data-layer")])); });
    verdict.textContent = sentence();
    var protectedShare = Object.keys(state).reduce(function (sum, key) { return sum + (state[key] ? WEIGHT[key] : 0); }, 0);
    bar.style.width = Math.max(4, 100 - protectedShare) + "%";
    bar.parentNode.setAttribute("data-level", protectedShare >= 85 ? "low" : protectedShare >= 40 ? "mid" : "high");
  }

  toggles.forEach(function (t) {
    t.addEventListener("click", function () {
      var key = t.getAttribute("data-layer");
      state[key] = !state[key];
      render();
    });
  });

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3600);
  }

  var alertTimer = null;
  document.getElementById("p-capture").addEventListener("click", function () {
    // Sur téléphone, la photo est au-dessus des boutons : on la ramène à
    // l'écran pour voir l'éclair et l'alerte.
    var box = photo.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) photo.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    photo.classList.remove("flash");
    void photo.offsetWidth; // rejoue l'éclair à chaque clic
    if (!still) photo.classList.add("flash");
    clearTimeout(alertTimer);
    if (state.alert) {
      alertBox.hidden = false;
      alertTimer = setTimeout(function () { alertBox.hidden = true; }, 4200);
    } else {
      alertBox.hidden = true;
      toast("Capture faite. Le photographe n'en sait rien.");
    }
  });

  render();
})();
