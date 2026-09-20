import { describe, expect, it } from "vitest";
import { detectedTitleSchema, lookupBatchRequestSchema } from "../src/index.js";

describe("lookup contracts", () => {
  it("accepts an episode detected on a supported provider", () => {
    const title = detectedTitleSchema.parse({
      requestId: "request-1",
      provider: "netflix",
      providerContentId: "80100172",
      title: "Perníkový táta",
      originalTitle: "Breaking Bad",
      year: 2008,
      kind: "episode",
      season: 5,
      episode: 14,
      locale: "cs-CZ",
    });

    expect(title.kind).toBe("episode");
    expect(lookupBatchRequestSchema.parse({ items: [title] }).items).toHaveLength(1);
  });

  it("rejects an episode without a season and episode number", () => {
    expect(() =>
      detectedTitleSchema.parse({
        requestId: "request-2",
        provider: "netflix",
        title: "Breaking Bad",
        kind: "episode",
        locale: "en",
      }),
    ).toThrow();
  });
});
