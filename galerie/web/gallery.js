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
  var LAYOUTS = { grille: 1, mosaique: 1, defilement: 1 };

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

  var el = {};
  var heartButtons = {}; // photoId -> bouton cœur de la grille, pour une mise à jour directe
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
    return selected ? "Retirer des favoris" : "Ajouter aux favoris";
  }

  function paintHeart(button, selected) {
    button.classList.toggle("gp-heart-active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.setAttribute("aria-label", heartLabel(selected));
    button.title = heartLabel(selected);
  }

  function formatEuros(cents) {
    return ((cents || 0) / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
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
    var text = count + " / " + included + " photo" + (included > 1 ? "s" : "") + " incluse" + (included > 1 ? "s" : "");
    if (due > 0) {
      text +=
        " — +" + due + " supplément" + (due > 1 ? "s" : "") +
        " (" + formatEuros(due * (state.gallery.extraPhotoPriceCents || 0)) + ")";
    } else if (extra > 0) {
      text += " — supplément réglé ✓";
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
    el.invoiceButton.textContent = "Téléchargement…";

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
        link.download = "facture-" + invoice.number + ".pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
        el.invoiceButton.disabled = false;
        el.invoiceButton.textContent = "Télécharger ma facture";
      })
      .catch(function (err) {
        el.invoiceButton.disabled = false;
        el.invoiceButton.textContent = "Télécharger ma facture";
        if (err.message === "session") {
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
        }
      });
  }

  // Ouvre la page de paiement hébergée par Stripe pour le supplément dû.
  // Le montant réel est recalculé côté serveur au moment de la requête — ce
  // qui s'affiche ici n'est qu'un affichage, jamais la source de vérité.
  function payForSupplement() {
    if (!el.payButton) return;
    el.payButton.disabled = true;
    el.payButton.textContent = "Redirection…";
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
          if (!response.ok) throw new Error(data.error || "Le paiement n'a pas pu démarrer.");
          return data;
        });
      })
      .then(function (data) {
        window.location.href = data.url;
      })
      .catch(function (err) {
        if (err.message === "session") {
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
          return;
        }
        el.payButton.disabled = false;
        el.payButton.textContent = "Régler le supplément";
        if (el.payError) {
          el.payError.textContent = err.message || "Le paiement n'a pas pu démarrer. Réessayez dans un instant.";
          el.payError.hidden = false;
        }
      });
  }

  function updateSelectionUI() {
    var count = selectedCount();
    if (el.selectionCount) {
      el.selectionCount.textContent =
        count === 0 ? "Aucune photo sélectionnée pour l'instant"
          : count + (count > 1 ? " photos sélectionnées" : " photo sélectionnée");
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
    return new Date(ts * 1000).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
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
      el.validate.textContent = "Valider à nouveau ma sélection";
      el.validateStatus.textContent = "Sélection validée le " + formatDateTime(doneAt) + ". Vous pouvez encore la modifier et la valider à nouveau.";
    } else {
      el.validate.textContent = "Valider ma sélection";
      el.validateStatus.textContent = count === 0
        ? "Cochez d'abord vos coups de cœur."
        : "Quand votre choix est fait, prévenez-moi d'un clic.";
    }
  }

  function validateSelection() {
    if (!state.gallery || state.validating) return;
    state.validating = true;
    updateValidateUI(selectedCount());
    el.validateStatus.textContent = "Envoi…";
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
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
        } else {
          el.validateStatus.textContent = "Impossible d'envoyer la validation pour l'instant. Réessayez dans un instant.";
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
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
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
    setCommentStatus("Enregistrement…");
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
        setCommentStatus("Enregistré");
        setTimeout(function () {
          if (el.commentStatus && el.commentStatus.textContent === "Enregistré") setCommentStatus("");
        }, 1800);
      })
      .catch(function (err) {
        setCommentStatus("Échec de l'enregistrement — réessayez");
        if (err.message === "session") {
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
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
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
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
      pin.setAttribute("aria-label", "Repère " + (index + 1) + (mark.note ? " : " + mark.note : ""));
      pin.title = mark.note || "Repère " + (index + 1);
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
    el.pinEditorTitle.textContent = "Repère " + (index + 1) + " — que faut-il signaler ici ?";
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
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
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
    shop.cart = lines.filter(function (l) {
      var photo = photoById(l.photoId);
      return photo && photo.printable && shopProduct(l.productId) && l.copies >= 1 && l.copies <= 10;
    });
  }

  function saveCart() {
    try { window.localStorage.setItem(cartKey(), JSON.stringify(shop.cart)); } catch (e) { /* navigation privée */ }
  }

  function cartCount() {
    return shop.cart.reduce(function (n, l) { return n + l.copies; }, 0);
  }

  function cartItemsCents() {
    return shop.cart.reduce(function (sum, l) {
      var p = shopProduct(l.productId);
      return sum + (p ? p.priceCents * l.copies : 0);
    }, 0);
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
    el.printStatus.textContent = "Ajouté ✓ — " + n + " article" + (n > 1 ? "s" : "") + " dans « Mes tirages »";
  }

  function renderPrintPanel(photo) {
    el.printProducts.innerHTML = "";
    el.printStatus.textContent = "";
    var products = state.gallery.shop.products;
    products.forEach(function (product) {
      var li = document.createElement("li");
      var label = document.createElement("span");
      label.textContent = product.label;
      var price = document.createElement("span");
      price.className = "gp-print-price";
      price.textContent = formatEuros(product.priceCents);
      var add = document.createElement("button");
      add.type = "button";
      add.className = "gp-print-add";
      add.textContent = "Ajouter";
      add.addEventListener("click", function () { addToCart(photo, product); });
      li.appendChild(label);
      li.appendChild(price);
      li.appendChild(add);
      el.printProducts.appendChild(li);
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
      var what = document.createElement("span");
      what.textContent = product.label;
      var which = document.createElement("span");
      which.className = "gp-cart-photo";
      which.textContent = "Photo n° " + (state.photos.indexOf(photo) + 1);
      what.appendChild(which);
      var qty = document.createElement("select");
      qty.setAttribute("aria-label", "Quantité");
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
      remove.setAttribute("aria-label", "Retirer");
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
    var shipping = state.gallery.shop.shippingCents || 0;
    el.cartItems.textContent = formatEuros(items);
    el.cartShipping.textContent = shipping ? formatEuros(shipping) : "offerte";
    el.cartTotal.textContent = formatEuros(items + shipping);
    el.cartPay.textContent = "Payer " + formatEuros(items + shipping);
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
    el.cartPay.textContent = "Redirection vers le paiement…";
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
          if (!response.ok) throw new Error(data.error || "La commande n'a pas pu démarrer.");
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
          sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
          return;
        }
        el.cartPay.disabled = false;
        renderCart();
        el.cartError.textContent = err.message || "La commande n'a pas pu démarrer. Réessayez dans un instant.";
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
        "Commande du " + new Date(o.createdAt * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long" }) +
        " — " + o.count + " tirage" + (o.count > 1 ? "s" : "") + " — " + o.statusLabel + (o.trackingUrl ? " ·" : "");
      if (o.trackingUrl) {
        var a = document.createElement("a");
        a.href = o.trackingUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Suivre le colis";
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
    renderPrintOrders();
    if (open) {
      var countries = state.gallery.shop.countries || {};
      el.cartCountry.innerHTML = "";
      Object.keys(countries).forEach(function (code) {
        var opt = document.createElement("option");
        opt.value = code;
        opt.textContent = countries[code];
        el.cartCountry.appendChild(opt);
      });
      loadCart();
      updateCartUI();
    }
    // Retour de la page de paiement Stripe.
    var result = new URLSearchParams(window.location.search).get("tirages");
    if (result === "succes") {
      shop.cart = [];
      saveCart();
      updateCartUI();
      showShopBanner("Merci ! Votre commande de tirages est confirmée : un e-mail récapitulatif vous a été envoyé, puis un autre avec le suivi dès l'expédition.");
    } else if (result === "annule") {
      showShopBanner("Paiement annulé — votre panier est conservé, vous pouvez le reprendre quand vous voulez.", true);
    }
    if (result) {
      var url = window.location.href.replace(/([?&])tirages=[^&]*&?/, "$1").replace(/[?&]$/, "");
      try { window.history.replaceState(null, "", url); } catch (e) { /* ignoré */ }
    }
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
    if (el.musicLabel) el.musicLabel.textContent = playing ? "Musique en lecture" : "Lancer la musique";
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

  function setupMusic() {
    if (!el.music) return;
    if (!(state.gallery && state.gallery.hasMusic)) {
      el.music.hidden = true;
      return;
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
            sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
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

  /* ---------- Grille ---------- */

  function buildGrid() {
    el.grid.innerHTML = "";
    heartButtons = {};
    commentBadges = {};
    tagDots = {};
    markBadges = {};
    // La grille contient toujours toutes les photos ; le filtre « ma
    // sélection » les masque par CSS (.gp-grid-filtered), pour ne jamais
    // retélécharger de tuile au seul geste de cocher un cœur.
    state.photos.forEach(function (photo, index) {
      var figure = document.createElement("figure");
      figure.className = "gp-item" + (photo.selected ? " gp-item-selected" : "");
      var ratio = (photo.height / photo.width) * 100;
      figure.style.setProperty("--ratio", ratio.toFixed(3) + "%");

      var canvas = document.createElement("canvas");
      canvas.className = "gp-canvas";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Photo " + (index + 1) + " sur " + state.photos.length);
      figure.appendChild(canvas);

      var button = document.createElement("button");
      button.type = "button";
      button.className = "gp-open";
      button.setAttribute("aria-label", "Agrandir la photo " + (index + 1));
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
      ctx.fillText("Photographies protégées", canvas.width / 2, 290);
      ctx.font = "300 28px Helvetica, Arial, sans-serif";
      ctx.fillText("Merci de ne pas les copier.", canvas.width / 2, 350);
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
    el.submit.textContent = "Ouverture…";

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
        if (!result.ok) throw new Error(result.data.error || "Accès refusé");
        state.token = result.data.token;
        state.gallery = result.data.gallery;
        state.photos = result.data.photos;

        el.title.textContent = state.gallery.title;
        if (state.gallery.studioName) {
          var eyebrows = document.querySelectorAll("#gp-gallery .gp-eyebrow");
          for (var e = 0; e < eyebrows.length; e++) eyebrows[e].textContent = state.gallery.studioName;
        }
        el.subtitle.textContent = state.gallery.clientName
          ? "Galerie de " + state.gallery.clientName
          : "";
        el.grid.setAttribute("data-layout", LAYOUTS[state.gallery.layout] ? state.gallery.layout : "grille");
        if (state.gallery.expiresAt) {
          var date = new Date(state.gallery.expiresAt * 1000);
          el.expiry.textContent =
            "Accès valable jusqu'au " +
            date.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" });
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
        setupShop();

        // La session expire : on prévient avant que les tuiles cessent d'arriver.
        setTimeout(function () {
          if (state.token) sessionLost("Votre session a expiré. Saisissez à nouveau le mot de passe.");
        }, Math.max(60, (result.data.expiresIn || 7200) - 30) * 1000);
      })
      .catch(function (err) {
        el.error.textContent = err.message || "Accès refusé";
        el.error.hidden = false;
      })
      .then(function () {
        el.submit.disabled = false;
        el.submit.textContent = "Voir mes photos";
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
      el.music.addEventListener("click", function () {
        if (music.audio && !music.audio.paused) stopMusic(true);
        else startMusic();
      });
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

    installGuards();
    el.password.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
