import { describe, expect, it } from "vitest";
import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";
import { createApp } from "../src/app.js";

const title: DetectedTitle = {
  requestId: "one",
  provider: "netflix",
  providerContentId: "42",
  title: "Oppenheimer",
  year: 2023,
  kind: "movie",
  locale: "cs-CZ",
};

const candidate: RatingCandidate = {
  source: "imdb",
  sourceId: "tt15398776",
  sourceUrl: "https://www.imdb.com/title/tt15398776/",
  canonicalTitle: "Oppenheimer",
  year: 2023,
  kind: "movie",
  rating: { value: 8.3, scale: 10, votes: 100, fetchedAt: "2026-09-17T00:00:00.000Z" },
  evidence: ["exact-title"],
};

describe("local API", () => {
  it("rejects a lookup without the pairing token", async () => {
    const app = createApp({ token: "secret", lookup: async () => [candidate] });
    const response = await app.inject({ method: "POST", url: "/v1/lookup/batch", payload: { items: [title] } });
    expect(response.statusCode).toBe(401);
  });

  it("returns candidates for an authorized batch", async () => {
    const app = createApp({ token: "secret", lookup: async () => [candidate] });
    const response = await app.inject({
      method: "POST",
      url: "/v1/lookup/batch",
      headers: { authorization: "Bearer secret", "x-milujufilmy-client": "extension" },
      payload: { items: [title] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].candidates[0].sourceId).toBe("tt15398776");
  });

  it("persists an authorized manual correction", async () => {
    let saved: { requestId: string; sourceId: string } | undefined;
    const app = createApp({
      token: "secret",
      lookup: async () => [],
      saveOverride: async (detected, selected) => { saved = { requestId: detected.requestId, sourceId: selected.sourceId }; },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/matches/override",
      headers: { authorization: "Bearer secret", "x-milujufilmy-client": "extension" },
      payload: { detected: title, selected: candidate },
    });
    expect(response.statusCode).toBe(200);
    expect(saved).toEqual({ requestId: "one", sourceId: "tt15398776" });
  });
});
