// Client HTTP vers l'API d'administration du Worker. Utilisé par la CLI
// (prepare.mjs, detect.mjs) et par le serveur d'admin local — jamais par le
// navigateur : le jeton d'administration ne doit circuler que côté serveur.

export class WorkerClient {
  constructor({ api, adminToken }) {
    if (!api) throw new Error("URL de l'API manquante (GALERIE_API)");
    if (!adminToken) throw new Error("Jeton d'administration manquant (GALERIE_ADMIN_TOKEN)");
    this.base = api.replace(/\/$/, "");
    this.adminToken = adminToken;
  }

  async request(method, path, body, raw = false) {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.adminToken}`,
        ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}),
      },
      body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
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
    const response = await fetch(`${this.base}/api/admin/tiles/${photoId}/${level}/${col}/${row}`, {
      headers: { authorization: `Bearer ${this.adminToken}` },
    });
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
