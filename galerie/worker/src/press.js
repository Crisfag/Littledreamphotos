// Salle de presse : les photos d'un événement (concert, festival, conférence,
// reportage) partagées avec le commanditaire, l'artiste ou son management,
// les médias et les sponsors, chacun avec sa licence.
//
// Une salle de presse est une galerie de type 'press' : elle réutilise
// l'envoi des photos, les aperçus en tuiles filigranées et l'empreinte
// invisible. Elle ajoute :
//   - des destinataires par rôle, chacun avec un lien personnel (magique) ;
//   - la validation photo par photo par le commanditaire ou l'artiste ;
//   - un embargo à l'heure près pour les médias et les sponsors ;
//   - des licences versionnées, acceptées en ligne avant tout
//     téléchargement, et gardées comme preuve (texte exact, empreinte) ;
//   - le droit à l'image de chaque photo (bloque les usages non éditoriaux) ;
//   - des fichiers HD où crédit, légende, licence et refus de l'entraînement
//     d'IA sont écrits au téléchargement (voir pressfile.js) ;
//   - un journal des téléchargements, exportable ;
//   - des demandes d'accréditation depuis la page publique de l'événement.
//
// Routes photographe : /api/admin/press/… (handlePressAdmin)
// Routes publiques   : /api/press/…       (handlePressPublic)

import { json, fail } from "./http.js";
import { signToken, verifyToken, hashIp, randomBytes, b64url, hashPassword } from "./auth.js";
import { hasFeature, featureRefusal } from "./subscription.js";
import { storageRefusal } from "./storage.js";
import { sendStudioMail, studioLabel, normEmail, isEmail, apiOrigin } from "./mailing.js";
import { LANGUAGES, formatAmount } from "./i18n.js";
import { localFileHeader, centralDirectoryHeader, endOfCentralDirectory, uniqueNames, safeFileName } from "./delivery.js";
import { xmpSegment, canStamp, stampedSize, stampHead, stampedCrc, crc32 } from "./pressfile.js";

export const ROLES = ["client", "validator", "press", "sponsor", "partner"];
const VALIDATING_ROLES = ["client", "validator"];
const KINDS = ["editorial", "communication", "advertising"];
const PEOPLE = ["unknown", "none", "release", "editorial", "minor"];
const USAGES = ["print", "web", "social", "tv", "newsletter", "internal", "advertising", "social_ads", "ooh"];
const TERRITORIES = ["world", "europe", "benelux", "belgium", "france", "netherlands"];
const ROLE_DEFAULT_KIND = { client: "communication", validator: "communication", press: "editorial", sponsor: "communication", partner: "communication" };
const MAX_HD_BYTES = 120e6;
const ZIP_PART_BYTES = 3.5e9; // un ZIP classique s'arrête à 4 Go
const LINK_TTL = 15 * 60;
const RECIPIENT_TTL = 400 * 24 * 3600;

const now = () => Math.floor(Date.now() / 1000);
const newId = (prefix) => `${prefix}_${b64url(randomBytes(9))}`;
const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const lang3 = (l) => (LANGUAGES.includes(l) ? l : "fr");
const T = (lang, fr, en, nl) => (lang === "en" ? en : lang === "nl" ? nl : fr);

function site(env) {
  return String(env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
}
function tokenSecret(env) {
  return `${env.TOKEN_SECRET}:presse`;
}
function linkSecret(env) {
  return `${env.TOKEN_SECRET}:presse-fichiers`;
}
async function ipHashOf(request, env) {
  return hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET);
}
async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function tagsOf(text) {
  return String(text || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/* ---------- Libellés (trois langues) ---------- */

const USAGE_LABELS = {
  print: ["presse écrite et magazines", "newspapers and magazines", "geschreven pers en magazines"],
  web: ["sites web et médias en ligne", "websites and online media", "websites en online media"],
  social: ["réseaux sociaux (publications non sponsorisées)", "social media (organic posts)", "sociale media (niet-gesponsorde berichten)"],
  tv: ["télévision et vidéo", "television and video", "televisie en video"],
  newsletter: ["newsletters et e-mails", "newsletters and emails", "nieuwsbrieven en e-mails"],
  internal: ["communication interne et rapports", "internal communications and reports", "interne communicatie en verslagen"],
  advertising: ["publicité (annonces, bannières, spots)", "advertising (ads, banners, spots)", "reclame (advertenties, banners, spots)"],
  social_ads: ["publicités sponsorisées sur les réseaux sociaux", "sponsored social media ads", "gesponsorde advertenties op sociale media"],
  ooh: ["affichage et imprimés publicitaires", "billboards and printed advertising", "affichage en gedrukte reclame"],
};
const TERRITORY_LABELS = {
  world: ["monde entier", "worldwide", "wereldwijd"],
  europe: ["Union européenne", "European Union", "Europese Unie"],
  benelux: ["Belgique, Pays-Bas et Luxembourg", "Belgium, the Netherlands and Luxembourg", "België, Nederland en Luxemburg"],
  belgium: ["Belgique", "Belgium", "België"],
  france: ["France", "France", "Frankrijk"],
  netherlands: ["Pays-Bas", "the Netherlands", "Nederland"],
};
const KIND_LABELS = {
  editorial: ["Usage éditorial", "Editorial use", "Redactioneel gebruik"],
  communication: ["Communication", "Communications", "Communicatie"],
  advertising: ["Publicité", "Advertising", "Reclame"],
};
const label = (map, key, lang) => {
  const v = map[key];
  return v ? v[lang === "en" ? 1 : lang === "nl" ? 2 : 0] : key;
};

function dateLabel(ts, lang, withTime = false) {
  if (!ts) return "";
  const locale = lang === "en" ? "en-GB" : lang === "nl" ? "nl-BE" : "fr-BE";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(ts * 1000));
}
function eventDateLabel(text, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || "")) return "";
  return dateLabel(Math.floor(Date.parse(`${text}T12:00:00Z`) / 1000), lang);
}

/* ---------- Modèles de licence ---------- */

const DEFAULT_TEMPLATES = [
  { kind: "editorial", name: "Presse : usage éditorial", usages: ["print", "web", "social", "tv"], territory: "world", duration: 0 },
  { kind: "communication", name: "Communication de l'organisation", usages: ["web", "social", "print", "newsletter", "internal"], territory: "world", duration: 24 },
  { kind: "advertising", name: "Publicité et partenaires", usages: ["advertising", "social_ads", "ooh", "web", "social"], territory: "benelux", duration: 12 },
];

async function ensureTemplates(env, photographerId) {
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM press_licence_templates WHERE photographer_id = ?").bind(photographerId).first();
  if (existing?.n) return;
  const t = now();
  for (const d of DEFAULT_TEMPLATES) {
    const id = newId("ptl");
    await env.DB.prepare(
      `INSERT INTO press_licence_templates (id, family, photographer_id, version, kind, name, usages, territory, duration_months, exclusive, price_cents, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 0, 0, ?)`
    ).bind(id, newId("plf"), photographerId, d.kind, d.name, JSON.stringify(d.usages), d.territory, d.duration, t).run();
  }
}

async function currentTemplates(env, photographerId) {
  await ensureTemplates(env, photographerId);
  const { results } = await env.DB.prepare(
    "SELECT * FROM press_licence_templates WHERE photographer_id = ? AND superseded_at IS NULL ORDER BY CASE kind WHEN 'editorial' THEN 0 WHEN 'communication' THEN 1 ELSE 2 END, created_at ASC"
  ).bind(photographerId).all();
  return results || [];
}

function templateOut(t) {
  let usages = [];
  try {
    usages = JSON.parse(t.usages || "[]");
  } catch {}
  return {
    id: t.id, family: t.family, version: t.version, kind: t.kind, name: t.name, usages, territory: t.territory,
    durationMonths: t.duration_months, exclusive: Boolean(t.exclusive), priceCents: t.price_cents,
    extra: { fr: t.extra_fr, en: t.extra_en, nl: t.extra_nl }, createdAt: t.created_at,
  };
}

async function templateForRecipient(env, photographerId, recipient) {
  const list = await currentTemplates(env, photographerId);
  return list.find((t) => t.family === recipient.template_family)
    || list.find((t) => t.kind === ROLE_DEFAULT_KIND[recipient.role])
    || list[0];
}

