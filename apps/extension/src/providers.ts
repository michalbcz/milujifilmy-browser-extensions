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
        const title = String(value.name ?? value.headline ?? "").trim();
        if (!title || !/(Movie|TVSeries|TVEpisode|VideoObject)/i.test(type)) continue;
        const date = String(value.datePublished ?? "");
        const video = value.video && typeof value.video === "object" ? value.video as Record<string, unknown> : undefined;
        const description = [value.description, video?.description].filter((item) => typeof item === "string").join(" ");
        const season = Number(value.episodeSeason?.toString?.() ?? NaN);
        const episode = Number(value.episodeNumber?.toString?.() ?? NaN);
        return {
          title,
          originalTitle: parseOriginalTitleFromText(description),
          year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
          kind: /TVEpisode/i.test(type) ? "episode" : /TVSeries/i.test(type) ? "series" : "movie",
          episode: Number.isInteger(season) && Number.isInteger(episode) ? { season, episode } : undefined,
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
  if (jsonLd) return { ...jsonLd, originalTitle, year: productionYear ?? jsonLd.year };
  const title = document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim()
    ?? document.querySelector("h1")?.textContent?.trim();
  if (!title) return undefined;
  const year = title.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  const episode = parseEpisodeLabel(`${title} ${document.body?.innerText.slice(0, 500) ?? ""}`);
  return { title: title.replace(/\s*\|.*$/, "").trim(), originalTitle, year: productionYear ?? (year ? Number(year) : undefined), kind: episode ? "episode" : "movie", episode };
}

function contentId(url: URL): string | undefined {
  const match = url.pathname.match(/(?:watch|title|detail|film|porady?|series|movies?)\/([\w-]+)/i);
  return match?.[1];
}

export function extractVisibleTitles(document: Document, url: URL, adapter: ProviderAdapter): DetectedTitle[] {
  const active = titleFromPage(document);
  const detected: DetectedTitle[] = active ? [{
    requestId: crypto.randomUUID(), provider: adapter.id, providerContentId: contentId(url), title: active.title.replace(/\s+/g, " "), pageRole: "primary",
    originalTitle: active.originalTitle, year: active.year, kind: active.kind, season: active.episode?.season, episode: active.episode?.episode,
    locale: document.documentElement.lang.startsWith("cs") ? "cs-CZ" : "en",
  }] : [];
  const seen = new Set(detected.map((item) => item.title.toLocaleLowerCase()));
  const selectors = adapter.cardSelectors.join(",");
  for (const card of document.querySelectorAll(selectors)) {
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > (document.defaultView?.innerHeight ?? 1080)) continue;
    const title = (card.querySelector("img[alt]")?.getAttribute("alt")?.trim()
      ?? card.getAttribute("aria-label")?.trim()
      ?? card.querySelector("[data-testid*='title'], h2, h3")?.textContent?.trim())?.replace(/\s+/g, " ");
    if (!title || seen.has(title.toLocaleLowerCase())) continue;
    // Number-only episode cards are not independent film names; the parent series
    // is already represented by the primary title and supplies its rating.
    if (/(?:^|\s[-–—]\s)(?:Epizoda|Díl)\s+\d+(?:\s*\/\s*\d+)?\s*$/i.test(title)) continue;
    seen.add(title.toLocaleLowerCase());
    const href = card.getAttribute("href") ?? card.querySelector("a[href]")?.getAttribute("href");
    detected.push({ requestId: crypto.randomUUID(), provider: adapter.id, providerContentId: href ? contentId(new URL(href, url)) : undefined, title, pageRole: "related", kind: /seriál/i.test(card.textContent ?? "") ? "series" : "movie", locale: document.documentElement.lang.startsWith("cs") ? "cs-CZ" : "en" });
  }
  return detected;
}
