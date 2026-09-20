import type { SearchLink } from './browser-sources.js';

export interface SearchProvider {
  readonly name: string;
  search(query: string): Promise<SearchLink[]>;
  status(): Record<string, unknown>;
}

export class DisabledSearch implements SearchProvider {
  readonly name = 'none';
  async search(): Promise<SearchLink[]> { return []; }
  status() { return {}; }
}

import { createHash } from 'node:crypto';
import { MemoryStore, SourceScheduler, SourceUnavailable, retryAfterMs, type JsonStore } from './source-scheduler.js';

export function sourceLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return undefined;
    if (['www.imdb.com', 'imdb.com'].includes(url.hostname) && /^\/title\/tt\d+(?:\/|$)/.test(url.pathname)) return url.href;
    if (url.hostname === 'www.csfd.cz' && /^\/film\/\d+(?:[/-]|$)/.test(url.pathname)) return url.href;
  } catch { /* Untrusted search results cannot choose arbitrary fetch targets. */ }
  return undefined;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('SearXNG: prázdná odpověď.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); throw new Error('SearXNG: příliš velká odpověď.'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
interface SearchCache { results: SearchLink[]; expiresAt: number; degraded?: string; }
export class SearxngSearch implements SearchProvider {
  readonly name = 'searxng';
  private readonly endpoint: URL;
  private readonly source: string;
  private flights = new Map<string, Promise<SearchLink[]>>();
  private degraded?: string;
  constructor(endpoint: string, private readonly scheduler = new SourceScheduler(), private readonly store: JsonStore = new MemoryStore()) {
    this.endpoint = new URL(endpoint);
    if (!['http:', 'https:'].includes(this.endpoint.protocol) || this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash) throw new Error('Invalid SearXNG URL');
    this.endpoint.pathname = `${this.endpoint.pathname.replace(/\/$/, '')}/search`;
    this.source = `searxng:${createHash('sha256').update(this.endpoint.href).digest('hex').slice(0,16)}`;
  }
  status(): Record<string, unknown> {
    return { ...this.scheduler.status(this.source), ...(this.degraded ? { searxng: { error: this.degraded } } : {}) };
  }
  search(query: string): Promise<SearchLink[]> {
    const normalized = query.trim().replace(/\s+/g, ' ');
    const key = `search:${this.source}:${createHash('sha256').update(normalized).digest('hex')}`;
    const cached = this.store.get(key) as SearchCache | undefined;
    if (cached && cached.expiresAt > Date.now()) { this.degraded = cached.degraded; return Promise.resolve(cached.results); }
    const running = this.flights.get(key); if (running) return running;
    const task = this.scheduler.run(this.source, async () => {
      const url = new URL(this.endpoint); url.search = new URLSearchParams({ q: normalized, format: 'json', categories: 'general', language: 'cs-CZ' }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error', headers: { accept: 'application/json' } });
      if (!response.ok || response.status === 202) {
        await response.body?.cancel();
        throw new SourceUnavailable(`SearXNG: HTTP ${response.status}; vyhledávání dočasně nedostupné.`, Math.max(retryAfterMs(response), [202,403,429].includes(response.status) ? 300_000 : 0));
      }
      const payload = await readJson(response) as { results?: unknown; unresponsive_engines?: unknown } | null;
      if (!payload || !Array.isArray(payload.results) || (payload.unresponsive_engines !== undefined && !Array.isArray(payload.unresponsive_engines))) throw new Error('SearXNG: neplatná JSON odpověď.');
      const unavailable = Array.isArray(payload.unresponsive_engines) && payload.unresponsive_engines.length > 0;
      const results: SearchLink[] = [];
      for (const item of payload.results) {
        if (!item || typeof item !== 'object') continue;
        const { url: raw, title } = item as { url?: unknown; title?: unknown };
        const link = sourceLink(raw);
        if (link && typeof title === 'string' && !results.some(result => result.url === link)) results.push({ url: link, title: title.slice(0,500) });
        if (results.length >= 10) break;
      }
      this.degraded = unavailable ? 'SearXNG: některé vyhledávače jsou nedostupné; výsledky mohou být neúplné.' : undefined;
      if (unavailable && !results.length) throw new SourceUnavailable(this.degraded!, 300_000);
      this.store.set(key, { results, degraded: this.degraded, expiresAt: Date.now()+(unavailable || !results.length ? 60_000 : 86_400_000) } satisfies SearchCache);
      return results;
    }).finally(() => this.flights.delete(key));
    this.flights.set(key, task); return task;
  }
}
