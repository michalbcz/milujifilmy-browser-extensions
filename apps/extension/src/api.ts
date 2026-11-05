import type { DetectedTitle, RatingCandidate } from '@milujufilmy/contracts';
import { browser } from 'wxt/browser';
import { bestCandidate } from './matching.js';
import type { SearchResult, Source } from './source-pages.js';

export interface LookupResult { requestId: string; candidates: RatingCandidate[]; warnings?: string[] }
const cacheKey = (title: DetectedTitle) => `ratings:${JSON.stringify([title.title,title.originalTitle,title.year,title.kind,title.season,title.episode])}`;
const overrideKey = (title: DetectedTitle) => `override:${JSON.stringify([title.provider,title.providerContentId ?? title.title,title.year,title.kind])}`;
let queue: Promise<unknown> = Promise.resolve();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function readPage(url: string, page: 'search' | 'detail'): Promise<any> {
  const tab = await browser.tabs.create({ url, active: false });
  if (tab.id === undefined) throw new Error('Nepodařilo se otevřít kartu zdroje.');
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await pause(500);
    try {
      const result = await browser.tabs.sendMessage(tab.id, {type:'read-source-page',page}) as {value?: unknown; error?: string};
      if (result?.error) throw new Error(result.error);
      if (result && 'value' in result) return result.value;
    } catch (error) {
      if (error instanceof Error && /blokován|ověření/.test(error.message)) throw error;
    }
  }
  throw new Error('Načtení stránky zdroje vypršelo.');
}
async function sourceLookup(title: DetectedTitle, source: Source): Promise<RatingCandidate | undefined> {
  const query = title.originalTitle ?? title.title;
  const url = source === 'csfd' ? `https://www.csfd.cz/hledat/?q=${encodeURIComponent(query)}` : `https://www.imdb.com/find/?q=${encodeURIComponent(query)}&s=tt`;
  const found = await readPage(url, 'search') as SearchResult[];
  if (!Array.isArray(found)) throw new Error('Vyhledávání zdroje není dostupné.');
  const candidates = found.filter(item => !item.kind || item.kind === title.kind).map(item => ({source,sourceId:item.url,sourceUrl:item.url,canonicalTitle:item.title,year:item.year,kind:item.kind ?? title.kind,evidence:[]}));
  const match = bestCandidate(query, title.year, candidates);
  if (!match || match.confidence < 0.5) return undefined;
  const detail = await readPage(match.candidate.sourceUrl, 'detail') as RatingCandidate | undefined;
  if (!detail || detail.kind !== title.kind) return undefined;
  return detail;
}
async function lookupOne(title: DetectedTitle): Promise<LookupResult> {
  const key = cacheKey(title), manualKey = overrideKey(title);
  const stored = await browser.storage.local.get([key,manualKey]);
  const cached = stored[key] as { expires: number; candidates: RatingCandidate[]; warnings: string[] } | undefined;
  const overrides = (stored[manualKey] as RatingCandidate[] | undefined) ?? [];
  if (cached && cached.expires > Date.now()) return {requestId:title.requestId,candidates:[...cached.candidates.filter(c => !overrides.some(o => o.source === c.source)),...overrides],warnings:cached.warnings};
  const candidates: RatingCandidate[] = [], warnings: string[] = [];
  for (const source of ['imdb','csfd'] as const) {
    if (overrides.some(o => o.source === source)) continue;
    try { const candidate = await sourceLookup(title,source); if (candidate) candidates.push(candidate); }
    catch { warnings.push(`${source.toUpperCase()}: zdroj není dostupný.`); }
    await pause(1000);
  }
  await browser.storage.local.set({[key]:{expires:Date.now() + (warnings.length ? 60_000 : 86_400_000),candidates,warnings}});
  return {requestId:title.requestId,candidates:[...candidates,...overrides],warnings};
}
export function lookupBatch(items: DetectedTitle[], isCurrent: () => boolean = () => true): Promise<LookupResult[]> {
  const task = queue.then(async () => {
    const results: LookupResult[] = [];
    for (const title of items.slice(0,25)) { if (!isCurrent()) break; results.push(await lookupOne(title)); }
    return results;
  });
  queue = task.catch(() => undefined);
  return task;
}
export async function saveOverride(detected: DetectedTitle, selected: RatingCandidate): Promise<void> {
  if (!selected || !['csfd','imdb'].includes(selected.source)) throw new Error('Neplatná shoda.');
  const key = overrideKey(detected);
  const old = (await browser.storage.local.get(key))[key] as RatingCandidate[] | undefined;
  await browser.storage.local.set({[key]:[...(old ?? []).filter(item => item.source !== selected.source),{...selected,evidence:[...selected.evidence,'manual']}]});
}
export async function saveCsfdUrl(detected: DetectedTitle, url: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Neplatný odkaz.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.csfd.cz' || !/^\/film\/\d+/.test(parsed.pathname)) throw new Error('Použijte odkaz na film na www.csfd.cz.');
  const candidate = await readPage(parsed.href,'detail') as RatingCandidate | undefined;
  if (!candidate || candidate.source !== 'csfd') throw new Error('ČSFD detail není dostupný.');
  await saveOverride(detected,candidate);
}
