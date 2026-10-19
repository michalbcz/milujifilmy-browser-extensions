import type { DetectedTitle, MediaKind } from "@milujufilmy/contracts";

export interface ProviderAdapter {
  id: string;
  name: string;
  hosts: string[];
  cardSelectors: string[];
}

export const providers: ProviderAdapter[] = [
  { id: "netflix", name: "Netflix", hosts: ["netflix.com"], cardSelectors: ["[data-uia*='title-card']", ".title-card"] },
  { id: "max", name: "HBO Max", hosts: ["max.com"], cardSelectors: ["[data-testid*='tile']", "[data-testid*='card']"] },
  { id: "disney-plus", name: "Disney+", hosts: ["disneyplus.com"], cardSelectors: ["[data-testid*='tile']", "[data-testid*='content']"] },
  { id: "prime-video", name: "Prime Video", hosts: ["primevideo.com", "amazon.com"], cardSelectors: ["[data-testid*='tile']", "[data-testid*='card']"] },
  { id: "oneplay", name: "Oneplay", hosts: ["oneplay.cz"], cardSelectors: ["[class*='card']", "[class*='tile']"] },
  { id: "prima-plus", name: "prima+", hosts: ["iprima.cz", "primaplus.cz"], cardSelectors: ["[class*='card']", "[class*='tile']"] },
  { id: "ivysilani", name: "iVysílání", hosts: ["ceskatelevize.cz"], cardSelectors: ["main a[href*='/porady/']", "main [data-testid*='card']"] },
  { id: "stream-cz", name: "Stream.cz", hosts: ["stream.cz"], cardSelectors: ["[class*='card']", "[class*='item']"] },
];

export function providerForUrl(url: URL): ProviderAdapter | undefined {
  return providers.find((provider) => provider.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)));
}

export function parseEpisodeLabel(value: string): { season: number; episode: number } | undefined {
  const compact = value.match(/\bS(?:eason)?\s*0?(\d{1,2})\s*[-., ]*E(?:pisode)?\s*0?(\d{1,3})\b/i);
  if (compact) return { season: Number(compact[1]), episode: Number(compact[2]) };
  const verbose = value.match(/(?:season|série|rada)\s*(\d{1,2})\D+(?:episode|epizoda|díl)\s*(\d{1,3})/i);
  return verbose ? { season: Number(verbose[1]), episode: Number(verbose[2]) } : undefined;
}

export function parseOriginalTitleFromText(value: string): string | undefined {
  return value.match(/Originální název (?:filmu|seriálu|pořadu)\s+(.{1,120}?)\s+(?:byl|byla|je|pochází|znamená)\b/i)?.[1]
    .trim()
    .replace(/\s+/gu, " ");
}

export function parseProductionYearFromText(value: string): number | undefined {
  const match = value.match(/\bVyrobeno\s+(19\d{2}|20\d{2})\b/i);
  return match ? Number(match[1]) : undefined;
}

