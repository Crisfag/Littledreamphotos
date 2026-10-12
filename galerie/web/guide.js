/* =====================================================================
   Holypixx — guide « Contrat de photographe » : menu, liens vers
   l'interface photographe, et le modèle de contrat personnalisable
   (aperçu en direct, téléchargement .rtf, impression en PDF, copie).
   Rien n'est envoyé : le formulaire reste dans le navigateur.
   ===================================================================== */
(function () {
  "use strict";

  var config = window.HOME_CONFIG || {};

  /* ---------- Liens, année, menu ---------- */

  var admin = config.adminUrl || "#";
  document.querySelectorAll("[data-admin]").forEach(function (a) { a.href = admin; });
  document.querySelectorAll("[data-signup]").forEach(function (a) { a.href = admin + "#/inscription"; });
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  var nav = document.getElementById("nav");
  var onScroll = function () { nav.classList.toggle("nav-solid", window.scrollY > 8); };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  function setMenu(open) {
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    toggle.querySelector("use").setAttribute("href", open ? "#i-close" : "#i-menu");
  }
  toggle.addEventListener("click", function () { setMenu(!links.classList.contains("open")); });
  links.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && links.classList.contains("open")) { setMenu(false); toggle.focus(); }
  });

  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  /* ---------- Le modèle ---------- */

  var form = document.getElementById("g-form");
  var paper = document.getElementById("g-paper");
  if (!form || !paper) return;

  var STORE = "holypixx-modele-contrat";
  var FIELDS = ["country", "studio", "number", "address", "email", "kind", "price", "deposit", "photos", "weeks", "notice"];

  var KINDS = {
    famille: { title: "Séance famille, naissance ou grossesse", object: "une séance photo de famille, de naissance ou de grossesse", outdoor: true },
    mariage: { title: "Reportage de mariage", object: "le reportage photographique du mariage", outdoor: false },
    portrait: { title: "Séance portrait", object: "une séance photo portrait", outdoor: true },
    entreprise: { title: "Prestation pour entreprise", object: "une prestation photographique pour l'entreprise du client", outdoor: false },
    evenement: { title: "Reportage d'événement", object: "le reportage photographique de l'événement", outdoor: false },
  };
  var COUNTRY = {
    be: { number: "Numéro d'entreprise (BCE)", numberPh: "BE 0123.456.789", addressPh: "Rue des Lilas 12, 1000 Bruxelles", emailPh: "bonjour@monstudio.be", law: "belge", code: "livre XI du Code de droit économique" },
    fr: { number: "SIRET", numberPh: "123 456 789 00012", addressPh: "12 rue des Lilas, 69001 Lyon", emailPh: "bonjour@monstudio.fr", law: "français", code: "Code de la propriété intellectuelle" },
  };

  function read() {
    var data = {};
    FIELDS.forEach(function (name) {
      var el = form.elements[name];
      data[name] = el ? String(el.value || "").trim() : "";
    });
    return data;
  }

  function num(value) {
    var n = parseFloat(String(value || "").replace(/\s/g, "").replace(",", "."));
    return isFinite(n) && n >= 0 ? n : null;
  }
  function euros(n) {
    return n.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  // Un contrat = une liste de blocs ; chaque bloc, une suite de morceaux :
  // du texte, une valeur saisie (ou son repère entre crochets), un blanc à
  // remplir pour chaque client, une case à cocher.
  function F(value, placeholder) { return value ? { fill: value } : { ph: placeholder }; }
  var B = { blank: true };
  var BOX = { box: true };

  function build(d) {
    var kind = KINDS[d.kind] || KINDS.famille;
    var c = COUNTRY[d.country] || COUNTRY.be;
    var wedding = d.kind === "mariage";
    var business = d.kind === "entreprise";
    var price = num(d.price);
    var deposit = num(d.deposit);
    var photos = num(d.photos);
    var weeks = num(d.weeks);
    var notice = num(d.notice);
    var blocks = [];
    var p = function () { blocks.push({ t: "p", parts: Array.prototype.slice.call(arguments) }); };
    var h = function (text) { blocks.push({ t: "h", parts: [text] }); };

    blocks.push({ t: "title", parts: ["Contrat de prestation photographique"] });
    blocks.push({ t: "sub", parts: [kind.title] });

    h("Entre les soussignés");
    p("Le photographe : ", F(d.studio, "[Nom du studio]"), ", " + c.number + " ", F(d.number, "[numéro]"), ", ", F(d.address, "[adresse]"), ", ", F(d.email, "[e-mail]"), ".");
    if (wedding) p("Les mariés : ", B, " et ", B, ", demeurant ", B, ", e-mail ", B, ", téléphone ", B, ".");
    else if (business) p("Le client : la société ", B, ", numéro d'entreprise ", B, ", représentée par ", B, ", e-mail ", B, ".");
    else p("Le client : ", B, ", demeurant ", B, ", e-mail ", B, ", téléphone ", B, ".");

    h("1. Objet");
    p("Le présent contrat porte sur " + kind.object + ", le ", B, " à ", B, " (lieu), à partir de ", B, ", pour une durée d'environ ", B, ".");

    h("2. Prix et paiement");
    var depositText = deposit !== null ? deposit.toLocaleString("fr-BE") + " %" : "[pourcentage]";
    var amount = price !== null && deposit !== null ? " (" + euros(price * deposit / 100) + ")" : "";
    p("Le prix total de la prestation est de ", price !== null ? { fill: euros(price) } : { ph: "[prix] €" }, " TTC. Un acompte de ", deposit !== null ? { fill: depositText } : { ph: depositText }, amount ? { fill: amount } : "", " est versé à la signature du présent contrat ; il réserve la date.");
    if (d.country === "fr") p("Cette somme constitue un acompte et non des arrhes : la commande est ferme pour les deux parties.");
    p("Le solde est réglé au plus tard le jour de la séance, sauf accord écrit différent.");

    h("3. Report et annulation");
    p("Le client peut reporter la séance une fois, sans frais, en prévenant le photographe au moins ", notice !== null ? { fill: String(notice) } : { ph: "[nombre]" }, " jours à l'avance. En cas d'annulation par le client, l'acompte reste acquis au photographe. En cas d'annulation par le photographe, notamment pour maladie ou force majeure, l'acompte est intégralement remboursé, à moins que le client n'accepte le photographe de remplacement qui lui est proposé.");
    if (kind.outdoor) p("Pour une séance en extérieur, une météo défavorable permet à chacune des parties de reporter la séance sans frais.");

    h("4. Déroulement");
    p("Un retard du client est décompté de la durée prévue de la séance.");
    if (wedding) p("Les mariés communiquent au photographe le programme de la journée au plus tard 15 jours avant le mariage, et prévoient son repas lorsque la prestation couvre le repas.");

    h("5. Livraison");
    p("Le photographe livre environ ", photos !== null ? { fill: String(photos) } : { ph: "[nombre]" }, " photos retouchées, dans une galerie en ligne privée, au plus tard ", weeks !== null ? { fill: String(weeks) } : { ph: "[nombre]" }, " semaines après la séance. Le choix des photos et leur retouche relèvent du style artistique du photographe. Les fichiers bruts et les photos écartées ne sont pas remis. Le photographe conserve les fichiers livrés pendant 12 mois ; il appartient au client d'en faire une copie.");

    h("6. Droits d'auteur");
    p("Le photographe reste titulaire des droits d'auteur sur les photos (" + c.code + ").");
    if (business) {
      p("Il autorise le client à les utiliser pour les usages professionnels suivants : supports ", B, ", durée ", B, ", territoire ", B, ". Tout autre usage, ainsi que toute modification des photos, demande l'accord écrit du photographe.");
    } else {
      p("Il accorde au client le droit de les utiliser pour un usage strictement privé : impression, partage avec ses proches, publication sur ses réseaux sociaux personnels, sans les modifier ni en faire un usage commercial. Tout usage commercial demande l'accord écrit du photographe.");
    }
    p("En cas de publication, le client mentionne si possible le nom du photographe.");

    h("7. Droit à l'image");
    p("Le client ", BOX, " autorise ", BOX, " n'autorise pas le photographe à publier une sélection de photos de la séance sur son site, son portfolio et ses réseaux sociaux.");
    if (!business) p("Pour un enfant mineur, l'accord est donné par ses deux parents. Le client peut retirer son accord à tout moment ; le photographe retire alors les photos concernées dans un délai raisonnable.");
    else p("Les personnes photographiées ont donné leur accord au client pour les usages prévus à l'article 6.");

    h("8. Données personnelles");
    p("Les coordonnées du client servent à l'organisation de la séance, à la facturation et à la livraison des photos. Le photographe peut aussi lui proposer par e-mail des séances semblables (étapes de l'enfant, anniversaires, séances de saison) ; le client peut s'y opposer à tout moment, gratuitement, en répondant simplement à l'un de ces messages. Les coordonnées sont conservées le temps nécessaire à ces fins et aux obligations comptables. Le client peut les consulter, les faire corriger ou effacer en écrivant à ", F(d.email, "[e-mail]"), ".");

    h("9. Litiges");
    p("Le présent contrat est soumis au droit " + c.law + ". En cas de désaccord, les parties recherchent d'abord une solution amiable.");
    if (!business && d.country === "fr") p("Le client consommateur peut recourir gratuitement au médiateur de la consommation suivant : ", B, " (nom et coordonnées du médiateur).");
    if (!business && d.country !== "fr") p("Le client peut aussi s'adresser gratuitement au Service de médiation pour le consommateur.");

    blocks.push({ t: "place", parts: ["Fait à ", B, ", le ", B, ", en deux exemplaires."] });
    blocks.push({ t: "sign", parts: [] });
    return blocks;
  }

  /* Rendus : aperçu HTML, texte brut, RTF. */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; });
  }
  var BLANK_TEXT = "______________";

  function partHtml(part) {
    if (typeof part === "string") return esc(part);
    if (part.fill) return '<span class="g-fill">' + esc(part.fill) + "</span>";
    if (part.ph) return '<span class="g-ph">' + esc(part.ph) + "</span>";
    if (part.blank) return '<span class="g-blank" aria-label="à compléter"></span>';
    if (part.box) return '<span class="g-box" aria-hidden="true"></span>';
    return "";
  }
  function partText(part) {
    if (typeof part === "string") return part;
    if (part.fill) return part.fill;
    if (part.ph) return part.ph;
    if (part.blank) return BLANK_TEXT;
    if (part.box) return "☐";
    return "";
  }

  function toHtml(blocks) {
    return blocks.map(function (b) {
      var inner = b.parts.map(partHtml).join("");
      if (b.t === "title") return '<p class="g-doc-title">' + inner + "</p>";
      if (b.t === "sub") return '<p class="g-doc-sub">' + inner + "</p>";
      if (b.t === "h") return '<p class="g-doc-h">' + inner + "</p>";
      if (b.t === "place") return '<p class="g-doc-place">' + inner + "</p>";
      if (b.t === "sign") return '<div class="g-doc-sign"><div><span>Le photographe</span><em>Lu et approuvé, signature</em></div><div><span>Le client</span><em>Lu et approuvé, signature</em></div></div>';
      return "<p>" + inner + "</p>";
    }).join("");
  }

  function toText(blocks) {
    var out = [];
    blocks.forEach(function (b) {
      var line = b.parts.map(partText).join("");
      if (b.t === "title") out.push(line.toUpperCase());
      else if (b.t === "sub") out.push(line);
      else if (b.t === "h") out.push("", line);
      else if (b.t === "place") out.push("", line);
      else if (b.t === "sign") out.push("", "Le photographe (lu et approuvé, signature)          Le client (lu et approuvé, signature)", "", "", "");
      else out.push(line);
    });
    return out.join("\n") + "\n";
  }

  // RTF : s'ouvre tel quel dans Word, Pages et LibreOffice, accents compris.
  function rtfEscape(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var code = s.charCodeAt(i);
      if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
      else if (code > 127) out += "\\u" + (code > 32767 ? code - 65536 : code) + "?";
      else out += ch;
    }
    return out;
  }
  function toRtf(blocks) {
    var body = blocks.map(function (b) {
      var text = rtfEscape(b.parts.map(partText).join(""));
      if (b.t === "title") return "\\pard\\qc\\sb0\\sa60\\b\\fs32 " + text + "\\b0\\par";
      if (b.t === "sub") return "\\pard\\qc\\sa360\\fs22\\cf2 " + text + "\\cf1\\par";
      if (b.t === "h") return "\\pard\\sb280\\sa80\\b\\fs22 " + text + "\\b0\\par";
      if (b.t === "place") return "\\pard\\sb360\\sa120\\fs21 " + text + "\\par";
      if (b.t === "sign") return "\\pard\\sb240\\tx5200\\fs21 " + rtfEscape("Le photographe") + "\\tab " + rtfEscape("Le client") + "\\par\\pard\\tx5200\\fs18\\cf2 " + rtfEscape("Lu et approuvé, signature") + "\\tab " + rtfEscape("Lu et approuvé, signature") + "\\cf1\\par\\par\\par\\par";
      return "\\pard\\sa100\\sl300\\slmult1\\fs21 " + text + "\\par";
    }).join("\n");
    return "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}{\\colortbl;\\red11\\green11\\blue16;\\red98\\green98\\blue111;}\n" +
      "\\paperw11906\\paperh16838\\margl1418\\margr1418\\margt1418\\margb1418\\f0\\cf1\n" + body + "\n}";
  }

  /* Formulaire : libellés selon le pays, mémoire locale, aperçu. */

  function syncCountry(d) {
    var c = COUNTRY[d.country] || COUNTRY.be;
    document.getElementById("g-number-label").textContent = c.number;
    form.elements.number.placeholder = c.numberPh;
    form.elements.address.placeholder = c.addressPh;
    form.elements.email.placeholder = c.emailPh;
  }

  function render() {
    var d = read();
    syncCountry(d);
    paper.innerHTML = toHtml(build(d));
    try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (err) { /* navigation privée : sans mémoire */ }
  }

  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved) {
      FIELDS.forEach(function (name) {
        var el = form.elements[name];
        if (!el || saved[name] === undefined) return;
        if (el instanceof RadioNodeList) {
          Array.prototype.forEach.call(el, function (radio) { radio.checked = radio.value === saved[name]; });
        } else {
          el.value = saved[name];
        }
      });
    }
  } catch (err) { /* rien à reprendre */ }

  form.addEventListener("input", render);
  form.addEventListener("change", render);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  render();

  function fileName(ext) {
    var studio = read().studio.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return "contrat-photographe" + (studio ? "-" + studio : "") + "." + ext;
  }

  document.getElementById("g-download").addEventListener("click", function () {
    var blob = new Blob([toRtf(build(read()))], { type: "application/rtf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName("rtf");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Modèle téléchargé : il s'ouvre dans Word, Pages ou LibreOffice.");
  });

  document.getElementById("g-print").addEventListener("click", function () {
    window.print();
  });

  document.getElementById("g-copy").addEventListener("click", function () {
    var text = toText(build(read()));
    var done = function () { toast("Texte copié : collez-le dans votre traitement de texte."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
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
      toast(ok ? "Texte copié : collez-le dans votre traitement de texte." : "Copie impossible ici : utilisez plutôt le téléchargement.");
    }
  });
})();
