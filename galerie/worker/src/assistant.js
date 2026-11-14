// Lumi, l'assistante de l'espace photographe : répond aux questions sur
// Holypixx (fonctions, configuration, marche à suivre), avec Claude.
//
//   Photographe   GET  /api/admin/assistant          disponible ? messages restants ? voix ?
//                 POST /api/admin/assistant          { messages: [{ role, content }] } → { reply }
//                 POST /api/admin/assistant/listen   audio enregistré → { text } (Whisper)
//                 POST /api/admin/assistant/speak    { text } → audio MP3 (MeloTTS, français)
//
// La conversation vit dans le navigateur : chaque question renvoie les
// derniers échanges (rien n'est enregistré ici, à part un compteur par jour).
// Le guide produit (assistantGuide.js) est figé et mis en cache par l'API ;
// le contexte du compte (formule, ce qui est déjà configuré) vient après,
// pour que Lumi propose la prochaine étape utile.
//
// Clé : secret ANTHROPIC_API_KEY du Worker (npx wrangler secret put
// ANTHROPIC_API_KEY). Sans clé, Lumi ne s'affiche pas. Modèle : variable
// ASSISTANT_MODEL (claude-opus-5-5 par défaut).

import Anthropic from "@anthropic-ai/sdk";
import { json, fail } from "./http.js";
import { planFor, hasFeature } from "./subscription.js";
import { displayName } from "./portfolio.js";
import { ASSISTANT_GUIDE } from "./assistantGuide.js";

export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";
// Messages par photographe et par jour : de quoi se faire guider largement,
// sans qu'une boucle (ou un abus) ne fasse exploser la facture.
export const ASSISTANT_DAILY_LIMIT = 40;
const MAX_TURNS = 16;
const MAX_MESSAGE_CHARS = 2000;
// Modèles qui acceptent le repli côté serveur en cas de refus (voir
// la documentation « refusals and fallback ») ; les autres s'en passent.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5"]);

function now() {
  return Math.floor(Date.now() / 1000);
}

