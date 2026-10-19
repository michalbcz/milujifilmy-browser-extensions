import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { detectedTitleSchema } from "@milujufilmy/contracts";
import { extractVisibleTitles, parseEpisodeLabel, parseOriginalTitleFromText, parseProductionYearFromText, providerForUrl } from "../src/providers.js";

describe("provider registry", () => {
  const visible = (window: Window) => {
    for (const card of window.document.querySelectorAll("a")) card.getBoundingClientRect = () => ({ top: 50, left: 0, right: 200, bottom: 200, width: 200, height: 150, x: 0, y: 50, toJSON() {} });
  };
  const ivysilaniEpisodePage = (path: string, episodeName: string, seriesName: string, genre: string[], main: string) => {
    const window = new Window({ url: `https://www.ceskatelevize.cz/porady/${path}/` });
    window.document.documentElement.lang = "cs";
    const seriesPath = path.split("/")[0];
    window.document.body.innerHTML = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "TVEpisode", url: `https://www.ceskatelevize.cz/porady/${path}/`, name: episodeName, dateCreated: "2026-03-16T21:39:22.000Z",
      partOfTVSeries: { "@type": "TVSeries", url: `https://www.ceskatelevize.cz/porady/${seriesPath}/`, name: seriesName, genre },
    })}</script><main>${main}</main>`;
    visible(window);
    const url = new URL(window.location.href);
    return extractVisibleTitles(window.document as unknown as Document, url, providerForUrl(url)!);
  };

  it("detects the opened iVysílání episode together with its whole series", () => {
    const titles = ivysilaniEpisodePage("10354229723-pripady-1-oddeleni/213512120200002", "2/14 Fantom z Jižáku", "Případy 1. oddělení", ["Seriál", "Krimi seriál"], `
      <h1>2/14 Fantom z Jižáku</h1><p>Vyrobeno 2014</p>
      <a href="/porady/10354229723-pripady-1-oddeleni/213512120200001/"><img alt="Případy 1. oddělení - 1/14 Rozčtvrcená"><p>1/14 Rozčtvrcená</p><p>I.&nbsp;řada</p></a>
      <a href="/porady/10354229723-pripady-1-oddeleni/213512120200002/"><img alt="Případy 1. oddělení - 2/14 Fantom z Jižáku"><p>2/14 Fantom z Jižáku</p><p>I.&nbsp;řada</p></a>
      <a href="/porady/1001879362-strach-nad-mestem/"><img alt="Strach nad městem"></a>`);
    expect(titles.map(({ title, kind, pageRole, season, episode, episodeTitle, year, providerContentId, parentContentId }) => ({ title, kind, pageRole, season, episode, episodeTitle, year, providerContentId, parentContentId }))).toEqual([
      { title: "Případy 1. oddělení", kind: "episode", pageRole: "primary", season: 1, episode: 2, episodeTitle: "Fantom z Jižáku", year: 2014, providerContentId: "213512120200002", parentContentId: "10354229723-pripady-1-oddeleni" },
      { title: "Případy 1. oddělení", kind: "series", pageRole: "primary", season: undefined, episode: undefined, episodeTitle: undefined, year: undefined, providerContentId: "10354229723-pripady-1-oddeleni", parentContentId: undefined },
      { title: "Strach nad městem", kind: "movie", pageRole: "related", season: undefined, episode: undefined, episodeTitle: undefined, year: undefined, providerContentId: "1001879362-strach-nad-mestem", parentContentId: undefined },
    ]);
    for (const title of titles) expect(detectedTitleSchema.safeParse(title).success).toBe(true);
  });

  it("reads a later season from the opened episode's list card", () => {
    const titles = ivysilaniEpisodePage("10354229723-pripady-1-oddeleni/213512120200099", "3/13 Trik", "Případy 1. oddělení", ["Seriál"], `
      <h2>I. řada</h2> <a href="/porady/10354229723-pripady-1-oddeleni/213512120200099/"><p>3/13 Trik</p><p>III.&nbsp;řada</p></a>`);
    expect(titles[0]).toMatchObject({ kind: "episode", season: 3, episode: 3, episodeTitle: "Trik" });
  });

  it("treats a numbered episode of a single-season series as season 1", () => {
    const titles = ivysilaniEpisodePage("17338616473-helsinsky-syndrom/226388771040001", "Epizoda 1/8", "Helsinský syndrom", ["Seriál"], "<h1>Epizoda 1/8</h1>");
    expect(titles.map(({ title, kind, season, episode, episodeTitle }) => ({ title, kind, season, episode, episodeTitle }))).toEqual([
      { title: "Helsinský syndrom", kind: "episode", season: 1, episode: 1, episodeTitle: undefined },
      { title: "Helsinský syndrom", kind: "series", season: undefined, episode: undefined, episodeTitle: undefined },
    ]);
  });

  it("reads the season when the card text runs the episode label into it", () => {
    const titles = ivysilaniEpisodePage("17338616473-helsinsky-syndrom/226388771040001", "Epizoda 1/8", "Helsinský syndrom", ["Seriál"],
      '<h2>II. řada</h2> <a href="/porady/17338616473-helsinsky-syndrom/226388771040001/"><span>Epizoda 1/8</span><span>I. řada</span><span>Ekonomická situace</span></a><a href="/porady/17338616473-helsinsky-syndrom/226388771040002/"><span>Epizoda 2/8</span><span>II. řada</span></a>');
    expect(titles[0]).toMatchObject({ kind: "episode", season: 1, episode: 1 });
    const named = ivysilaniEpisodePage("10354229723-pripady-1-oddeleni/213512120200002", "2/14 Fantom z Jižáku", "Případy 1. oddělení", ["Seriál"],
      '<h2>III. řada</h2> <a href="/porady/10354229723-pripady-1-oddeleni/213512120200002/"><span>2/14 Fantom z Jižáku</span><span>I. řada</span><span>Ve výtazích</span></a>');
    expect(named[0]).toMatchObject({ kind: "episode", season: 1, episode: 2 });
  });

  const nextData = (idec: string) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: { episode: {
    id: idec, idec, activeSeasonId: "season:3",
    show: { seasons: [{ id: "season:1", title: "I. řada" }, { id: "season:2", title: "II. řada" }, { id: "season:3", title: "III. řada" }] },
  } } } } })}</script>`;

  it("reads the season from the page data when the episode's card is not listed", () => {
    const titles = ivysilaniEpisodePage("10354229723-pripady-1-oddeleni/220512120080013", "13/13 Trik", "Případy 1. oddělení", ["Seriál"],
      `${nextData("220512120080013")}<button>III. řada</button><a href="/porady/10354229723-pripady-1-oddeleni/220512120080001/"><p>1/13 Podnájemníci</p><p>III.&nbsp;řada</p></a>`);
    expect(titles[0]).toMatchObject({ kind: "episode", season: 3, episode: 13, episodeTitle: "Trik" });
  });

  it("ignores page data left over from a previous episode after SPA navigation", () => {
    const titles = ivysilaniEpisodePage("10354229723-pripady-1-oddeleni/213512120200002", "2/14 Fantom z Jižáku", "Případy 1. oddělení", ["Seriál"],
      `${nextData("220512120080013")}<button>III. řada</button>`);
    expect(titles.map(({ kind }) => kind)).toEqual(["series"]);
  });

  it("shows only the series when the opened episode's season is unknown", () => {
    const titles = ivysilaniEpisodePage("10354229723-pripady-1-oddeleni/213512120200099", "3/13 Trik", "Případy 1. oddělení", ["Seriál"], "<p>II. řada</p>");
    expect(titles.map(({ kind, pageRole }) => ({ kind, pageRole }))).toEqual([{ kind: "series", pageRole: "primary" }]);
  });

  it("treats a multi-part iVysílání film as one film", () => {
    const titles = ivysilaniEpisodePage("16373259302-gerta-schnirch/424233100041001", "Epizoda 1/2", "Gerta Schnirch", ["Film", "Filmové drama", "Český film"], "<h1>Epizoda 1/2</h1><p>Vyrobeno 2025</p>");
    expect(titles.map(({ title, kind, year, pageRole, providerContentId }) => ({ title, kind, year, pageRole, providerContentId }))).toEqual([
      { title: "Gerta Schnirch", kind: "movie", year: 2025, pageRole: "primary", providerContentId: "16373259302-gerta-schnirch" },
    ]);
  });

  it("does not detect iVysílání episode cards outside their detail page", () => {
    const window = new Window({ url: "https://www.ceskatelevize.cz/porady/10095426857-interview-ct24/" });
    window.document.body.innerHTML = `<script type="application/ld+json">{"@type":"TVSeries","name":"Interview ČT24"}</script><main>
      <a href="/porady/10095426857-interview-ct24/226411058041019/"><img alt="Interview ČT24 - 19. října"></a>
      <a href="https://www.ceskatelevize.cz/porady/10354229723-pripady-1-oddeleni/213512120200002/"><img alt="Fantom z Jižáku"></a>
      <a href="/porady/1001879362-strach-nad-mestem/"><img alt="Strach nad městem"></a></main>`;
    visible(window);
    const url = new URL(window.location.href);
    const titles = extractVisibleTitles(window.document as unknown as Document, url, providerForUrl(url)!);
    expect(titles.map(({ title, pageRole }) => ({ title, pageRole }))).toEqual([
      { title: "Interview ČT24", pageRole: "primary" },
      { title: "Strach nad městem", pageRole: "related" },
    ]);
  });

  it("extracts series title, season and episode when provided in JSON-LD", () => {
    const window = new Window({ url: "https://www.netflix.com/watch/12345" });
    window.document.body.innerHTML = `
      <script type="application/ld+json">
        {
          "@type": "TVEpisode",
          "name": "Fly",
          "partOfSeries": {
            "@type": "TVSeries",
            "name": "Breaking Bad"
          },
          "partOfSeason": {
            "@type": "TVSeason",
            "seasonNumber": 3
          },
          "episodeNumber": 10
        }
      </script>
    `;
    const url = new URL(window.location.href);
    const titles = extractVisibleTitles(window.document as unknown as Document, url, providerForUrl(url)!);
    expect(titles).toHaveLength(1);
    expect(titles[0].title).toBe("Breaking Bad");
    expect(titles[0].kind).toBe("episode");
    expect(titles[0].season).toBe(3);
    expect(titles[0].episode).toBe(10);
    const parsed = detectedTitleSchema.safeParse(titles[0]);
    expect(parsed.success).toBe(true);
  });


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
