// Suggestions des photographes, sans réseau ni D1 : validation de la
// saisie, e-mail au propriétaire, e-mail de réponse.
//
//   node tests/feedback.test.mjs

import { readFeedback, FEEDBACK_KINDS, FEEDBACK_STATUSES } from "../src/feedback.js";
import { buildFeedbackOwnerEmail, buildFeedbackReplyEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

check("types et statuts connus", FEEDBACK_KINDS.join() === "idea,improvement,problem,other" && FEEDBACK_STATUSES.join() === "new,considering,planned,done,declined");
check("une demande sans titre est refusée", Boolean(readFeedback({ title: "   ", body: "x" }).error));
const ok = readFeedback({ kind: "improvement", title: "  Vidéo dans la galerie  ", body: "Pour les mariages.\nMerci !" });
check("titre et détails nettoyés, type gardé", ok.kind === "improvement" && ok.title === "Vidéo dans la galerie" && ok.body.includes("mariages"), JSON.stringify(ok));
check("type inconnu → idée", readFeedback({ kind: "<script>", title: "t" }).kind === "idea");
check("titre coupé à 120 caractères", readFeedback({ title: "a".repeat(300) }).title.length === 120);

const owner = buildFeedbackOwnerEmail({
  studioName: "Studio <Lumière>", photographerEmail: "julie@example.com", kind: "problem",
  title: "Le <b>bouton</b> ne marche pas", body: "Sur iPhone & iPad", adminUrl: "https://admin.example/#/proprietaire",
});
check("e-mail au propriétaire : type, studio, titre et détails échappés, lien vers l'admin",
      owner.subject.includes("Un souci") && owner.html.includes("Studio &lt;Lumière&gt;") && owner.html.includes("Le &lt;b&gt;bouton&lt;/b&gt;") &&
      owner.html.includes("iPhone &amp; iPad") && owner.html.includes("#/proprietaire") && owner.text.includes("julie@example.com"), owner.subject);

const reply = buildFeedbackReplyEmail({ name: "Julie Martin", title: "Vidéo", status: "planned", reply: "Bonne idée, c'est prévu pour janvier.", adminUrl: "https://admin.example/#/suggestions" });
check("e-mail de réponse : prénom, statut lisible, réponse, lien vers ses suggestions",
      reply.html.includes("Merci Julie") && reply.html.includes("Prévue") && reply.html.includes("prévu pour janvier") && reply.html.includes("#/suggestions") &&
      reply.subject.includes("« Vidéo »"), reply.subject);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
