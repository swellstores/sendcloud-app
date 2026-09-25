import { vi } from "vitest";

export const SETTINGS = {
  public_key: "pk",
  secret_key: "sk",
  integration_id: 626842,
  sync_on: "paid",
  default_weight: 1,
  create_fulfillment: true,
  enabled: true,
};

export function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: "order_1",
    number: "100003",
    status: "delivery_pending",
    paid: true,
    currency: "EUR",
    grand_total: 44.9,
    sub_total: 39.9,
    shipment_total: 5,
    tax_total: 0,
    date_created: "2026-09-24T10:00:00.000Z",
    account: { email: "jan@example.com" },
    shipping: {
      first_name: "Jan",
      last_name: "Jansen",
      address1: "Stationsstraat 12A",
      city: "Eindhoven",
      zip: "5611 AB",
      country: "nl",
      service_name: "Standard",
    },
    items: [
      {
        id: "item_1",
        delivery: "shipment",
        quantity: 2,
        quantity_shipment_deliverable: 2,
        shipment_weight: 3,
        price: 19.95,
        price_total: 39.9,
        product_id: "prod_1",
        product: { name: "Mug", sku: "MUG" },
      },
    ],
    ...overrides,
  };
}

// swell.get mock that answers by path
export function routeGet(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const [prefix, value] of Object.entries(routes)) {
      if (url === prefix || url.startsWith(`${prefix}?`)) {
        return typeof value === "function" ? (value as () => unknown)() : value;
      }
    }
    return null;
  });
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function hmacHex(body: string, key: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
