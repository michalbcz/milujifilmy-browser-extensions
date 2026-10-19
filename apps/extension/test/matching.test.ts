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

  it("trusts an episode candidate with the requested season and episode despite its own episode name", () => {
    const episode = { ...candidate("Fantom z Jižáku", 2014), kind: "episode" as const, season: 1, episode: 2 };
    const wrong = { ...episode, sourceId: "other", season: 1, episode: 3 };
    const result = bestCandidate("Případy 1. oddělení", 2014, [wrong, episode], { season: 1, episode: 2 });
    expect(result?.candidate.sourceId).toBe(episode.sourceId);
    expect(result?.uncertain).toBe(false);
  });

  it("does not doubt an exact title one year off, as production and premiere years often differ", () => {
    expect(bestCandidate("Gerta Schnirch", 2025, [candidate("Gerta Schnirch", 2026)])?.uncertain).toBe(false);
    expect(bestCandidate("Strážce zákona", 2008, [candidate("Strážce zákona", 1971)])?.uncertain).toBe(true);
  });
});
