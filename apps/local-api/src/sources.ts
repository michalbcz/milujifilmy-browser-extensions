import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import type { DetectedTitle, MediaKind, RatingCandidate } from "@milujufilmy/contracts";
import { BrowserSources } from "./browser-sources.js";

const IMDB_DATASETS = {
  basics: "https://datasets.imdbws.com/title.basics.tsv.gz",
  episodes: "https://datasets.imdbws.com/title.episode.tsv.gz",
  ratings: "https://datasets.imdbws.com/title.ratings.tsv.gz",
} as const;

type ImdbRow = {
  id: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  kind: MediaKind;
  season: number | null;
  episode: number | null;
  rating: number | null;
  votes: number | null;
};

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (roman) => String(romanToNumber(roman)))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function romanToNumber(value: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10 };
  return value.toLowerCase().split("").reduceRight(
    ({ total, previous }, letter) => {
      const current = values[letter] ?? 0;
      return { total: total + (current < previous ? -current : current), previous: current };
    },
    { total: 0, previous: 0 },
  ).total;
}

export function scoreCandidate(
  requestedTitle: string,
  requestedYear: number | undefined,
  candidateTitle: string,
  candidateYear: number | undefined,
): number {
  const requested = normalizeTitle(requestedTitle);
  const candidate = normalizeTitle(candidateTitle);
  const requestedWords = new Set(requested.split(" ").filter(Boolean));
  const candidateWords = new Set(candidate.split(" ").filter(Boolean));
  const shared = [...requestedWords].filter((word) => candidateWords.has(word)).length;
  const titleScore = requested === candidate
    ? 0.85
    : requestedWords.size && candidateWords.size
      ? 0.65 * (shared / Math.max(requestedWords.size, candidateWords.size))
      : 0;
  const yearScore = requestedYear === undefined || candidateYear === undefined
    ? 0
    : requestedYear === candidateYear ? 0.15 : -0.25;
  return Math.max(0, Math.min(1, Number((titleScore + yearScore).toFixed(2))));
}

export function parseCsfdRating(html: string): number | undefined {
  const $ = cheerio.load(html);
  const visible = $(".film-rating-average, .rating-average").first().text();
  const match = visible.match(/\b(100|[1-9]?\d)\s*%/);
  return match ? Number(match[1]) : undefined;
}

export function parseCsfdDetail(html: string, url: string): RatingCandidate | undefined {
  const $ = cheerio.load(html);
  const id = url.match(/^https:\/\/www\.csfd\.cz\/film\/(\d+)(?:[/-]|$)/)?.[1];
  for (const node of $("script[type='application/ld+json']").toArray()) {
    try {
      const data = JSON.parse($(node).text());
      if (!id || !data.name || !["Movie", "TVSeries", "TVEpisode"].includes(data["@type"])) continue;
      const names = $(".film-names li").map((_, element) => {
        const name = $(element).clone();
        name.find("span").remove();
        return name.text().trim().replace(/\s+/g, " ");
      }).get().filter(Boolean);
      const year = Number(String(data.dateCreated ?? "").slice(0, 4));
      const rating = parseCsfdRating(html);
      const votes = Number(data.aggregateRating?.ratingCount);
      return {
        source: "csfd", sourceId: id, sourceUrl: url, canonicalTitle: data.name,
        originalTitle: names[0], year: year >= 1888 && year <= 2100 ? year : undefined,
        kind: data["@type"] === "TVSeries" ? "series" : data["@type"] === "TVEpisode" ? "episode" : "movie",
        rating: rating === undefined ? undefined : { value: rating, scale: 100, votes: Number.isInteger(votes) && votes >= 0 ? votes : undefined, fetchedAt: new Date().toISOString() },
        evidence: ["ČSFD detail page"],
      };
    } catch { /* Ignore unrelated JSON-LD, never manufacture a title from a challenge page. */ }
  }
  return undefined;
}

function overrideKey(title: DetectedTitle): string {
  return createHash("sha256").update(JSON.stringify(title.providerContentId
    ? [title.provider, title.providerContentId]
    : [title.provider, normalizeTitle(title.title), title.year, title.kind])).digest("hex");
}

