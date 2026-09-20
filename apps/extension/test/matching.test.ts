import { describe, expect, it } from "vitest";
import type { RatingCandidate } from "@milujufilmy/contracts";
import { bestCandidate } from "../src/matching.js";

const candidate = (title: string, year: number): RatingCandidate => ({
  source: "imdb", sourceId: `tt-${title}`, sourceUrl: "https://www.imdb.com/title/tt1/",
  canonicalTitle: title, year, kind: "movie", evidence: [],
});

describe("candidate matching", () => {
  it("prefers the title and year match and marks uncertain results", () => {
    const result = bestCandidate("Duna: Část druhá", 2024, [candidate("Duna Část druhá", 2024), candidate("Duna", 2021)]);
    expect(result?.candidate.year).toBe(2024);
    expect(result?.uncertain).toBe(false);
  });

  it("uses a candidate's original title when the canonical title is translated", () => {
    const translated = { ...candidate("The Last Deadly Mission", 2008), originalTitle: "MR 73" };
    const result = bestCandidate("Mr 73", 2008, [translated]);
    expect(result?.confidence).toBe(1);
    expect(result?.uncertain).toBe(false);
  });
});