function dayOf(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/* ---------- La voix de Lumi (Workers AI) ---------- */

// Écouter et parler : 120 fois par jour et par photographe au plus.
export const VOICE_DAILY_LIMIT = 120;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024; // ~ 1 minute de parole
const MAX_SPEAK_CHARS = 1200;
export const LISTEN_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const SPEAK_MODEL = "@cf/myshell-ai/melotts";

export function voiceEnabled(env) {
  return Boolean(env.AI && typeof env.AI.run === "function");
}

// Ce que Lumi dit à voix haute : sa réponse sans la mise en forme (gras,
// boutons d'onglet, puces), en phrases.
export function speakableText(text) {
  return String(text || "")
    .replace(/\[\[[a-z-]+\]\]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1. ")
    .replace(/[«»"“”]/g, "")
    .replace(/→/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_SPEAK_CHARS);
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function claimVoice(env, photographerId, day) {
  return env.DB.prepare(
    `INSERT INTO assistant_usage (photographer_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(photographer_id, day) DO UPDATE SET count = count + 1 WHERE count < ?
     RETURNING count`
  ).bind(photographerId, `${day}#voix`, VOICE_DAILY_LIMIT).first();
}

async function listen(request, env, photographer, day) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 800) return fail(400, "Je n'ai rien entendu : réessayez en parlant un peu plus longtemps.");
  if (bytes.length > MAX_AUDIO_BYTES) return fail(413, "Message trop long : une minute au plus.");
  if (!(await claimVoice(env, photographer.id, day))) return fail(429, "La voix de Lumi se repose jusqu'à demain : écrivez-lui votre question.");
  try {
    const result = await env.AI.run(LISTEN_MODEL, { audio: toBase64(bytes), language: "fr", task: "transcribe", vad_filter: true });
    const text = String(result?.text || "").trim();
    if (!text) return fail(422, "Je n'ai pas compris : réessayez, ou écrivez votre question.");
    return json({ text: text.slice(0, MAX_MESSAGE_CHARS) });
  } catch (err) {
    console.error("Assistant : transcription impossible :", err?.message || err);
    return fail(502, "Je n'ai pas pu écouter votre message. Réessayez, ou écrivez votre question.");
  }
}

async function speak(request, env, photographer, day) {
  const body = await request.json().catch(() => ({}));
  const text = speakableText(body?.text);
  if (!text) return fail(400, "Rien à lire");
  if (!(await claimVoice(env, photographer.id, day))) return fail(429, "La voix de Lumi se repose jusqu'à demain.");
  try {
    const result = await env.AI.run(SPEAK_MODEL, { prompt: text, lang: "fr" });
    const audio = typeof result?.audio === "string" ? result.audio : "";
    if (!audio) throw new Error("réponse sans audio");
    const binary = atob(audio);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return new Response(out, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (err) {
    console.error("Assistant : voix impossible :", err?.message || err);
    // L'espace photographe lit alors la réponse avec la voix du navigateur.
    return fail(502, "Voix indisponible");
  }
}

export function assistantEnabled(env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

// Historique envoyé par le navigateur : alternance stricte user/assistant,
// qui commence et finit par une question, textes bornés, derniers échanges.
export function readConversation(body) {
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const messages = [];
  for (const m of raw.slice(-MAX_TURNS * 2)) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : "";
    const content = String(m?.content ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_MESSAGE_CHARS);
    if (!role || !content) continue;
    // Deux messages de suite du même côté : on garde le dernier.
    if (messages.length && messages[messages.length - 1].role === role) messages.pop();
    messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return { error: "Posez votre question" };
  return { messages };
}

// Ce que Lumi doit savoir du compte pour guider la suite (aucune donnée de
// client : seulement l'état de la configuration).
async function accountContext(env, photographer) {
  const id = photographer.id;
  const count = async (sql) => (await env.DB.prepare(sql).bind(id).first())?.n || 0;
  const [galleries, photos, offers, slots, templates, clients, portfolio, booking] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM galleries WHERE photographer_id = ? AND kind != 'school' AND demo = 0"),
    count("SELECT COUNT(*) AS n FROM photos p JOIN galleries g ON g.id = p.gallery_id WHERE g.photographer_id = ?"),
    count("SELECT COUNT(*) AS n FROM booking_offers WHERE photographer_id = ?"),
    count(`SELECT COUNT(*) AS n FROM booking_slots WHERE photographer_id = ? AND starts_at > ${now()}`),
    count("SELECT COUNT(*) AS n FROM contract_templates WHERE photographer_id = ?").catch(() => 0),
    count("SELECT COUNT(*) AS n FROM clients WHERE photographer_id = ?"),
    env.DB.prepare("SELECT published, booking_page FROM portfolios WHERE photographer_id = ?").bind(id).first(),
    count("SELECT COUNT(*) AS n FROM bookings WHERE photographer_id = ? AND status = 'confirmed'"),
  ]);
  const plan = planFor(env, photographer);
  const yes = (v) => (v ? "oui" : "non");
  return [
    "# Contexte du compte (à jour, pour adapter tes réponses)",
    `- Studio : ${displayName(photographer) || "(nom non renseigné)"}`,
    `- Formule : ${plan.label}${plan.key === "free" ? " (gratuite)" : ""}`,
    `- Inclus dans sa formule : boutique et suppléments en ligne ${yes(hasFeature(env, photographer, "shop"))}, réservation ${yes(hasFeature(env, photographer, "booking"))}, contrats ${yes(hasFeature(env, photographer, "contracts"))}, campagnes ${yes(hasFeature(env, photographer, "campaigns"))}, adresse à son nom ${yes(hasFeature(env, photographer, "subdomain"))}`,
    `- Paiement en ligne (Stripe) connecté : ${yes(photographer.stripe_account_id && photographer.stripe_charges_enabled)}`,
    `- Galeries créées (hors démo) : ${galleries} ; photos déposées : ${photos}`,
    `- Mini-site publié : ${yes(portfolio?.published)} ; page de réservation seule ouverte : ${yes(portfolio?.booking_page)}`,
    `- Formules de séance : ${offers} ; créneaux à venir : ${slots} ; séances réservées : ${booking}`,
    `- Modèles de contrat : ${templates} ; fiches clients : ${clients}`,
    `- Adresse à son nom réglée : ${yes(photographer.subdomain)}`,
  ].join("\n");
}

async function usageToday(env, photographerId, day) {
  const row = await env.DB.prepare("SELECT count FROM assistant_usage WHERE photographer_id = ? AND day = ?").bind(photographerId, day).first();
  return row?.count || 0;
}

function replyText(response) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export async function handleAssistantAdmin(request, env, photographer, sub = "") {
  const ts = now();
  const day = dayOf(ts);
  if (sub === "listen" || sub === "speak") {
    if (request.method !== "POST") return fail(405, "Méthode non autorisée");
    if (!assistantEnabled(env) || !voiceEnabled(env)) return fail(503, "La voix de Lumi n'est pas encore disponible.");
    return sub === "listen" ? listen(request, env, photographer, day) : speak(request, env, photographer, day);
  }
  if (sub) return fail(404, "Route inconnue");
  if (request.method === "GET") {
    if (!assistantEnabled(env)) return json({ enabled: false });
    const used = await usageToday(env, photographer.id, day);
    return json({ enabled: true, voice: voiceEnabled(env), remaining: Math.max(0, ASSISTANT_DAILY_LIMIT - used), limit: ASSISTANT_DAILY_LIMIT });
  }
  if (request.method !== "POST") return fail(405, "Méthode non autorisée");
  if (!assistantEnabled(env)) return fail(503, "Lumi n'est pas encore disponible.");
  const body = await request.json().catch(() => null);
  const { messages, error } = readConversation(body);
  if (error) return fail(400, error);

  // Compteur posé avant l'appel : deux onglets ne dépassent pas la limite.
  const claim = await env.DB.prepare(
    `INSERT INTO assistant_usage (photographer_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(photographer_id, day) DO UPDATE SET count = count + 1 WHERE count < ?
     RETURNING count`
  ).bind(photographer.id, day, ASSISTANT_DAILY_LIMIT).first();
  if (!claim) return fail(429, `Vous avez posé ${ASSISTANT_DAILY_LIMIT} questions aujourd'hui : Lumi se repose jusqu'à demain. Une urgence ? Écrivez-nous dans l'onglet Suggestions.`);

  const model = env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45000 });
  const params = {
    model,
    max_tokens: 2000,
    // Une aide en ligne : réponses courtes et rapides.
    output_config: { effort: "low" },
    system: [
      // Le guide est identique pour tous : mis en cache (lectures à ~10 % du prix).
      { type: "text", text: ASSISTANT_GUIDE, cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: await accountContext(env, photographer) },
    ],
    messages,
  };
  let response;
  try {
    response = FALLBACK_MODELS.has(model)
      // En cas de refus du modèle, l'API repasse la question à un autre modèle.
      ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await client.messages.create(params);
  } catch (err) {
    // La question n'a pas abouti : elle ne compte pas.
    await env.DB.prepare("UPDATE assistant_usage SET count = MAX(0, count - 1) WHERE photographer_id = ? AND day = ?").bind(photographer.id, day).run();
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
      return fail(503, "Lumi est très demandée en ce moment : réessayez dans un instant.");
    }
    console.error("Assistant : appel impossible :", err?.status, err?.message);
    return fail(502, "Lumi n'a pas pu répondre. Réessayez dans un instant.");
  }

  let reply = replyText(response);
  if (response.stop_reason === "refusal" || !reply) {
    reply = "Je ne peux pas vous aider sur ce point. Pour toute question sur Holypixx, je suis là ; sinon, écrivez à l'équipe dans l'onglet Suggestions [[suggestions]].";
  } else if (response.stop_reason === "max_tokens") {
    reply += "…";
  }
  return json({ reply, remaining: Math.max(0, ASSISTANT_DAILY_LIMIT - claim.count) });
}