function kindFromImdb(value: string): MediaKind | undefined {
  if (value === "movie") return "movie";
  if (value === "tvSeries" || value === "tvMiniSeries") return "series";
  if (value === "tvEpisode") return "episode";
  return undefined;
}

function sqlKind(kind: MediaKind): string {
  return kind === "movie" ? "movie" : kind === "series" ? "series" : "episode";
}

function cacheKey(title: DetectedTitle): string {
  return createHash("sha256").update(JSON.stringify({
    matcherVersion: 6,
    title: normalizeTitle(title.title),
    originalTitle: normalizeTitle(title.originalTitle ?? ""),
    year: title.year,
    kind: title.kind,
    season: title.season,
    episode: title.episode,
  })).digest("hex");
}

export function buildPublicSearchQuery(title: DetectedTitle): string {
  return [title.originalTitle ?? title.title, title.year, title.kind].filter(Boolean).join(" ");
}

export function resolveSearchResultUrl(value: string): string | undefined {
  try {
    const absolute = value.startsWith("//") ? `https:${value}` : value;
    const url = new URL(absolute);
    if (url.hostname === "duckduckgo.com" && url.pathname === "/l/") {
      const target = url.searchParams.get("uddg");
      return target && /^https?:\/\//.test(target) ? target : undefined;
    }
    return /^https?:\/\//.test(absolute) ? absolute : undefined;
  } catch {
    return undefined;
  }
}

export function parseWikidataItemId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const query = (payload as { query?: unknown }).query;
  if (!query || typeof query !== "object") return undefined;
  const search = (query as { search?: unknown }).search;
  if (!Array.isArray(search)) return undefined;
  const value = (search[0] as { title?: unknown } | undefined)?.title;
  return typeof value === "string" && /^Q\d+$/.test(value) ? value : undefined;
}

export function parseWikidataCsfdId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const claims = (payload as { claims?: unknown }).claims;
  if (!claims || typeof claims !== "object") return undefined;
  const statements = (claims as { P2529?: unknown }).P2529;
  if (!Array.isArray(statements)) return undefined;
  const value = (statements[0] as { mainsnak?: { datavalue?: { value?: unknown } } } | undefined)?.mainsnak?.datavalue?.value;
  return typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
}

