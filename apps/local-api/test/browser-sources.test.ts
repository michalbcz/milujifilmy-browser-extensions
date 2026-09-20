import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSources, isSearchChallenge, parseCsfdSearch } from "../src/browser-sources.js";

afterEach(() => vi.unstubAllGlobals());

describe("source browser parsing", () => {
  it("reports a transport failure and backs off instead of repeating requests", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Network offline"));
    vi.stubGlobal("fetch", fetch);
    const source = new BrowserSources();
    await expect(source.searchCsfd("Test")).rejects.toThrow("Network offline");
    expect(source.status()["www.csfd.cz"]).toMatchObject({ count: 1, error: "Network offline" });
    await expect(source.searchCsfd("Test")).rejects.toThrow("Network offline");
    expect(fetch).toHaveBeenCalledTimes(1);
    await source.close();
  });
  it("distinguishes the series from similarly named episodes in CSFD results", () => {
    const rows = parseCsfdSearch('<div id="series"><h3><a href="/film/1224558-helsinsky-syndrom/prehled/">Helsinský syndrom</a> (2022) (seriál)</h3><h3><a href="/film/1224558-helsinsky-syndrom/1588090-alkuviikko/prehled/">Helsinský syndrom - Alkuviikko</a> (2024) (epizoda)</h3></div>');
    expect(rows).toEqual([
      { url: "https://www.csfd.cz/film/1224558-helsinsky-syndrom/prehled/", title: "Helsinský syndrom", year: 2022, kind: "series" },
      { url: "https://www.csfd.cz/film/1224558-helsinsky-syndrom/1588090-alkuviikko/prehled/", title: "Helsinský syndrom - Alkuviikko", year: 2024, kind: "episode" },
    ]);
  });
  it("recognizes the DDG 202 challenge instead of treating it as an empty result", () => {
    expect(isSearchChallenge(202, '<form id="challenge-form">Unfortunately, bots use DuckDuckGo too.</form>')).toBe(true);
    expect(isSearchChallenge(200, '<a data-testid="result-title-a">Film</a>')).toBe(false);
    expect(isSearchChallenge(200, '<h1>Jejda!</h1>Přístup zamítnut: kód chyby 123.')).toBe(true);
  });
});
