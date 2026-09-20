import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import type { DetectedTitle, MediaKind, RatingCandidate } from "@milujufilmy/contracts";
import { DisabledSearch, SearxngSearch, type SearchProvider } from "./search-provider.js";
import { SourceScheduler, SourceUnavailable, retryAfterMs, type JsonStore } from "./source-scheduler.js";
import { BrowserSources } from "./browser-sources.js";

const IMDB_DATASETS = {
  basics: "https://datasets.imdbws.com/title.basics.tsv.gz",
  episodes: "https://datasets.imdbws.com/title.episode.tsv.gz",
  ratings: "https://datasets.imdbws.com/title.ratings.tsv.gz",
  aliases: "https://datasets.imdbws.com/title.akas.tsv.gz",
} as const;

type ImdbRow = {
  id: string;
  title: string;
  originalTitle: string | null;
  matchedAlias?: string;
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
    matcherVersion: 7,
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
    CREATE TABLE IF NOT EXISTS imdb_aliases (
      imdb_id TEXT NOT NULL, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
      PRIMARY KEY(imdb_id, normalized_title)
    );
    CREATE INDEX IF NOT EXISTS idx_imdb_aliases_title ON imdb_aliases(normalized_title);
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS source_state (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_matches (
      key TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(key, source)
    );
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
  private readonly pages: Pick<BrowserSources, "read" | "searchCsfd" | "status" | "close">;
  private readonly search: SearchProvider;
  private readonly scheduler: SourceScheduler;
  private readonly state: JsonStore;
  private readonly inFlight = new Map<string, Promise<RatingCandidate[]>>();

  constructor(private readonly databasePath: string, options: { onlineSearch?: boolean; searxngUrl?: string; search?: SearchProvider; pages?: Pick<BrowserSources, "read" | "searchCsfd" | "status" | "close"> } = {}) {
    this.onlineSearch = options.onlineSearch ?? false;
    this.db = openDatabase(databasePath);
    this.state = {
      get: (key) => { const row = this.db.prepare("SELECT payload FROM source_state WHERE key=?").get(key) as { payload: string } | undefined; return row ? JSON.parse(row.payload) : undefined; },
      set: (key, value) => { this.db.prepare("INSERT OR REPLACE INTO source_state(key,payload) VALUES (?,?)").run(key, JSON.stringify(value)); },
      entries: () => (this.db.prepare("SELECT key,payload FROM source_state").all() as { key: string; payload: string }[]).map(row => [row.key, JSON.parse(row.payload)]),
    };
    this.scheduler = new SourceScheduler(this.state);
    this.pages = options.pages ?? new BrowserSources(this.scheduler);
    this.search = options.search ?? (options.searxngUrl ? new SearxngSearch(options.searxngUrl, this.scheduler, this.state) : new DisabledSearch());
  }

  async lookup(title: DetectedTitle): Promise<RatingCandidate[]> {
    const manual = this.db.prepare("SELECT 1 FROM manual_overrides WHERE key IN (?,?) LIMIT 1").get(`${overrideKey(title)}:imdb`, `${overrideKey(title)}:csfd`);
    const identity = manual ? `${cacheKey(title)}:${overrideKey(title)}` : cacheKey(title);
    const flightKey = `${identity}:${title.pageRole === "related" ? "local" : "online"}`;
    const existing = this.inFlight.get(flightKey);
    if (existing) return existing;
    const pending = this.lookupUncached(title).finally(() => this.inFlight.delete(flightKey));
    this.inFlight.set(flightKey, pending);
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

    const online = this.onlineSearch && title.pageRole !== "related";
    const matches = overrides.length ? [] : (this.db.prepare("SELECT payload FROM source_matches WHERE key=?").all(key) as { payload: string }[])
      .map(row => JSON.parse(row.payload) as RatingCandidate);
    let csfd = overrides.find(candidate => candidate.source === "csfd");
    const manualCsfd = Boolean(csfd);
    const knownCsfd = csfd ?? matches.find(candidate => candidate.source === "csfd") ?? previous.find(candidate => candidate.source === "csfd");
    if (knownCsfd) {
      csfd = await this.csfdCandidate(knownCsfd.sourceUrl, title, online, manualCsfd).catch(() => undefined)
        ?? previous.find(candidate => candidate.source === "csfd") ?? csfd;
      if (csfd && manualCsfd) csfd = { ...csfd, evidence: ["manual", ...csfd.evidence.filter(item => item !== "manual")] };
    }
    const imdbTitle = () => csfd ? { ...title,
      originalTitle: manualCsfd ? csfd.originalTitle : title.originalTitle ?? csfd.originalTitle,
      year: manualCsfd ? csfd.year : title.year ?? csfd.year, kind: csfd.kind } : title;
    let imdb: RatingCandidate | undefined = overrides.find(candidate => candidate.source === "imdb") ?? this.localImdbCandidates(imdbTitle())[0];
    if (!imdb) {
      const known = matches.find(candidate => candidate.source === "imdb");
      if (known) imdb = this.imdbById(known.sourceId, title, known.aliases?.[0]);
    }
    if (online) {
      if (!imdb && !csfd) {
        const linked = await this.wikidataTitleCandidates(title);
        imdb = linked.find(candidate => candidate.source === "imdb");
        csfd = linked.find(candidate => candidate.source === "csfd");
      }
      if (!csfd && imdb && this.confidence(imdb) >= 0.8) csfd = await this.wikidataCsfdCandidate(imdb.sourceId, title);
      if (!csfd) csfd = await this.directCsfdCandidate(title);
      if (csfd && !overrides.some(candidate => candidate.source === "imdb") && (!imdb || csfd.originalTitle)) imdb = this.localImdbCandidates(imdbTitle())[0];
      // Resolve just the missing source, and derive IMDb locally from CSFD before
      // paying for another web search. An empty dataset cannot use IMDb links.
      if (!csfd) csfd = (await this.publicCandidates(title, "csfd"))[0];
      if (csfd && !overrides.some(candidate => candidate.source === "imdb") && (!imdb || csfd.originalTitle)) imdb = this.localImdbCandidates(imdbTitle())[0];
      if (!imdb && this.db.prepare("SELECT 1 FROM imdb_titles LIMIT 1").get()) imdb = (await this.publicCandidates(title, "imdb"))[0];
    }
    if (imdb && csfd && (manualCsfd || (this.confidence(imdb) >= 0.8 && this.confidence(csfd) >= 0.8))) {
      imdb = { ...imdb, aliases: [...new Set([...(imdb.aliases ?? []), csfd.canonicalTitle, csfd.originalTitle].filter((name): name is string => Boolean(name)))] };
    }
    const candidates = [imdb, csfd].filter((candidate): candidate is RatingCandidate => Boolean(candidate));
    for (const old of previous) if (!candidates.some(candidate => candidate.source === old.source)) candidates.push(old);
    // Manual matches are authoritative per source, never a global alias/mapping.
    for (const override of overrides) {
      const index = candidates.findIndex(candidate => candidate.source === override.source);
      if (override.source === "csfd" && csfd) continue;
      if (index >= 0) candidates[index] = override; else candidates.push(override);
    }
    if (!overrides.length && online) {
      for (const candidate of candidates) {
        if (this.confidence(candidate) < 0.8 || candidate.evidence.includes("manual")) continue;
        const { rating: _rating, ...identity } = candidate;
        this.db.prepare("INSERT OR REPLACE INTO source_matches(key,source,payload) VALUES (?,?,?)").run(key, candidate.source, JSON.stringify(identity));
      }
      const complete = candidates.some(candidate => candidate.source === "imdb") && candidates.some(candidate => candidate.source === "csfd" && candidate.rating && Date.now() - Date.parse(candidate.rating.fetchedAt) < 86_400_000);
      this.db.prepare("INSERT OR REPLACE INTO cache(key,payload,expires_at) VALUES (?,?,?)").run(key, JSON.stringify(candidates), Date.now() + (complete ? 86_400_000 : 60_000));
    }
    return candidates.sort((a, b) => Number(b.evidence.includes("manual")) - Number(a.evidence.includes("manual")) || this.confidence(b) - this.confidence(a));
  }

  private async directCsfdCandidate(title: DetectedTitle): Promise<RatingCandidate | undefined> {
    try {
      const requested = title.originalTitle ?? title.title;
      const links = (await this.pages.searchCsfd(requested)).filter(link => link.kind === title.kind)
        .filter(link => title.year === undefined || link.year === undefined || Math.abs(title.year - link.year) <= 1)
        .map(link => ({ link, score: Math.max(scoreCandidate(requested, title.year, link.title, link.year), scoreCandidate(title.title, title.year, link.title, link.year)) }))
        .filter(item => item.score >= 0.5).sort((a, b) => b.score - a.score);
      for (const { link } of links.slice(0, 3)) {
        const candidate = await this.csfdCandidate(link.url, title).catch(() => undefined);
        if (candidate && this.confidence(candidate) >= 0.5) return candidate;
      }
    } catch { /* Other sources and stale data remain usable. */ }
    return undefined;
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
    const candidate = await this.csfdCandidate(`https://www.csfd.cz/film/${id}/prehled/`, title, true, true);
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
    return { imdb: { ready: Boolean(snapshotDate), snapshotDate: snapshotDate ?? null }, csfd: { cacheHours: 24, transport: "html-with-chromium-fallback" }, browsers: this.pages.status(), backoff: this.scheduler.status(), search: { provider: this.search.name, ...this.search.status() } };
  }

  sourceWarnings(): string[] {
    return Object.values({ ...this.scheduler.status(), ...this.pages.status(), ...this.search.status() }).map((status) => (status as { error: string }).error);
  }

  async close(): Promise<void> { await this.pages.close(); this.db.close(); }

  private syncing?: Promise<void>;

  syncImdb(): Promise<void> {
    return this.syncing ??= this.importImdb().finally(() => { this.syncing = undefined; });
  }

  private async importImdb(): Promise<void> {
    const previous = this.snapshotDate();
    if (previous && Date.now() - Date.parse(previous) < 24 * 60 * 60 * 1_000) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const stagingPath = `${this.databasePath}.${randomUUID()}.next`;
    const staging = openDatabase(stagingPath, "DELETE");
    try {
      await runInTransaction(staging, () => this.importBasics(staging));
      await runInTransaction(staging, () => this.importEpisodes(staging));
      await runInTransaction(staging, () => this.importRatings(staging));
      await runInTransaction(staging, () => this.importAliases(staging));
      staging.close();
      // Swap only the dataset tables in one transaction. Active lookups retain their
      // connection; caches, overrides and source state stay in the live database.
      this.db.prepare("ATTACH DATABASE ? AS imdb_next").run(stagingPath);
      try {
        this.db.transaction(() => {
          for (const table of ["imdb_titles", "imdb_ratings", "imdb_aliases"]) {
            this.db.exec(`DELETE FROM ${table}; INSERT INTO ${table} SELECT * FROM imdb_next.${table}`);
          }
          this.db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES ('imdb_snapshot_date',?)").run(new Date().toISOString());
          this.db.prepare("UPDATE cache SET expires_at=0 WHERE length(key)=64 AND key NOT GLOB '*[^0-9a-f]*'").run();
        })();
      } finally { this.db.exec("DETACH DATABASE imdb_next"); }
      await rm(stagingPath, { force: true });
    } catch (error) {
      if (staging.open) staging.close();
      await rm(stagingPath, { force: true });
      throw error;
    }
  }

  private localImdbCandidates(title: DetectedTitle): RatingCandidate[] {
    const requested = title.originalTitle ?? title.title;
    const normalized = normalizeTitle(requested);
    const select = `SELECT t.id, t.title, t.original_title AS originalTitle, t.year, t.kind, t.season, t.episode,
      r.value AS rating, r.votes AS votes, r.fetched_at AS fetchedAt,
      (SELECT a.title FROM imdb_aliases a WHERE a.imdb_id=t.id AND a.normalized_title=@normalized LIMIT 1) AS matchedAlias
      FROM imdb_titles t LEFT JOIN imdb_ratings r ON r.id=t.id`;
    const constraints = `t.kind=@kind AND (@year IS NULL OR t.year IS NULL OR abs(t.year-@year)<=1)
      AND (@season IS NULL OR t.season=@season) AND (@episode IS NULL OR t.episode=@episode)`;
    const params = { normalized, requested, kind: sqlKind(title.kind), year: title.year ?? null,
      season: title.kind === "episode" ? title.season ?? null : null, episode: title.kind === "episode" ? title.episode ?? null : null };
    const exact = this.db.prepare(`${select} WHERE ${constraints} AND
      (t.normalized_title=@normalized OR t.original_title=@requested COLLATE NOCASE OR t.id IN
        (SELECT imdb_id FROM imdb_aliases WHERE normalized_title=@normalized))
      ORDER BY CASE WHEN t.year=@year THEN 0 ELSE 1 END, t.id LIMIT 12`).all(params) as ImdbRow[];
    const rows = exact.length ? exact : this.db.prepare(`${select} WHERE ${constraints} AND
      (t.normalized_title LIKE @pattern OR t.original_title LIKE @pattern COLLATE NOCASE) LIMIT 12`)
      .all({ ...params, pattern: `%${normalized}%` }) as ImdbRow[];
    return rows.map((row) => this.imdbCandidate(row, title)).filter((candidate) => this.confidence(candidate) >= 0.5).sort((a, b) => this.confidence(b) - this.confidence(a));
  }

  private imdbCandidate(row: ImdbRow, title: DetectedTitle): RatingCandidate {
    const requested = title.originalTitle ?? title.title;
    const confidence = Math.max(
      scoreCandidate(requested, title.year, row.title, row.year ?? undefined),
      scoreCandidate(requested, title.year, row.originalTitle ?? row.title, row.year ?? undefined),
      row.matchedAlias ? scoreCandidate(requested, title.year, row.matchedAlias, row.year ?? undefined) : 0,
    );
    return {
      source: "imdb",
      sourceId: row.id,
      sourceUrl: `https://www.imdb.com/title/${row.id}/`,
      canonicalTitle: row.title,
      aliases: row.matchedAlias ? [row.matchedAlias] : undefined,
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

  private imdbById(id: string, title: DetectedTitle, linkedAlias?: string): RatingCandidate | undefined {
    const row = this.db.prepare(`SELECT t.id,t.title,t.original_title AS originalTitle,t.year,t.kind,t.season,t.episode,
      r.value AS rating,r.votes,r.fetched_at AS fetchedAt FROM imdb_titles t LEFT JOIN imdb_ratings r ON r.id=t.id WHERE t.id=?`).get(id) as ImdbRow | undefined;
    if (!row || row.kind !== title.kind || (title.year !== undefined && row.year !== null && Math.abs(row.year-title.year)>1)
      || (title.kind === "episode" && (row.season !== title.season || row.episode !== title.episode))) return undefined;
    const candidate = this.imdbCandidate({ ...row, matchedAlias: title.originalTitle ? undefined : linkedAlias }, title);
    return this.confidence(candidate) >= 0.5 ? candidate : undefined;
  }

  private async publicCandidates(title: DetectedTitle, source: "imdb" | "csfd"): Promise<RatingCandidate[]> {
    try {
      const links = await this.search.search(`${buildPublicSearchQuery(title)} site:${source === "imdb" ? "imdb.com/title" : "csfd.cz/film"}`);
      const candidates: RatingCandidate[] = [];
      for (const link of links.slice(0, 3)) {
        const url = new URL(link.url);
        if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
        if (source === "imdb" && ["www.imdb.com", "imdb.com"].includes(url.hostname)) {
          const id = url.pathname.match(/^\/title\/(tt\d+)(?:\/|$)/)?.[1];
          const candidate = id ? this.imdbById(id, title) : undefined;
          if (candidate) candidates.push(candidate);
        } else if (source === "csfd" && url.hostname === "www.csfd.cz") {
          const candidate = await this.csfdCandidate(link.url, title).catch(() => undefined);
          if (candidate && this.confidence(candidate) >= 0.5) candidates.push(candidate);
        }
      }
      return candidates.sort((a, b) => this.confidence(b)-this.confidence(a));
    } catch { return []; }
  }

  private async wikidata(params: Record<string, string>): Promise<any> {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.search = new URLSearchParams({ ...params, format: "json" }).toString();
    const key = `wikidata:${createHash("sha256").update(url.href).digest("hex")}`;
    const cached = this.state.get(key) as { value: unknown; expiresAt: number } | undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    return this.scheduler.run("www.wikidata.org", async () => {
      const response = await fetch(url.href, { signal: AbortSignal.timeout(8000), redirect: "error", headers: { "user-agent": "MilujuFilmy/0.1 (personal non-commercial browser extension)" } });
      if (!response.ok || response.status === 202) throw new SourceUnavailable(`Wikidata: HTTP ${response.status}`, retryAfterMs(response));
      const value = await response.json();
      if (!value || typeof value !== "object" || value.error) throw new Error("Wikidata: neplatná odpověď.");
      const empty = (Array.isArray(value.search) && !value.search.length) || (Array.isArray(value.query?.search) && !value.query.search.length);
      this.state.set(key, { value, expiresAt: Date.now()+(empty ? 60_000 : 86_400_000) });
      return value;
    });
  }

  private async wikidataTitleCandidates(title: DetectedTitle): Promise<RatingCandidate[]> {
    try {
      const search = await this.wikidata({ action: "wbsearchentities", search: title.title, language: title.locale === "cs-CZ" ? "cs" : "en", limit: "3" });
      const ids = (search.search ?? []).filter((item: { id?: string; label?: string }) => /^Q\d+$/.test(item.id ?? "") && (normalizeTitle(item.label ?? "") === normalizeTitle(title.title) || normalizeTitle((item as { match?: { text?: string } }).match?.text ?? "") === normalizeTitle(title.title))).map((item: { id: string }) => item.id);
      if (!ids.length) return [];
      const data = await this.wikidata({ action: "wbgetentities", ids: ids.join("|"), props: "claims" });
      for (const id of ids) {
        const claims = data.entities?.[id]?.claims;
        const imdbId = claims?.P345?.[0]?.mainsnak?.datavalue?.value;
        const csfdId = parseWikidataCsfdId({ claims });
        const linkedImdb = typeof imdbId === "string" ? this.imdbById(imdbId, title, title.title) : undefined;
        if (!csfdId) { if (linkedImdb) return [linkedImdb]; continue; }
        const csfd = await this.csfdCandidate(`https://www.csfd.cz/film/${csfdId}/prehled/`, title);
        if (!csfd || csfd.kind !== title.kind || this.confidence(csfd) < 0.8) { if (linkedImdb) return [linkedImdb]; continue; }
        const imdb = this.localImdbCandidates({ ...title, originalTitle: csfd.originalTitle, year: csfd.year, kind: csfd.kind });
        return [csfd, ...(linkedImdb ? [linkedImdb] : imdb).filter((candidate) => !imdbId || candidate.sourceId === imdbId)];
      }
    } catch { /* Other sources can still resolve the title. */ }
    return [];
  }

  private async wikidataCsfdCandidate(imdbId: string, title: DetectedTitle): Promise<RatingCandidate | undefined> {
    if (!/^tt\d+$/.test(imdbId)) return undefined;
    try {
      const itemId = parseWikidataItemId(await this.wikidata({ action: "query", list: "search", srsearch: `haswbstatement:P345=${imdbId}` }));
      if (!itemId) return undefined;
      const claims = await this.wikidata({ action: "wbgetclaims", entity: itemId, property: "P2529" });
      const csfdId = parseWikidataCsfdId(claims);
      return csfdId ? this.csfdCandidate(`https://www.csfd.cz/film/${csfdId}/prehled/`, title) : undefined;
    } catch {
      return undefined;
    }
  }

  private async csfdCandidate(url: string, title: DetectedTitle, online = this.onlineSearch, manual = false): Promise<RatingCandidate | undefined> {
    if (!/^https:\/\/www\.csfd\.cz\/film\//.test(url)) return undefined;
    const sourceKey = `csfd-detail:${url.match(/\/film\/(\d+)/)?.[1]}`;
    const stored = this.db.prepare("SELECT payload,expires_at FROM cache WHERE key=?").get(sourceKey) as { payload: string; expires_at: number } | undefined;
    let candidate: RatingCandidate | undefined = stored ? JSON.parse(stored.payload) : undefined;
    if ((!stored || stored.expires_at <= Date.now()) && online) {
      try {
        const fresh = parseCsfdDetail(await this.pages.read(url), url);
        if (fresh) {
          candidate = fresh;
          this.db.prepare("INSERT OR REPLACE INTO cache(key,payload,expires_at) VALUES (?,?,?)").run(sourceKey, JSON.stringify(fresh), Date.now()+86_400_000);
        }
      } catch { /* Preserve the original fetchedAt when serving stale detail data. */ }
    }
    if (!candidate || (!manual && (candidate.kind !== title.kind || (title.year !== undefined && candidate.year !== undefined && Math.abs(title.year-candidate.year)>1)))) return undefined;
    const resolved = candidate;
    const confidence = Math.max(...(title.originalTitle ? [title.originalTitle] : [title.title]).flatMap((requested) =>
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

  private async importAliases(db: Database.Database): Promise<void> {
    const insert = db.prepare(`INSERT OR IGNORE INTO imdb_aliases(imdb_id,title,normalized_title)
      SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM imdb_titles WHERE id=?)`);
    await this.forEachDatasetLine(IMDB_DATASETS.aliases, (columns) => {
      const [id, , title, region, language] = columns;
      if (!id || !title || title === "\\N") return;
      if (!["CZ", "SK", "US", "GB"].includes(region ?? "") && !["cs", "sk", "en"].includes(language ?? "")) return;
      insert.run(id, title, normalizeTitle(title), id);
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
