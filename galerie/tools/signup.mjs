#!/usr/bin/env node
// Création d'un compte photographe — à faire une seule fois.
//
//   node signup.mjs --email vous@exemple.com --password "un-mot-de-passe-solide" --studio "Mon Studio"
//
// Affiche l'identifiant du compte créé. Ensuite, prepare.mjs et
// admin-server.mjs s'authentifient avec GALERIE_EMAIL / GALERIE_PASSWORD —
// plus besoin de repasser par ce script.

function parseArgs(argv) {
  const options = { api: process.env.GALERIE_API || "" };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--api": options.api = next(); break;
      case "--email": options.email = next(); break;
      case "--password": options.password = next(); break;
      case "--studio": options.studio = next(); break;
      case "-h": case "--help": options.help = true; break;
      default: throw new Error(`Option inconnue : ${arg}`);
    }
  }
  return options;
}

const USAGE = `
Créer un compte photographe.

  node signup.mjs --email <e-mail> --password <mot-de-passe> [--studio <nom>]

Options
  --api       URL du Worker                (défaut : GALERIE_API)
  --email     adresse e-mail du compte
  --password  mot de passe (10 caractères minimum)
  --studio    nom de votre studio, affiché dans l'interface d'admin
`;

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.email || !options.password) {
    console.log(USAGE);
    process.exit(options.help ? 0 : 1);
  }
  if (!options.api) throw new Error("--api ou GALERIE_API est requis");

  const response = await fetch(`${options.api.replace(/\/$/, "")}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: options.email, password: options.password, studioName: options.studio || "" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Échec (${response.status})`);
  }

  console.log(`Compte créé : ${data.photographer.email} (${data.photographer.id})`);
  console.log(`\nAjoutez à votre configuration :\n`);
  console.log(`  export GALERIE_EMAIL="${data.photographer.email}"`);
  console.log(`  export GALERIE_PASSWORD="…votre mot de passe…"`);
}

main().catch((err) => {
  console.error(`\nÉchec : ${err.message}`);
  process.exit(1);
});