export function openDatabase(path: string, journalMode: "WAL" | "DELETE" = "WAL"): Database.Database {
  const database = new Database(path);
  database.pragma(`journal_mode = ${journalMode}`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS imdb_titles (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
      original_title TEXT, year INTEGER, kind TEXT NOT NULL,
      season INTEGER, episode INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_imdb_titles_normalized ON imdb_titles(normalized_title);
    CREATE TABLE IF NOT EXISTS imdb_ratings (
      id TEXT PRIMARY KEY, value REAL NOT NULL, votes INTEGER NOT NULL, fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS manual_overrides (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return database;
}

export async function runInTransaction(database: Database.Database, work: () => Promise<void>): Promise<void> {
  database.exec("BEGIN IMMEDIATE");
  try {
    await work();
    database.exec("COMMIT");
  } catch (error) {
    if (database.inTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export class LocalLookup {
  private db: Database.Database;
  private readonly onlineSearch: boolean;
  private readonly pages: Pick<BrowserSources, "read" | "searchCsfd" | "searchDuckDuckGo" | "status" | "close">;
  private readonly inFlight = new Map<string, Promise<RatingCandidate[]>>();

  constructor(private readonly databasePath: string, options: { onlineSearch?: boolean; pages?: Pick<BrowserSources, "read" | "searchCsfd" | "searchDuckDuckGo" | "status" | "close"> } = {}) {
    this.onlineSearch = options.onlineSearch ?? false;
    this.db = openDatabase(databasePath);
    this.pages = options.pages ?? new BrowserSources();
  }

  async lookup(title: DetectedTitle): Promise<RatingCandidate[]> {
    const manual = this.db.prepare("SELECT 1 FROM manual_overrides WHERE key IN (?,?) LIMIT 1").get(`${overrideKey(title)}:imdb`, `${overrideKey(title)}:csfd`);
    const identity = manual ? `${cacheKey(title)}:${overrideKey(title)}` : cacheKey(title);
    const existing = this.inFlight.get(identity);
    if (existing) return existing;
    const pending = this.lookupUncached(title).finally(() => this.inFlight.delete(identity));
    this.inFlight.set(identity, pending);
    return pending;
  }

  private async lookupUncached(title: DetectedTitle): Promise<RatingCandidate[]> {
    const key = cacheKey(title);
    const overrides = ["imdb", "csfd"].flatMap((source) => {
      const row = this.db.prepare("SELECT payload FROM manual_overrides WHERE key = ?").get(`${overrideKey(title)}:${source}`) as { payload: string } | undefined;
      return row ? [JSON.parse(row.payload) as RatingCandidate] : [];
    });
    const legacy = this.db.prepare("SELECT payload FROM manual_overrides WHERE key = ?").get(key) as { payload: string } | undefined;
    if (legacy && !overrides.length) overrides.push(JSON.parse(legacy.payload));
    const cached = this.db.prepare("SELECT payload, expires_at FROM cache WHERE key = ?").get(key) as { payload: string; expires_at: number } | undefined;
    if (cached && cached.expires_at > Date.now() && !overrides.length) return JSON.parse(cached.payload) as RatingCandidate[];
    const previous = cached ? JSON.parse(cached.payload) as RatingCandidate[] : [];

    // A user-supplied source identity survives title/year refinements and enriches IMDb lookup.
    let csfd = overrides.find((candidate) => candidate.source === "csfd");
    if (!csfd && this.onlineSearch) {
      const known = previous.find((candidate) => candidate.source === "csfd");
      if (known) csfd = await this.csfdCandidate(known.sourceUrl, title).catch(() => undefined) ?? known;
      else {
        try {
          const searchTitle = title.originalTitle ?? title.title;
          const links = (await this.pages.searchCsfd(searchTitle))
            .filter((link) => link.kind === title.kind)
            .filter((link) => title.year === undefined || link.year === undefined || Math.abs(title.year - link.year) <= 1)
            .map((link) => ({ link, score: Math.max(scoreCandidate(searchTitle, title.year, link.title, link.year), scoreCandidate(title.title, title.year, link.title, link.year)) }))
            .filter(({ score }) => score >= 0.5).sort((a, b) => b.score - a.score);
          for (const { link } of links.slice(0, 3)) {
            const candidate = await this.csfdCandidate(link.url, title).catch(() => undefined);
            if (candidate && candidate.kind === title.kind && (title.year === undefined || candidate.year === undefined || Math.abs(title.year - candidate.year) <= 1) && this.confidence(candidate) >= 0.5) { csfd = candidate; break; }
          }
        } catch { /* Keep IMDb and cached data available if the browser source is offline. */ }
      }
    }
    if (csfd && overrides.some((candidate) => candidate.source === "csfd") && this.onlineSearch && (!csfd.rating || Date.now() - Date.parse(csfd.rating.fetchedAt) >= 86_400_000)) {
      const fresh = await this.csfdCandidate(csfd.sourceUrl, title).catch(() => undefined);
      if (fresh) { csfd = { ...fresh, evidence: ["manual", ...fresh.evidence] }; await this.saveOverride(title, csfd); }
    }
    const manualCsfd = overrides.some((candidate) => candidate.source === "csfd");
    let candidates = this.localImdbCandidates(csfd ? { ...title, originalTitle: manualCsfd ? csfd.originalTitle : title.originalTitle ?? csfd.originalTitle, year: manualCsfd ? csfd.year : title.year ?? csfd.year, kind: csfd.kind } : title);
    if (this.onlineSearch) {
      let imdb = candidates.find((candidate) => candidate.source === "imdb");
      if (!imdb && !csfd) {
        const linked = await this.wikidataTitleCandidates(title);
        candidates.push(...linked);
        imdb = linked.find((candidate) => candidate.source === "imdb");
        csfd = linked.find((candidate) => candidate.source === "csfd");
      }
      csfd ??= imdb ? await this.wikidataCsfdCandidate(imdb.sourceId, title) : undefined;
      if (!imdb && !csfd) candidates.push(...await this.publicCandidates(title));
    }
    if (csfd) candidates.push(csfd);
    if (!candidates.some((candidate) => candidate.source === "imdb")) {
      const found = candidates.find((candidate) => candidate.source === "csfd");
      if (found?.originalTitle) candidates.push(...this.localImdbCandidates({ ...title, originalTitle: found.originalTitle, year: found.year, kind: found.kind }));
    }
    if (csfd) for (const candidate of candidates.filter((item) => item.source === "imdb")) {
      candidate.aliases = [csfd.canonicalTitle, csfd.originalTitle ?? csfd.canonicalTitle];
    }
    candidates = [...overrides.filter((candidate) => candidate.source !== "csfd" || !csfd), ...candidates.filter((candidate) => !overrides.some((override) => override.source === candidate.source && override.source !== "csfd"))];
    if (!candidates.length && previous.length) candidates.push(...previous);
    const unique = candidates
      .sort((a, b) => Number(b.evidence.includes("manual")) - Number(a.evidence.includes("manual")) || this.confidence(b) - this.confidence(a))
      .filter((candidate, index, all) => all.findIndex((item) => item.source === candidate.source && item.sourceId === candidate.sourceId) === index)
      .filter((candidate, index, all) => all.slice(0, index).filter((item) => item.source === candidate.source).length < 3);
    const hasFreshCsfd = unique.some((candidate) => candidate.source === "csfd" && candidate.rating && Date.now() - Date.parse(candidate.rating.fetchedAt) < 86_400_000);
    const expiresIn = hasFreshCsfd ? 86_400_000 : 60_000;
    if (!overrides.length) this.db.prepare("INSERT INTO cache(key, payload, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at")
      .run(key, JSON.stringify(unique), Date.now() + expiresIn);
    return unique;
  }

  async saveOverride(title: DetectedTitle, selected: RatingCandidate): Promise<void> {
    const key = `${overrideKey(title)}:${selected.source}`;
    this.db.prepare("INSERT INTO manual_overrides(key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload")
      .run(key, JSON.stringify({ ...selected, evidence: ["manual", ...selected.evidence.filter((item) => item !== "manual")] }));
    this.db.prepare("DELETE FROM cache WHERE key = ?").run(cacheKey(title));
  }

  async saveCsfdUrl(title: DetectedTitle, url: string): Promise<RatingCandidate> {
    const parsed = new URL(url);
    const id = parsed.pathname.match(/^\/film\/(\d+)(?:[/-]|$)/)?.[1];
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.csfd.cz" || parsed.port || parsed.username || parsed.password || !id) throw new Error("Vložte HTTPS odkaz na detail filmu na www.csfd.cz.");
    const candidate = await this.csfdCandidate(`https://www.csfd.cz/film/${id}/prehled/`, title);
    if (!candidate) throw new Error("ČSFD detail se nepodařilo načíst. Zkuste to později.");
    await this.saveOverride(title, candidate);
    return candidate;
  }

  private confidence(candidate: RatingCandidate): number {
    return Number(candidate.evidence.find((entry) => entry.startsWith("confidence:"))?.slice(11) ?? 0);
  }

  snapshotDate(): string | undefined {
    return (this.db.prepare("SELECT value FROM metadata WHERE key = 'imdb_snapshot_date'").get() as { value: string } | undefined)?.value;
  }

  sourceStatus(): Record<string, unknown> {
    const snapshotDate = this.snapshotDate();
    return { imdb: { ready: Boolean(snapshotDate), snapshotDate: snapshotDate ?? null }, csfd: { cacheHours: 24, transport: "html-with-chromium-fallback" }, browsers: this.pages.status() };
  }

  sourceWarnings(): string[] {
    return Object.values(this.pages.status()).map((status) => (status as { error: string }).error);
  }

  async close(): Promise<void> { await this.pages.close(); this.db.close(); }

  async syncImdb(): Promise<void> {
    const previous = this.snapshotDate();
    if (previous && Date.now() - Date.parse(previous) < 24 * 60 * 60 * 1_000) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const stagingPath = `${this.databasePath}.${randomUUID()}.next`;
    const staging = openDatabase(stagingPath, "DELETE");
    try {
      await runInTransaction(staging, () => this.importBasics(staging));
      await runInTransaction(staging, () => this.importEpisodes(staging));
      await runInTransaction(staging, () => this.importRatings(staging));
      const overrides = this.db.prepare("SELECT key, payload FROM manual_overrides").all() as Array<{ key: string; payload: string }>;
      const copyOverride = staging.prepare("INSERT INTO manual_overrides(key, payload) VALUES (?, ?)");
      for (const override of overrides) copyOverride.run(override.key, override.payload);
      const copyCache = staging.prepare("INSERT INTO cache(key,payload,expires_at) VALUES (?,?,?)");
      for (const row of this.db.prepare("SELECT key,payload,expires_at FROM cache").all() as Array<{ key: string; payload: string; expires_at: number }>) copyCache.run(row.key, row.payload, row.expires_at);
      staging.prepare("INSERT INTO metadata(key, value) VALUES ('imdb_snapshot_date', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(new Date().toISOString());
      staging.close();
      this.db.close();
      await rename(stagingPath, this.databasePath);
      this.db = openDatabase(this.databasePath);
    } catch (error) {
      if (staging.open) staging.close();
      await rm(stagingPath, { force: true });
      throw error;
    }
  }

  private localImdbCandidates(title: DetectedTitle): RatingCandidate[] {
    const requested = title.originalTitle ?? title.title;
    const normalized = normalizeTitle(requested);
    const exact = this.db.prepare(`
      SELECT t.id, t.title, t.original_title AS originalTitle, t.year, t.kind, t.season, t.episode,
             r.value AS rating, r.votes AS votes, r.fetched_at AS fetchedAt
      FROM imdb_titles t LEFT JOIN imdb_ratings r ON r.id = t.id
      WHERE (t.normalized_title = ? OR t.original_title = ? COLLATE NOCASE) AND t.kind = ? LIMIT 12
    `).all(normalized, requested, sqlKind(title.kind)) as ImdbRow[];
    const rows = exact.length ? exact : this.db.prepare(`
      SELECT t.id, t.title, t.original_title AS originalTitle, t.year, t.kind, t.season, t.episode,
             r.value AS rating, r.votes AS votes, r.fetched_at AS fetchedAt
      FROM imdb_titles t LEFT JOIN imdb_ratings r ON r.id = t.id
      WHERE (t.normalized_title LIKE ? OR t.original_title LIKE ? COLLATE NOCASE) AND t.kind = ? LIMIT 12
    `).all(`%${normalized}%`, `%${requested}%`, sqlKind(title.kind)) as ImdbRow[];
    return rows.map((row) => this.imdbCandidate(row, title)).filter((candidate) => this.confidence(candidate) >= 0.5).sort((a, b) => this.confidence(b) - this.confidence(a));
  }

  private imdbCandidate(row: ImdbRow, title: DetectedTitle): RatingCandidate {
    const requested = title.originalTitle ?? title.title;
    const confidence = Math.max(
      scoreCandidate(requested, title.year, row.title, row.year ?? undefined),
      scoreCandidate(requested, title.year, row.originalTitle ?? row.title, row.year ?? undefined),
    );
    return {
      source: "imdb",
      sourceId: row.id,
      sourceUrl: `https://www.imdb.com/title/${row.id}/`,
      canonicalTitle: row.title,
      originalTitle: row.originalTitle ?? undefined,
      year: row.year ?? undefined,
      kind: row.kind,
      season: row.season ?? undefined,
      episode: row.episode ?? undefined,
      rating: row.rating === null ? undefined : {
        value: row.rating,
        scale: 10,
        votes: row.votes ?? undefined,
        fetchedAt: (row as ImdbRow & { fetchedAt?: string }).fetchedAt ?? new Date().toISOString(),
      },
      evidence: [`confidence:${confidence}`, "IMDb non-commercial dataset"],
    };
  }

  private async publicCandidates(title: DetectedTitle): Promise<RatingCandidate[]> {
    try {
      const query = buildPublicSearchQuery(title);
      const [imdbSearch, csfdSearch] = await Promise.allSettled([
        this.pages.searchDuckDuckGo(`${query} site:imdb.com/title`),
        this.pages.searchDuckDuckGo(`${query} site:csfd.cz/film`),
      ]);
      const imdbResults = imdbSearch.status === "fulfilled" ? imdbSearch.value : [];
      const csfdResults = csfdSearch.status === "fulfilled" ? csfdSearch.value : [];
      const imdb = imdbResults.flatMap((result) => {
        const match = result.url.match(/imdb\.com\/title\/(tt\d+)/i);
        if (!match) return [];
        const row = this.db.prepare(`
          SELECT t.id, t.title, t.original_title AS originalTitle, t.year, t.kind, t.season, t.episode,
                 r.value AS rating, r.votes AS votes, r.fetched_at AS fetchedAt
          FROM imdb_titles t LEFT JOIN imdb_ratings r ON r.id = t.id WHERE t.id = ?
        `).get(match[1]) as ImdbRow | undefined;
        if (!row) return [];
        const candidate = this.imdbCandidate(row, title);
        return Number(candidate.evidence[0]?.replace("confidence:", "") ?? 0) >= 0.5 ? [candidate] : [];
      });
      const csfd = await Promise.all(csfdResults.slice(0, 3).map((result) => this.csfdCandidate(result.url, title).catch(() => undefined)));
      return [...imdb, ...csfd.filter((value): value is RatingCandidate =>
        value !== undefined && Number(value.evidence[0]?.replace("confidence:", "") ?? 0) >= 0.5,
      )];
    } catch {
      return [];
    }
  }

  private async wikidataTitleCandidates(title: DetectedTitle): Promise<RatingCandidate[]> {
    try {
      const api = async (params: Record<string, string>) => {
        const response = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ ...params, format: "json" })}`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("Wikidata unavailable");
        return response.json();
      };
      const search = await api({ action: "wbsearchentities", search: title.title, language: title.locale === "cs-CZ" ? "cs" : "en", limit: "3" });
      const ids = (search.search ?? []).filter((item: { id?: string; label?: string }) => /^Q\d+$/.test(item.id ?? "") && normalizeTitle(item.label ?? "") === normalizeTitle(title.title)).map((item: { id: string }) => item.id);
      if (!ids.length) return [];
      const data = await api({ action: "wbgetentities", ids: ids.join("|"), props: "claims" });
      for (const id of ids) {
        const claims = data.entities?.[id]?.claims;
        const imdbId = claims?.P345?.[0]?.mainsnak?.datavalue?.value;
        const csfdId = parseWikidataCsfdId({ claims });
        if (!csfdId) continue;
        const csfd = await this.csfdCandidate(`https://www.csfd.cz/film/${csfdId}/prehled/`, title);
        if (!csfd || csfd.kind !== title.kind || this.confidence(csfd) < 0.8) continue;
        const imdb = this.localImdbCandidates({ ...title, originalTitle: csfd.originalTitle, year: csfd.year, kind: csfd.kind });
        return [csfd, ...imdb.filter((candidate) => !imdbId || candidate.sourceId === imdbId)];
      }
    } catch { /* Other sources can still resolve the title. */ }
    return [];
  }

  private async wikidataCsfdCandidate(imdbId: string, title: DetectedTitle): Promise<RatingCandidate | undefined> {
    if (!/^tt\d+$/.test(imdbId)) return undefined;
    try {
      const headers = { "user-agent": "MilujuFilmy/0.1 (personal non-commercial browser extension)" };
      const searchUrl = new URL("https://www.wikidata.org/w/api.php");
      searchUrl.search = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: `haswbstatement:P345=${imdbId}`,
        format: "json",
      }).toString();
      const searchResponse = await fetch(searchUrl, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!searchResponse.ok) return undefined;
      const itemId = parseWikidataItemId(await searchResponse.json());
      if (!itemId) return undefined;

      const claimsUrl = new URL("https://www.wikidata.org/w/api.php");
      claimsUrl.search = new URLSearchParams({
        action: "wbgetclaims",
        entity: itemId,
        property: "P2529",
        format: "json",
      }).toString();
      const claimsResponse = await fetch(claimsUrl, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!claimsResponse.ok) return undefined;
      const csfdId = parseWikidataCsfdId(await claimsResponse.json());
      return csfdId ? this.csfdCandidate(`https://www.csfd.cz/film/${csfdId}/prehled/`, title) : undefined;
    } catch {
      return undefined;
    }
  }

  private async csfdCandidate(url: string, title: DetectedTitle): Promise<RatingCandidate | undefined> {
    if (!/^https:\/\/www\.csfd\.cz\/film\//.test(url)) return undefined;
    const sourceKey = `csfd-detail:${url.match(/\/film\/(\d+)/)?.[1]}`;
    const stored = this.db.prepare("SELECT payload FROM cache WHERE key = ? AND expires_at > ?").get(sourceKey, Date.now()) as { payload: string } | undefined;
    let candidate: RatingCandidate | undefined = stored ? JSON.parse(stored.payload) as RatingCandidate : undefined;
    if (!candidate) {
      let html: string;
      if (this.onlineSearch) html = await this.pages.read(url);
      else {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
        if (!response.ok) return undefined;
        html = await response.text();
      }
      candidate = parseCsfdDetail(html, url);
      if (!candidate) return undefined;
      this.db.prepare("INSERT OR REPLACE INTO cache(key,payload,expires_at) VALUES (?,?,?)").run(sourceKey, JSON.stringify(candidate), Date.now() + 86_400_000);
    }
    const resolved = candidate;
    const confidence = Math.max(...[title.title, title.originalTitle].filter(Boolean).flatMap((requested) =>
      [resolved.canonicalTitle, resolved.originalTitle].filter(Boolean).map((name) => scoreCandidate(requested!, title.year, name!, resolved.year))));
    candidate.evidence = [`confidence:${confidence}`, ...candidate.evidence.filter((item) => !item.startsWith("confidence:"))];
    return candidate;
  }

  private async importBasics(db: Database.Database): Promise<void> {
    const insert = db.prepare("INSERT OR REPLACE INTO imdb_titles(id,title,normalized_title,original_title,year,kind,season,episode) VALUES (?,?,?,?,?,?,NULL,NULL)");
    await this.forEachDatasetLine(IMDB_DATASETS.basics, (columns) => {
      const kind = kindFromImdb(columns[1]);
      const year = Number(columns[5]);
      if (kind) insert.run(columns[0], columns[2], normalizeTitle(columns[2]), columns[3] === columns[2] ? null : columns[3], Number.isInteger(year) ? year : null, kind);
    });
  }

  private async importEpisodes(db: Database.Database): Promise<void> {
    const update = db.prepare("UPDATE imdb_titles SET season = ?, episode = ? WHERE id = ?");
    await this.forEachDatasetLine(IMDB_DATASETS.episodes, (columns) => {
      const season = Number(columns[2]);
      const episode = Number(columns[3]);
      update.run(Number.isInteger(season) ? season : null, Number.isInteger(episode) ? episode : null, columns[0]);
    });
  }

  private async importRatings(db: Database.Database): Promise<void> {
    const insert = db.prepare("INSERT OR REPLACE INTO imdb_ratings(id,value,votes,fetched_at) VALUES (?,?,?,?)");
    const fetchedAt = new Date().toISOString();
    await this.forEachDatasetLine(IMDB_DATASETS.ratings, (columns) => insert.run(columns[0], Number(columns[1]), Number(columns[2]), fetchedAt));
  }

  private async forEachDatasetLine(url: string, handler: (columns: string[]) => void): Promise<void> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60 * 1_000) });
    if (!response.ok || !response.body) throw new Error(`IMDb dataset download failed: ${response.status}`);
    const input = Readable.fromWeb(response.body as never).pipe(createGunzip());
    const lines = createInterface({ input, crlfDelay: Infinity });
    let header = true;
    for await (const line of lines) {
      if (header) { header = false; continue; }
      handler(line.split("\t"));
    }
  }
}
