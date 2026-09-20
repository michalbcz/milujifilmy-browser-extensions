import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";
import { buildPublicSearchQuery, LocalLookup, openDatabase, parseCsfdRating, parseCsfdDetail, parseWikidataCsfdId, parseWikidataItemId, resolveSearchResultUrl, runInTransaction, scoreCandidate } from "../src/sources.js";

afterEach(() => vi.unstubAllGlobals());
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");

describe("Czech source identity", () => {
  it.each([false, true])("does not replace known original title and year with a namesake (only wrong result: %s)", async (onlyWrongResult) => {
    const path = join(tmpdir(), `milujufilmy-namesake-${crypto.randomUUID()}.sqlite`);
    const db = openDatabase(path);
    for (const [id, name, original, year] of [["tt0920470", "The Last Deadly Mission", "MR 73", 2008], ["tt0067333", "Lawman", "Lawman", 1971]] as const) {
      db.prepare("INSERT INTO imdb_titles(id,title,normalized_title,original_title,year,kind) VALUES (?,?,?,?,?,'movie')").run(id, name, name.toLowerCase(), original, year);
    }
    db.close();
    vi.stubGlobal("fetch", async () => { throw new Error("No external fallback in this fixture"); });
    const lookup = new LocalLookup(path, { onlineSearch: true, pages: {
      searchCsfd: async (query) => query === "Mr 73" && !onlyWrongResult
        ? [{ title: "MR 73", year: 2008, kind: "movie", url: "https://www.csfd.cz/film/228849/prehled/" }]
        : [{ title: "Strážce zákona", year: 1971, kind: "movie", url: "https://www.csfd.cz/film/12363/prehled/" }],
      read: async (url) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Movie", name: "Strážce zákona", dateCreated: url.includes("228849") ? "2008" : "1971" })}</script><ul class="film-names"><li>${url.includes("228849") ? "MR 73" : "Lawman"}</li></ul>`,
      searchDuckDuckGo: async () => [], status: () => ({}), close: async () => {},
    } });
    try {
      const found = await lookup.lookup({ requestId: "namesake", provider: "ivysilani", title: "Strážce zákona", originalTitle: "Mr 73", year: 2008, kind: "movie", locale: "cs-CZ" });
      expect(found.find((candidate) => candidate.source === "imdb")?.sourceId).toBe("tt0920470");
      expect(found.find((candidate) => candidate.source === "csfd")?.sourceId).toBe(onlyWrongResult ? undefined : "228849");
    } finally { await lookup.close(); }
  });
  it("persists an on-demand lookup across restart and shares it between providers", async () => {
    const path = join(tmpdir(), `milujufilmy-cache-${crypto.randomUUID()}.sqlite`);
    let searches = 0;
    let reads = 0;
    const pages = {
      searchCsfd: async () => { searches++; return [{ url: "https://www.csfd.cz/film/1224558-helsinsky-syndrom/prehled/", title: "Helsinský syndrom", kind: "series" as const, year: 2022 }]; },
      read: async () => { reads++; return fixture("helsinki"); },
      searchDuckDuckGo: async () => [], status: () => ({}), close: async () => {},
    };
    const title: DetectedTitle = { requestId: "1", provider: "ivysilani", title: "Helsinský syndrom", kind: "series", locale: "cs-CZ" };
    const first = new LocalLookup(path, { onlineSearch: true, pages });
    const [a, b] = await Promise.all([first.lookup(title), first.lookup({ ...title, provider: "netflix", requestId: "2" })]);
    expect(a[0]?.sourceId).toBe("1224558");
    expect(b).toEqual(a);
    const restarted = new LocalLookup(path, { onlineSearch: true, pages });
    expect(await restarted.lookup({ ...title, provider: "netflix" })).toEqual(a);
    expect({ searches, reads }).toEqual({ searches: 1, reads: 1 });
  });
  it("preserves the last successful result when stale refresh fails without making it a manual override", async () => {
    const path = join(tmpdir(), `milujufilmy-stale-${crypto.randomUUID()}.sqlite`);
    let offline = false;
    const pages = { searchCsfd: async () => [{ url: "https://www.csfd.cz/film/1224558/prehled/", title: "Helsinský syndrom", kind: "series" as const }], read: async () => { if (offline) throw new Error("Offline"); return fixture("helsinki"); }, searchDuckDuckGo: async () => [], status: () => ({}), close: async () => {} };
    const title: DetectedTitle = { requestId: "1", provider: "ivysilani", title: "Helsinský syndrom", kind: "series", locale: "cs-CZ" };
    const lookup = new LocalLookup(path, { onlineSearch: true, pages });
    const first = await lookup.lookup(title);
    const db = openDatabase(path);
    db.prepare("UPDATE cache SET expires_at=0").run();
    offline = true;
    expect(await lookup.lookup(title)).toEqual(first);
    expect((db.prepare("SELECT count(*) AS n FROM manual_overrides").get() as { n: number }).n).toBe(0);
    db.close();
  });
  it.each([
    ["helsinki", "1224558", "Helsinský syndrom", "Helsinki-syndrooma", 2022, "series", 78, 45],
    ["strach", "32437", "Strach nad městem", "Peur sur la ville", 1975, "movie", 76, 5375],
  ] as const)("reads real metadata and aliases for %s", (name, id, title, originalTitle, year, kind, value, votes) => {
    expect(parseCsfdDetail(fixture(name), `https://www.csfd.cz/film/${id}/prehled/`)).toMatchObject({
      sourceId: id, canonicalTitle: title, originalTitle, year, kind, rating: { value, votes, scale: 100 },
    });
  });

  it("does not turn an anti-bot page percentage into a film rating", () => {
    expect(parseCsfdDetail('<h1>Oh noes!</h1><p>challenge 50%</p>', "https://www.csfd.cz/film/32437/prehled/")).toBeUndefined();
  });

  it("keeps the supplied CSFD match across metadata changes and derives IMDb from the original title", async () => {
    const path = join(tmpdir(), `milujufilmy-csfd-${crypto.randomUUID()}.sqlite`);
    const db = openDatabase(path);
    db.prepare("INSERT INTO imdb_titles(id,title,normalized_title,original_title,year,kind) VALUES (?,?,?,?,?,?)")
      .run("tt0073540", "Fear over the City", "fear over the city", "Peur sur la ville", 1975, "movie");
    db.prepare("INSERT INTO imdb_ratings(id,value,votes,fetched_at) VALUES (?,?,?,?)").run("tt0073540", 6.9, 100, "2026-09-20T00:00:00Z");
    db.close();
    const lookup = new LocalLookup(path);
    const detected: DetectedTitle = { requestId: "1", provider: "ivysilani", providerContentId: "1001879362-strach-nad-mestem", title: "Strach nad městem", kind: "movie", locale: "cs-CZ" };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url !== "https://www.csfd.cz/film/32437/prehled/") throw new Error("Unexpected URL");
      return new Response(fixture("strach"));
    });
    await lookup.saveCsfdUrl(detected, "https://www.csfd.cz/film/32437-strach-nad-mestem/prehled/");
    const restarted = new LocalLookup(path);
    const candidates = await restarted.lookup({ ...detected, year: 1975 });
    expect(candidates.map((candidate) => candidate.sourceId).sort()).toEqual(["32437", "tt0073540"]);
    expect(candidates.find((candidate) => candidate.source === "csfd")?.rating?.value).toBe(76);
  });

  it("rejects arbitrary URLs for manual CSFD lookup", async () => {
    const lookup = new LocalLookup(join(tmpdir(), `milujufilmy-url-${crypto.randomUUID()}.sqlite`));
    const detected: DetectedTitle = { requestId: "1", provider: "ivysilani", title: "Test", kind: "movie", locale: "cs-CZ" };
    await expect(lookup.saveCsfdUrl(detected, "http://127.0.0.1:1234/private")).rejects.toThrow();
  });
});

