import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const STATUS_LABELS = Object.freeze({
  submitted: "Новый",
  assembling: "Собирается",
  ready: "Готов к выдаче",
  completed: "Получен",
  cancelled: "Отменён",
});

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function signature(secret, timestamp, method, target, body = "") {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret)
    .update(`${timestamp}\n${method}\n${target}\n${digest}`)
    .digest("hex");
}

export function equalHex(left, right) {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function validateOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("invalid_epharm_origin");
  }
  if (url.protocol !== "https:") throw new Error("epharm_https_required");
  return url.origin;
}

export function parsePharmacyAllowlist(value) {
  const raw = String(value || "").trim();
  if (raw === "*") return { all: true, ids: [] };
  const ids = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!ids.length || ids.some((item) => !/^sloc_[0-9A-Z]{26}$/.test(item))
      || new Set(ids).size !== ids.length) {
    throw new Error("invalid_epharm_pharmacy_allowlist");
  }
  return { all: false, ids };
}

export function exactEpharmPharmacyId(localPharmacyId, catalogPharmacy) {
  if (!catalogPharmacy || catalogPharmacy.id !== localPharmacyId
      || catalogPharmacy.active !== true
      || !/^[1-9][0-9]*$/.test(String(catalogPharmacy.external_id || ""))) {
    throw new Error("unresolved_pharmacy_mapping");
  }
  return `ch:${catalogPharmacy.external_id}`;
}

export function validateOrderAck(ack, orderId) {
  if (!ack || ack.orderId !== orderId || !Number.isInteger(ack.version)
      || ack.version < 1 || ack.assigned !== true) {
    throw new Error("invalid_epharm_ack");
  }
  return ack;
}

export function buildOrder(event, catalog, pharmacyExternalId) {
  const payload = event.payload;
  if (!payload || payload.status_code !== "submitted" || !/^\d{6}$/.test(payload.pickup_code || "")) {
    throw new Error("invalid_order_snapshot");
  }
  const rawDelivery = payload.delivery_method;
  const delivery = ["pickup", "Самовывоз"].includes(rawDelivery)
    ? "pickup"
    : ["courier", "Доставка", "Курьер", "pharmacy"].includes(rawDelivery) ? "pharmacy" : null;
  if (!delivery || !["cash", "card", "kaspi", "halyk"].includes(payload.payment_method)) {
    throw new Error("unsupported_fulfillment_or_payment");
  }
  // Cash on pickup is recorded by ACC as not_required until the pharmacist
  // confirms collection. Epharm expects pending and enforces cashCollected.
  const paymentStatus = payload.payment_method === "cash" && payload.payment_status === "not_required"
    ? "pending" : payload.payment_status;
  if (!["pending", "paid", "demo_no_charge"].includes(paymentStatus)) {
    throw new Error("unsupported_payment_status");
  }
  const lines = (payload.line_items || []).map((line) => {
    const found = catalog.find((item) => item.variant_id === line.variant_id
      && (!line.product_id || item.product_id === line.product_id));
    const title = line.product_title || line.title || found?.title;
    const productId = line.product_id || found?.product_id;
    if (!title || !productId || !Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error("unresolved_order_line");
    }
    const unitPrice = line.unit_price == null ? null : Number(line.unit_price);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0
      || Math.abs(unitPrice * 100 - Math.round(unitPrice * 100)) > 1e-7)) {
      throw new Error("invalid_line_price");
    }
    return {
      productId,
      sku: line.sku || found?.sku || "",
      title,
      quantity: line.quantity,
      unitPrice,
    };
  });
  const total = Number(payload.total_amount);
  const createdAt = new Date(payload.created_at);
  const externalId = String(pharmacyExternalId || payload.pharmacy_external_id || "").trim();
  if (!lines.length || lines.length > 200 || !externalId || !Number.isFinite(total) || total < 0
      || Math.abs(total * 100 - Math.round(total * 100)) > 1e-7 || !Number.isFinite(createdAt.valueOf())) {
    throw new Error("invalid_order_lines_total_or_pharmacy");
  }
  return {
    eventId: event.id,
    orderId: payload.order_id,
    number: String(payload.order_number),
    pharmacyExternalId: externalId,
    createdAt: createdAt.toISOString(),
    total,
    currency: String(payload.currency_code).toUpperCase(),
    delivery,
    paymentMethod: payload.payment_method,
    paymentStatus,
    demo: payload.is_demo === true,
    pickupCode: payload.pickup_code,
    lines,
  };
}

export function validateFeed(feed, after) {
  if (!feed || !Array.isArray(feed.updates) || feed.updates.length > 200
      || !Number.isSafeInteger(feed.nextCursor) || typeof feed.hasMore !== "boolean") {
    throw new Error("invalid_epharm_feed");
  }
  let previous = after;
  for (const item of feed.updates) {
    if (!Number.isSafeInteger(item.cursor) || item.cursor <= previous
        || !Number.isInteger(item.version) || item.version < 1
        || typeof item.orderId !== "string" || !Object.hasOwn(STATUS_LABELS, item.status)) {
      throw new Error("invalid_epharm_event");
    }
    previous = item.cursor;
  }
  if (feed.nextCursor !== previous) throw new Error("invalid_epharm_cursor");
  return feed;
}
