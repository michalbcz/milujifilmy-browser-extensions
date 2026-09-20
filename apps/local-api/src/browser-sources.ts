import { chromium, type Browser, type BrowserContext } from "playwright";
import { SourceScheduler, SourceUnavailable, retryAfterMs } from "./source-scheduler.js";
import * as cheerio from "cheerio";

export interface SearchLink { url: string; title: string; year?: number; kind?: "movie" | "series" | "episode"; }
export function parseCsfdSearch(html: string): SearchLink[] {
  const $ = cheerio.load(html);
  return $("#films h3 a[href^='/film/'], #series h3 a[href^='/film/']").map((_, element) => {
    const link = $(element);
    const text = link.closest("h3").text();
    return { url: new URL(link.attr("href")!, "https://www.csfd.cz").href, title: link.text().trim(),
      year: Number(text.match(/\((\d{4})\)/)?.[1]) || undefined,
      kind: /epizoda/.test(text) ? "episode" as const : /seriál|série/.test(text) ? "series" as const : "movie" as const };
  }).get();
}

export function isSearchChallenge(status: number, html: string): boolean {
  return status === 202 || status === 403 || status === 429 || /anomaly-modal|challenge-form|Unfortunately, bots use DuckDuckGo too|Oh noes!|Přístup zamítnut|Access denied|verify you are human/i.test(html);
}

export class BrowserSources {
  private browser?: Browser;
  private contexts = new Map<string, BrowserContext>();
  constructor(private readonly scheduler = new SourceScheduler()) {}

  status() { return this.scheduler.status("www.csfd.cz"); }

  read(url: string): Promise<string> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.csfd.cz" || parsed.username || parsed.password || parsed.port) return Promise.reject(new Error("Unsupported source URL"));
    return this.scheduler.run(parsed.hostname, async () => {
      // CSFD serves complete public HTML without JavaScript. Prefer that response;
      // use Chromium only when the page actually needs rendering.
      if (parsed.hostname === "www.csfd.cz") {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
        const html = await response.text();
        if (response.ok && !isSearchChallenge(response.status, html) && /application\/ld\+json|search-results/.test(html)) {
          return html;
        }
        if (isSearchChallenge(response.status, html)) {
          const error = `${parsed.hostname}: ochrana proti automatickému přístupu; zkuste později.`;
          throw new SourceUnavailable(error, Math.max(300_000, retryAfterMs(response)));
        }
      }
      let context = this.contexts.get(parsed.hostname);
      if (!this.browser?.isConnected()) {
        this.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
        this.contexts.clear();
        context = undefined;
      }
      if (!context) {
        context = await this.browser.newContext({ locale: "cs-CZ" });
        this.contexts.set(parsed.hostname, context);
      }
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        const html = await page.content();
        if (isSearchChallenge(response?.status() ?? 0, html)) throw new SourceUnavailable(`${parsed.hostname}: ochrana proti automatickému přístupu; zkuste později nebo vložte zdrojový odkaz.`, 300_000);
        if (!response?.ok()) throw new Error(`${parsed.hostname}: HTTP ${response?.status()}`);
        return html;
      } finally { await page.close(); }
    });
  }

  async searchCsfd(title: string): Promise<SearchLink[]> {
    return parseCsfdSearch(await this.read(`https://www.csfd.cz/hledat/?q=${encodeURIComponent(title)}`));
  }

  async close() { await this.browser?.close(); this.contexts.clear(); }
}