// Texte complet de la licence, dans la langue du destinataire. C'est ce texte
// exact (et son empreinte) qui est gardé à l'acceptation.
export function licenceText(tpl, ctx, lang) {
  const t = templateOut(tpl);
  const L = (fr, en, nl) => T(lang, fr, en, nl);
  const usages = t.usages.map((u) => label(USAGE_LABELS, u, lang)).join(", ") || L("aucun", "none", "geen");
  const where = [ctx.venue, ctx.city].filter(Boolean).join(", ");
  const date = eventDateLabel(ctx.eventDate, lang);
  const place = [date, where].filter(Boolean).join(L(", ", ", ", ", "));
  const duration = t.durationMonths
    ? L(`${t.durationMonths} mois à compter de l'acceptation`, `${t.durationMonths} months from acceptance`, `${t.durationMonths} maanden vanaf de aanvaarding`)
    : L("sans limite de durée", "no time limit", "onbeperkt in de tijd");
  const extra = (lang === "en" ? t.extra.en : lang === "nl" ? t.extra.nl : t.extra.fr) || t.extra.fr || "";
  const lines = [];
  let n = 0;
  const clause = (text) => lines.push(`${++n}. ${text}`);
  lines.push(L(`Licence d'utilisation de photographies : ${t.name}`, `Photo licence: ${t.name}`, `Gebruikslicentie voor foto's: ${t.name}`));
  lines.push(L(`Version ${t.version} · ${label(KIND_LABELS, t.kind, lang)}`, `Version ${t.version} · ${label(KIND_LABELS, t.kind, lang)}`, `Versie ${t.version} · ${label(KIND_LABELS, t.kind, lang)}`));
  lines.push("");
  clause(L(
    `Parties. ${ctx.studio} (« le studio ») concède à ${ctx.licensee} (« le licencié ») le droit d'utiliser les photographies mises à sa disposition dans la salle de presse de l'événement « ${ctx.title} »${place ? ` (${place})` : ""}.`,
    `Parties. ${ctx.studio} ("the studio") grants ${ctx.licensee} ("the licensee") the right to use the photographs made available in the press room of the event "${ctx.title}"${place ? ` (${place})` : ""}.`,
    `Partijen. ${ctx.studio} ("de studio") verleent ${ctx.licensee} ("de licentiehouder") het recht om de foto's te gebruiken die ter beschikking staan in de perskamer van het evenement "${ctx.title}"${place ? ` (${place})` : ""}.`
  ));
  clause(L(
    `Nature. Licence ${t.exclusive ? "exclusive" : "non exclusive"}, personnelle et non transférable. Le studio reste titulaire des droits d'auteur.`,
    `Nature. ${t.exclusive ? "Exclusive" : "Non-exclusive"}, personal and non-transferable licence. The studio keeps the copyright.`,
    `Aard. ${t.exclusive ? "Exclusieve" : "Niet-exclusieve"}, persoonlijke en niet-overdraagbare licentie. De studio blijft houder van het auteursrecht.`
  ));
  clause(L(
    `Usages autorisés : ${usages}. Territoire : ${label(TERRITORY_LABELS, t.territory, lang)}. Durée : ${duration}.`,
    `Permitted uses: ${usages}. Territory: ${label(TERRITORY_LABELS, t.territory, lang)}. Term: ${duration}.`,
    `Toegestaan gebruik: ${usages}. Grondgebied: ${label(TERRITORY_LABELS, t.territory, lang)}. Duur: ${duration}.`
  ));
  if (t.kind === "editorial") {
    clause(L(
      "Usage éditorial uniquement : information et couverture de l'événement. Toute publicité, promotion commerciale ou association à une marque est exclue.",
      "Editorial use only: news and coverage of the event. Any advertising, commercial promotion or brand association is excluded.",
      "Uitsluitend redactioneel gebruik: nieuws en verslaggeving over het evenement. Reclame, commerciële promotie of koppeling aan een merk is uitgesloten."
    ));
  }
  clause(L(
    `Crédit. Chaque photographie publiée porte le crédit « ${ctx.credit} », à côté de l'image ou dans le générique.`,
    `Credit. Every published photograph carries the credit "${ctx.credit}", next to the image or in the credits.`,
    `Vermelding. Elke gepubliceerde foto draagt de vermelding "${ctx.credit}", naast het beeld of in de aftiteling.`
  ));
  clause(L(
    `Interdictions. Toute utilisation non listée ci-dessus demande l'accord écrit préalable du studio. Sont notamment interdits : la revente ou la cession à un tiers, la modification de l'image au-delà du recadrage et du redimensionnement${ctx.aiReservation ? ", et l'utilisation pour l'entraînement de systèmes d'intelligence artificielle (réserve au sens de l'article 4, § 3, de la directive (UE) 2019/790)" : ""}.`,
    `Restrictions. Any use not listed above requires the studio's prior written consent. In particular: no resale or transfer to a third party, no alteration beyond cropping and resizing${ctx.aiReservation ? ", and no use to train artificial intelligence systems (reservation under Article 4(3) of Directive (EU) 2019/790)" : ""}.`,
    `Beperkingen. Elk gebruik dat hierboven niet vermeld staat, vereist de voorafgaande schriftelijke toestemming van de studio. Verboden zijn onder meer: doorverkoop of overdracht aan derden, bewerking van het beeld verder dan bijsnijden en schalen${ctx.aiReservation ? ", en gebruik voor het trainen van systemen voor artificiële intelligentie (voorbehoud in de zin van artikel 4, lid 3, van Richtlijn (EU) 2019/790)" : ""}.`
  ));
  clause(L(
    `Droit à l'image. Les personnes reconnaissables ont leur propre droit à l'image. Une photographie marquée « usage éditorial seulement » ne peut servir à la communication ni à la publicité.${t.kind === "editorial" ? "" : " Pour tout usage publicitaire, le licencié s'assure de disposer des autorisations des personnes représentées."}`,
    `Image rights. Recognisable people have their own image rights. A photograph marked "editorial use only" may not be used for communications or advertising.${t.kind === "editorial" ? "" : " For any advertising use, the licensee makes sure it holds the consent of the people shown."}`,
    `Portretrecht. Herkenbare personen hebben hun eigen portretrecht. Een foto gemarkeerd als "alleen redactioneel gebruik" mag niet voor communicatie of reclame dienen.${t.kind === "editorial" ? "" : " Voor elk reclamegebruik zorgt de licentiehouder voor de toestemming van de afgebeelde personen."}`
  ));
  if (ctx.embargoAt) {
    clause(L(
      `Embargo. Aucune publication avant le ${dateLabel(ctx.embargoAt, lang, true)} (heure de Bruxelles).`,
      `Embargo. No publication before ${dateLabel(ctx.embargoAt, lang, true)} (Brussels time).`,
      `Embargo. Geen publicatie vóór ${dateLabel(ctx.embargoAt, lang, true)} (Brusselse tijd).`
    ));
  }
  clause(t.priceCents
    ? L(`Prix. ${formatAmount(t.priceCents, lang)} hors TVA, facturés par le studio.`, `Price. ${formatAmount(t.priceCents, lang)} excluding VAT, invoiced by the studio.`, `Prijs. ${formatAmount(t.priceCents, lang)} exclusief btw, gefactureerd door de studio.`)
    : L("Prix. Inclus dans la prestation du studio.", "Price. Included in the studio's assignment.", "Prijs. Inbegrepen in de opdracht van de studio."));
  if (extra.trim()) clause(extra.trim());
  clause(L(
    "Preuve. L'acceptation en ligne de cette licence, horodatée et liée à l'identité du licencié, vaut accord. Le texte accepté est conservé tel quel par le studio et reste consultable par le licencié.",
    "Proof. Accepting this licence online, time-stamped and tied to the licensee's identity, constitutes agreement. The accepted text is kept as is by the studio and remains available to the licensee.",
    "Bewijs. De online aanvaarding van deze licentie, met tijdstempel en gekoppeld aan de identiteit van de licentiehouder, geldt als akkoord. De aanvaarde tekst wordt ongewijzigd bewaard door de studio en blijft raadpleegbaar voor de licentiehouder."
  ));
  return lines.join("\n");
}

// Résumé d'une ligne, écrit dans le fichier (champ « Conditions d'utilisation »).
function usageSummary(tpl, licence, ctx, lang) {
  const t = templateOut(tpl);
  const L = (fr, en, nl) => T(lang, fr, en, nl);
  const usages = t.usages.map((u) => label(USAGE_LABELS, u, lang)).join(", ");
  const until = licence.expires_at ? L(`jusqu'au ${dateLabel(licence.expires_at, lang)}`, `until ${dateLabel(licence.expires_at, lang)}`, `tot ${dateLabel(licence.expires_at, lang)}`) : L("sans limite de durée", "no time limit", "onbeperkt");
  return L(
    `${label(KIND_LABELS, t.kind, lang)} · ${usages} · ${label(TERRITORY_LABELS, t.territory, lang)} · ${until}. Licence ${licence.id} accordée à ${ctx.licensee}. Crédit obligatoire : ${ctx.credit}. Tout autre usage sur accord écrit de ${ctx.studio}.`,
    `${label(KIND_LABELS, t.kind, lang)} · ${usages} · ${label(TERRITORY_LABELS, t.territory, lang)} · ${until}. Licence ${licence.id} granted to ${ctx.licensee}. Mandatory credit: ${ctx.credit}. Any other use requires written consent from ${ctx.studio}.`,
    `${label(KIND_LABELS, t.kind, lang)} · ${usages} · ${label(TERRITORY_LABELS, t.territory, lang)} · ${until}. Licentie ${licence.id} verleend aan ${ctx.licensee}. Verplichte vermelding: ${ctx.credit}. Elk ander gebruik met schriftelijke toestemming van ${ctx.studio}.`
  );
}

/* ---------- Lectures ---------- */

async function loadEvent(env, galleryId) {
  return env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.language, g.photographer_id, g.watermark_text, e.*
       FROM galleries g JOIN press_events e ON e.gallery_id = g.id
      WHERE g.id = ? AND g.kind = 'press'`
  ).bind(galleryId).first();
}
async function ownedEvent(env, photographerId, slug) {
  const row = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ? AND photographer_id = ? AND kind = 'press'").bind(slug, photographerId).first();
  return row ? loadEvent(env, row.id) : null;
}
async function eventPhotos(env, galleryId) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.position, p.width, p.height, p.cols, p.rows, p.preview_width, p.preview_height, p.source_name, p.forensic_id, p.created_at,
            pp.headline, pp.caption, pp.byline, pp.keywords, pp.people, pp.tags, pp.status, pp.decided_by, pp.decided_at, pp.note,
            pp.hd_name, pp.hd_size, pp.hd_type, pp.head_end, pp.tail_crc, pp.insert_at, pp.strip
       FROM photos p LEFT JOIN press_photos pp ON pp.photo_id = p.id
      WHERE p.gallery_id = ? ORDER BY p.position ASC, p.created_at ASC`
  ).bind(galleryId).all();
  return (results || []).map((p) => ({ ...p, status: p.status || "pending", people: p.people || "unknown", tags: p.tags || "", hd_size: p.hd_size || 0 }));
}