function titleFromJsonLd(document: Document): { title: string; originalTitle?: string; year?: number; kind: MediaKind; episode?: { season: number; episode: number } } | undefined {
  for (const node of document.querySelectorAll("script[type='application/ld+json']")) {
    try {
      const values = JSON.parse(node.textContent ?? "") as unknown;
      const entries = Array.isArray(values) ? values : [values];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const value = entry as Record<string, unknown>;
        const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] ?? "");
        const rawTitle = String(value.name ?? value.headline ?? "").trim();
        if (!rawTitle || !/(Movie|TVSeries|TVEpisode|VideoObject)/i.test(type)) continue;

        const isEpisode = /TVEpisode/i.test(type);
        const isSeries = isEpisode || /TVSeries/i.test(type);

        const seriesName = isEpisode && typeof value.partOfTVSeries === "object" && value.partOfTVSeries !== null
          ? String((value.partOfTVSeries as Record<string, unknown>).name ?? "").trim()
          : isEpisode && typeof value.partOfSeries === "object" && value.partOfSeries !== null
            ? String((value.partOfSeries as Record<string, unknown>).name ?? "").trim()
            : undefined;

        const title = (seriesName || rawTitle).trim();
        if (!title) continue;

        const date = String(value.datePublished ?? value.dateCreated ?? "");
        const rawYear = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined;
        const year = rawYear && rawYear >= 1888 && rawYear <= 2100 ? rawYear : undefined;

        const video = value.video && typeof value.video === "object" ? value.video as Record<string, unknown> : undefined;
        const description = [value.description, video?.description].filter((item) => typeof item === "string").join(" ");

        const seasonRaw = typeof value.partOfSeason === "object" && value.partOfSeason !== null
          ? (value.partOfSeason as Record<string, unknown>).seasonNumber
          : value.episodeSeason ?? value.seasonNumber;
        const season = Number(seasonRaw?.toString?.() ?? NaN);
        const episode = Number(value.episodeNumber?.toString?.() ?? NaN);

        const hasValidEpisode = isEpisode && Number.isInteger(season) && Number.isInteger(episode) && season > 0 && episode > 0;
        const kind: MediaKind = isEpisode ? (hasValidEpisode ? "episode" : "series") : isSeries ? "series" : "movie";

        return {
          title,
          originalTitle: parseOriginalTitleFromText(description)?.trim() || undefined,
          year,
          kind,
          episode: hasValidEpisode ? { season, episode } : undefined,
        };
      }
    } catch { /* A page can have unrelated or invalid JSON-LD. */ }
  }
  return undefined;
}

function titleFromPage(document: Document): { title: string; originalTitle?: string; year?: number; kind: MediaKind; episode?: { season: number; episode: number } } | undefined {
  const jsonLd = titleFromJsonLd(document);
  const pageText = (document.querySelector("main") as HTMLElement | null)?.innerText ?? document.body?.innerText ?? "";
  const originalTitle = parseOriginalTitleFromText(pageText) ?? jsonLd?.originalTitle;
  const productionYear = parseProductionYearFromText(pageText);
  if (jsonLd) return { ...jsonLd, originalTitle: originalTitle?.trim() || undefined, year: productionYear ?? jsonLd.year };
  const rawTitle = document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim()
    ?? document.querySelector("h1")?.textContent?.trim();
  if (!rawTitle) return undefined;
  const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  const parsedYear = yearMatch ? Number(yearMatch) : undefined;
  const year = productionYear ?? (parsedYear && parsedYear >= 1888 && parsedYear <= 2100 ? parsedYear : undefined);
  const parsedEpisode = parseEpisodeLabel(`${rawTitle} ${document.body?.innerText.slice(0, 500) ?? ""}`);
  const hasValidEpisode = Boolean(parsedEpisode && parsedEpisode.season > 0 && parsedEpisode.episode > 0);
  const cleanTitle = rawTitle.replace(/\s*\|.*$/, "").trim() || rawTitle;
  return {
    title: cleanTitle,
    originalTitle: originalTitle?.trim() || undefined,
    year,
    kind: hasValidEpisode ? "episode" : "movie",
    episode: hasValidEpisode ? parsedEpisode : undefined,
  };
}

function contentId(url: URL): string | undefined {
  const match = url.pathname.match(/(?:watch|title|detail|film|porady?|series|movies?)\/([\w-]+)/i);
  return match?.[1];
}

const IVYSILANI_EPISODE_PATH = /^\/porady\/([^/]+)\/(\d{9,})\/?$/;

function ivysilaniEpisodePath(url: URL): { seriesId: string; episodeId: string } | undefined {
  const match = url.pathname.match(IVYSILANI_EPISODE_PATH);
  return match ? { seriesId: match[1], episodeId: match[2] } : undefined;
}

