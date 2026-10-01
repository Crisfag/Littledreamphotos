// `fetch` de Node (undici) ignore un en-tête Host fourni à la main : pour
// parler au Worker local « comme depuis julie.holypixx.com », on passe par
// node:http, qui l'envoie tel quel. Renvoie un objet au goût de Response.

import { request as httpRequest } from "node:http";

export function hostFetch(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: {
              get: (k) => (res.headers[k.toLowerCase()] === undefined ? null : String(res.headers[k.toLowerCase()])),
              forEach: (fn) => Object.entries(res.headers).forEach(([k, v]) => fn(String(v), k)),
            },
            text: async () => buf.toString("utf8"),
            json: async () => JSON.parse(buf.toString("utf8")),
            arrayBuffer: async () => buf,
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
