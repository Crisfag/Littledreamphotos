// Faux laboratoire Prodigi pour les tests locaux : reproduit les routes
// v4.0 utilisées (devis, création et relecture de commande) avec le format
// de réponse documenté, sans jamais rien imprimer. Le Worker local y est
// envoyé par PRODIGI_API_BASE (worker/.dev.vars).
//
// Comportements :
//  - clé d'API qui ne commence pas par "test-key" → 401 ;
//  - SKU contenant "INVALID" (ou motif `rejectSku`) → 400 avec un détail
//    d'erreur au format Prodigi ;
//  - sinon : devis 12,50 € + 4,95 € de port, commande créée en "InProgress".

import { createServer } from "node:http";

export async function startFakeProdigi(port = Number(process.env.FAKE_PRODIGI_PORT || 8790), { rejectSku = /INVALID/i } = {}) {
  const orders = new Map(); // id -> commande (format Prodigi)
  const received = [];      // corps des POST /orders, dans l'ordre
  const quotes = [];        // corps des POST /quotes
  let counter = 0;

  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const invalid = (res, property) =>
    send(res, 400, {
      statusCode: 400,
      statusText: "ValidationFailed",
      data: { errors: [{ property, message: "Unknown SKU" }] },
    });

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : null;
    const key = req.headers["x-api-key"] || "";
    if (!String(key).startsWith("test-key")) return send(res, 401, { statusCode: 401, statusText: "Unauthorized" });

    const path = req.url.split("?")[0];
    if (req.method === "POST" && path === "/v4.0/quotes") {
      quotes.push(body);
      const bad = (body.items || []).findIndex((i) => rejectSku.test(i.sku));
      if (bad !== -1) return invalid(res, `items[${bad}].sku`);
      return send(res, 200, {
        outcome: "Created",
        quotes: [{
          shipmentMethod: body.shippingMethod || "Standard",
          costSummary: { items: { amount: "12.50", currency: "EUR" }, shipping: { amount: "4.95", currency: "EUR" } },
          shipments: [],
          items: [],
        }],
      });
    }
    if (req.method === "POST" && path === "/v4.0/orders") {
      received.push({ key, body });
      const bad = (body.items || []).findIndex((i) => /INVALID/i.test(i.sku));
      if (bad !== -1) return invalid(res, `items[${bad}].sku`);
      counter += 1;
      const order = {
        id: `ord_fake_${counter}`,
        merchantReference: body.merchantReference,
        status: { stage: "InProgress", issues: [], details: {} },
        shipments: [],
      };
      orders.set(order.id, order);
      return send(res, 200, { outcome: "Created", order });
    }
    const match = /^\/v4\.0\/orders\/([^/]+)$/.exec(path);
    if (req.method === "GET" && match) {
      const order = orders.get(decodeURIComponent(match[1]));
      if (!order) return send(res, 404, { statusCode: 404, statusText: "NotFound" });
      return send(res, 200, { outcome: "Ok", order });
    }
    send(res, 404, { statusCode: 404, statusText: "NotFound" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    orders,
    received,
    quotes,
    // Simule l'expédition par le labo.
    ship(orderId, trackingUrl) {
      const order = orders.get(orderId);
      order.status.stage = "Complete";
      order.shipments = [{ id: "shp_1", status: "Shipped", tracking: { url: trackingUrl, number: "TRK123" } }];
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