/** Reads "2/14 Fantom z Jižáku", "Epizoda 1/8" or "Díl 3: Název"; dated names have no number. */
export function parseIvysilaniEpisodeName(name: string): { episode: number; episodeTitle?: string } | undefined {
  const match = name.trim().match(/^(?:(?:Epizoda|Díl)\s+)?(\d{1,3})(?:\s*\/\s*\d{1,3})(?:\s*[:\-–—]?\s+(.+))?$/i)
    ?? name.trim().match(/^(?:Epizoda|Díl)\s+(\d{1,3})(?:\s*[:\-–—]\s*(.+))?$/i);
  if (!match || Number(match[1]) < 1) return undefined;
  return { episode: Number(match[1]), episodeTitle: match[2]?.trim() || undefined };
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
function seasonNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  let total = 0;
  for (let index = 0; index < value.length; index++) {
    const current = ROMAN[value[index]!.toUpperCase()];
    const next = ROMAN[value[index + 1]?.toUpperCase() ?? ""] ?? 0;
    if (!current) return undefined;
    total += current < next ? -current : current;
  }
  return total || undefined;
}

// Card text runs labels together ("Fantom z JižákuI. řada…"), so read whole elements, not substrings.
const SEASON_LABEL = /^([IVXL]+|\d{1,2})\.\s*řada$/i;

function seasonLabel(root: ParentNode): number | undefined {
  for (const element of root.querySelectorAll("*")) {
    if (element.childElementCount) continue;
    const label = element.textContent?.trim().match(SEASON_LABEL)?.[1];
    if (label) return seasonNumber(label);
  }
  return undefined;
}

/** Server-rendered page data names the episode's active season; after SPA navigation it may describe another episode. */
function seasonFromPageData(document: Document, episodeId: string): number | undefined {
  try {
    const episode = JSON.parse(document.getElementById("__NEXT_DATA__")?.textContent ?? "null")?.props?.pageProps?.data?.episode;
    if (!episode || String(episode.idec ?? episode.id) !== episodeId) return undefined;
    const label = (episode.show?.seasons as Array<{ id?: string; title?: string }> | undefined)
      ?.find((season) => season.id === episode.activeSeasonId)?.title?.trim().match(SEASON_LABEL)?.[1];
    return label ? seasonNumber(label) : undefined;
  } catch { return undefined; }
}

/** Page data or the opened episode's own list card carries "I. řada"; a show without any season label has one season. */
function ivysilaniSeason(document: Document, url: URL, episodeId: string): number | undefined {
  const fromPageData = seasonFromPageData(document, episodeId);
  if (fromPageData) return fromPageData;
  const current = url.pathname.replace(/\/?$/, "/");
  for (const link of document.querySelectorAll("a[href]")) {
    if (new URL(link.getAttribute("href")!, url).pathname.replace(/\/?$/, "/") !== current) continue;
    const season = seasonLabel(link);
    if (season) return season;
  }
  return document.body && seasonLabel(document.body) ? undefined : 1;
}

function ivysilaniEpisodeTitles(document: Document, url: URL, adapter: ProviderAdapter): DetectedTitle[] | undefined {
  const path = ivysilaniEpisodePath(url);
  if (!path) return undefined;
  for (const node of document.querySelectorAll("script[type='application/ld+json']")) {
    let value: Record<string, unknown>;
    try { value = JSON.parse(node.textContent ?? "") as Record<string, unknown>; } catch { continue; }
    const parent = value?.partOfTVSeries as Record<string, unknown> | undefined;
    if (!/TVEpisode/i.test(String(value?.["@type"] ?? "")) || !parent || typeof parent !== "object") continue;
    const seriesTitle = String(parent.name ?? "").trim().replace(/\s+/g, " ");
    if (!seriesTitle) continue;
    const pageText = (document.querySelector("main") as HTMLElement | null)?.innerText ?? document.body?.textContent ?? "";
    const genres = (Array.isArray(parent.genre) ? parent.genre : [parent.genre]).filter((genre): genre is string => typeof genre === "string");
    const locale = document.documentElement.lang?.startsWith("cs") ? "cs-CZ" as const : "en" as const;
    const originalTitle = parseOriginalTitleFromText(pageText);
    const year = parseProductionYearFromText(pageText);
    const base = { provider: adapter.id, title: seriesTitle, originalTitle, locale, pageRole: "primary" as const };
    // Parts of a multi-part film are not rated separately; the film itself is.
    if (genres.includes("Film") && !genres.some((genre) => /seriál/i.test(genre))) {
      return [{ ...base, requestId: crypto.randomUUID(), providerContentId: path.seriesId, year, kind: "movie" }];
    }
    const series: DetectedTitle = { ...base, requestId: crypto.randomUUID(), providerContentId: path.seriesId, kind: "series" };
    const parsed = parseIvysilaniEpisodeName(String(value.name ?? ""));
    const season = parsed ? ivysilaniSeason(document, url, path.episodeId) : undefined;
    if (!parsed || !season) return [series];
    return [{
      ...base, requestId: crypto.randomUUID(), providerContentId: path.episodeId, parentContentId: path.seriesId,
      year, kind: "episode", season, episode: parsed.episode, episodeTitle: parsed.episodeTitle,
    }, series];
  }
  return undefined;
}

