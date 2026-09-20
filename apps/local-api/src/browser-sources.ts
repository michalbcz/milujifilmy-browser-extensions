import { chromium, type Browser, type BrowserContext } from "playwright";
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
  private queue: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  private failures = new Map<string, { count: number; retryAt: number; error: string }>();

  status() { return Object.fromEntries(this.failures); }

  read(url: string): Promise<string> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["www.csfd.cz", "duckduckgo.com"].includes(parsed.hostname)) return Promise.reject(new Error("Unsupported source URL"));
    const task = this.queue.then(async () => {
      const failure = this.failures.get(parsed.hostname);
      if (failure && failure.retryAt > Date.now()) throw new Error(failure.error);
      const delay = this.nextAt - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextAt = Date.now() + 1000;
      // CSFD serves complete public HTML without JavaScript. Prefer that response;
      // use Chromium only when the page actually needs rendering.
      if (parsed.hostname === "www.csfd.cz") {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
        const html = await response.text();
        if (response.ok && !isSearchChallenge(response.status, html) && /application\/ld\+json|search-results/.test(html)) {
          this.failures.delete(parsed.hostname);
          return html;
        }
        if (isSearchChallenge(response.status, html)) {
          const error = `${parsed.hostname}: ochrana proti automatickému přístupu; zkuste později.`;
          throw new Error(error);
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
        if (parsed.hostname === "duckduckgo.com") {
          await page.locator('a[data-testid="result-title-a"], .anomaly-modal, #challenge-form').first().waitFor({ timeout: 8000 }).catch(() => undefined);
        }
        const html = await page.content();
        if (isSearchChallenge(response?.status() ?? 0, html)) throw new Error(`${parsed.hostname}: ochrana proti automatickému přístupu; zkuste později nebo vložte zdrojový odkaz.`);
        if (!response?.ok()) throw new Error(`${parsed.hostname}: HTTP ${response?.status()}`);
        this.failures.delete(parsed.hostname);
        return html;
      } finally { await page.close(); }
    }).catch((error: unknown) => {
      // Include HTTP timeouts and browser startup failures, not only page navigation.
      const failure = this.failures.get(parsed.hostname);
      if (!failure || failure.retryAt <= Date.now()) {
        const count = (failure?.count ?? 0) + 1;
        this.failures.set(parsed.hostname, { count, retryAt: Date.now() + Math.min(3_600_000, 30_000 * 2 ** (count - 1)), error: error instanceof Error ? error.message : "Zdroj není dostupný." });
      }
      throw error;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  async searchCsfd(title: string): Promise<SearchLink[]> {
    return parseCsfdSearch(await this.read(`https://www.csfd.cz/hledat/?q=${encodeURIComponent(title)}`));
  }

  async searchDuckDuckGo(query: string): Promise<SearchLink[]> {
    const html = await this.read(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`);
    const $ = cheerio.load(html);
    return $('a[data-testid="result-title-a"]').map((_, element) => ({ url: $(element).attr("href") ?? "", title: $(element).text().trim() })).get();
  }

  async close() { await this.browser?.close(); this.contexts.clear(); }
}
