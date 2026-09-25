import { describe, it, expect } from "vitest";
import { createSwellClient } from "../helpers/swell-client";

// Read-only checks against the logged-in test store (uses swell-cli auth).
describe("store data the app depends on", () => {
  const swell = createSwellClient();

  it("reads the store weight unit used for parcel weights", async () => {
    const shipments = await swell.get("/settings/shipments");
    expect(["g", "kg", "oz", "lb", undefined]).toContain(shipments?.weight_unit);
  });

  it("reads the app settings", async () => {
    const settings = await swell.settings("sendcloud");
    expect(settings).toBeTypeOf("object");
  });
});