function eventState(ev, at = now()) {
  if (ev.closed_at) return "closed";
  if (ev.published_at) return "live";
  if (ev.review_opened_at) return "review";
  return "draft";
}

function eventOut(ev, lang = "fr") {
  return {
    slug: ev.slug, title: ev.title, language: ev.language || "fr",
    eventDate: ev.event_date, eventDateLabel: eventDateLabel(ev.event_date, lang), venue: ev.venue, city: ev.city,
    organiser: ev.organiser, description: ev.description, creditLine: ev.credit_line,
    approvalRequired: Boolean(ev.approval_required), embargoAt: ev.embargo_at || null,
    accreditationOpen: Boolean(ev.accreditation_open), aiReservation: Boolean(ev.ai_reservation),
    reviewOpenedAt: ev.review_opened_at || null, publishedAt: ev.published_at || null, closedAt: ev.closed_at || null,
    state: eventState(ev),
  };
}

function creditOf(ev, studio) {
  return ev.credit_line || studio;
}

/* ---------- Règles d'accès ---------- */

// Une photo est « publiable » : validée, ou sans validation demandée et non refusée.
function releasable(ev, p) {
  return ev.approval_required ? p.status === "approved" : p.status !== "rejected";
}

function embargoed(ev, recipient, at = now()) {
  if (VALIDATING_ROLES.includes(recipient.role)) return false;
  return Boolean(ev.embargo_at && at < ev.embargo_at);
}

// Ce que voit un destinataire. null = rien (pas encore ouvert, embargo…).
function visibleFor(ev, recipient, photos, at = now()) {
  if (VALIDATING_ROLES.includes(recipient.role)) {
    if (!ev.review_opened_at && !ev.published_at) return null;
    return photos;
  }
  if (!ev.published_at || embargoed(ev, recipient, at)) return null;
  const filter = tagsOf(recipient.tag_filter);
  return photos.filter((p) => releasable(ev, p) && (!filter.length || tagsOf(p.tags).some((t) => filter.includes(t))));
}

// Peut-on télécharger cette photo avec cette licence ? Renvoie un motif sinon.
function downloadBlock(ev, tpl, p) {
  if (!releasable(ev, p)) return p.status === "rejected" ? "rejected" : "pending";
  if (!p.hd_size) return "nohd";
  if (tpl.kind !== "editorial" && ["editorial", "minor"].includes(p.people)) return "rights";
  return "";
}

/* ---------- Destinataires ---------- */

function recipientOut(r, extra = {}) {
  return {
    id: r.id, role: r.role, name: r.name, organisation: r.organisation, email: r.email, lang: r.lang,
    templateFamily: r.template_family, tagFilter: r.tag_filter, pressCard: r.press_card, message: r.message,
    status: r.revoked_at ? "revoked" : r.status, source: r.source, invitedAt: r.invited_at || null,
    lastSeenAt: r.last_seen_at || null, createdAt: r.created_at, ...extra,
  };
}

async function recipientLink(env, r) {
  const token = await signToken(tokenSecret(env), { typ: "press", r: r.id, g: r.gallery_id, exp: now() + RECIPIENT_TTL });
  return `${site(env)}/presse.html?t=${encodeURIComponent(token)}`;
}

const INVITE = {
  validate: {
    subject: (ev, lang) => T(lang, `Les photos de « ${ev.title} » attendent votre validation`, `The photos of "${ev.title}" are ready for your approval`, `De foto's van "${ev.title}" wachten op je goedkeuring`),
    body: (ev, lang, studio) => T(lang,
      `Bonjour,\n\nLes photos de « ${ev.title} » sont en ligne dans votre salle de presse privée. Vous pouvez les parcourir, valider celles qui peuvent être diffusées et télécharger les fichiers haute définition.\n\nLes médias ne verront que les photos validées.\n\n${studio}`,
      `Hello,\n\nThe photos of "${ev.title}" are online in your private press room. You can browse them, approve those that may be published and download the high-resolution files.\n\nThe media will only see the approved photos.\n\n${studio}`,
      `Hallo,\n\nDe foto's van "${ev.title}" staan online in je privé-perskamer. Je kunt ze bekijken, goedkeuren welke gepubliceerd mogen worden en de bestanden in hoge resolutie downloaden.\n\nDe media zien alleen de goedgekeurde foto's.\n\n${studio}`),
    cta: (lang) => T(lang, "Ouvrir la salle de presse", "Open the press room", "Open de perskamer"),
  },
  media: {
    subject: (ev, lang) => T(lang, `Photos officielles : ${ev.title}`, `Official photos: ${ev.title}`, `Officiële foto's: ${ev.title}`),
    body: (ev, lang, studio, embargoAt) => T(lang,
      `Bonjour,\n\nLes photos officielles de « ${ev.title} » sont à votre disposition, en haute définition, avec légendes et crédits.${embargoAt ? `\n\nEmbargo : publication à partir du ${dateLabel(embargoAt, lang, true)} (heure de Bruxelles). Les photos s'afficheront à ce moment-là.` : ""}\n\nCrédit obligatoire : ${ev.credit_line || studio}.\n\n${studio}`,
      `Hello,\n\nThe official photos of "${ev.title}" are available to you in high resolution, with captions and credits.${embargoAt ? `\n\nEmbargo: publication from ${dateLabel(embargoAt, lang, true)} (Brussels time). The photos will appear at that moment.` : ""}\n\nMandatory credit: ${ev.credit_line || studio}.\n\n${studio}`,
      `Hallo,\n\nDe officiële foto's van "${ev.title}" staan voor je klaar, in hoge resolutie, met bijschriften en vermeldingen.${embargoAt ? `\n\nEmbargo: publicatie vanaf ${dateLabel(embargoAt, lang, true)} (Brusselse tijd). De foto's verschijnen op dat moment.` : ""}\n\nVerplichte vermelding: ${ev.credit_line || studio}.\n\n${studio}`),
    cta: (lang) => T(lang, "Voir les photos", "See the photos", "Bekijk de foto's"),
  },
};

async function sendInvite(env, photographer, ev, r) {
  if (!r.email) return { sent: false, skipped: "email" };
  const lang = lang3(r.lang);
  const kind = VALIDATING_ROLES.includes(r.role) ? INVITE.validate : INVITE.media;
  const studio = studioLabel(photographer);
  const res = await sendStudioMail(env, photographer, {
    to: r.email, kind: "press:invite", refId: r.id, lang, marketing: false,
    subject: kind.subject(ev, lang), body: kind.body(ev, lang, studio, ev.embargo_at), ctaLabel: kind.cta(lang), ctaUrl: await recipientLink(env, r),
  });
  if (res.sent || !env.RESEND_API_KEY) {
    await env.DB.prepare("UPDATE press_recipients SET invited_at = ? WHERE id = ?").bind(now(), r.id).run();
  }
  return res;
}

async function inviteAll(env, photographer, ev, roles) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM press_recipients WHERE gallery_id = ? AND status = 'active' AND revoked_at IS NULL AND invited_at IS NULL AND email != ''`
  ).bind(ev.gallery_id).all();
  let sent = 0;
  for (const r of (results || []).filter((x) => roles.includes(x.role))) {
    const res = await sendInvite(env, photographer, ev, r);
    if (res.sent) sent++;
  }
  return sent;
}

/* ---------- Routes photographe ---------- */

function slugify(title) {
  const base = String(title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "evenement";
  return `presse-${base}-${b64url(randomBytes(3)).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "x1"}`;
}

function parseEventFields(body, current = {}) {
  const pickBool = (v, d) => (v === undefined ? d : Boolean(v));
  const embargo = body.embargoAt === undefined ? current.embargo_at ?? null
    : body.embargoAt === null || body.embargoAt === "" ? null : Number(body.embargoAt);
  if (embargo !== null && !Number.isFinite(embargo)) return { error: "Heure d'embargo illisible" };
  const date = body.eventDate === undefined ? current.event_date || "" : str(body.eventDate, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Date de l'événement illisible" };
  return {
    event_date: date,
    venue: body.venue === undefined ? current.venue || "" : str(body.venue, 160),
    city: body.city === undefined ? current.city || "" : str(body.city, 120),
    organiser: body.organiser === undefined ? current.organiser || "" : str(body.organiser, 160),
    description: body.description === undefined ? current.description || "" : str(body.description, 2000),
    credit_line: body.creditLine === undefined ? current.credit_line || "" : str(body.creditLine, 160),
    approval_required: pickBool(body.approvalRequired, current.approval_required ?? true) ? 1 : 0,
    embargo_at: embargo,
    accreditation_open: pickBool(body.accreditationOpen, Boolean(current.accreditation_open)) ? 1 : 0,
    ai_reservation: pickBool(body.aiReservation, current.ai_reservation ?? true) ? 1 : 0,
  };
}

async function createEvent(request, env, photographer) {
  const body = await request.json().catch(() => ({}));
  const title = str(body.title, 120);
  if (!title) return fail(400, "Le nom de l'événement est requis");
  const fields = parseEventFields(body);
  if (fields.error) return fail(400, fields.error);
  const language = LANGUAGES.includes(body.language) ? body.language : "fr";
  const studio = studioLabel(photographer);
  const id = newId("gal");
  const { hash, salt } = await hashPassword(b64url(randomBytes(18)));
  let slug = slugify(title);
  for (let i = 0; i < 4; i++) {
    const taken = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ?").bind(slug).first();
    if (!taken) break;
    slug = slugify(title);
  }
  const t = now();
  // Galerie de type 'press' : jamais ouverte avec un mot de passe (aléatoire,
  // jamais montré) ; seuls les liens personnels des destinataires y donnent accès.
  await env.DB.prepare(
    `INSERT INTO galleries (id, photographer_id, slug, title, client_name, client_email, password_hash, password_salt, watermark_text,
                            expires_at, layout, theme, language, kind, created_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, NULL, 'grille', '', ?, 'press', ?)`
  ).bind(id, photographer.id, slug, title, fields.organiser || "", hash, salt, `${studio}  ·  ${T(language, "APERÇU PRESSE", "PRESS PREVIEW", "PERSPREVIEW")}`, language, t).run();
  await env.DB.prepare(
    `INSERT INTO press_events (gallery_id, photographer_id, event_date, venue, city, organiser, description, credit_line, approval_required,
                               embargo_at, accreditation_open, ai_reservation, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, photographer.id, fields.event_date, fields.venue, fields.city, fields.organiser, fields.description, fields.credit_line || studio,
    fields.approval_required, fields.embargo_at, fields.accreditation_open, fields.ai_reservation, t, t).run();
  return json({ ok: true, slug }, { status: 201 });
}