export function extractVisibleTitles(document: Document, url: URL, adapter: ProviderAdapter): DetectedTitle[] {
  const episodePage = adapter.id === "ivysilani" ? ivysilaniEpisodeTitles(document, url, adapter) : undefined;
  const active = episodePage ? undefined : titleFromPage(document);
  const detected: DetectedTitle[] = episodePage ?? [];
  if (active && active.title) {
    const hasValidEpisode = Boolean(active.episode && active.episode.season > 0 && active.episode.episode > 0);
    const kind: MediaKind = active.kind === "episode" ? (hasValidEpisode ? "episode" : "series") : active.kind;
    detected.push({
      requestId: crypto.randomUUID(),
      provider: adapter.id,
      providerContentId: contentId(url),
      title: active.title.replace(/\s+/g, " "),
      pageRole: "primary",
      originalTitle: active.originalTitle?.trim() || undefined,
      year: active.year && active.year >= 1888 && active.year <= 2100 ? active.year : undefined,
      kind,
      season: hasValidEpisode ? active.episode?.season : undefined,
      episode: hasValidEpisode ? active.episode?.episode : undefined,
      locale: document.documentElement.lang?.startsWith("cs") ? "cs-CZ" : "en",
    });
  }
  const seen = new Set(detected.map((item) => item.title.toLocaleLowerCase()));
  const selectors = adapter.cardSelectors.join(",");
  for (const card of document.querySelectorAll(selectors)) {
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > (document.defaultView?.innerHeight ?? 1080)) continue;
    const title = (card.querySelector("img[alt]")?.getAttribute("alt")?.trim()
      || card.getAttribute("aria-label")?.trim()
      || card.querySelector("[data-testid*='title'], h2, h3")?.textContent?.trim())?.replace(/\s+/g, " ");
    if (!title || seen.has(title.toLocaleLowerCase())) continue;
    const href = card.getAttribute("href") ?? card.querySelector("a[href]")?.getAttribute("href");
    // iVysílání episodes are rated only on their own detail page, together with the series.
    if (adapter.id === "ivysilani" && href && ivysilaniEpisodePath(new URL(href, url))) continue;
    // Number-only episode cards are not independent film names; the parent series
    // is already represented by the primary title and supplies its rating.
    if (/(?:^|\s[-–—]\s)(?:Epizoda|Díl)\s+\d+(?:\s*\/\s*\d+)?\s*$/i.test(title)) continue;
    seen.add(title.toLocaleLowerCase());
    detected.push({ requestId: crypto.randomUUID(), provider: adapter.id, providerContentId: href ? contentId(new URL(href, url)) : undefined, title, pageRole: "related", kind: /seriál/i.test(card.textContent ?? "") ? "series" : "movie", locale: document.documentElement.lang?.startsWith("cs") ? "cs-CZ" : "en" });
  }
  return detected;
}
