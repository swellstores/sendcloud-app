import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../functions/webhook-url";
import { createMockRequest } from "../helpers/mock-request";

const URL = "https://dev11.swell.store/api/functions/sendcloud/sendcloud-webhook";

function setup(settings: Record<string, any>) {
  const put = vi.fn().mockResolvedValue({});
  const req = createMockRequest({
    appId: "sendcloud",
    store: { id: "dev11" },
    swell: { settings: vi.fn().mockResolvedValue({ sendcloud: settings }), put },
  });
  return { req, put };
}

describe("webhook-url", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the webhook URL into app settings", async () => {
    const { req, put } = setup({});
    await handler(req);
    expect(put).toHaveBeenCalledWith("/settings/sendcloud", { sendcloud: { webhook_url: URL } });
  });

  it("does nothing when the URL is already set", async () => {
    const { req, put } = setup({ webhook_url: URL });
    await handler(req);
    expect(put).not.toHaveBeenCalled();
  });
});