async function listEvents(env, photographer) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.language, e.*,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id) AS photo_count,
            (SELECT COUNT(*) FROM press_photos pp WHERE pp.gallery_id = g.id AND pp.status = 'approved') AS approved_count,
            (SELECT COUNT(*) FROM press_recipients r WHERE r.gallery_id = g.id AND r.status = 'active' AND r.revoked_at IS NULL) AS recipient_count,
            (SELECT COUNT(*) FROM press_recipients r WHERE r.gallery_id = g.id AND r.status = 'pending') AS request_count,
            (SELECT COUNT(*) FROM press_downloads d WHERE d.gallery_id = g.id) AS download_count,
            (SELECT p.id FROM photos p WHERE p.gallery_id = g.id ORDER BY p.position ASC, p.created_at ASC LIMIT 1) AS cover_id
       FROM galleries g JOIN press_events e ON e.gallery_id = g.id
      WHERE g.photographer_id = ? AND g.kind = 'press'
      ORDER BY COALESCE(NULLIF(e.event_date, ''), date(g.created_at, 'unixepoch')) DESC, g.created_at DESC`
  ).bind(photographer.id).all();
  return (results || []).map((e) => ({
    ...eventOut(e), photoCount: e.photo_count, approvedCount: e.approved_count, recipientCount: e.recipient_count,
    requestCount: e.request_count, downloadCount: e.download_count, coverId: e.cover_id || null,
  }));
}

function photoAdminOut(p) {
  return {
    id: p.id, position: p.position, width: p.width, height: p.height, cols: p.cols, rows: p.rows,
    preview_width: p.preview_width, preview_height: p.preview_height, sourceName: p.source_name || "",
    headline: p.headline || "", caption: p.caption || "", byline: p.byline || "", keywords: p.keywords || "",
    people: p.people, tags: p.tags, status: p.status, decidedBy: p.decided_by || "", decidedAt: p.decided_at || null, note: p.note || "",
    hdName: p.hd_name || "", hdSize: p.hd_size || 0, stamped: canStamp(p),
  };
}

async function eventDetail(env, photographer, ev) {
  const photos = await eventPhotos(env, ev.gallery_id);
  const { results: recipients } = await env.DB.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM press_downloads d WHERE d.recipient_id = r.id) AS downloads,
            (SELECT MAX(accepted_at) FROM press_licences l WHERE l.recipient_id = r.id) AS accepted_at
       FROM press_recipients r WHERE r.gallery_id = ? ORDER BY r.created_at ASC`
  ).bind(ev.gallery_id).all();
  const { results: licences } = await env.DB.prepare(
    `SELECT id, recipient_id, template_id, kind, lang, text_sha256, signer_name, signer_email, organisation, expires_at, accepted_at
       FROM press_licences WHERE gallery_id = ? ORDER BY accepted_at DESC`
  ).bind(ev.gallery_id).all();
  const { results: downloads } = await env.DB.prepare(
    `SELECT d.ts, d.photo_id, d.recipient_id, d.licence_id, d.batch, d.bytes FROM press_downloads d WHERE d.gallery_id = ? ORDER BY d.ts DESC LIMIT 200`
  ).bind(ev.gallery_id).all();
  const links = {};
  for (const r of recipients || []) if (r.status === "active" && !r.revoked_at) links[r.id] = await recipientLink(env, r);
  return {
    enabled: hasFeature(env, photographer, "press"),
    event: eventOut(ev),
    publicUrl: `${site(env)}/presse.html?e=${encodeURIComponent(ev.slug)}`,
    photos: photos.map(photoAdminOut),
    recipients: (recipients || []).map((r) => recipientOut(r, { downloads: r.downloads, acceptedAt: r.accepted_at || null, link: links[r.id] || "" })),
    licences: (licences || []).map((l) => ({ id: l.id, recipientId: l.recipient_id, templateId: l.template_id, kind: l.kind, lang: l.lang, sha256: l.text_sha256, signerName: l.signer_name, signerEmail: l.signer_email, organisation: l.organisation, expiresAt: l.expires_at, acceptedAt: l.accepted_at })),
    downloads: downloads || [],
    templates: (await currentTemplates(env, photographer.id)).map(templateOut),
  };
}

async function updateEvent(request, env, photographer, ev) {
  const body = await request.json().catch(() => ({}));
  const f = parseEventFields(body, ev);
  if (f.error) return fail(400, f.error);
  const title = body.title === undefined ? ev.title : str(body.title, 120) || ev.title;
  const language = LANGUAGES.includes(body.language) ? body.language : ev.language;
  await env.DB.prepare("UPDATE galleries SET title = ?, language = ?, client_name = ? WHERE id = ?").bind(title, language, f.organiser, ev.gallery_id).run();
  await env.DB.prepare(
    `UPDATE press_events SET event_date = ?, venue = ?, city = ?, organiser = ?, description = ?, credit_line = ?, approval_required = ?,
            embargo_at = ?, accreditation_open = ?, ai_reservation = ?, updated_at = ? WHERE gallery_id = ?`
  ).bind(f.event_date, f.venue, f.city, f.organiser, f.description, f.credit_line || studioLabel(photographer), f.approval_required,
    f.embargo_at, f.accreditation_open, f.ai_reservation, now(), ev.gallery_id).run();
  return json({ ok: true });
}

async function setStage(env, photographer, ev, action) {
  const t = now();
  if (action === "review") {
    await env.DB.prepare("UPDATE press_events SET review_opened_at = COALESCE(review_opened_at, ?), closed_at = NULL, updated_at = ? WHERE gallery_id = ?").bind(t, t, ev.gallery_id).run();
    const sent = await inviteAll(env, photographer, { ...ev, review_opened_at: t }, VALIDATING_ROLES);
    return json({ ok: true, sent });
  }
  if (action === "publish") {
    await env.DB.prepare("UPDATE press_events SET published_at = COALESCE(published_at, ?), review_opened_at = COALESCE(review_opened_at, ?), closed_at = NULL, updated_at = ? WHERE gallery_id = ?").bind(t, t, t, ev.gallery_id).run();
    const fresh = await loadEvent(env, ev.gallery_id);
    const sent = await inviteAll(env, photographer, fresh, ROLES);
    return json({ ok: true, sent });
  }
  if (action === "close") {
    await env.DB.prepare("UPDATE press_events SET closed_at = ?, updated_at = ? WHERE gallery_id = ?").bind(t, t, ev.gallery_id).run();
    return json({ ok: true });
  }
  if (action === "reopen") {
    await env.DB.prepare("UPDATE press_events SET closed_at = NULL, updated_at = ? WHERE gallery_id = ?").bind(t, ev.gallery_id).run();
    return json({ ok: true });
  }
  return fail(404, "Action inconnue");
}

