// Client HTTP vers l'API d'administration du Worker. Utilisé par la CLI
// (prepare.mjs, detect.mjs) et par le serveur d'admin local — jamais par le
// navigateur : les identifiants et le jeton de session ne doivent circuler
// que côté serveur.
//
// S'authentifie par compte photographe (e-mail + mot de passe), pas par un
// jeton unique partagé : chaque compte ne voit et ne modifie que ses propres
// galeries. La connexion se fait à la demande, au premier appel, et se
// renouvelle automatiquement si la session a expiré entre-temps.

export class WorkerClient {
  constructor({ api, email, password }) {
    if (!api) throw new Error("URL de l'API manquante (GALERIE_API)");
    if (!email || !password) throw new Error("Identifiants manquants (GALERIE_EMAIL / GALERIE_PASSWORD)");
    this.base = api.replace(/\/$/, "");
    this.email = email;
    this.password = password;
    this.token = null;
  }

  async login() {
    const response = await fetch(`${this.base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const err = new Error(`Connexion refusée (${response.status}) ${detail}`);
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    this.token = data.token;
    return this.token;
  }

  async request(method, path, body, raw = false) {
    if (!this.token) await this.login();

    const send = () =>
      fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(raw
            ? { "content-type": "application/octet-stream" }
            : body ? { "content-type": "application/json" } : {}),
        },
        body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });

    let response = await send();
    // Session expirée en cours de route (le serveur d'admin peut tourner des
    // heures) : on se reconnecte une fois et on rejoue la requête.
    if (response.status === 401) {
      await this.login();
      response = await send();
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const err = new Error(`${method} ${path} → ${response.status} ${detail}`);
      err.status = response.status;
      err.detail = detail;
      throw err;
    }
    return response.status === 204 ? null : response.json();
  }

  listGalleries() {
    return this.request("GET", "/api/admin/galleries");
  }

  getGallery(slug) {
    return this.request("GET", `/api/admin/galleries/${encodeURIComponent(slug)}`);
  }

  createGallery(data) {
    return this.request("POST", "/api/admin/galleries", data);
  }

  deleteGallery(slug) {
    return this.request("DELETE", `/api/admin/galleries/${encodeURIComponent(slug)}`);
  }

  addPhoto(slug, photo) {
    return this.request("POST", `/api/admin/galleries/${encodeURIComponent(slug)}/photos`, photo);
  }

  deletePhoto(slug, photoId) {
    return this.request("DELETE", `/api/admin/galleries/${encodeURIComponent(slug)}/photos/${encodeURIComponent(photoId)}`);
  }

  putTile(photoId, level, col, row, buffer) {
    return this.request("PUT", `/api/admin/tiles/${photoId}/${level}/${col}/${row}`, buffer, true);
  }

  // Renvoie la réponse brute (pas de JSON) : c'est un flux d'octets JPEG.
  async getTileResponse(photoId, level, col, row) {
    if (!this.token) await this.login();
    let response = await fetch(`${this.base}/api/admin/tiles/${photoId}/${level}/${col}/${row}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) {
      await this.login();
      response = await fetch(`${this.base}/api/admin/tiles/${photoId}/${level}/${col}/${row}`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
    }
    return response;
  }

  galleryLog(slug, limit) {
    const qs = limit ? `?limit=${Number(limit)}` : "";
    return this.request("GET", `/api/admin/galleries/${encodeURIComponent(slug)}/log${qs}`);
  }

  forensicPrints() {
    return this.request("GET", "/api/admin/forensic");
  }
}
