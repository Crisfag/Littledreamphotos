// Coordonnées de l'éditeur, utilisées par les trois pages légales
// (conditions, confidentialité, mentions légales). Un seul endroit à
// modifier : tant qu'un champ est vide, il s'affiche en surligné jaune
// « à compléter » sur les pages.
window.LEGAL = {
  // Nom de l'entreprise ou nom et prénom (entreprise individuelle).
  company: "",
  // Forme juridique (ex. « personne physique — entreprise individuelle », « SRL »).
  legalForm: "",
  // Adresse du siège ou de l'établissement.
  address: "",
  // Numéro d'entreprise (BCE) et numéro de TVA.
  companyNumber: "",
  vatNumber: "",
  // Adresse e-mail de contact (aussi pour les demandes RGPD).
  email: "",
  // Arrondissement judiciaire compétent (ex. « Liège », « Bruxelles »).
  court: "",
};

(function () {
  "use strict";
  var data = window.LEGAL || {};
  document.querySelectorAll("[data-legal]").forEach(function (el) {
    var key = el.getAttribute("data-legal");
    var value = String(data[key] || "").trim();
    if (value) {
      if (key === "email") {
        var a = document.createElement("a");
        a.href = "mailto:" + value;
        a.textContent = value;
        el.textContent = "";
        el.appendChild(a);
      } else {
        el.textContent = value;
      }
    } else {
      el.textContent = "à compléter : " + (el.getAttribute("data-label") || key);
      el.className = (el.className ? el.className + " " : "") + "legal-missing";
    }
  });
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
