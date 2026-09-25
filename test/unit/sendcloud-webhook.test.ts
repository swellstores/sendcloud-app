import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { post } from "../../functions/sendcloud-webhook";
import { createMockRequest } from "../helpers/mock-request";
import { SETTINGS, hmacHex, makeOrder, routeGet } from "../helpers/fixtures";

const PARCEL = {
  id: 5001,
  order_number: "100003",
  tracking_number: "3SABCD123",
  tracking_url: "https://tracking.example/3SABCD123",
  status: { id: 1000, message: "Ready to send" },
  carrier: { code: "postnl" },
  shipment: { id: 8, name: "PostNL Standard" },
};

async function setup({
  payload = { action: "parcel_status_changed", timestamp: 1000, parcel: PARCEL } as Record<string, any>,
  settings = SETTINGS as Record<string, any>,
  order = makeOrder() as Record<string, any>,
  signatureKey = "sk",
  signature,
}: {
  payload?: Record<string, any>;
  settings?: Record<string, any>;
  order?: Record<string, any>;
  signatureKey?: string;
  signature?: string;
} = {}) {
  const rawBody = JSON.stringify(payload);
  const put = vi.fn().mockResolvedValue({});
  const postFn = vi.fn().mockResolvedValue({ id: "shipment_1" });
  const req = createMockRequest({
    data: payload as any,
    appId: "sendcloud",
    headers: { "sendcloud-signature": signature ?? (await hmacHex(rawBody, signatureKey)) },
    swell: {
      settings: vi.fn().mockResolvedValue({ sendcloud: settings }),
      get: routeGet({ "/orders": { results: [{ id: order.id }] }, [`/orders/${order.id}`]: order }),
      put,
      post: postFn,
    },
  });
  (req as any).rawBody = rawBody;
  return { req, put, post: postFn };
}

describe("sendcloud-webhook", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects requests with an invalid signature", async () => {
    const { req, put } = await setup({ signature: "bad" });
    await expect(post(req)).rejects.toMatchObject({ status: 401 });
    expect(put).not.toHaveBeenCalled();
  });

  it("verifies with the webhook signature key when set", async () => {
    const { req } = await setup({
      settings: { ...SETTINGS, webhook_signature_key: "wsk" },
      signatureKey: "wsk",
    });
    await expect(post(req)).resolves.toMatchObject({ updated: true });
  });

  it("acknowledges other webhook actions", async () => {
    const { req, put } = await setup({ payload: { action: "integration_updated" } });
    await expect(post(req)).resolves.toEqual({ received: true });
    expect(put).not.toHaveBeenCalled();
  });

  it("acknowledges parcels for unknown orders", async () => {
    const { req, put } = await setup();
    (req.swell.get as any).mockImplementation(async () => ({ results: [] }));
    await expect(post(req)).resolves.toEqual({ received: true, order_found: false });
    expect(put).not.toHaveBeenCalled();
  });

  it("stores tracking and creates the Swell shipment once the label exists", async () => {
    const { req, put, post: postFn } = await setup();

    await expect(post(req)).resolves.toEqual({ received: true, order_found: true, updated: true });

    expect(postFn).toHaveBeenCalledWith(
      "/shipments",
      expect.objectContaining({
        order_id: "order_1",
        items: [{ order_item_id: "item_1", product_id: "prod_1", variant_id: undefined, quantity: 2 }],
        carrier: "postnl",
        tracking_code: "3SABCD123",
        service_name: "PostNL Standard",
      }),
    );
    expect(put).toHaveBeenCalledWith("/orders/order_1", {
      $app: {
        sendcloud: {
          sendcloud_parcel_id: 5001,
          sendcloud_status_id: 1000,
          sendcloud_status: "Ready to send",
          sendcloud_tracking_number: "3SABCD123",
          sendcloud_tracking_url: "https://tracking.example/3SABCD123",
          sendcloud_carrier: "postnl",
          sendcloud_status_timestamp: 1000,
          sendcloud_shipment_id: "shipment_1",
        },
      },
    });
  });

  it("does not create a shipment when fulfillment is off or there is no label yet", async () => {
    const off = await setup({ settings: { ...SETTINGS, create_fulfillment: false } });
    await post(off.req);
    expect(off.post).not.toHaveBeenCalled();

    const noLabel = await setup({
      payload: {
        action: "parcel_status_changed",
        parcel: { ...PARCEL, tracking_number: null, status: { id: 999, message: "No label" } },
      },
    });
    await post(noLabel.req);
    expect(noLabel.post).not.toHaveBeenCalled();
  });

  it("skips out-of-order updates", async () => {
    const { req, put } = await setup({
      order: makeOrder({ $app: { sendcloud: { sendcloud_parcel_id: 5001, sendcloud_status_timestamp: 2000 } } }),
    });
    await expect(post(req)).resolves.toMatchObject({ updated: false });
    expect(put).not.toHaveBeenCalled();
  });

  it("ignores a different parcel unless the stored one was canceled", async () => {
    const other = await setup({
      order: makeOrder({ $app: { sendcloud: { sendcloud_parcel_id: 4000, sendcloud_status_id: 1000 } } }),
    });
    await expect(post(other.req)).resolves.toMatchObject({ updated: false });

    const replaced = await setup({
      order: makeOrder({ $app: { sendcloud: { sendcloud_parcel_id: 4000, sendcloud_status_id: 2000 } } }),
    });
    await expect(post(replaced.req)).resolves.toMatchObject({ updated: true });
  });

  it("cancels the Swell shipment when the parcel is canceled", async () => {
    const { req, put, post: postFn } = await setup({
      payload: {
        action: "parcel_status_changed",
        parcel: { ...PARCEL, status: { id: 2000, message: "Cancelled" } },
      },
      order: makeOrder({ $app: { sendcloud: { sendcloud_parcel_id: 5001, sendcloud_shipment_id: "shipment_1" } } }),
    });

    await post(req);

    expect(postFn).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith("/shipments/shipment_1", { canceled: true });
    expect(put).toHaveBeenCalledWith(
      "/orders/order_1",
      expect.objectContaining({
        $app: { sendcloud: expect.objectContaining({ sendcloud_shipment_id: null, sendcloud_status_id: 2000 }) },
      }),
    );
  });
});
