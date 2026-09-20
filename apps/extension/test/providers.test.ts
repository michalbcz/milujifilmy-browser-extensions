import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { extractVisibleTitles, parseEpisodeLabel, parseOriginalTitleFromText, parseProductionYearFromText, providerForUrl } from "../src/providers.js";

describe("provider registry", () => {
  it.each(["Epizoda 1/8", "Helsinský syndrom - Epizoda 1/8"])("separates the active series from programme cards and ignores unnamed episode %s", (episodeLabel) => {
    const window = new Window({ url: "https://www.ceskatelevize.cz/porady/17338616473-helsinsky-syndrom/" });
    window.document.body.innerHTML = '<script type="application/ld+json">{"@type":"TVSeries","name":"Helsinský syndrom"}</script><main><h1>Helsinský syndrom</h1><a href="/porady/17338616473-helsinsky-syndrom/226388771040001/"><img alt="Epizoda 1/8"></a><a href="/porady/1001879362-strach-nad-mestem/"><img alt="Strach nad městem"></a></main>';
    window.document.querySelector("img")!.alt = episodeLabel;
    for (const card of window.document.querySelectorAll("a")) card.getBoundingClientRect = () => ({ top: 50, left: 0, right: 200, bottom: 200, width: 200, height: 150, x: 0, y: 50, toJSON() {} });
    const url = new URL(window.location.href);
    const titles = extractVisibleTitles(window.document as unknown as Document, url, providerForUrl(url)!);
    expect(titles.map(({ title, kind, pageRole }) => ({ title, kind, pageRole }))).toEqual([
      { title: "Helsinský syndrom", kind: "series", pageRole: "primary" },
      { title: "Strach nad městem", kind: "movie", pageRole: "related" },
    ]);
    expect(titles[1]?.providerContentId).toBe("1001879362-strach-nad-mestem");
  });
  it.each([
    ["https://www.netflix.com/watch/80100172", "netflix"],
    ["https://www.max.com/cz/cs/movies/example", "max"],
    ["https://www.disneyplus.com/movies/example/abc", "disney-plus"],
    ["https://www.primevideo.com/detail/abc", "prime-video"],
    ["https://www.oneplay.cz/porad/example", "oneplay"],
    ["https://www.iprima.cz/serialy/example", "prima-plus"],
    ["https://www.ceskatelevize.cz/ivysilani/123", "ivysilani"],
    ["https://www.stream.cz/porady/example", "stream-cz"],
  ])("recognizes %s", (url, provider) => {
    expect(providerForUrl(new URL(url))?.id).toBe(provider);
  });

  it("parses standard Czech and English episode labels", () => {
    expect(parseEpisodeLabel("S02E05 - Pátý díl")).toEqual({ season: 2, episode: 5 });
    expect(parseEpisodeLabel("Season 3, Episode 11")).toEqual({ season: 3, episode: 11 });
  });

  it("extracts the original film title from an iVysílání description", () => {
    expect(parseOriginalTitleFromText(
      "Originální název filmu Mr\u00a073\u00a0byl zvolen podle typu revolveru Manhurin MR 73.",
    )).toBe("Mr 73");
  });

  it("extracts the production year instead of the online publication date", () => {
    expect(parseProductionYearFromText("Vyrobeno\u00a0 2008  Stopáž 120 min")).toBe(2008);
  });

  it("uses only programme links as iVysílání catalogue cards", () => {
    expect(providerForUrl(new URL("https://www.ceskatelevize.cz/porady/123-test/"))?.cardSelectors)
      .toEqual(["main a[href*='/porady/']", "main [data-testid*='card']"]);
  });
});
