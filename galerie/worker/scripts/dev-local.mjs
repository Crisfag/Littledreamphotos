// Lance le Worker en local pour les tests (`npm run dev:local`).
//
// wrangler.toml déclare la route de production *.holypixx.com : en local,
// wrangler s'en sert pour réécrire l'hôte des requêtes vers holypixx.com,
// ce qui casse les tests (dont ceux des sous-domaines, qui comptent sur
// l'en-tête Host d'origine). On lance donc wrangler avec une copie de la
// configuration sans cette route, régénérée à chaque fois et ignorée par git.
//
//   npm run dev:local                 (port 8788)
//   npm run dev:local -- --port 8787  (arguments passés à wrangler dev)

import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(root, "wrangler.toml"), "utf8").replace(/^routes\s*=\s*\[[\s\S]*?^\]\s*\n/m, "");
const localConfig = join(root, ".wrangler-local.toml");
writeFileSync(localConfig, config);

const extra = process.argv.slice(2);
const args = ["wrangler", "dev", "--config", localConfig, "--local", ...(extra.includes("--port") ? [] : ["--port", "8788"]), ...extra];
const child = spawn("npx", args, { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
