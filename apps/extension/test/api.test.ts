import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedTitle } from "@milujufilmy/contracts";
import { fakeBrowser } from "wxt/testing";
import { lookupBatch, saveCsfdUrl, saveOverride } from "../src/api.js";

const sampleTitle: DetectedTitle = {
  requestId: "req-1",
  provider: "netflix",
  title: "Test Film",
  kind: "movie",
  locale: "cs-CZ",
};

describe("extension API client", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when pairing token is missing", async () => {
    await expect(lookupBatch([sampleTitle])).rejects.toThrow("Nejdřív vložte párovací token v nastavení rozšíření.");
  });

  it("throws pairing token invalid message on 401", async () => {
    await fakeBrowser.storage.local.set({ settings: { token: "invalid-token" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    await expect(lookupBatch([sampleTitle])).rejects.toThrow("Párovací token není platný.");
  });

  it("surfaces validation error message on 400", async () => {
    await fakeBrowser.storage.local.set({ settings: { token: "valid-token" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { fieldErrors: { items: ["Episode requires season and episode"] } } }), { status: 400 }),
    );
    await expect(lookupBatch([sampleTitle])).rejects.toThrow("Chyba dat: Episode requires season and episode");
  });

  it("throws backend unavailable on server 500 without specific error message", async () => {
    await fakeBrowser.storage.local.set({ settings: { token: "valid-token" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Internal error", { status: 500 }));
    await expect(lookupBatch([sampleTitle])).rejects.toThrow("Lokální backend není dostupný.");
  });
});
