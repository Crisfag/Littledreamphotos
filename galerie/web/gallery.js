/* =====================================================================
   Galerie protégée — affichage client
   ---------------------------------------------------------------------
   Les photos ne sont jamais des éléments <img> : chacune est réassemblée
   dans un <canvas> à partir de tuiles chargées avec un jeton de session.
   Conséquences concrètes :
     · « Enregistrer l'image sous » ne propose rien ;
     · aucune URL du réseau ne renvoie une photo entière ;
     · un aspirateur de site ne trouve aucun fichier à récupérer.

   Ce que ce code ne fait PAS, et ne peut pas faire : empêcher une capture
   d'écran. C'est le système d'exploitation qui capture l'écran, aucun
   JavaScript n'a autorité là-dessus. Les gardes ci-dessous découragent le
   geste réflexe et le consignent ; la vraie protection est ailleurs — basse
   définition, filigrane en trame, et empreinte invisible qui rend chaque
   photo traçable jusqu'à la galerie dont elle provient.
   ===================================================================== */

(function () {
  "use strict";

  var CONFIG = window.GALERIE_CONFIG || {};
  var API = String(CONFIG.api || "").replace(/\/$/, "");
  var CLIPBOARD_GUARD = CONFIG.clipboardGuard !== false;
  var LEVEL_PREVIEW = 0;
  var LEVEL_FULL = 1;
  var PREVIEW_COLS = 2;
  var PREVIEW_ROWS = 2;
  var PARALLEL_TILES = 6;
  var LAYOUTS = { grille: 1, mosaique: 1, defilement: 1, recit: 1 };

  /* ---------- Styles et polices (voir presentation.js) ---------- */

  // [famille, paramètres Google Fonts, repli, manuscrite ?]
  var FONTS = {
    cormorant: ["Cormorant Garamond", "Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500", "Georgia, serif"],
    playfair: ["Playfair Display", "Playfair+Display:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif"],
    bodoni: ["Bodoni Moda", "Bodoni+Moda:ital,wght@0,400;0,500;0,600;1,400", "Didot, Georgia, serif"],
    fraunces: ["Fraunces", "Fraunces:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif"],
    dmserif: ["DM Serif Display", "DM+Serif+Display:ital@0;1", "Georgia, serif"],
    marcellus: ["Marcellus", "Marcellus", "Georgia, serif"],
    italiana: ["Italiana", "Italiana", "Georgia, serif"],
    josefin: ["Josefin Sans", "Josefin+Sans:ital,wght@0,300;0,400;0,600;1,400", "sans-serif"],
    manrope: ["Manrope", "Manrope:wght@300;400;500;600;700", "sans-serif"],
    montserrat: ["Montserrat", "Montserrat:ital,wght@0,300;0,400;0,500;0,600;1,400", "sans-serif"],
    syne: ["Syne", "Syne:wght@400;500;600;700", "sans-serif"],
    greatvibes: ["Great Vibes", "Great+Vibes", "cursive", true],
    parisienne: ["Parisienne", "Parisienne", "cursive", true],
    jost: ["Jost", "Jost:ital,wght@0,300;0,400;0,500;1,300;1,400", "sans-serif"],
    nunito: ["Nunito Sans", "Nunito+Sans:ital,wght@0,300;0,400;0,600;1,400", "sans-serif"],
    worksans: ["Work Sans", "Work+Sans:ital,wght@0,300;0,400;0,500;1,400", "sans-serif"],
    karla: ["Karla", "Karla:ital,wght@0,300;0,400;0,500;1,400", "sans-serif"],
    lato: ["Lato", "Lato:ital,wght@0,300;0,400;0,700;1,400", "sans-serif"],
    inter: ["Inter", "Inter:wght@300;400;500;600", "sans-serif"],
    lora: ["Lora", "Lora:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif"],
    ebgaramond: ["EB Garamond", "EB+Garamond:ital,wght@0,400;0,500;0,600;1,400", "Georgia, serif"],
  };
  // Polices de chaque style : [titres, texte].
  var THEME_FONTS = {
    classique: ["cormorant", "jost"],
    doux: ["cormorant", "nunito"],
    architectural: ["josefin", "worksans"],
    moderne: ["manrope", "manrope"],
    nuit: ["cormorant", "jost"],
    editorial: ["bodoni", "karla"],
    romantique: ["greatvibes", "lora"],
    boheme: ["fraunces", "karla"],
    galerie: ["marcellus", "worksans"],
  };
  var loadedFonts = { cormorant: true, jost: true }; // déjà dans la page

  var state = {
    slug: null,
    token: null,
    photos: [],
    gallery: null,
    current: -1,
    viewerList: null,
    filterSelected: false,
    drawn: {},
  };

  /* ---------- Langue (choisie par le photographe, galerie par galerie) ---------- */

  var LANG = "fr";

  // L("Bonjour", "Hello") : le texte dans la langue de la galerie.
  function L(fr, en) {
    return LANG === "en" ? en : fr;
  }

  function locale() {
    return LANG === "en" ? "en-GB" : "fr-BE";
  }

  function plural(count, one, many) {
    return count > 1 ? many : one;
  }

  function SESSION_EXPIRED() {
    return L("Votre session a expiré. Saisissez à nouveau le mot de passe.", "Your session has expired. Please enter the password again.");
  }

  // Messages d'erreur du serveur (rédigés en français) : leur traduction
  // quand elle est connue, sinon un message générique.
  var SERVER_EN = {
    "Mot de passe incorrect.": "Incorrect password.",
    "Trop de tentatives. Réessayez dans quelques minutes.": "Too many attempts. Please try again in a few minutes.",
    "Cette galerie a expiré. Contactez votre photographe.": "This gallery has expired. Please contact your photographer.",
    "Cette galerie a expiré.": "This gallery has expired.",
    "Le nom du destinataire est requis": "The recipient's name is required",
    "Une adresse e-mail valide est requise": "A valid email address is required",
    "L'adresse de livraison est requise": "The delivery address is required",
    "Le code postal est requis": "The postcode is required",
    "La ville est requise": "The city is required",
    "Pays de livraison non proposé": "We don't deliver to this country",
    "Le panier est vide": "Your cart is empty",
    "Une des photos du panier n'existe plus": "One of the photos in your cart is no longer available",
    "Une des photos du panier n'est pas disponible en tirage": "One of the photos in your cart can't be printed",
    "Un des formats du panier n'est plus proposé": "One of the formats in your cart is no longer offered",
    "Rien à régler pour le moment": "Nothing to pay for now",
    "Le paiement en ligne n'est pas encore activé pour cette galerie": "Online payment isn't enabled for this gallery yet",
    "Le paiement en ligne n'est pas encore activé": "Online payment isn't enabled yet",
    "Stripe a refusé la demande de paiement": "The payment couldn't start. Please try again in a moment.",
    "La boutique de tirages n'est pas ouverte sur cette galerie": "The print shop isn't open on this gallery",
  };

  function serverText(message, fallbackEn) {
    if (LANG !== "en") return message;
    return SERVER_EN[message] || fallbackEn;
  }

  // Textes fixes de la page (galerie.html) : data-en, data-en-html,
  // data-en-label, data-en-title, data-en-placeholder.
  function setLanguage(lang) {
    if (lang !== "en" || LANG === "en") return;
    LANG = "en";
    document.documentElement.lang = "en";
    document.title = "Your private gallery — Holypixx";
    Array.prototype.forEach.call(document.querySelectorAll("[data-en]"), function (node) {
      node.textContent = node.getAttribute("data-en");
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-en-html]"), function (node) {
      node.innerHTML = node.getAttribute("data-en-html");
    });
    [["data-en-label", "aria-label"], ["data-en-title", "title"], ["data-en-placeholder", "placeholder"]].forEach(function (pair) {
      Array.prototype.forEach.call(document.querySelectorAll("[" + pair[0] + "]"), function (node) {
        node.setAttribute(pair[1], node.getAttribute(pair[0]));
      });
    });
    Object.keys(TAG_LABELS_EN).forEach(function (key) { TAG_LABELS[key] = TAG_LABELS_EN[key]; });
  }

  var el = {};
  var heartButtons = {}; // photoId -> bouton cœur de la grille, pour une mise à jour directe
  var gridCanvases = {}; // photoId -> vignette peinte dans la grille (source des aperçus produits)
  var commentBadges = {}; // photoId -> pastille « a un commentaire » de la grille
  var tagDots = {}; // photoId -> pastille de code couleur de la grille
  var markBadges = {}; // photoId -> compteur de repères de la grille
  var COMMENT_DEBOUNCE_MS = 700;
  var commentTimer = null;

  /* ---------- Sélection (coup de cœur) ---------- */

  function selectedCount() {
    var count = 0;
    for (var i = 0; i < state.photos.length; i++) if (state.photos[i].selected) count++;
    return count;
  }

  // La liste que parcourt la visionneuse (Précédent/Suivant) : toutes les
  // photos, ou seulement les sélectionnées si le filtre est actif.
  function visiblePhotos() {
    if (!state.filterSelected) return state.photos;
    return state.photos.filter(function (p) {
      return p.selected;
    });
  }

  function heartLabel(selected) {
    return selected ? L("Retirer des favoris", "Remove from favourites") : L("Ajouter aux favoris", "Add to favourites");
  }

  function paintHeart(button, selected) {
    button.classList.toggle("gp-heart-active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.setAttribute("aria-label", heartLabel(selected));
    button.title = heartLabel(selected);
  }

  function formatEuros(cents) {
    var amount = ((cents || 0) / 100).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return LANG === "en" ? "€" + amount : amount + " €";
  }

  // Forfait : nombre de photos déjà payées par le client, au-delà duquel un
  // supplément se calcule automatiquement à partir de ses coups de cœur.
  // Absent (includedPhotos null) sur les galeries sans forfait défini —
  // comportement d'avant cette fonctionnalité, rien ne s'affiche alors.
  // `paidExtraCount` (déjà réglé en ligne, confirmé par Stripe) est toujours
  // déduit du brut : ce qui s'affiche ici est ce qui reste réellement dû.
  function updateQuotaUI(count) {
    if (!el.toolbarQuota) return;
    var included = state.gallery && state.gallery.includedPhotos;
    if (included === null || included === undefined) {
      el.toolbarQuota.hidden = true;
      if (el.payButton) el.payButton.hidden = true;
      return;
    }
    var extra = Math.max(0, count - included);
    var paid = (state.gallery && state.gallery.paidExtraCount) || 0;
    var due = Math.max(0, extra - paid);
    var text = count + " / " + included + " " + L(
      "photo" + (included > 1 ? "s" : "") + " incluse" + (included > 1 ? "s" : ""),
      plural(included, "photo", "photos") + " included"
    );
    if (due > 0) {
      text +=
        " — +" + due + " " + L("supplément" + (due > 1 ? "s" : ""), plural(due, "extra", "extras")) +
        " (" + formatEuros(due * (state.gallery.extraPhotoPriceCents || 0)) + ")";
    } else if (extra > 0) {
      text += L(" — supplément réglé ✓", " — extras paid ✓");
    }
    el.toolbarQuota.textContent = text;
    el.toolbarQuota.classList.toggle("gp-toolbar-quota-due", due > 0);
    el.toolbarQuota.hidden = false;

    if (el.payButton) {
      el.payButton.hidden = !(due > 0 && state.gallery.canPayOnline);
    }
    if (el.invoiceButton) {
      var invoices = state.gallery.invoices || [];
      el.invoiceButton.hidden = invoices.length === 0;
    }
  }

  // Facture la plus récente : suffisant tant qu'un seul supplément est réglé
  // par galerie — s'il y en a plusieurs, celle-ci couvre le tout dernier.
  function downloadInvoice() {
    if (!el.invoiceButton) return;
    var invoices = (state.gallery && state.gallery.invoices) || [];
    var invoice = invoices[0];
    if (!invoice) return;

    el.invoiceButton.disabled = true;
    el.invoiceButton.textContent = L("Téléchargement…", "Downloading…");

    fetch(apiUrl("/invoice/" + invoice.id), { headers: authHeaders() })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        if (!response.ok) throw new Error("échec");
        return response.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = L("facture-", "invoice-") + invoice.number + ".pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
        el.invoiceButton.disabled = false;
        el.invoiceButton.textContent = L("Télécharger ma facture", "Download my invoice");
      })
      .catch(function (err) {
        el.invoiceButton.disabled = false;
        el.invoiceButton.textContent = L("Télécharger ma facture", "Download my invoice");
        if (err.message === "session") {
          sessionLost(SESSION_EXPIRED());
        }
      });
  }

  // Ouvre la page de paiement hébergée par Stripe pour le supplément dû.
  // Le montant réel est recalculé côté serveur au moment de la requête — ce
  // qui s'affiche ici n'est qu'un affichage, jamais la source de vérité.
  function payForSupplement() {
    if (!el.payButton) return;
    el.payButton.disabled = true;
    el.payButton.textContent = L("Redirection…", "Redirecting…");
    if (el.payError) el.payError.hidden = true;

    var here = window.location.href;
    var returnUrl = here + (here.indexOf("?") === -1 ? "?" : "&");

    fetch(apiUrl("/checkout"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({
        successUrl: returnUrl + "paiement=succes",
        cancelUrl: returnUrl + "paiement=annule",
      }),
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(serverText(data.error || "", "The payment couldn't start.") || L("Le paiement n'a pas pu démarrer.", "The payment couldn't start."));
          return data;
        });
      })
      .then(function (data) {
        window.location.href = data.url;
      })
      .catch(function (err) {
        if (err.message === "session") {
          sessionLost(SESSION_EXPIRED());
          return;
        }
        el.payButton.disabled = false;
        el.payButton.textContent = L("Régler le supplément", "Pay the extra");
        if (el.payError) {
          el.payError.textContent = err.message || L("Le paiement n'a pas pu démarrer. Réessayez dans un instant.", "The payment couldn't start. Please try again in a moment.");
          el.payError.hidden = false;
        }
      });
  }

  function updateSelectionUI() {
    var count = selectedCount();
    if (el.selectionCount) {
      el.selectionCount.textContent =
        count === 0 ? L("Aucune photo sélectionnée pour l'instant", "No photos selected yet")
          : count + L(count > 1 ? " photos sélectionnées" : " photo sélectionnée", count > 1 ? " photos selected" : " photo selected");
    }
    updateQuotaUI(count);
    if (el.filterEmpty) {
      el.filterEmpty.hidden = !(state.filterSelected && count === 0);
    }
    if (el.toolbar) el.toolbar.hidden = state.photos.length === 0;
    updateValidateUI(count);
  }

  /* ---------- « Valider ma sélection » ---------- */

  function formatDateTime(ts) {
    return new Date(ts * 1000).toLocaleString(LANG === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeStyle: "short" });
  }

  // Le bouton reste disponible après validation (le client peut changer
  // d'avis et revalider) ; le statut rappelle la dernière validation.
  function updateValidateUI(count) {
    if (!el.validateBlock) return;
    el.validateBlock.hidden = state.photos.length === 0;
    var doneAt = state.gallery && state.gallery.selectionDoneAt;
    el.validate.disabled = count === 0 || state.validating;
    el.validateBlock.classList.toggle("gp-validate-done", Boolean(doneAt));
    if (doneAt) {
      el.validate.textContent = L("Valider à nouveau ma sélection", "Confirm my selection again");
      el.validateStatus.textContent = L(
        "Sélection validée le " + formatDateTime(doneAt) + ". Vous pouvez encore la modifier et la valider à nouveau.",
        "Selection confirmed on " + formatDateTime(doneAt) + ". You can still change it and confirm it again."
      );
    } else {
      el.validate.textContent = L("Valider ma sélection", "Confirm my selection");
      el.validateStatus.textContent = count === 0
        ? L("Cochez d'abord vos coups de cœur.", "Heart your favourites first.")
        : L("Quand votre choix est fait, prévenez-moi d'un clic.", "When you've made your choice, let me know in one click.");
    }
  }

  function validateSelection() {
    if (!state.gallery || state.validating) return;
    state.validating = true;
    updateValidateUI(selectedCount());
    el.validateStatus.textContent = L("Envoi…", "Sending…");
    fetch(apiUrl("/validate"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: "{}",
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        if (!response.ok) throw new Error("échec");
        return response.json();
      })
      .then(function (data) {
        state.gallery.selectionDoneAt = data.selectionDoneAt;
        state.validating = false;
        updateValidateUI(selectedCount());
      })
      .catch(function (err) {
        state.validating = false;
        updateValidateUI(selectedCount());
        if (err.message === "session") {
          sessionLost(SESSION_EXPIRED());
        } else {
          el.validateStatus.textContent = L("Impossible d'envoyer la validation pour l'instant. Réessayez dans un instant.", "Couldn't send your confirmation right now. Please try again in a moment.");
        }
      });
  }

  /**
   * Bascule le coup de cœur d'une photo. Mise à jour immédiate de
   * l'affichage (les deux cœurs — grille et visionneuse — s'il y en a un
   * ouvert), puis confirmation au Worker ; en cas d'échec, l'affichage
   * revient en arrière plutôt que de mentir sur l'état réel.
   */
  function toggleSelect(photo) {
    var next = !photo.selected;
    photo.selected = next;
    reflectSelection(photo);

    fetch(apiUrl("/select"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ photoId: photo.id, selected: next }),
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        if (!response.ok) throw new Error("échec");
      })
      .catch(function (err) {
        photo.selected = !next;
        reflectSelection(photo);
        if (err.message === "session") {
          sessionLost(SESSION_EXPIRED());
        }
      });
  }

  // Répercute l'état d'une photo sur tout ce qui l'affiche, sans jamais
  // reconstruire la grille ni retélécharger de tuile : le filtre « ma
  // sélection » masque/affiche par CSS, pas en retirant les photos du DOM.
  function reflectSelection(photo) {
    var heart = heartButtons[photo.id];
    if (heart) {
      paintHeart(heart, photo.selected);
      heart.closest(".gp-item").classList.toggle("gp-item-selected", photo.selected);
    }
    if (el.viewerHeart && state.viewerList && state.viewerList[state.current] === photo) {
      paintHeart(el.viewerHeart, photo.selected);
    }
    updateSelectionUI();
  }

  /* ---------- Commentaire (note laissée sur une photo) ---------- */

  function hasComment(photo) {
    return !!(photo.comment && photo.comment.trim());
  }

  // Répercute le commentaire d'une photo sur la pastille de la grille et sur
  // le bouton de la visionneuse, sans jamais reconstruire la grille.
  function reflectComment(photo) {
    var badge = commentBadges[photo.id];
    if (badge) badge.hidden = !hasComment(photo);
    if (el.commentToggle && state.viewerList && state.viewerList[state.current] === photo) {
      el.commentToggle.classList.toggle("gp-comment-has-text", hasComment(photo));
    }
  }

  function setCommentStatus(text) {
    if (el.commentStatus) el.commentStatus.textContent = text;
  }

  function saveComment(photo, value) {
    setCommentStatus(L("Enregistrement…", "Saving…"));
    fetch(apiUrl("/comment"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ photoId: photo.id, comment: value }),
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        if (!response.ok) throw new Error("échec");
        return response.json();
      })
      .then(function (data) {
        // La valeur renvoyée est normalisée par le serveur (espaces retirés,
        // longueur bornée) : c'est elle qui fait foi, pas ce qui a été tapé.
        photo.comment = data.comment;
        reflectComment(photo);
        if (el.commentInput && currentViewerPhoto() === photo && el.commentInput.value !== data.comment) {
          el.commentInput.value = data.comment;
        }
        setCommentStatus(L("Enregistré", "Saved"));
        setTimeout(function () {
          if (el.commentStatus && el.commentStatus.textContent === L("Enregistré", "Saved")) setCommentStatus("");
        }, 1800);
      })
      .catch(function (err) {
        setCommentStatus(L("Échec de l'enregistrement — réessayez", "Couldn't save — please try again"));
        if (err.message === "session") {
          sessionLost(SESSION_EXPIRED());
        }
      });
  }

  // Sauvegarde immédiate d'une saisie encore en attente (débounce non écoulé)
  // — appelé avant de changer de photo ou de fermer la visionneuse, pour ne
  // jamais perdre ce qui vient d'être tapé.
  function flushPendingComment() {
    if (!commentTimer) return;
    clearTimeout(commentTimer);
    commentTimer = null;
    var photo = currentViewerPhoto();
    if (photo && el.commentInput && el.commentInput.value !== (photo.comment || "")) {
      saveComment(photo, el.commentInput.value);
    }
  }

  function wireCommentInput() {
    if (!el.commentInput) return;
    el.commentInput.addEventListener("input", function () {
      clearTimeout(commentTimer);
      var photo = currentViewerPhoto();
      var value = el.commentInput.value;
      commentTimer = setTimeout(function () {
        commentTimer = null;
        if (photo) saveComment(photo, value);
      }, COMMENT_DEBOUNCE_MS);
    });
    el.commentInput.addEventListener("blur", flushPendingComment);
    // Empêche les flèches gauche/droite de faire changer de photo pendant la
    // frappe. Échap reste actif : il ferme la visionneuse normalement (le
    // commentaire en cours est sauvegardé au passage par closeViewer).
    el.commentInput.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") event.stopPropagation();
    });
  }

  function toggleCommentPanel() {
    if (!el.commentPanel) return;
    var willOpen = el.commentPanel.hidden;
    el.commentPanel.hidden = !willOpen;
    if (el.commentToggle) el.commentToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen && el.commentInput) el.commentInput.focus();
  }

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------- Codes couleur (validée / à retoucher / à écarter) ---------- */

  var TAG_LABELS = { green: "Validée", yellow: "À retoucher", red: "À écarter" };
  var TAG_LABELS_EN = { green: "Approved", yellow: "To retouch", red: "Set aside" };

  // Répercute le code couleur d'une photo sur la pastille de la grille et
  // sur les trois boutons de la visionneuse (si c'est la photo affichée).
  function reflectTag(photo) {
    var dot = tagDots[photo.id];
    if (dot) {
      dot.hidden = !photo.tag;
      dot.className = "gp-tag-dot" + (photo.tag ? " gp-tag-dot-" + photo.tag : "");
      dot.title = photo.tag ? TAG_LABELS[photo.tag] || "" : "";
    }
    if (el.tagButtons && currentViewerPhoto() === photo) {
      el.tagButtons.forEach(function (button) {
        button.setAttribute("aria-pressed", button.getAttribute("data-tag") === photo.tag ? "true" : "false");
      });
    }
  }

  // Cliquer sur la couleur déjà active la retire : trois boutons, pas de
  // quatrième « aucun » à expliquer.
  function setTag(photo, tag) {
    var previous = photo.tag || "";
    var next = previous === tag ? "" : tag;
    photo.tag = next;
    reflectTag(photo);

    fetch(apiUrl("/tag"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ photoId: photo.id, tag: next }),
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        if (!response.ok) throw new Error("échec");
      })
      .catch(function (err) {
        photo.tag = previous;
        reflectTag(photo);
        if (err.message === "session") {
          sessionLost(SESSION_EXPIRED());
        }
      });
  }

  /* ---------- Repères annotés (un point + une note sur la photo) ---------- */

  var MAX_MARKS = 12;
  var pinState = { placing: false, editing: -1, isNew: false };

  function marksOf(photo) {
    if (!photo.marks) photo.marks = [];
    return photo.marks;
  }

  function reflectMarks(photo) {
    var badge = markBadges[photo.id];
    var count = marksOf(photo).length;
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = String(count);
    }
    if (currentViewerPhoto() === photo) renderPins(photo);
  }

  // Le calque des repères est calé sur la boîte réelle du canvas : celle-ci
  // dépend de la fenêtre (largeur ou hauteur limitante), donc on la relit
  // plutôt que de la deviner en CSS.
  function syncPinsLayer() {
    if (!el.pins || !el.viewerCanvas || !el.viewerFrame) return;
    var canvas = el.viewerCanvas;
    el.pins.style.left = canvas.offsetLeft + "px";
    el.pins.style.top = canvas.offsetTop + "px";
    el.pins.style.width = canvas.offsetWidth + "px";
    el.pins.style.height = canvas.offsetHeight + "px";
  }

  function renderPins(photo) {
    if (!el.pins) return;
    el.pins.innerHTML = "";
    marksOf(photo).forEach(function (mark, index) {
      var pin = document.createElement("button");
      pin.type = "button";
      pin.className = "gp-pin" + (pinState.editing === index ? " gp-pin-active" : "");
      pin.style.left = (mark.x * 100).toFixed(2) + "%";
      pin.style.top = (mark.y * 100).toFixed(2) + "%";
      pin.setAttribute("aria-label", L("Repère ", "Marker ") + (index + 1) + (mark.note ? L(" : ", ": ") + mark.note : ""));
      pin.title = mark.note || L("Repère ", "Marker ") + (index + 1);
      var label = document.createElement("span");
      label.textContent = String(index + 1);
      pin.appendChild(label);
      pin.addEventListener("click", function (event) {
        event.stopPropagation();
        openPinEditor(index, false);
      });
      el.pins.appendChild(pin);
    });
    syncPinsLayer();
  }

  function setPlacing(on) {
    pinState.placing = on;
    if (el.pinToggle) el.pinToggle.setAttribute("aria-pressed", on ? "true" : "false");
    if (el.pins) el.pins.classList.toggle("gp-pins-placing", on);
    if (el.pinHint) el.pinHint.hidden = !on;
  }

  function openPinEditor(index, isNew) {
    var photo = currentViewerPhoto();
    if (!photo || !el.pinEditor) return;
    pinState.editing = index;
    pinState.isNew = isNew;
    var mark = marksOf(photo)[index];
    el.pinEditorTitle.textContent = L("Repère " + (index + 1) + " — que faut-il signaler ici ?", "Marker " + (index + 1) + " — what should we look at here?");
    el.pinNote.value = mark.note || "";
    el.pinEditor.hidden = false;
    if (el.commentPanel) el.commentPanel.hidden = true;
    if (el.commentToggle) el.commentToggle.setAttribute("aria-expanded", "false");
    renderPins(photo);
    el.pinNote.focus();
  }

  function closePinEditor() {
    pinState.editing = -1;
    pinState.isNew = false;
    if (el.pinEditor) el.pinEditor.hidden = true;
    var photo = currentViewerPhoto();
    if (photo) renderPins(photo);
  }

  function saveMarks(photo, previous) {
    reflectMarks(photo);
    return fetch(apiUrl("/marks"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ photoId: photo.id, marks: marksOf(photo) }),
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        if (!response.ok) throw new Error("échec");
        return response.json();
      })
      .then(function (data) {
        if (data && Array.isArray(data.marks)) {
          photo.marks = data.marks;
          reflectMarks(photo);
        }
      })
      .catch(function (err) {
        photo.marks = previous;
        reflectMarks(photo);
        if (err.message === "session") {
          sessionLost(SESSION_EXPIRED());
        }
      });
  }

  function placePin(event) {
    var photo = currentViewerPhoto();
    if (!photo || !pinState.placing || !el.pins) return;
    if (marksOf(photo).length >= MAX_MARKS) {
      setPlacing(false);
      return;
    }
    var rect = el.pins.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    var y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    marksOf(photo).push({ x: x, y: y, note: "" });
    setPlacing(false);
    openPinEditor(marksOf(photo).length - 1, true);
  }

  function wirePins() {
    if (!el.pinToggle || !el.pins) return;
    el.pinToggle.addEventListener("click", function () {
      var photo = currentViewerPhoto();
      if (!photo) return;
      if (!pinState.placing && pinState.editing !== -1) cancelPinEdit();
      setPlacing(!pinState.placing);
    });
    el.pins.addEventListener("click", placePin);
    el.pinSave.addEventListener("click", function () {
      var photo = currentViewerPhoto();
      if (!photo || pinState.editing === -1) return;
      var previous = marksOf(photo).slice();
      marksOf(photo)[pinState.editing].note = el.pinNote.value.trim().slice(0, 200);
      closePinEditor();
      saveMarks(photo, previous);
    });
    el.pinDelete.addEventListener("click", function () {
      var photo = currentViewerPhoto();
      if (!photo || pinState.editing === -1) return;
      var previous = marksOf(photo).slice();
      var wasNew = pinState.isNew;
      marksOf(photo).splice(pinState.editing, 1);
      closePinEditor();
      if (wasNew) reflectMarks(photo); // jamais envoyé au serveur : rien à retirer
      else saveMarks(photo, previous);
    });
    el.pinCancel.addEventListener("click", cancelPinEdit);
    el.pinNote.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancelPinEdit();
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        el.pinSave.click();
      }
    });
    window.addEventListener("resize", syncPinsLayer);
  }

  // Annuler sur un repère tout juste posé le retire ; sur un repère
  // existant, on referme simplement sans toucher à sa note.
  function cancelPinEdit() {
    var photo = currentViewerPhoto();
    if (photo && pinState.isNew && pinState.editing !== -1) {
      marksOf(photo).splice(pinState.editing, 1);
      closePinEditor();
      reflectMarks(photo);
      return;
    }
    closePinEditor();
  }

  /* ---------- Aperçu des produits avec la photo du client ---------- */

  // Chaque produit de la boutique est dessiné avec la photo elle-même :
  // toile, cadre (à sa couleur), plexiglas, mug… La photo est copiée depuis
  // une vignette déjà affichée (filigranée, basse définition), jamais
  // rechargée ni exportée. Le recadrage montré est celui du labo : la photo
  // remplit le format choisi (sauf sur un mug, où elle est posée entière).
  var FRAME_COLORS = {
    black: "#1f1c1a", white: "#f4f1eb", natural: "#c39a6b", brown: "#5b3a27",
    "dark grey": "#4a4a4c", "light grey": "#b8b8ba", gold: "#b8944d", silver: "#bec0c3",
  };

  function photoSource(photo) {
    if (currentViewerPhoto() === photo && el.viewerCanvas.width) return el.viewerCanvas;
    return gridCanvases[photo.id] || null;
  }

  // Proportions du produit, tournées dans le sens de la photo (un 30 × 40
  // accueille une photo en largeur comme en hauteur).
  function productRatio(look, photo) {
    var photoRatio = photo.width / photo.height;
    if (!look.ratio) return photoRatio;
    var r = look.ratio[0] / look.ratio[1];
    if (r !== 1 && (r > 1) !== (photoRatio > 1)) r = 1 / r;
    return r;
  }

  // Dessine la photo dans `canvas` (w × h en px CSS) : recadrée pour remplir,
  // ou posée entière sur fond blanc (`fit`).
  function drawPhoto(canvas, source, w, h, fit) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = fit ? "#ffffff" : "#efe6db";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!source || !source.width || !source.height) return;
    var sw = source.width;
    var sh = source.height;
    if (fit) {
      var scale = Math.min(canvas.width / sw, canvas.height / sh);
      var dw = sw * scale;
      var dh = sh * scale;
      ctx.drawImage(source, 0, 0, sw, sh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      return;
    }
    var target = canvas.width / canvas.height;
    var cw = sw;
    var ch = sh;
    if (sw / sh > target) cw = sh * target;
    else ch = sw / target;
    ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
  }

  // Aperçu d'un produit, dans un carré de `box` px.
  function buildMockup(photo, product, box) {
    var look = product.look || { kind: "print" };
    var kind = look.kind || "print";
    var wrap = document.createElement("div");
    wrap.className = "gp-mock gp-mock-" + kind + (look.deep ? " gp-mock-deep" : "") + (look.matte ? " gp-mock-matte" : "");
    wrap.style.width = box + "px";
    wrap.style.height = box + "px";
    wrap.setAttribute("aria-hidden", "true");
    var obj = document.createElement("div");
    obj.className = "gp-mock-obj";
    var canvas = document.createElement("canvas");
    var source = photoSource(photo);

    if (kind === "mug") {
      var body = Math.round(box * 0.6);
      obj.style.width = body + "px";
      obj.style.height = Math.round(body * 1.04) + "px";
      obj.style.setProperty("--s", body + "px");
      drawPhoto(canvas, source, Math.round(body * 0.78), Math.round(body * 0.7), true);
      obj.appendChild(canvas);
      wrap.appendChild(obj);
      return wrap;
    }

    var ratio = productRatio(look, photo);
    var max = box * (kind === "card" || kind === "board" ? 0.8 : 0.86);
    var ow = ratio >= 1 ? max : max * ratio;
    var oh = ratio >= 1 ? max / ratio : max;
    var longSide = Math.max(ow, oh);
    var border = 0;
    var pad = 0;
    if (kind === "frame") {
      border = Math.max(2, longSide * (look.deep ? 0.075 : 0.055));
      pad = look.mat ? longSide * 0.1 : 0;
    } else if (kind === "float") {
      border = Math.max(2, longSide * 0.045);
      pad = Math.max(1.5, longSide * 0.03);
    }
    if (border) {
      obj.style.borderWidth = border + "px";
      obj.style.setProperty("--frame", FRAME_COLORS[look.color] || FRAME_COLORS.black);
      if (look.color === "white" || look.color === "light grey" || look.color === "silver") obj.classList.add("gp-mock-light");
    }
    if (pad) obj.style.padding = pad + "px";
    if (look.mat) obj.classList.add("gp-mock-mat");
    obj.style.width = Math.round(ow) + "px";
    obj.style.height = Math.round(oh) + "px";
    var inset = 2 * (border + pad);
    drawPhoto(canvas, source, Math.max(1, Math.round(ow - inset)), Math.max(1, Math.round(oh - inset)), false);
    obj.appendChild(canvas);
    wrap.appendChild(obj);
    return wrap;
  }

  /* ---------- Boutique de tirages ---------- */

  var shop = { cart: [] };

  function cartKey() {
    return "gp-cart-" + state.slug;
  }

  function shopProduct(id) {
    var products = (state.gallery && state.gallery.shop && state.gallery.shop.products) || [];
    for (var i = 0; i < products.length; i++) if (products[i].id === id) return products[i];
    return null;
  }

  function photoById(id) {
    for (var i = 0; i < state.photos.length; i++) if (state.photos[i].id === id) return state.photos[i];
    return null;
  }

  // Le panier survit au passage par la page de paiement (et à un retour
  // arrière) : stocké dans ce navigateur seulement, jamais côté serveur.
  function loadCart() {
    var raw = null;
    try { raw = window.localStorage.getItem(cartKey()); } catch (e) { raw = null; }
    var lines = [];
    try { lines = JSON.parse(raw || "[]") || []; } catch (e) { lines = []; }
    // Panier vide dans ce navigateur : on reprend celui enregistré côté
    // serveur (préparé sur un autre appareil, ou rappelé par e-mail).
    var saved = state.gallery && state.gallery.shop && state.gallery.shop.savedCart;
    if (!lines.length && saved && saved.length) lines = saved;
    shop.cart = lines.filter(function (l) {
      var photo = photoById(l.photoId);
      return photo && photo.printable && shopProduct(l.productId) && l.copies >= 1 && l.copies <= 10;
    });
  }

  // Copie du panier côté serveur, regroupée (un envoi par rafale de clics)
  // et envoyée tout de suite si la page se ferme avant.
  var cartSync = { timer: null, pending: null };

  function flushCartSync() {
    clearTimeout(cartSync.timer);
    var lines = cartSync.pending;
    cartSync.pending = null;
    if (!lines || !state.token) return;
    fetch(apiUrl("/cart"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ lines: lines }),
      keepalive: true,
    }).catch(function () {});
  }

  function saveCart() {
    try { window.localStorage.setItem(cartKey(), JSON.stringify(shop.cart)); } catch (e) { /* navigation privée */ }
    if (!state.token) return;
    cartSync.pending = shop.cart.map(function (l) { return { photoId: l.photoId, productId: l.productId, copies: l.copies }; });
    clearTimeout(cartSync.timer);
    cartSync.timer = setTimeout(flushCartSync, 600);
  }

  window.addEventListener("pagehide", flushCartSync);

  function cartCount() {
    return shop.cart.reduce(function (n, l) { return n + l.copies; }, 0);
  }

  function cartItemsCents() {
    return shop.cart.reduce(function (sum, l) {
      var p = shopProduct(l.productId);
      return sum + (p ? p.priceCents * l.copies : 0);
    }, 0);
  }

  // Forfait de port du pays choisi : Europe, ou hors d'Europe.
  function shippingForCountry(code) {
    var info = state.gallery.shop;
    var countries = info.countries || [];
    for (var i = 0; i < countries.length; i++) {
      if (countries[i].code === code && countries[i].zone === "world") return info.shippingWorldCents || 0;
    }
    return info.shippingCents || 0;
  }

  function updateCartUI() {
    if (el.cartCount) el.cartCount.textContent = "(" + cartCount() + ")";
  }

  function addToCart(photo, product) {
    var existing = null;
    for (var i = 0; i < shop.cart.length; i++) {
      if (shop.cart[i].photoId === photo.id && shop.cart[i].productId === product.id) existing = shop.cart[i];
    }
    if (existing) existing.copies = Math.min(10, existing.copies + 1);
    else shop.cart.push({ photoId: photo.id, productId: product.id, copies: 1 });
    saveCart();
    updateCartUI();
    var n = cartCount();
    el.printStatus.textContent = L(
      "Ajouté ✓ — " + n + " article" + (n > 1 ? "s" : "") + " dans « Mes tirages »",
      "Added ✓ — " + n + " " + plural(n, "item", "items") + " in “My prints”"
    );
  }

  function showPrintPreview(photo, product, li) {
    if (!el.printPreview) return;
    el.printPreview.innerHTML = "";
    el.printPreview.appendChild(buildMockup(photo, product, 168));
    var caption = document.createElement("p");
    caption.className = "gp-print-preview-label";
    caption.textContent = product.label;
    el.printPreview.appendChild(caption);
    Array.prototype.forEach.call(el.printProducts.children, function (row) {
      row.classList.toggle("gp-print-active", row === li);
    });
  }

  function renderPrintPanel(photo) {
    el.printProducts.innerHTML = "";
    el.printStatus.textContent = "";
    var products = state.gallery.shop.products;
    products.forEach(function (product, index) {
      var li = document.createElement("li");
      li.appendChild(buildMockup(photo, product, 52));
      li.addEventListener("mouseenter", function () { showPrintPreview(photo, product, li); });
      li.addEventListener("focusin", function () { showPrintPreview(photo, product, li); });
      li.addEventListener("click", function () { showPrintPreview(photo, product, li); });
      var label = document.createElement("span");
      label.textContent = product.label;
      var price = document.createElement("span");
      price.className = "gp-print-price";
      price.textContent = formatEuros(product.priceCents);
      if (product.listPriceCents && product.listPriceCents > product.priceCents) {
        var was = document.createElement("s");
        was.className = "gp-print-was";
        was.textContent = formatEuros(product.listPriceCents);
        price.insertBefore(was, price.firstChild);
        price.classList.add("gp-print-promo");
      }
      var add = document.createElement("button");
      add.type = "button";
      add.className = "gp-print-add";
      add.textContent = L("Ajouter", "Add");
      add.addEventListener("click", function () { addToCart(photo, product); });
      li.appendChild(label);
      li.appendChild(price);
      li.appendChild(add);
      el.printProducts.appendChild(li);
      if (index === 0) showPrintPreview(photo, product, li);
    });
  }

  function closePrintPanel() {
    if (el.printPanel) el.printPanel.hidden = true;
    if (el.printToggle) el.printToggle.setAttribute("aria-expanded", "false");
  }

  function reflectPrintable(photo) {
    if (!el.printToggle) return;
    var can = Boolean(state.gallery && state.gallery.shop && photo && photo.printable);
    el.printToggle.hidden = !can;
    closePrintPanel();
  }

  function togglePrintPanel() {
    var photo = currentViewerPhoto();
    if (!photo || !el.printPanel) return;
    var willOpen = el.printPanel.hidden;
    if (willOpen) {
      renderPrintPanel(photo);
      if (el.commentPanel) el.commentPanel.hidden = true;
      if (el.commentToggle) el.commentToggle.setAttribute("aria-expanded", "false");
    }
    el.printPanel.hidden = !willOpen;
    el.printToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }

  function renderCart() {
    el.cartLines.innerHTML = "";
    shop.cart.forEach(function (line, index) {
      var product = shopProduct(line.productId);
      var photo = photoById(line.photoId);
      if (!product || !photo) return;
      var li = document.createElement("li");
      li.appendChild(buildMockup(photo, product, 46));
      var what = document.createElement("span");
      what.textContent = product.label;
      var which = document.createElement("span");
      which.className = "gp-cart-photo";
      which.textContent = L("Photo n° ", "Photo no. ") + (state.photos.indexOf(photo) + 1);
      what.appendChild(which);
      var qty = document.createElement("select");
      qty.setAttribute("aria-label", L("Quantité", "Quantity"));
      for (var q = 1; q <= 10; q++) {
        var opt = document.createElement("option");
        opt.value = String(q);
        opt.textContent = "× " + q;
        if (q === line.copies) opt.selected = true;
        qty.appendChild(opt);
      }
      qty.addEventListener("change", function () {
        line.copies = Number(qty.value);
        saveCart();
        updateCartUI();
        renderCart();
      });
      var price = document.createElement("span");
      price.textContent = formatEuros(product.priceCents * line.copies);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "gp-cart-remove";
      remove.setAttribute("aria-label", L("Retirer", "Remove"));
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        shop.cart.splice(index, 1);
        saveCart();
        updateCartUI();
        renderCart();
      });
      li.appendChild(what);
      li.appendChild(qty);
      li.appendChild(price);
      li.appendChild(remove);
      el.cartLines.appendChild(li);
    });
    var empty = shop.cart.length === 0;
    el.cartEmpty.hidden = !empty;
    el.cartForm.hidden = empty;
    el.cartTotals.hidden = empty;
    var items = cartItemsCents();
    var shipping = shippingForCountry(el.cartCountry.value);
    el.cartItems.textContent = formatEuros(items);
    el.cartShipping.textContent = shipping ? formatEuros(shipping) : L("offerte", "free");
    el.cartTotal.textContent = formatEuros(items + shipping);
    el.cartPay.textContent = L("Payer ", "Pay ") + formatEuros(items + shipping);
  }

  function openCart() {
    loadCart();
    updateCartUI();
    renderCart();
    el.cartError.hidden = true;
    el.cart.hidden = false;
    document.body.classList.add("gp-locked");
  }

  function closeCart() {
    el.cart.hidden = true;
    if (el.viewer.hidden) document.body.classList.remove("gp-locked");
  }

  function submitCart(event) {
    event.preventDefault();
    if (!shop.cart.length) return;
    var form = el.cartForm;
    el.cartError.hidden = true;
    el.cartPay.disabled = true;
    el.cartPay.textContent = L("Redirection vers le paiement…", "Redirecting to payment…");
    var here = window.location.href.replace(/[?&]tirages=[^&]*/, "");
    var returnUrl = here + (here.indexOf("?") === -1 ? "?" : "&");
    fetch(apiUrl("/print-order"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({
        lines: shop.cart,
        recipient: {
          name: form.name.value, email: form.email.value, line1: form.line1.value, line2: form.line2.value,
          postalCode: form.postalCode.value, city: form.city.value, countryCode: form.countryCode.value,
        },
        successUrl: returnUrl + "tirages=succes",
        cancelUrl: returnUrl + "tirages=annule",
      }),
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(serverText(data.error || "", "Please check your details and try again.") || L("La commande n'a pas pu démarrer.", "The order couldn't start."));
          return data;
        });
      })
      .then(function (data) {
        try { window.sessionStorage.setItem("gp-cart-pending-" + state.slug, "1"); } catch (e) { /* ignoré */ }
        window.location.href = data.url;
      })
      .catch(function (err) {
        if (err.message === "session") {
          closeCart();
          sessionLost(SESSION_EXPIRED());
          return;
        }
        el.cartPay.disabled = false;
        renderCart();
        el.cartError.textContent = err.message || L("La commande n'a pas pu démarrer. Réessayez dans un instant.", "The order couldn't start. Please try again in a moment.");
        el.cartError.hidden = false;
      });
  }

  function renderPrintOrders() {
    var orders = (state.gallery && state.gallery.printOrders) || [];
    if (!el.printOrders) return;
    el.printOrders.innerHTML = "";
    el.printOrders.hidden = orders.length === 0;
    orders.forEach(function (o) {
      var li = document.createElement("li");
      li.textContent =
        L("Commande du ", "Order of ") + new Date(o.createdAt * 1000).toLocaleDateString(locale(), { day: "numeric", month: "long" }) +
        " — " + o.count + " " + L("tirage" + (o.count > 1 ? "s" : ""), plural(o.count, "print", "prints")) +
        " — " + o.statusLabel + (o.trackingUrl ? " ·" : "");
      if (o.trackingUrl) {
        var a = document.createElement("a");
        a.href = o.trackingUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = L("Suivre le colis", "Track the parcel");
        li.appendChild(a);
      }
      el.printOrders.appendChild(li);
    });
  }

  function showShopBanner(text, warn) {
    var banner = document.createElement("p");
    banner.className = "gp-shop-banner" + (warn ? " gp-shop-banner-warn" : "");
    banner.id = "gp-shop-banner";
    banner.textContent = text;
    el.toolbar.parentNode.insertBefore(banner, el.toolbar);
  }

  function setupShop() {
    var open = Boolean(state.gallery.shop);
    if (el.shopBar) el.shopBar.hidden = !open;
    var promo = open && state.gallery.shop.promo;
    if (el.shopPromo) {
      el.shopPromo.hidden = !promo;
      if (promo) {
        var until = new Date(promo.endsAt * 1000).toLocaleDateString(LANG === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long" });
        el.shopPromo.textContent = L(
          "−" + promo.percent + " % sur tous les tirages jusqu'au " + until,
          promo.percent + "% off all prints until " + until
        );
      }
    }
    renderPrintOrders();
    if (open) {
      // Pays livrés (dans la langue de la galerie) ; présélection : celui
      // du navigateur s'il est livré, sinon la Belgique.
      var countries = state.gallery.shop.countries || [];
      var region = (String(navigator.language || "").split("-")[1] || "").toUpperCase();
      var preferred = countries.some(function (c) { return c.code === region; }) ? region : "BE";
      el.cartCountry.innerHTML = "";
      countries.forEach(function (country) {
        var opt = document.createElement("option");
        opt.value = country.code;
        opt.textContent = country.name;
        if (country.code === preferred) opt.selected = true;
        el.cartCountry.appendChild(opt);
      });
      loadCart();
      updateCartUI();
      // Le panier de ce navigateur fait foi : on resynchronise la copie
      // serveur (au cas où une modification ne serait pas partie).
      if (shop.cart.length) saveCart();
    }
    // Retour de la page de paiement Stripe.
    var result = new URLSearchParams(window.location.search).get("tirages");
    if (result === "succes") {
      shop.cart = [];
      saveCart();
      updateCartUI();
      showShopBanner(L(
        "Merci ! Votre commande de tirages est confirmée : un e-mail récapitulatif vous a été envoyé, puis un autre avec le suivi dès l'expédition.",
        "Thank you! Your print order is confirmed: a summary email is on its way, and another one with tracking will follow as soon as it ships."
      ));
    } else if (result === "annule") {
      showShopBanner(L(
        "Paiement annulé — votre panier est conservé, vous pouvez le reprendre quand vous voulez.",
        "Payment cancelled — your cart is saved, you can pick it up whenever you like."
      ), true);
    }
    if (result) {
      var url = window.location.href.replace(/([?&])tirages=[^&]*&?/, "$1").replace(/[?&]$/, "");
      try { window.history.replaceState(null, "", url); } catch (e) { /* ignoré */ }
    }
  }

  /* ---------- Livraison des photos définitives ---------- */
  // Les fichiers se téléchargent par un lien signé valable quelques minutes,
  // demandé au moment du clic (un lien de navigateur ne peut pas porter le
  // jeton de session) : rien n'est préparé tant que le client ne clique pas.

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
      var gb = (bytes / (1024 * 1024 * 1024)).toFixed(1);
      return L(gb.replace(".", ",") + " Go", gb + " GB");
    }
    if (bytes >= 1024 * 1024) return Math.round(bytes / (1024 * 1024)) + L(" Mo", " MB");
    return Math.max(1, Math.round(bytes / 1024)) + L(" Ko", " KB");
  }

  function startDownload(fileId, button) {
    if (button) button.disabled = true;
    el.deliveryStatus.textContent = fileId ? L("Préparation du téléchargement…", "Preparing the download…") : L("Préparation du fichier ZIP…", "Preparing the ZIP file…");
    return fetch(apiUrl("/delivery/link"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify(fileId ? { fileId: fileId } : {}),
    })
      .then(function (response) {
        if (response.status === 401) throw new Error("session");
        if (!response.ok) throw new Error(L("Téléchargement impossible pour le moment.", "Download unavailable right now."));
        return response.json();
      })
      .then(function (data) {
        var link = document.createElement("a");
        link.href = data.url;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        el.deliveryStatus.textContent = fileId
          ? L("Téléchargement lancé.", "Download started.")
          : L("Téléchargement lancé — selon la taille, il peut prendre quelques minutes.", "Download started — depending on the size, it may take a few minutes.");
      })
      .catch(function (err) {
        if (err.message === "session") return sessionLost(SESSION_EXPIRED());
        el.deliveryStatus.textContent = err.message;
      })
      .then(function () {
        if (button) button.disabled = false;
      });
  }

  function setupDelivery() {
    if (!el.delivery) return;
    var d = state.gallery && state.gallery.delivery;
    if (!d || !d.files || !d.files.length) {
      el.delivery.hidden = true;
      return;
    }
    var n = d.files.length;
    el.deliverySummary.textContent = n + " photo" + (n > 1 ? "s" : "") + L(" en haute définition, sans filigrane · ", " in high resolution, no watermark · ") + formatBytes(d.totalBytes);
    el.deliveryZip.textContent = n > 1 ? L("Tout télécharger (", "Download all (") + formatBytes(d.totalBytes) + ")" : L("Télécharger", "Download");
    el.deliveryStatus.textContent = "";
    el.deliveryList.innerHTML = "";
    d.files.forEach(function (file) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = file.name;
      var size = document.createElement("span");
      size.className = "gp-delivery-size";
      size.textContent = formatBytes(file.size);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "gp-delivery-one";
      button.textContent = L("Télécharger", "Download");
      button.addEventListener("click", function () { startDownload(file.id, button); });
      li.appendChild(name);
      li.appendChild(size);
      li.appendChild(button);
      el.deliveryList.appendChild(li);
    });
    el.deliveryFiles.hidden = n < 2;
    el.delivery.hidden = false;
  }

  /* ---------- Musique d'ambiance ---------- */
  // Un décor choisi par le photographe, jamais imposé : lancée d'elle-même
  // seulement en mise en page « défilement » (le rendu éditorial, pensé pour
  // ça), proposée en pause ailleurs — et le client garde toujours la main.
  // Les navigateurs peuvent refuser un démarrage automatique sans geste
  // récent ; dans ce cas le bouton reste simplement sur « Lancer la musique ».

  var music = { audio: null };

  function musicPrefKey() {
    return "gp-music-" + state.slug;
  }

  function rememberMusicPref(value) {
    try {
      sessionStorage.setItem(musicPrefKey(), value);
    } catch (err) {
      /* stockage indisponible : sans conséquence */
    }
  }

  function readMusicPref() {
    try {
      return sessionStorage.getItem(musicPrefKey());
    } catch (err) {
      return null;
    }
  }

  function setMusicUI(playing) {
    if (!el.music) return;
    el.music.setAttribute("aria-pressed", playing ? "true" : "false");
    if (el.musicLabel) el.musicLabel.textContent = playing ? L("Musique en lecture", "Music playing") : L("Lancer la musique", "Play music");
  }

  function startMusic() {
    if (!music.audio) return Promise.resolve(false);
    return music.audio
      .play()
      .then(function () {
        setMusicUI(true);
        rememberMusicPref("on");
        return true;
      })
      .catch(function () {
        setMusicUI(false);
        return false;
      });
  }

  function stopMusic(remember) {
    if (!music.audio) return;
    music.audio.pause();
    setMusicUI(false);
    if (remember) rememberMusicPref("off");
  }

  // Lecteur officiel d'un service de musique (lien collé par le
  // photographe). Rien n'est chargé chez le service tant que le client n'a
  // pas ouvert le lecteur ; « Réduire » le cache sans couper la musique,
  // « Fermer » le retire (et l'arrête).
  var EMBED_PREFIXES = [
    "https://open.spotify.com/embed/",
    "https://widget.deezer.com/widget/auto/",
    "https://w.soundcloud.com/player/?url=",
    "https://www.youtube-nocookie.com/embed/",
  ];
  var EMBED_HEIGHTS = { spotify: 152, deezer: 150, soundcloud: 166 };

  function currentEmbed() {
    var m = state.gallery && state.gallery.music;
    if (!m || m.kind !== "embed") return null;
    var allowed = EMBED_PREFIXES.some(function (prefix) { return String(m.embedUrl || "").indexOf(prefix) === 0; });
    return allowed ? m : null;
  }

  function reflectEmbedUI() {
    if (!el.music || !el.musicPlayer) return;
    var open = !el.musicPlayer.hidden;
    el.music.setAttribute("aria-pressed", open || el.musicPlayerFrame.firstChild ? "true" : "false");
    el.music.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function openEmbedPlayer() {
    var m = currentEmbed();
    if (!m || !el.musicPlayer) return;
    if (!el.musicPlayerFrame.firstChild) {
      var frame = document.createElement("iframe");
      frame.src = m.embedUrl;
      frame.title = L("Lecteur " + (m.providerLabel || "de musique"), (m.providerLabel || "Music") + " player");
      frame.setAttribute("allow", "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture");
      frame.setAttribute("loading", "lazy");
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      if (EMBED_HEIGHTS[m.provider]) frame.style.height = EMBED_HEIGHTS[m.provider] + "px";
      else frame.className = "gp-music-player-video";
      el.musicPlayerFrame.appendChild(frame);
    }
    el.musicPlayer.hidden = false;
    reflectEmbedUI();
  }

  function minimizeEmbedPlayer() {
    if (el.musicPlayer) el.musicPlayer.hidden = true;
    reflectEmbedUI();
  }

  function closeEmbedPlayer() {
    if (!el.musicPlayer) return;
    el.musicPlayer.hidden = true;
    el.musicPlayerFrame.innerHTML = "";
    reflectEmbedUI();
  }

  function toggleMusic() {
    if (currentEmbed()) {
      if (el.musicPlayer.hidden) openEmbedPlayer();
      else minimizeEmbedPlayer();
      return;
    }
    if (music.audio && !music.audio.paused) stopMusic(true);
    else startMusic();
  }

  function setupMusic() {
    if (!el.music) return;
    closeEmbedPlayer();
    if (el.musicCredit) el.musicCredit.hidden = true;
    var embed = currentEmbed();
    if (embed) {
      if (music.audio) music.audio.pause();
      el.music.hidden = false;
      if (el.musicLabel) el.musicLabel.textContent = L("Écouter la musique · ", "Listen to the music · ") + (embed.providerLabel || L("lecteur", "player"));
      if (el.musicPlayerTitle) el.musicPlayerTitle.textContent = L("Musique · ", "Music · ") + (embed.providerLabel || "");
      reflectEmbedUI();
      return;
    }
    el.music.removeAttribute("aria-expanded");
    if (!(state.gallery && state.gallery.hasMusic)) {
      el.music.hidden = true;
      return;
    }
    var info = state.gallery.music || {};
    if (el.musicCredit && info.title) {
      el.musicCredit.textContent = L("« " + info.title + " »", "“" + info.title + "”") + (info.artist ? " — " + info.artist : "") + (info.credit ? " · " + info.credit : "");
      el.musicCredit.hidden = false;
    }
    if (!music.audio) {
      music.audio = new Audio();
      music.audio.loop = true;
      music.audio.preload = "auto";
      music.audio.addEventListener("pause", function () {
        setMusicUI(false);
      });
      music.audio.addEventListener("play", function () {
        setMusicUI(true);
      });
    }
    music.audio.src = apiUrl("/music");
    el.music.hidden = false;
    setMusicUI(false);

    var pref = readMusicPref();
    var autoplay = state.gallery.layout === "defilement" && pref !== "off";
    if (pref === "on" || autoplay) startMusic();
  }

  /* ---------- Réseau ---------- */

  function apiUrl(path) {
    return API + "/api/gallery/" + encodeURIComponent(state.slug) + path;
  }

  function authHeaders() {
    return { authorization: "Bearer " + state.token };
  }

  function logEvent(event, detail, photoId) {
    if (!state.token) return;
    // `keepalive` : l'évènement part même si la page se ferme juste après.
    fetch(apiUrl("/event"), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ event: event, detail: detail || "", photoId: photoId || "" }),
      keepalive: true,
    }).catch(function () {});
  }

  function sessionLost(message) {
    state.token = null;
    state.drawn = {};
    stopMusic(false);
    closeEmbedPlayer();
    closeViewer();
    show(el.login);
    hide(el.gallery);
    el.error.textContent = message;
    el.error.hidden = false;
    el.password.value = "";
  }

  /* ---------- Assemblage des tuiles ---------- */

  // La même formule que côté préparation : les tuiles se rejoignent au pixel
  // près, sans trou ni chevauchement, quelles que soient les dimensions.
  function tileRect(width, height, cols, rows, col, row) {
    var x = Math.floor((col * width) / cols);
    var y = Math.floor((row * height) / rows);
    return {
      x: x,
      y: y,
      w: Math.floor(((col + 1) * width) / cols) - x,
      h: Math.floor(((row + 1) * height) / rows) - y,
    };
  }

  function decode(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    // Repli pour les navigateurs sans createImageBitmap.
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("tuile illisible"));
      };
      img.src = url;
    });
  }

  function fetchTile(photoId, level, col, row) {
    return fetch(apiUrl("/tile/" + photoId + "/" + level + "/" + col + "/" + row), {
      headers: authHeaders(),
      cache: "no-store",
    }).then(function (response) {
      if (response.status === 401) throw new Error("session");
      if (!response.ok) throw new Error("tuile " + response.status);
      return response.blob().then(decode);
    });
  }

  /**
   * Peint une photo dans un canvas, tuile par tuile.
   * Les tuiles sont chargées par petits paquets : la photo apparaît
   * progressivement au lieu de faire attendre devant un cadre vide.
   */
  function paint(canvas, photo, level) {
    var cols = level === LEVEL_PREVIEW ? PREVIEW_COLS : photo.cols;
    var rows = level === LEVEL_PREVIEW ? PREVIEW_ROWS : photo.rows;
    var width = level === LEVEL_PREVIEW ? photo.previewWidth || photo.width : photo.width;
    var height = level === LEVEL_PREVIEW ? photo.previewHeight || photo.height : photo.height;

    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#efe6db";
    ctx.fillRect(0, 0, width, height);

    var queue = [];
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) queue.push([col, row]);
    }

    var failed = false;
    function next() {
      var job = queue.shift();
      if (!job) return Promise.resolve();
      var col = job[0];
      var row = job[1];
      return fetchTile(photo.id, level, col, row)
        .then(function (bitmap) {
          var rect = tileRect(width, height, cols, rows, col, row);
          ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
          if (bitmap.close) bitmap.close();
        })
        .catch(function (err) {
          if (err.message === "session") {
            failed = true;
            queue.length = 0;
            sessionLost(SESSION_EXPIRED());
          }
        })
        .then(next);
    }

    var workers = [];
    for (var i = 0; i < PARALLEL_TILES; i++) workers.push(next());
    return Promise.all(workers).then(function () {
      return !failed;
    });
  }

  /* ---------- Style, polices, en-tête ---------- */

  function fontStack(key) {
    var f = FONTS[key];
    return '"' + f[0] + '", ' + f[2];
  }
  function loadFont(key) {
    if (loadedFonts[key] || !FONTS[key]) return;
    loadedFonts[key] = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + FONTS[key][1] + "&display=swap";
    document.head.appendChild(link);
  }

  // Style de la galerie et polices : celles choisies par le photographe,
  // sinon celles du style. Une police manuscrite ne sert qu'au grand titre.
  function applyStyle(theme, titleFont, bodyFont) {
    var key = THEME_FONTS[theme] ? theme : "classique";
    var title = FONTS[titleFont] ? titleFont : THEME_FONTS[key][0];
    var body = FONTS[bodyFont] ? bodyFont : THEME_FONTS[key][1];
    loadFont(title);
    loadFont(body);
    var root = document.documentElement.style;
    root.setProperty("--title", fontStack(title));
    root.setProperty("--serif", FONTS[title][3] ? fontStack(body) : fontStack(title));
    root.setProperty("--sans", fontStack(body));
    document.body.setAttribute("data-theme", key);
    if (FONTS[title][3]) document.body.setAttribute("data-title-script", "");
    else document.body.removeAttribute("data-title-script");
  }

  function coverCanvas(photo, label) {
    var canvas = document.createElement("canvas");
    canvas.className = "gp-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
    paint(canvas, photo, LEVEL_FULL);
    return canvas;
  }

  // En-tête : le film (YouTube, Vimeo) ou la photo de couverture, peinte en
  // pleine définition comme dans la visionneuse (tuiles, canvas). Le lecteur
  // vidéo n'est chargé qu'au clic : rien ne part chez YouTube ou Vimeo tant
  // que le client ne lance pas le film (la couverture lui sert d'affiche).
  function setupHero() {
    var g = state.gallery;
    el.hero.textContent = "";
    var cover = null;
    for (var i = 0; i < state.photos.length; i++) if (state.photos[i].id === g.coverPhotoId) cover = state.photos[i];
    if (g.headerVideo) {
      var frame = document.createElement("div");
      frame.className = "gp-hero-video" + (cover ? " gp-hero-video-poster" : "");
      if (cover) frame.appendChild(coverCanvas(cover, L("Affiche du film", "Film poster")));
      var play = document.createElement("button");
      play.type = "button";
      play.className = "gp-hero-play";
      play.innerHTML = '<span class="gp-hero-play-icon" aria-hidden="true"></span><span>' + L("Voir le film", "Watch the film") + "</span>";
      play.addEventListener("click", function () {
        var iframe = document.createElement("iframe");
        iframe.src = g.headerVideo + (g.headerVideo.indexOf("?") === -1 ? "?" : "&") + "autoplay=1";
        iframe.title = L("Film de la séance", "Session film");
        iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
        iframe.setAttribute("allowfullscreen", "");
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        frame.textContent = "";
        frame.classList.add("gp-hero-video-playing");
        frame.appendChild(iframe);
        iframe.focus();
      });
      frame.appendChild(play);
      el.hero.appendChild(frame);
    } else if (cover) {
      var box = document.createElement("div");
      box.className = "gp-hero-cover";
      box.appendChild(coverCanvas(cover, L("Photo de couverture", "Cover photo")));
      el.hero.appendChild(box);
    }
    el.hero.hidden = !el.hero.firstChild;
    el.gallery.classList.toggle("gp-has-hero", !el.hero.hidden);
    el.intro.textContent = g.intro || "";
    el.intro.hidden = !g.intro;
  }

  // Mise en page « récit » : paysages en pleine largeur, portraits par deux
  // (ou seul, au centre), et une respiration toutes les six photos environ.
  // Deux portraits côte à côte prennent la même hauteur (la plus basse des
  // deux, la plus haute est très légèrement recadrée) : plan[i + "r"].
  function recitPlan(photos) {
    var plan = [];
    var i = 0;
    var sinceBreak = 0;
    var wide = function (p) { return p.width / p.height >= 1.15; };
    while (i < photos.length) {
      var startsChapter = sinceBreak >= 6;
      if (startsChapter) sinceBreak = 0;
      var extra = startsChapter ? " gp-recit-break" : "";
      if (wide(photos[i])) {
        plan[i] = "gp-recit-wide" + extra;
        i += 1;
        sinceBreak += 1;
      } else if (photos[i + 1] && !wide(photos[i + 1])) {
        plan[i] = "gp-recit-pair" + extra;
        plan[i + 1] = "gp-recit-pair" + extra;
        var shared = Math.min(photos[i].height / photos[i].width, photos[i + 1].height / photos[i + 1].width) * 100;
        plan[i + "r"] = shared;
        plan[(i + 1) + "r"] = shared;
        i += 2;
        sinceBreak += 2;
      } else {
        plan[i] = "gp-recit-solo" + extra;
        i += 1;
        sinceBreak += 1;
      }
    }
    return plan;
  }

  // Les grandes vignettes (récit, défilement) passent en pleine définition
  // quand elles approchent de l'écran : peintes à part, puis recopiées, pour
  // ne jamais repasser par un cadre vide.
  var sharpenObserver = null;
  function sharpenLarge() {
    if (sharpenObserver) sharpenObserver.disconnect();
    sharpenObserver = null;
    var layout = el.grid.getAttribute("data-layout");
    if ((layout !== "recit" && layout !== "defilement") || !window.IntersectionObserver) return;
    var byId = {};
    state.photos.forEach(function (p) { byId[p.id] = p; });
    sharpenObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        sharpenObserver.unobserve(entry.target);
        var photo = byId[entry.target.getAttribute("data-photo")];
        var canvas = photo && gridCanvases[photo.id];
        if (!canvas) return;
        var needed = entry.target.offsetWidth * (window.devicePixelRatio || 1);
        if (needed <= (photo.previewWidth || 500) * 1.15) return;
        var sharp = document.createElement("canvas");
        paint(sharp, photo, LEVEL_FULL).then(function (ok) {
          if (!ok || gridCanvases[photo.id] !== canvas) return;
          canvas.width = sharp.width;
          canvas.height = sharp.height;
          canvas.getContext("2d").drawImage(sharp, 0, 0);
        });
      });
    }, { rootMargin: "300px 0px" });
    el.grid.querySelectorAll(".gp-item").forEach(function (figure) { sharpenObserver.observe(figure); });
  }

  /* ---------- Grille ---------- */

  function buildGrid() {
    el.grid.innerHTML = "";
    heartButtons = {};
    gridCanvases = {};
    commentBadges = {};
    tagDots = {};
    markBadges = {};
    var plan = el.grid.getAttribute("data-layout") === "recit" ? recitPlan(state.photos) : [];
    // La grille contient toujours toutes les photos ; le filtre « ma
    // sélection » les masque par CSS (.gp-grid-filtered), pour ne jamais
    // retélécharger de tuile au seul geste de cocher un cœur.
    state.photos.forEach(function (photo, index) {
      var figure = document.createElement("figure");
      figure.className = "gp-item" + (photo.selected ? " gp-item-selected" : "") + (plan[index] ? " " + plan[index] : "");
      figure.setAttribute("data-photo", photo.id);
      var ratio = plan[index + "r"] || (photo.height / photo.width) * 100;
      figure.style.setProperty("--ratio", ratio.toFixed(3) + "%");

      var canvas = document.createElement("canvas");
      canvas.className = "gp-canvas";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Photo " + (index + 1) + L(" sur ", " of ") + state.photos.length);
      figure.appendChild(canvas);
      gridCanvases[photo.id] = canvas;

      var button = document.createElement("button");
      button.type = "button";
      button.className = "gp-open";
      button.setAttribute("aria-label", L("Agrandir la photo ", "Enlarge photo ") + (index + 1));
      button.addEventListener("click", function () {
        openViewer(photo);
      });
      figure.appendChild(button);

      var heart = document.createElement("button");
      heart.type = "button";
      heart.className = "gp-heart";
      paintHeart(heart, photo.selected);
      heart.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleSelect(photo);
      });
      figure.appendChild(heart);
      heartButtons[photo.id] = heart;

      // Pastille non interactive : le clic passe à travers vers .gp-open,
      // qui couvre déjà toute la vignette.
      var commentBadge = document.createElement("span");
      commentBadge.className = "gp-comment-badge";
      commentBadge.setAttribute("aria-hidden", "true");
      commentBadge.hidden = !hasComment(photo);
      figure.appendChild(commentBadge);
      commentBadges[photo.id] = commentBadge;

      var tagDot = document.createElement("span");
      tagDot.setAttribute("aria-hidden", "true");
      figure.appendChild(tagDot);
      tagDots[photo.id] = tagDot;
      reflectTag(photo);

      var markBadge = document.createElement("span");
      markBadge.className = "gp-mark-badge";
      markBadge.setAttribute("aria-hidden", "true");
      figure.appendChild(markBadge);
      markBadges[photo.id] = markBadge;
      reflectMarks(photo);

      el.grid.appendChild(figure);
      paint(canvas, photo, LEVEL_PREVIEW);
    });
    updateSelectionUI();
    sharpenLarge();
  }

  /* ---------- Visionneuse ---------- */

  // Ouvre la visionneuse sur une photo précise. La liste parcourue par
  // Précédent/Suivant est figée à cet instant (état du filtre compris) :
  // cocher ou décocher un cœur en cours de visionnage ne fait donc pas
  // sauter les photos suivantes sous les pieds du visiteur.
  function openViewer(photo) {
    state.viewerList = visiblePhotos();
    var index = state.viewerList.indexOf(photo);
    showViewerAt(index === -1 ? 0 : index);
  }

  function showViewerAt(index) {
    var list = state.viewerList;
    if (!list || index < 0 || index >= list.length) return;
    flushPendingComment(); // sauvegarde ce qui était en cours de frappe sur la photo précédente
    if (pinState.isNew) cancelPinEdit();
    state.current = index;
    var photo = list[index];

    el.viewer.hidden = false;
    document.body.classList.add("gp-locked");
    el.counter.textContent = index + 1 + " / " + list.length;
    el.prev.disabled = index === 0;
    el.next.disabled = index === list.length - 1;
    if (el.viewerHeart) paintHeart(el.viewerHeart, photo.selected);
    if (el.commentInput) el.commentInput.value = photo.comment || "";
    setCommentStatus("");
    reflectComment(photo);
    closePinEditor();
    setPlacing(false);
    el.closeBtn.focus();

    var canvas = el.viewerCanvas;
    canvas.style.aspectRatio = photo.width + " / " + photo.height;
    paint(canvas, photo, LEVEL_FULL);
    reflectTag(photo);
    reflectPrintable(photo);
    renderPins(photo);
    // Une seconde passe une fois la mise en page stabilisée : la boîte du
    // canvas peut encore bouger juste après le changement de dimensions.
    requestAnimationFrame(syncPinsLayer);
    logEvent("view", photo.id);
  }

  function closeViewer() {
    flushPendingComment();
    if (pinState.isNew) cancelPinEdit(); // un repère tout juste posé, jamais enregistré, ne reste pas
    el.viewer.hidden = true;
    document.body.classList.remove("gp-locked");
    state.current = -1;
    state.viewerList = null;
    if (el.commentPanel) el.commentPanel.hidden = true;
    if (el.commentToggle) el.commentToggle.setAttribute("aria-expanded", "false");
    if (el.pinEditor) el.pinEditor.hidden = true;
    closePrintPanel();
    pinState.editing = -1;
    pinState.isNew = false;
    setPlacing(false);
  }

  function step(delta) {
    showViewerAt(state.current + delta);
  }

  function currentViewerPhoto() {
    return state.viewerList && state.current >= 0 ? state.viewerList[state.current] : null;
  }

  /* ---------- Voile de dissuasion ---------- */

  var veilTimer = null;
  var blurStartedAt = 0;
  var blurReason = "";
  // Sur macOS, le raccourci de capture (Cmd+Maj+3/4/5) est intercepté par le
  // système avant même d'atteindre le navigateur — impossible à voir passer
  // comme un raccourci clavier. Ce qu'on voit, en revanche : l'éclair très
  // bref d'un changement de fenêtre ou d'onglet au moment de la capture,
  // bien plus court qu'un vrai passage à une autre application. Compte le
  // temps de sélectionner une zone (Cmd+Maj+4) et de voir la miniature de
  // confirmation s'afficher : mesuré en usage réel autour de 2-3 s, donc une
  // marge confortable pour ne pas rater le signal tout en excluant un vrai
  // départ vers une autre application (souvent bien plus long).
  var BRIEF_ABSENCE_MS = 4000;

  // Masquer les photos dès que l'attention quitte la page : la plupart des
  // outils de capture prennent le focus, et un raccourci de capture se voit.
  // Ce n'est pas un blocage — c'est un rappel, et une trace dans le journal.
  function veil(reason) {
    el.veil.hidden = false;
    document.body.classList.add("gp-veiled");
    clearTimeout(veilTimer);
    if (reason === "perte-focus" || reason === "onglet-masque") {
      // On ne sait pas encore si c'est un vrai changement d'application ou
      // l'éclair d'une capture : on tranche au retour du focus, selon la
      // durée de l'absence (voir unveil ci-dessous).
      blurStartedAt = Date.now();
      blurReason = reason;
      return;
    }
    if (reason) {
      // Si une photo est ouverte en plein écran au moment du signal, on la
      // référence : c'est ce qui permet au photographe d'être averti de LA
      // photo concernée, pas juste « une capture a eu lieu ».
      var photo = currentViewerPhoto();
      logEvent(reason === "print" ? "print" : "capture_suspected", reason, photo ? photo.id : "");
    }
  }

  function unveil() {
    clearTimeout(veilTimer);
    if (blurReason) {
      var elapsed = Date.now() - blurStartedAt;
      var finalReason = elapsed < BRIEF_ABSENCE_MS ? "absence-breve" : blurReason;
      var photo = currentViewerPhoto();
      logEvent("capture_suspected", finalReason, photo ? photo.id : "");
      blurReason = "";
    }
    veilTimer = setTimeout(function () {
      el.veil.hidden = true;
      document.body.classList.remove("gp-veiled");
    }, 220);
  }

  // Meilleur effort : remplacer le presse-papiers juste après une capture.
  // Ne fonctionne pas partout, et ne touche que ce qui vient d'y être mis
  // depuis cette page. Désactivable via GALERIE_CONFIG.clipboardGuard.
  function poisonClipboard() {
    if (!CLIPBOARD_GUARD || !navigator.clipboard || !window.ClipboardItem) return;
    try {
      var canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#2b2521";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f7f2ec";
      ctx.font = "600 42px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(L("Photographies protégées", "Protected photographs"), canvas.width / 2, 290);
      ctx.font = "300 28px Helvetica, Arial, sans-serif";
      ctx.fillText(L("Merci de ne pas les copier.", "Please don't copy them."), canvas.width / 2, 350);
      canvas.toBlob(function (blob) {
        if (!blob) return;
        navigator.clipboard
          .write([new window.ClipboardItem({ "image/png": blob })])
          .catch(function () {});
      });
    } catch (err) {
      /* sans conséquence : ce garde-fou est facultatif */
    }
  }

  function installGuards() {
    ["contextmenu", "dragstart", "selectstart"].forEach(function (type) {
      document.addEventListener(type, function (event) {
        event.preventDefault();
      });
    });

    document.addEventListener("copy", function (event) {
      event.preventDefault();
    });

    // Sur Windows, « Impr. écran » ne déclenche souvent que keyup : on écoute
    // les deux. Sur macOS, la capture passe par Cmd + Maj + 3/4/5.
    function onKey(event) {
      var key = event.key;
      var meta = event.metaKey || event.ctrlKey;

      if (key === "PrintScreen" || key === "Snapshot") {
        veil("impr-ecran");
        poisonClipboard();
        return;
      }
      if (event.metaKey && event.shiftKey && ["3", "4", "5", "6"].indexOf(key) !== -1) {
        veil("capture-macos");
        return;
      }
      if (meta && (key === "s" || key === "S")) {
        event.preventDefault();
        veil("enregistrer");
        return;
      }
      if (meta && (key === "p" || key === "P")) {
        event.preventDefault();
        veil("print");
        return;
      }
      if (key === "F12" || (meta && event.shiftKey && ["I", "J", "C"].indexOf(key.toUpperCase()) !== -1)) {
        logEvent("devtools", key);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);

    window.addEventListener("blur", function () {
      veil("perte-focus");
    });
    window.addEventListener("focus", unveil);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) veil("onglet-masque");
      else unveil();
    });

    // Impression : la feuille de style dédiée vide la page, on double d'un voile.
    if (window.matchMedia) {
      var printQuery = window.matchMedia("print");
      if (printQuery.addEventListener) {
        printQuery.addEventListener("change", function (event) {
          if (event.matches) veil("print");
        });
      }
    }

    // Navigation clavier de la visionneuse.
    document.addEventListener("keydown", function (event) {
      if (el.viewer.hidden) return;
      if (event.key === "Escape") closeViewer();
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
    });

    // Balayage tactile.
    var startX = null;
    el.viewer.addEventListener("touchstart", function (event) {
      startX = event.touches[0].clientX;
    }, { passive: true });
    el.viewer.addEventListener("touchend", function (event) {
      if (startX === null) return;
      var delta = event.changedTouches[0].clientX - startX;
      if (Math.abs(delta) > 50) step(delta < 0 ? 1 : -1);
      startX = null;
    }, { passive: true });
  }

  /* ---------- Ouverture de session ---------- */

  function show(node) {
    node.hidden = false;
  }
  function hide(node) {
    node.hidden = true;
  }

  function login(password) {
    el.error.hidden = true;
    el.submit.disabled = true;
    el.submit.textContent = L("Ouverture…", "Opening…");

    return fetch(apiUrl("/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: password }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(serverText(result.data.error || "", "Access denied") || L("Accès refusé", "Access denied"));
        state.token = result.data.token;
        state.gallery = result.data.gallery;
        state.photos = result.data.photos;
        setLanguage(state.gallery.language);

        el.title.textContent = state.gallery.title;
        if (state.gallery.studioName) {
          var eyebrows = document.querySelectorAll("#gp-gallery .gp-eyebrow");
          for (var e = 0; e < eyebrows.length; e++) eyebrows[e].textContent = state.gallery.studioName;
        }
        el.subtitle.textContent = state.gallery.clientName
          ? L("Galerie de ", "Gallery of ") + state.gallery.clientName
          : "";
        el.grid.setAttribute("data-layout", LAYOUTS[state.gallery.layout] ? state.gallery.layout : "grille");
        applyStyle(state.gallery.theme, state.gallery.titleFont, state.gallery.bodyFont);
        setupHero();
        if (state.gallery.expiresAt) {
          var date = new Date(state.gallery.expiresAt * 1000);
          el.expiry.textContent =
            L("Accès valable jusqu'au ", "Access open until ") +
            date.toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
          el.expiry.hidden = false;
        }

        hide(el.login);
        show(el.gallery);
        if (state.photos.length === 0) {
          el.empty.hidden = false;
        } else {
          buildGrid();
        }
        setupMusic();
        setupDelivery();
        setupShop();

        // La session expire : on prévient avant que les tuiles cessent d'arriver.
        setTimeout(function () {
          if (state.token) sessionLost(SESSION_EXPIRED());
        }, Math.max(60, (result.data.expiresIn || 7200) - 30) * 1000);
      })
      .catch(function (err) {
        el.error.textContent = err.message || L("Accès refusé", "Access denied");
        el.error.hidden = false;
      })
      .then(function () {
        el.submit.disabled = false;
        el.submit.textContent = L("Voir mes photos", "See my photos");
      });
  }

  /* ---------- Démarrage ---------- */

  function readSlug() {
    var params = new URLSearchParams(window.location.search);
    var slug = params.get("g") || window.location.hash.replace(/^#/, "");
    return slug ? slug.toLowerCase().replace(/[^a-z0-9-]/g, "") : "";
  }

  // Arrière-plan personnalisé de l'écran de mot de passe — choisi par le
  // photographe (couleur ou image importée, jamais une photo protégée de la
  // galerie). Échoue en silence : sans réponse, on garde l'apparence par
  // défaut, ce n'est jamais bloquant pour accéder à la galerie.
  function applyBackground() {
    fetch(apiUrl("/background"))
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (!data || !el.login) return;
        setLanguage(data.language);
        if (data.theme) applyStyle(data.theme, data.titleFont, data.bodyFont);
        if (data.type === "image") {
          el.login.style.backgroundImage =
            "linear-gradient(rgba(20, 16, 14, .4), rgba(20, 16, 14, .4)), url(" + apiUrl("/background-image") + ")";
          el.login.style.backgroundSize = "cover";
          el.login.style.backgroundPosition = "center";
        } else if (data.color) {
          el.login.style.background = data.color;
        }
      })
      .catch(function () {
        /* apparence par défaut, sans conséquence */
      });
  }

  function init() {
    el = {
      login: $("gp-login"),
      gallery: $("gp-gallery"),
      form: $("gp-form"),
      password: $("gp-password"),
      submit: $("gp-submit"),
      error: $("gp-error"),
      title: $("gp-title"),
      subtitle: $("gp-subtitle"),
      intro: $("gp-intro"),
      hero: $("gp-hero"),
      expiry: $("gp-expiry"),
      grid: $("gp-grid"),
      empty: $("gp-empty"),
      viewer: $("gp-viewer"),
      viewerCanvas: $("gp-viewer-canvas"),
      counter: $("gp-counter"),
      prev: $("gp-prev"),
      next: $("gp-next"),
      closeBtn: $("gp-close"),
      viewerHeart: $("gp-viewer-heart"),
      veil: $("gp-veil"),
      missing: $("gp-missing"),
      toolbar: $("gp-toolbar"),
      selectionCount: $("gp-selection-count"),
      toolbarQuota: $("gp-toolbar-quota"),
      payButton: $("gp-pay-supplement"),
      payError: $("gp-pay-error"),
      invoiceButton: $("gp-download-invoice"),
      filterCheckbox: $("gp-filter-selected"),
      validateBlock: $("gp-validate-block"),
      validate: $("gp-validate"),
      validateStatus: $("gp-validate-status"),
      filterEmpty: $("gp-filter-empty"),
      commentToggle: $("gp-comment-toggle"),
      commentPanel: $("gp-comment-panel"),
      commentInput: $("gp-comment-input"),
      commentStatus: $("gp-comment-status"),
      music: $("gp-music"),
      musicLabel: $("gp-music-label"),
      musicCredit: $("gp-music-credit"),
      delivery: $("gp-delivery"),
      deliverySummary: $("gp-delivery-summary"),
      deliveryZip: $("gp-delivery-zip"),
      deliveryStatus: $("gp-delivery-status"),
      deliveryList: $("gp-delivery-list"),
      deliveryFiles: document.querySelector(".gp-delivery-files"),
      shopPromo: $("gp-shop-promo"),
      musicPlayer: $("gp-music-player"),
      musicPlayerFrame: $("gp-music-player-frame"),
      musicPlayerTitle: $("gp-music-player-title"),
      viewerFrame: $("gp-viewer-frame"),
      pins: $("gp-pins"),
      pinToggle: $("gp-pin-toggle"),
      pinHint: $("gp-pin-hint"),
      pinEditor: $("gp-pin-editor"),
      pinEditorTitle: $("gp-pin-editor-title"),
      pinNote: $("gp-pin-note"),
      pinSave: $("gp-pin-save"),
      pinDelete: $("gp-pin-delete"),
      pinCancel: $("gp-pin-cancel"),
      tagButtons: Array.prototype.slice.call(document.querySelectorAll(".gp-tag[data-tag]")),
      shopBar: $("gp-shop-bar"),
      cartBtn: $("gp-cart-btn"),
      cartCount: $("gp-cart-count"),
      printOrders: $("gp-print-orders"),
      printToggle: $("gp-print-toggle"),
      printPanel: $("gp-print-panel"),
      printProducts: $("gp-print-products"),
      printPreview: $("gp-print-preview"),
      printStatus: $("gp-print-status"),
      cart: $("gp-cart"),
      cartClose: $("gp-cart-close"),
      cartLines: $("gp-cart-lines"),
      cartEmpty: $("gp-cart-empty"),
      cartTotals: $("gp-cart-totals"),
      cartItems: $("gp-cart-items"),
      cartShipping: $("gp-cart-shipping"),
      cartTotal: $("gp-cart-total"),
      cartForm: $("gp-cart-form"),
      cartCountry: $("gp-cart-country"),
      cartError: $("gp-cart-error"),
      cartPay: $("gp-cart-pay"),
    };

    state.slug = readSlug();
    if (!API) {
      el.error.textContent = "Configuration manquante : renseignez GALERIE_CONFIG.api.";
      el.error.hidden = false;
      el.submit.disabled = true;
      return;
    }
    if (!state.slug) {
      hide(el.login);
      show(el.missing);
      return;
    }
    applyBackground();

    el.form.addEventListener("submit", function (event) {
      event.preventDefault();
      login(el.password.value);
    });
    el.prev.addEventListener("click", function () {
      step(-1);
    });
    el.next.addEventListener("click", function () {
      step(1);
    });
    el.closeBtn.addEventListener("click", closeViewer);
    el.viewer.addEventListener("click", function (event) {
      if (event.target === el.viewer) closeViewer();
    });
    if (el.viewerHeart) {
      el.viewerHeart.addEventListener("click", function () {
        var photo = currentViewerPhoto();
        if (photo) toggleSelect(photo);
      });
    }
    if (el.filterCheckbox) {
      el.filterCheckbox.addEventListener("change", function () {
        state.filterSelected = el.filterCheckbox.checked;
        el.grid.classList.toggle("gp-grid-filtered", state.filterSelected);
        updateSelectionUI();
      });
    }
    if (el.payButton) {
      el.payButton.addEventListener("click", payForSupplement);
    }
    if (el.invoiceButton) {
      el.invoiceButton.addEventListener("click", downloadInvoice);
    }
    if (el.validate) {
      el.validate.addEventListener("click", validateSelection);
    }
    if (el.commentToggle) {
      el.commentToggle.addEventListener("click", toggleCommentPanel);
    }
    if (el.music) {
      el.music.addEventListener("click", toggleMusic);
    }
    if (el.deliveryZip) {
      el.deliveryZip.addEventListener("click", function () {
        var d = state.gallery && state.gallery.delivery;
        // Un seul fichier : inutile de passer par un ZIP.
        startDownload(d && d.files.length === 1 ? d.files[0].id : "", el.deliveryZip);
      });
    }
    if (el.musicPlayer) {
      $("gp-music-player-min").addEventListener("click", minimizeEmbedPlayer);
      $("gp-music-player-close").addEventListener("click", closeEmbedPlayer);
    }
    wireCommentInput();
    el.tagButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        var photo = currentViewerPhoto();
        if (photo) setTag(photo, button.getAttribute("data-tag"));
      });
    });
    wirePins();
    if (el.printToggle) el.printToggle.addEventListener("click", togglePrintPanel);
    if (el.cartBtn) el.cartBtn.addEventListener("click", openCart);
    if (el.cartClose) el.cartClose.addEventListener("click", closeCart);
    if (el.cart) {
      el.cart.addEventListener("click", function (event) {
        if (event.target === el.cart) closeCart();
      });
      el.cart.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeCart();
      });
    }
    if (el.cartForm) el.cartForm.addEventListener("submit", submitCart);
    if (el.cartCountry) el.cartCountry.addEventListener("change", renderCart);

    installGuards();
    el.password.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