async function ensurePressPhoto(env, ev, photoId) {
  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?").bind(photoId, ev.gallery_id).first();
  if (!photo) return null;
  const t = now();
  await env.DB.prepare("INSERT OR IGNORE INTO press_photos (photo_id, gallery_id, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(photoId, ev.gallery_id, t, t).run();
  return photo;
}

function photoPatch(body) {
  const patch = {};
  if (body.headline !== undefined) patch.headline = str(body.headline, 300);
  if (body.caption !== undefined) patch.caption = str(body.caption, 2000);
  if (body.byline !== undefined) patch.byline = str(body.byline, 200);
  if (body.keywords !== undefined) patch.keywords = (Array.isArray(body.keywords) ? body.keywords.join(", ") : str(body.keywords, 1000)).slice(0, 1000);
  if (body.tags !== undefined) patch.tags = tagsOf(Array.isArray(body.tags) ? body.tags.join(",") : body.tags).join(", ").slice(0, 300);
  if (body.people !== undefined) {
    if (!PEOPLE.includes(body.people)) return { error: "Droit à l'image inconnu" };
    patch.people = body.people;
  }
  if (body.status !== undefined) {
    if (!["pending", "approved", "rejected"].includes(body.status)) return { error: "Statut inconnu" };
    patch.status = body.status;
    patch.decided_at = body.status === "pending" ? null : now();
    patch.decided_by = body.status === "pending" ? "" : body.decidedBy || "studio";
    patch.note = body.status === "rejected" ? str(body.note, 300) : "";
  }
  return { patch };
}

async function applyPatch(env, photoId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE press_photos SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE photo_id = ?`)
    .bind(...keys.map((k) => patch[k]), now(), photoId).run();
}

async function updatePhotos(request, env, ev, ids) {
  const body = await request.json().catch(() => ({}));
  const { patch, error } = photoPatch(body);
  if (error) return fail(400, error);
  const list = ids || (Array.isArray(body.ids) ? body.ids.slice(0, 2000) : []);
  let n = 0;
  for (const id of list) {
    if (!(await ensurePressPhoto(env, ev, String(id)))) continue;
    await applyPatch(env, String(id), patch);
    n++;
  }
  return json({ ok: true, updated: n });
}

// PUT /api/admin/press/:slug/photos/:id/hd?name=… (corps : le fichier tel qu'envoyé)
async function putHd(request, env, photographer, ev, photoId) {
  if (!(await ensurePressPhoto(env, ev, photoId))) return fail(404, "Photo introuvable");
  const url = new URL(request.url);
  const name = safeFileName(url.searchParams.get("name") || `${photoId}.jpg`);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_HD_BYTES) return fail(413, "Fichier trop volumineux (120 Mo maximum)");
  const refusal = await storageRefusal(env, photographer, declared);
  if (refusal) return refusal;
  const type = /\.png$/i.test(name) ? "image/png" : /\.tiff?$/i.test(name) ? "image/tiff" : /\.webp$/i.test(name) ? "image/webp" : /\.heic$/i.test(name) ? "image/heic" : "image/jpeg";
  const key = `${ev.gallery_id}/${photoId}/hd`;
  const stored = await env.TILES.put(key, request.body, { httpMetadata: { contentType: type } });
  const size = stored?.size ?? 0;
  if (!size || size > MAX_HD_BYTES) {
    await env.TILES.delete(key);
    return fail(size ? 413 : 400, size ? "Fichier trop volumineux" : "Fichier vide");
  }
  await env.DB.prepare("UPDATE press_photos SET hd_name = ?, hd_size = ?, hd_type = ?, head_end = 0, tail_crc = 0, insert_at = 0, strip = '[]', updated_at = ? WHERE photo_id = ?")
    .bind(name, size, type, now(), photoId).run();
  return json({ ok: true, size }, { status: 201 });
}

// POST /api/admin/press/:slug/photos/:id/meta : légendes lues dans le fichier
// et carte de son en-tête (relevées par l'outil d'administration).
async function putMeta(request, env, ev, photoId) {
  if (!(await ensurePressPhoto(env, ev, photoId))) return fail(404, "Photo introuvable");
  const body = await request.json().catch(() => ({}));
  const current = await env.DB.prepare("SELECT * FROM press_photos WHERE photo_id = ?").bind(photoId).first();
  const fill = (k, v, max) => (current[k] ? current[k] : str(v, max));
  const layout = body.layout || {};
  const strip = Array.isArray(layout.strip) ? layout.strip.filter((r) => Array.isArray(r) && r.length === 2).map(([a, b]) => [Number(a) | 0, Number(b) | 0]).slice(0, 20) : [];
  const headEnd = Number(layout.headEnd) | 0;
  const insertAt = Number(layout.insertAt) | 0;
  const tailCrc = Number(layout.tailCrc) >>> 0;
  const okLayout = headEnd >= 2 && insertAt >= 2 && insertAt <= headEnd && headEnd < (current.hd_size || Infinity)
    && strip.every(([a, b]) => a >= 2 && b <= headEnd && a < b && !(insertAt > a && insertAt < b));
  await env.DB.prepare(
    `UPDATE press_photos SET headline = ?, caption = ?, byline = ?, keywords = ?, head_end = ?, tail_crc = ?, insert_at = ?, strip = ?, updated_at = ? WHERE photo_id = ?`
  ).bind(
    fill("headline", body.headline, 300), fill("caption", body.caption, 2000), fill("byline", body.byline, 200),
    current.keywords || (Array.isArray(body.keywords) ? body.keywords.join(", ") : str(body.keywords, 1000)).slice(0, 1000),
    okLayout ? headEnd : 0, okLayout ? tailCrc : (Number(body.fullCrc) >>> 0), okLayout ? insertAt : 0, okLayout ? JSON.stringify(strip) : "[]", now(), photoId
  ).run();
  return json({ ok: true, stamped: okLayout });
}

async function addRecipient(request, env, photographer, ev) {
  const body = await request.json().catch(() => ({}));
  const role = ROLES.includes(body.role) ? body.role : "press";
  const email = normEmail(body.email || "");
  if (email && !isEmail(email)) return fail(400, "Adresse e-mail invalide");
  const name = str(body.name, 120);
  if (!name && !email) return fail(400, "Indiquez au moins un nom ou une adresse e-mail");
  const templates = await currentTemplates(env, photographer.id);
  const family = templates.some((t) => t.family === body.templateFamily) ? body.templateFamily : (templates.find((t) => t.kind === ROLE_DEFAULT_KIND[role])?.family || "");
  const r = {
    id: newId("prc"), gallery_id: ev.gallery_id, photographer_id: photographer.id, role, name, organisation: str(body.organisation, 160), email,
    lang: lang3(body.lang || ev.language), template_family: family, tag_filter: tagsOf(body.tagFilter).join(", "), status: "active", source: "studio", created_at: now(),
  };
  await env.DB.prepare(
    `INSERT INTO press_recipients (id, gallery_id, photographer_id, role, name, organisation, email, lang, template_family, tag_filter, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(r.id, r.gallery_id, r.photographer_id, r.role, r.name, r.organisation, r.email, r.lang, r.template_family, r.tag_filter, r.status, r.source, r.created_at).run();
  // Invitation tout de suite si la salle est déjà ouverte à ce rôle.
  let invited = false;
  const open = VALIDATING_ROLES.includes(role) ? ev.review_opened_at || ev.published_at : ev.published_at;
  if (body.invite !== false && open && !ev.closed_at && email) invited = (await sendInvite(env, photographer, ev, r)).sent;
  return json({ ok: true, id: r.id, link: await recipientLink(env, r), invited }, { status: 201 });
}

async function updateRecipient(request, env, photographer, ev, id) {
  const r = await env.DB.prepare("SELECT * FROM press_recipients WHERE id = ? AND gallery_id = ?").bind(id, ev.gallery_id).first();
  if (!r) return fail(404, "Destinataire introuvable");
  const body = await request.json().catch(() => ({}));
  if (body.action === "invite") {
    if (!r.email) return fail(400, "Pas d'adresse e-mail pour ce destinataire");
    const res = await sendInvite(env, photographer, ev, r);
    return json({ ok: true, sent: res.sent });
  }
  if (body.action === "revoke") {
    await env.DB.prepare("UPDATE press_recipients SET revoked_at = ? WHERE id = ?").bind(now(), id).run();
    return json({ ok: true });
  }
  if (body.action === "restore") {
    await env.DB.prepare("UPDATE press_recipients SET revoked_at = NULL WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (body.action === "accept") {
    await env.DB.prepare("UPDATE press_recipients SET status = 'active', invited_at = NULL WHERE id = ?").bind(id).run();
    const fresh = { ...r, status: "active" };
    const sent = ev.published_at && !ev.closed_at ? (await sendInvite(env, photographer, ev, fresh)).sent : false;
    return json({ ok: true, sent, link: await recipientLink(env, fresh) });
  }
  if (body.action === "refuse") {
    await env.DB.prepare("UPDATE press_recipients SET status = 'refused' WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  const templates = await currentTemplates(env, photographer.id);
  const role = ROLES.includes(body.role) ? body.role : r.role;
  await env.DB.prepare(
    "UPDATE press_recipients SET role = ?, name = ?, organisation = ?, lang = ?, template_family = ?, tag_filter = ? WHERE id = ?"
  ).bind(
    role, body.name === undefined ? r.name : str(body.name, 120), body.organisation === undefined ? r.organisation : str(body.organisation, 160),
    body.lang ? lang3(body.lang) : r.lang,
    templates.some((t) => t.family === body.templateFamily) ? body.templateFamily : r.template_family,
    body.tagFilter === undefined ? r.tag_filter : tagsOf(body.tagFilter).join(", "), id
  ).run();
  return json({ ok: true });
}

async function saveTemplate(request, env, photographer, family) {
  const body = await request.json().catch(() => ({}));
  const list = await currentTemplates(env, photographer.id);
  const current = family ? list.find((t) => t.family === family) : null;
  if (family && !current) return fail(404, "Modèle introuvable");
  const kind = KINDS.includes(body.kind) ? body.kind : current?.kind || "editorial";
  const usages = (Array.isArray(body.usages) ? body.usages : []).filter((u) => USAGES.includes(u));
  if (!usages.length) return fail(400, "Choisissez au moins un usage");
  const territory = TERRITORIES.includes(body.territory) ? body.territory : "world";
  const duration = Math.max(0, Math.min(240, Number(body.durationMonths) | 0));
  const price = Math.max(0, Math.round(Number(body.priceCents) || 0));
  const name = str(body.name, 120) || current?.name || "Licence";
  const t = now();
  const id = newId("ptl");
  const fam = current?.family || newId("plf");
  // Jamais de modification sur place : une nouvelle version, l'ancienne reste
  // telle qu'acceptée par les destinataires.
  await env.DB.prepare(
    `INSERT INTO press_licence_templates (id, family, photographer_id, version, kind, name, usages, territory, duration_months, exclusive, price_cents, extra_fr, extra_en, extra_nl, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, fam, photographer.id, (current?.version || 0) + 1, kind, name, JSON.stringify(usages), territory, duration, body.exclusive ? 1 : 0, price,
    str(body.extra?.fr, 2000), str(body.extra?.en, 2000), str(body.extra?.nl, 2000), t).run();
  if (current) await env.DB.prepare("UPDATE press_licence_templates SET superseded_at = ? WHERE id = ?").bind(t, current.id).run();
  return json({ ok: true, id, family: fam }, { status: current ? 200 : 201 });
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function journalCsv(env, ev) {
  const { results } = await env.DB.prepare(
    `SELECT d.ts, d.photo_id, d.licence_id, d.batch, d.bytes, r.name, r.organisation, r.email, r.role, l.kind, l.signer_name, l.text_sha256, p.source_name, pp.hd_name
       FROM press_downloads d
       LEFT JOIN press_recipients r ON r.id = d.recipient_id
       LEFT JOIN press_licences l ON l.id = d.licence_id
       LEFT JOIN photos p ON p.id = d.photo_id
       LEFT JOIN press_photos pp ON pp.photo_id = d.photo_id
      WHERE d.gallery_id = ? ORDER BY d.ts ASC`
  ).bind(ev.gallery_id).all();
  const head = ["date_utc", "destinataire", "organisation", "email", "role", "fichier", "licence", "type_licence", "signataire", "empreinte_sha256", "zip", "octets"];
  const rows = (results || []).map((d) => [
    new Date(d.ts * 1000).toISOString(), d.name, d.organisation, d.email, d.role, d.hd_name || d.source_name || d.photo_id,
    d.licence_id, d.kind, d.signer_name, d.text_sha256, d.batch, d.bytes,
  ]);
  const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="journal-${ev.slug}.csv"`,
      "cache-control": "no-store",
    },
  });
}

export async function handlePressAdmin(request, env, photographer, parts, { eraseGallery } = {}) {
  const enabled = hasFeature(env, photographer, "press");
  const method = request.method;
  // GET /api/admin/press
  if (!parts.length || !parts[0]) {
    if (method === "GET") {
      return json({ enabled, events: await listEvents(env, photographer), templates: (await currentTemplates(env, photographer.id)).map(templateOut) });
    }
    if (method === "POST") {
      if (!enabled) return featureRefusal("press");
      return createEvent(request, env, photographer);
    }
    return fail(405, "Méthode non autorisée");
  }
  // /api/admin/press/templates[/:family]
  if (parts[0] === "templates") {
    if (method === "GET") return json({ templates: (await currentTemplates(env, photographer.id)).map(templateOut) });
    if (method === "POST") {
      if (!enabled) return featureRefusal("press");
      return saveTemplate(request, env, photographer, parts[1] ? decodeURIComponent(parts[1]) : "");
    }
    return fail(405, "Méthode non autorisée");
  }
  const ev = await ownedEvent(env, photographer.id, decodeURIComponent(parts[0]));
  if (!ev) return fail(404, "Salle de presse introuvable");
  const action = parts[1] || "";
  if (!action) {
    if (method === "GET") return json(await eventDetail(env, photographer, ev));
    if (method === "POST") return updateEvent(request, env, photographer, ev);
    if (method === "DELETE") {
      const gallery = await env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(ev.gallery_id).first();
      if (eraseGallery) await eraseGallery(env, gallery);
      else await env.DB.prepare("DELETE FROM galleries WHERE id = ?").bind(ev.gallery_id).run();
      for (const table of ["press_events", "press_photos", "press_recipients", "press_downloads"]) {
        await env.DB.prepare(`DELETE FROM ${table} WHERE gallery_id = ?`).bind(ev.gallery_id).run();
      }
      return json({ ok: true });
    }
    return fail(405, "Méthode non autorisée");
  }
  if (["review", "publish", "close", "reopen"].includes(action) && method === "POST") {
    if (!enabled && action !== "close") return featureRefusal("press");
    return setStage(env, photographer, ev, action);
  }
  if (action === "photos") {
    const photoId = parts[2] ? decodeURIComponent(parts[2]) : "";
    if (!photoId && method === "POST") return updatePhotos(request, env, ev, null);
    if (photoId && parts[3] === "hd" && method === "PUT") return putHd(request, env, photographer, ev, photoId);
    if (photoId && parts[3] === "meta" && method === "POST") return putMeta(request, env, ev, photoId);
    if (photoId && !parts[3] && method === "POST") return updatePhotos(request, env, ev, [photoId]);
    return fail(404, "Route inconnue");
  }
  if (action === "recipients") {
    if (!parts[2] && method === "POST") {
      if (!enabled) return featureRefusal("press");
      return addRecipient(request, env, photographer, ev);
    }
    if (parts[2] && method === "POST") return updateRecipient(request, env, photographer, ev, decodeURIComponent(parts[2]));
    return fail(404, "Route inconnue");
  }
  if (action === "licences" && parts[2] && method === "GET") {
    const l = await env.DB.prepare("SELECT * FROM press_licences WHERE id = ? AND gallery_id = ?").bind(decodeURIComponent(parts[2]), ev.gallery_id).first();
    if (!l) return fail(404, "Licence introuvable");
    return json({ licence: { id: l.id, text: l.text, sha256: l.text_sha256, signerName: l.signer_name, signerEmail: l.signer_email, organisation: l.organisation, acceptedAt: l.accepted_at, expiresAt: l.expires_at, lang: l.lang, kind: l.kind, ipHash: l.ip_hash, userAgent: l.user_agent } });
  }
  if (action === "journal.csv" && method === "GET") return journalCsv(env, ev);
  // Aperçu du texte d'un modèle, tel qu'un destinataire le lira.
  if (action === "licence-preview" && method === "GET") {
    const url = new URL(request.url);
    const list = await currentTemplates(env, photographer.id);
    const tpl = list.find((t) => t.family === url.searchParams.get("family")) || list[0];
    const lang = lang3(url.searchParams.get("lang") || ev.language);
    const sample = { role: url.searchParams.get("role") || "press", name: T(lang, "Nom du destinataire", "Recipient name", "Naam van de ontvanger"), organisation: T(lang, "Média", "Media outlet", "Medium"), email: "" };
    return json({ text: licenceText(tpl, licenceCtx(ev, sample, photographer), lang) });
  }
  return fail(404, "Route inconnue");
}

/* ---------- Routes publiques ---------- */

async function recipientFromRequest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = await verifyToken(tokenSecret(env), token);
  if (!payload || payload.typ !== "press") return { error: fail(401, "Lien invalide ou expiré : demandez un nouveau lien au studio") };
  const r = await env.DB.prepare("SELECT * FROM press_recipients WHERE id = ? AND gallery_id = ?").bind(payload.r, payload.g).first();
  if (!r || r.revoked_at || r.status !== "active") return { error: fail(403, "Cet accès a été retiré par le studio") };
  const ev = await loadEvent(env, r.gallery_id);
  if (!ev) return { error: fail(404, "Salle de presse introuvable") };
  return { r, ev };
}

async function activeLicence(env, r) {
  const l = await env.DB.prepare("SELECT * FROM press_licences WHERE recipient_id = ? ORDER BY accepted_at DESC LIMIT 1").bind(r.id).first();
  if (!l) return null;
  return l;
}

function licenceCtx(ev, r, photographer) {
  const studio = studioLabel(photographer);
  return {
    studio, studioEmail: photographer.email, licensee: r.organisation ? `${r.organisation}${r.name ? ` (${r.name})` : ""}` : r.name || r.email,
    title: ev.title, eventDate: ev.event_date, venue: ev.venue, city: ev.city, credit: creditOf(ev, studio),
    embargoAt: VALIDATING_ROLES.includes(r.role) ? null : ev.embargo_at, aiReservation: Boolean(ev.ai_reservation),
  };
}

function publicPhoto(ev, tpl, p, canValidate) {
  const block = tpl ? downloadBlock(ev, tpl, p) : "licence";
  return {
    id: p.id, width: p.width, height: p.height, cols: p.cols, rows: p.rows, preview_width: p.preview_width, preview_height: p.preview_height,
    headline: p.headline || "", caption: p.caption || "", byline: p.byline || "", keywords: p.keywords || "", people: p.people,
    status: p.status, ...(canValidate ? { note: p.note || "" } : {}), hdName: p.hd_name || "", hdSize: p.hd_size || 0, block,
  };
}

async function me(request, env) {
  const { r, ev, error } = await recipientFromRequest(request, env);
  if (error) return error;
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(ev.photographer_id).first();
  await env.DB.prepare("UPDATE press_recipients SET last_seen_at = ? WHERE id = ?").bind(now(), r.id).run();
  const lang = lang3(new URL(request.url).searchParams.get("lang") || r.lang);
  const tpl = await templateForRecipient(env, photographer.id, r);
  const ctx = licenceCtx(ev, r, photographer);
  const text = licenceText(tpl, ctx, lang);
  const lic = await activeLicence(env, r);
  const expired = Boolean(lic?.expires_at && lic.expires_at < now());
  const current = lic && lic.template_id === tpl.id && !expired;
  const canValidate = VALIDATING_ROLES.includes(r.role) && Boolean(ev.approval_required) && !ev.closed_at;
  const photos = await eventPhotos(env, ev.gallery_id);
  const visible = visibleFor(ev, r, photos);
  const state = eventState(ev);
  const studio = studioLabel(photographer);
  return json({
    recipient: { id: r.id, role: r.role, name: r.name, organisation: r.organisation, email: r.email, lang: r.lang },
    studio: { name: studio, email: photographer.email },
    event: { ...eventOut(ev, lang), embargoed: embargoed(ev, r), credit: creditOf(ev, studio) },
    state, open: Boolean(visible), canValidate,
    licence: {
      kind: tpl.kind, name: tpl.name, version: tpl.version, text, sha256: await sha256Hex(text),
      accepted: lic ? { id: lic.id, acceptedAt: lic.accepted_at, signerName: lic.signer_name, expiresAt: lic.expires_at, kind: lic.kind, current } : null,
      expired, needed: !current,
    },
    photos: visible ? visible.map((p) => publicPhoto(ev, current ? tpl : null, p, canValidate)) : [],
    counts: {
      total: photos.length,
      approved: photos.filter((p) => p.status === "approved").length,
      pending: photos.filter((p) => p.status === "pending").length,
      rejected: photos.filter((p) => p.status === "rejected").length,
    },
  });
}

async function acceptLicence(request, env) {
  const { r, ev, error } = await recipientFromRequest(request, env);
  if (error) return error;
  if (ev.closed_at) return fail(409, "Cette salle de presse est fermée");
  const body = await request.json().catch(() => ({}));
  const signer = str(body.name, 120);
  if (signer.length < 2) return fail(400, "Indiquez votre nom pour accepter la licence");
  if (body.accept !== true) return fail(400, "Cochez la case d'acceptation");
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(ev.photographer_id).first();
  const lang = lang3(body.lang || r.lang);
  const tpl = await templateForRecipient(env, photographer.id, r);
  const text = licenceText(tpl, licenceCtx(ev, r, photographer), lang);
  const sha = await sha256Hex(text);
  // Le texte affiché doit être celui qu'on enregistre : si le studio a changé
  // le modèle entre-temps, la page recharge le nouveau texte.
  if (body.sha256 && body.sha256 !== sha) return fail(409, "La licence vient d'être mise à jour par le studio : relisez-la avant d'accepter");
  const t = now();
  const id = newId("lic");
  const expires = tpl.duration_months ? t + tpl.duration_months * 30 * 86400 : null;
  await env.DB.prepare(
    `INSERT INTO press_licences (id, gallery_id, photographer_id, recipient_id, template_id, kind, lang, text, text_sha256, signer_name, signer_email, organisation, ip_hash, user_agent, expires_at, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, ev.gallery_id, photographer.id, r.id, tpl.id, tpl.kind, lang, text, sha, signer, r.email, r.organisation,
    await ipHashOf(request, env), str(request.headers.get("user-agent"), 300), expires, t).run();
  return json({ ok: true, id, acceptedAt: t, expiresAt: expires, sha256: sha });
}

async function decide(request, env) {
  const { r, ev, error } = await recipientFromRequest(request, env);
  if (error) return error;
  if (!VALIDATING_ROLES.includes(r.role) || !ev.approval_required) return fail(403, "La validation est réservée au commanditaire et à l'artiste");
  if (ev.closed_at) return fail(409, "Cette salle de presse est fermée");
  if (!ev.review_opened_at && !ev.published_at) return fail(403, "La salle de presse n'est pas encore ouverte");
  const body = await request.json().catch(() => ({}));
  if (!["approved", "rejected", "pending"].includes(body.status)) return fail(400, "Statut inconnu");
  const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 2000).map(String);
  const { patch } = photoPatch({ status: body.status, note: body.note, decidedBy: r.id });
  let n = 0;
  for (const id of ids) {
    if (!(await ensurePressPhoto(env, ev, id))) continue;
    await applyPatch(env, id, patch);
    n++;
  }
  return json({ ok: true, updated: n });
}

async function tile(request, env, rest) {
  const { r, ev, error } = await recipientFromRequest(request, env);
  if (error) return error;
  const [photoId, level, col, row] = rest.map((x) => decodeURIComponent(x));
  if (!/^[01]$/.test(level) || !/^\d{1,2}$/.test(col) || !/^\d{1,2}$/.test(row)) return fail(400, "Tuile invalide");
  const photos = await env.DB.prepare(
    `SELECT p.id, pp.status, pp.tags, pp.people FROM photos p LEFT JOIN press_photos pp ON pp.photo_id = p.id WHERE p.id = ? AND p.gallery_id = ?`
  ).bind(photoId, ev.gallery_id).all();
  const list = (photos.results || []).map((p) => ({ ...p, status: p.status || "pending", tags: p.tags || "" }));
  const visible = visibleFor(ev, r, list);
  if (!visible || !visible.length) return fail(404, "Photo introuvable");
  const object = await env.TILES.get(`${ev.gallery_id}/${photoId}/${level}/${col}_${row}.jpg`);
  if (!object) return fail(404, "Tuile introuvable");
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
}

// Ce que ce destinataire peut télécharger maintenant, avec sa licence.
async function downloadable(env, r, ev) {
  if (ev.closed_at) return { error: fail(409, "Cette salle de presse est fermée : plus aucun téléchargement") };
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(ev.photographer_id).first();
  const tpl = await templateForRecipient(env, photographer.id, r);
  const lic = await activeLicence(env, r);
  if (!lic || lic.template_id !== tpl.id || (lic.expires_at && lic.expires_at < now())) return { error: fail(403, "Acceptez la licence avant de télécharger") };
  const photos = visibleFor(ev, r, await eventPhotos(env, ev.gallery_id));
  if (!photos) return { error: fail(403, embargoed(ev, r) ? "Embargo en cours" : "La salle de presse n'est pas encore ouverte") };
  return { photographer, tpl, lic, photos: photos.filter((p) => !downloadBlock(ev, tpl, p)) };
}

function stampMeta(ev, r, photographer, tpl, lic, p) {
  const studio = studioLabel(photographer);
  const ctx = licenceCtx(ev, r, photographer);
  const lang = lang3(lic.lang || r.lang);
  const year = (ev.event_date || "").slice(0, 4) || String(new Date().getUTCFullYear());
  return {
    credit: ctx.credit, byline: p.byline || studio, copyright: `© ${year} ${studio}`,
    headline: p.headline || ev.title, caption: p.caption, keywords: String(p.keywords || "").split(",").map((k) => k.trim()).filter(Boolean),
    city: ev.city, dateCreated: ev.event_date,
    usageTerms: usageSummary(tpl, lic, ctx, lang),
    instructions: ctx.embargoAt ? T(lang, `Embargo jusqu'au ${dateLabel(ctx.embargoAt, lang, true)}`, `Embargo until ${dateLabel(ctx.embargoAt, lang, true)}`, `Embargo tot ${dateLabel(ctx.embargoAt, lang, true)}`) : "",
    licensor: studio, licensorEmail: photographer.email, licensee: ctx.licensee, licenseeId: r.id,
    licenceId: lic.id, licenceDate: new Date(lic.accepted_at * 1000).toISOString().slice(0, 10), aiReservation: Boolean(ev.ai_reservation),
  };
}

function fileNameOf(p, i) {
  const base = safeFileName(p.hd_name || `${p.id}.jpg`);
  return base || `photo-${i + 1}.jpg`;
}

const AI_HEADERS = { "x-robots-tag": "noai, noimageai", "tdm-reservation": "1" };

function disposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function readAll(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Morceaux d'un fichier livré : en-tête réécrit (si JPEG relevé), puis la suite.
async function fileParts(env, ev, p, segment) {
  const key = `${ev.gallery_id}/${p.id}/hd`;
  if (!canStamp(p)) {
    const object = await env.TILES.get(key);
    if (!object) throw new Error("Fichier HD manquant");
    return { size: object.size, streams: [object.body] };
  }
  const headObj = await env.TILES.get(key, { range: { offset: 0, length: p.head_end } });
  if (!headObj) throw new Error("Fichier HD manquant");
  const head = await readAll(headObj.body);
  const newHead = stampHead(head, p, segment);
  const tail = await env.TILES.get(key, { range: { offset: p.head_end } });
  if (!tail) throw new Error("Fichier HD manquant");
  return { size: newHead.length + (p.hd_size - p.head_end), head: newHead, crc: stampedCrc(newHead, p), streams: [newHead, tail.body] };
}

async function pipeInto(writer, part) {
  if (part instanceof Uint8Array) {
    await writer.write(part);
    return;
  }
  const reader = part.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    await writer.write(value);
  }
}

// Répartit les photos en ZIP de moins de 3,5 Go (limite du ZIP classique).
function zipParts(items) {
  const parts = [[]];
  let size = 0;
  for (const it of items) {
    const cost = it.size + 120 + it.name.length * 2;
    if (size + cost > ZIP_PART_BYTES && parts[parts.length - 1].length) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(it);
    size += cost;
  }
  return parts;
}

async function createLink(request, env) {
  const { r, ev, error } = await recipientFromRequest(request, env);
  if (error) return error;
  const ok = await downloadable(env, r, ev);
  if (ok.error) return ok.error;
  const body = await request.json().catch(() => ({}));
  // Même adresse que celle utilisée par la page (site principal, adresse
  // d'un studio, ou poste local).
  const origin = new URL(request.url).origin || apiOrigin(env);
  if (body.photo) {
    if (!ok.photos.some((p) => p.id === body.photo)) return fail(403, "Cette photo n'est pas téléchargeable avec votre licence");
    const token = await signToken(linkSecret(env), { typ: "pdl", r: r.id, p: String(body.photo), exp: now() + LINK_TTL });
    return json({ urls: [`${origin}/api/press/dl/${encodeURIComponent(token)}`] });
  }
  if (!ok.photos.length) return fail(404, "Aucune photo téléchargeable pour le moment");
  const items = ok.photos.map((p, i) => ({ id: p.id, name: fileNameOf(p, i), size: p.hd_size }));
  const parts = zipParts(items);
  const urls = [];
  for (let i = 0; i < parts.length; i++) {
    const token = await signToken(linkSecret(env), { typ: "pdl", r: r.id, all: 1, part: i, parts: parts.length, exp: now() + LINK_TTL });
    urls.push(`${origin}/api/press/dl/${encodeURIComponent(token)}`);
  }
  return json({ urls, count: ok.photos.length });
}

async function logDownloads(env, request, ev, r, lic, rows, batch) {
  const ip = await ipHashOf(request, env);
  const t = now();
  for (const row of rows) {
    await env.DB.prepare(
      "INSERT INTO press_downloads (id, gallery_id, recipient_id, photo_id, licence_id, batch, bytes, ip_hash, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(newId("pdl"), ev.gallery_id, r.id, row.id, lic.id, batch, row.size, ip, t).run();
  }
}

async function download(request, env, ctx, token) {
  const payload = await verifyToken(linkSecret(env), token);
  if (!payload || payload.typ !== "pdl") return fail(403, "Lien expiré : relancez le téléchargement depuis la salle de presse");
  const r = await env.DB.prepare("SELECT * FROM press_recipients WHERE id = ?").bind(payload.r).first();
  if (!r || r.revoked_at || r.status !== "active") return fail(403, "Cet accès a été retiré par le studio");
  const ev = await loadEvent(env, r.gallery_id);
  if (!ev) return fail(404, "Salle de presse introuvable");
  const ok = await downloadable(env, r, ev);
  if (ok.error) return ok.error;
  const { photographer, tpl, lic } = ok;

  if (payload.p) {
    const p = ok.photos.find((x) => x.id === payload.p);
    if (!p) return fail(403, "Cette photo n'est plus téléchargeable");
    const segment = xmpSegment(stampMeta(ev, r, photographer, tpl, lic, p));
    const parts = await fileParts(env, ev, p, segment);
    const { readable, writable } = typeof FixedLengthStream !== "undefined" ? new FixedLengthStream(parts.size) : new TransformStream();
    const writer = writable.getWriter();
    const pump = (async () => {
      try {
        for (const s of parts.streams) await pipeInto(writer, s);
        await writer.close();
      } catch (err) {
        await writer.abort(err).catch(() => {});
      }
    })();
    ctx?.waitUntil?.(pump);
    await logDownloads(env, request, ev, r, lic, [{ id: p.id, size: parts.size }], "");
    return new Response(readable, {
      headers: { "content-type": p.hd_type || "image/jpeg", "content-length": String(parts.size), "content-disposition": disposition(fileNameOf(p, 0)), "cache-control": "private, no-store", ...AI_HEADERS },
    });
  }

  // ZIP (éventuellement en plusieurs parties).
  const names = uniqueNames(ok.photos.map((p, i) => fileNameOf(p, i)));
  const all = ok.photos.map((p, i) => {
    const segment = xmpSegment(stampMeta(ev, r, photographer, tpl, lic, p));
    return { p, segment, name: names[i], size: stampedSize(p, segment) };
  });
  const parts = zipParts(all);
  const part = parts[payload.part || 0];
  if (!part) return fail(404, "Partie introuvable");
  const enc = new TextEncoder();
  const date = new Date();
  let total = 22;
  for (const it of part) {
    const n = enc.encode(it.name).length;
    total += 30 + n + it.size + 46 + n;
  }
  const { readable, writable } = typeof FixedLengthStream !== "undefined" ? new FixedLengthStream(total) : new TransformStream();
  const writer = writable.getWriter();
  const pump = (async () => {
    try {
      const central = [];
      let offset = 0;
      for (const it of part) {
        const fp = await fileParts(env, ev, it.p, it.segment);
        let crc = fp.crc;
        if (crc === undefined) {
          // Fichier gardé tel quel (PNG, TIFF…) : CRC du fichier entier,
          // relevé à l'envoi ; à défaut, on le calcule en le lisant.
          if (!it.p.head_end && it.p.tail_crc) crc = it.p.tail_crc >>> 0;
          else {
            const obj = await env.TILES.get(`${ev.gallery_id}/${it.p.id}/hd`);
            const bytes = await readAll(obj.body);
            crc = crc32(bytes);
            fp.streams = [bytes];
          }
        }
        const entry = { name: it.name, size: fp.size, crc32: crc, date };
        const local = localFileHeader(entry);
        await writer.write(local);
        for (const s of fp.streams) await pipeInto(writer, s);
        central.push(centralDirectoryHeader(entry, offset));
        offset += local.length + fp.size;
      }
      let cdSize = 0;
      for (const c of central) {
        await writer.write(c);
        cdSize += c.length;
      }
      await writer.write(endOfCentralDirectory(central.length, cdSize, offset));
      await writer.close();
    } catch (err) {
      console.error("ZIP presse interrompu :", err && err.message);
      await writer.abort(err).catch(() => {});
    }
  })();
  ctx?.waitUntil?.(pump);
  const batch = newId("zip");
  await logDownloads(env, request, ev, r, lic, part.map((it) => ({ id: it.p.id, size: it.size })), batch);
  const base = (ev.title || ev.slug).replace(/[\\/:*?"<>|]+/g, " ").trim() || "photos";
  const fileName = parts.length > 1 ? `${base} (${(payload.part || 0) + 1}-${parts.length}).zip` : `${base}.zip`;
  return new Response(readable, {
    headers: { "content-type": "application/zip", "content-length": String(total), "content-disposition": disposition(fileName), "cache-control": "private, no-store", ...AI_HEADERS },
  });
}

// Page publique d'un événement (demande d'accréditation).
async function publicEvent(env, slug) {
  const row = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ? AND kind = 'press'").bind(slug).first();
  const ev = row ? await loadEvent(env, row.id) : null;
  if (!ev || !ev.accreditation_open || ev.closed_at) return null;
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(ev.photographer_id).first();
  return { ev, photographer };
}

async function requestAccreditation(request, env, slug) {
  const found = await publicEvent(env, slug);
  if (!found) return fail(404, "Les demandes d'accréditation sont fermées pour cet événement");
  const { ev, photographer } = found;
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true }); // pot de miel
  const name = str(body.name, 120);
  const organisation = str(body.organisation, 160);
  const email = normEmail(body.email || "");
  if (name.length < 2 || organisation.length < 2) return fail(400, "Indiquez votre nom et votre média");
  if (!isEmail(email)) return fail(400, "Adresse e-mail invalide");
  const ip = await ipHashOf(request, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM press_recipients WHERE gallery_id = ? AND ip_hash = ? AND created_at > ?").bind(ev.gallery_id, ip, now() - 3600).first();
  if ((recent?.n || 0) >= 5) return fail(429, "Trop de demandes : réessayez dans une heure");
  const dup = await env.DB.prepare("SELECT id, status FROM press_recipients WHERE gallery_id = ? AND email = ? AND revoked_at IS NULL").bind(ev.gallery_id, email).first();
  if (dup) return json({ ok: true, already: true });
  const templates = await currentTemplates(env, photographer.id);
  await env.DB.prepare(
    `INSERT INTO press_recipients (id, gallery_id, photographer_id, role, name, organisation, email, lang, template_family, press_card, message, status, source, ip_hash, created_at)
     VALUES (?, ?, ?, 'press', ?, ?, ?, ?, ?, ?, ?, 'pending', 'accreditation', ?, ?)`
  ).bind(newId("prc"), ev.gallery_id, photographer.id, name, organisation, email, lang3(body.lang), templates.find((t) => t.kind === "editorial")?.family || "",
    str(body.pressCard, 60), str(body.message, 600), ip, now()).run();
  return json({ ok: true }, { status: 201 });
}

export async function handlePressPublic(request, env, ctx, path) {
  const parts = path.split("/").slice(3); // /api/press/…
  const method = request.method;
  if (parts[0] === "me" && !parts[1] && method === "GET") return me(request, env);
  if (parts[0] === "me" && parts[1] === "licence" && method === "POST") return acceptLicence(request, env);
  if (parts[0] === "me" && parts[1] === "decide" && method === "POST") return decide(request, env);
  if (parts[0] === "me" && parts[1] === "link" && method === "POST") return createLink(request, env);
  if (parts[0] === "tile" && parts.length === 5 && method === "GET") return tile(request, env, parts.slice(1));
  if (parts[0] === "dl" && parts[1] && method === "GET") return download(request, env, ctx, decodeURIComponent(parts[1]));
  if (parts[0] === "event" && parts[1]) {
    const slug = decodeURIComponent(parts[1]);
    if (!parts[2] && method === "GET") {
      const found = await publicEvent(env, slug);
      if (!found) return fail(404, "Les demandes d'accréditation sont fermées pour cet événement");
      const { ev, photographer } = found;
      const lang = lang3(new URL(request.url).searchParams.get("lang") || ev.language);
      return json({ event: { ...eventOut(ev, lang), credit: creditOf(ev, studioLabel(photographer)) }, studio: { name: studioLabel(photographer) } });
    }
    if (parts[2] === "accreditation" && method === "POST") return requestAccreditation(request, env, slug);
  }
  return fail(404, "Route inconnue");
}