describe("source helpers", () => {
  it("scores exact Czech title and year above a different year", () => {
    expect(scoreCandidate("Perníkový táta", 2008, "Perníkový táta", 2008)).toBeGreaterThan(
      scoreCandidate("Perníkový táta", 2008, "Perníkový táta", 2018),
    );
  });

  it("extracts a CSFD percentage from title-page markup", () => {
    expect(parseCsfdRating('<div class="film-rating-average">83%</div>')).toBe(83);
  });

  it("unwraps DuckDuckGo redirect URLs", () => {
    expect(resolveSearchResultUrl(
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.csfd.cz%2Ffilm%2F228849-mr-73%2Frecenze%2F&rut=abc",
    )).toBe("https://www.csfd.cz/film/228849-mr-73/recenze/");
  });

  it("extracts the Wikidata item and numeric CSFD film id from API results", () => {
    expect(parseWikidataItemId({
      query: { search: [{ title: "Q1768064" }] },
    })).toBe("Q1768064");
    expect(parseWikidataCsfdId({
      claims: { P2529: [{ mainsnak: { datavalue: { value: "228849" } } }] },
    })).toBe("228849");
    expect(parseWikidataCsfdId({
      results: { bindings: [{ csfd: { value: "not-an-id" } }] },
    })).toBeUndefined();
  });

  it("opens a staging database with rollback journaling", () => {
    const path = join(tmpdir(), `milujufilmy-staging-${Date.now()}.sqlite`);
    const database = openDatabase(path, "DELETE");
    expect(database.pragma("journal_mode", { simple: true })).toBe("delete");
    database.close();
  });

  it("rolls back an interrupted dataset batch", async () => {
    const path = join(tmpdir(), `milujufilmy-transaction-${Date.now()}.sqlite`);
    const database = openDatabase(path, "DELETE");
    await expect(runInTransaction(database, async () => {
      database.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("partial", "value");
      throw new Error("interrupted");
    })).rejects.toThrow("interrupted");
    expect(database.prepare("SELECT value FROM metadata WHERE key = ?").get("partial")).toBeUndefined();
    database.close();
  });

  it("matches an imported IMDb row by the detected original title after a cached local-title miss", async () => {
    const path = join(tmpdir(), `milujufilmy-original-title-${Date.now()}.sqlite`);
    const lookup = new LocalLookup(path);
    const detected: DetectedTitle = {
      requestId: "czech-title",
      provider: "ivysilani",
      providerContentId: "12905661003-strazce-zakona",
      title: "Strážce zákona",
      year: 2008,
      kind: "movie",
      locale: "cs-CZ",
    };
    expect(await lookup.lookup(detected)).toEqual([]);

    const database = openDatabase(path);
    database.prepare("INSERT INTO imdb_titles(id, title, normalized_title, original_title, year, kind) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tt0920470", "The Last Deadly Mission", "the last deadly mission", "MR 73", 2008, "movie");
    database.prepare("INSERT INTO imdb_ratings(id, value, votes, fetched_at) VALUES (?, ?, ?, ?)")
      .run("tt0920470", 6.6, 6900, "2026-09-20T00:00:00.000Z");
    database.close();

    const candidates = await lookup.lookup({ ...detected, requestId: "original-title", originalTitle: "Mr 73" });
    expect(candidates[0]?.sourceId).toBe("tt0920470");
  });

  it("prefers the detected original title in public-search queries", () => {
    expect(buildPublicSearchQuery({
      requestId: "query",
      provider: "ivysilani",
      title: "Strážce zákona",
      originalTitle: "Mr 73",
      year: 2008,
      kind: "movie",
      locale: "cs-CZ",
    })).toBe("Mr 73 2008 movie");
  });

  it("keeps a manual correction after reopening SQLite", async () => {
    const path = join(tmpdir(), `milujufilmy-${Date.now()}.sqlite`);
    const detected: DetectedTitle = { requestId: "manual", provider: "netflix", providerContentId: "7", title: "Duna", year: 2021, kind: "movie", locale: "cs-CZ" };
    const selected: RatingCandidate = { source: "imdb", sourceId: "tt1160419", sourceUrl: "https://www.imdb.com/title/tt1160419/", canonicalTitle: "Dune", year: 2021, kind: "movie", evidence: ["manual"] };
    const first = new LocalLookup(path);
    await first.saveOverride(detected, selected);
    const restarted = new LocalLookup(path);
    expect((await restarted.lookup(detected))[0]?.sourceId).toBe("tt1160419");
  });
});
