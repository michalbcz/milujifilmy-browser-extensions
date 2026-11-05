import type { MediaKind, RatingCandidate } from '@milujufilmy/contracts';
export type Source = 'imdb' | 'csfd';
export interface SearchResult { url: string; title: string; year?: number; kind?: MediaKind }
function check(doc: Document) {
  if (/přístup zamítnut|access denied|verify you are human|captcha/i.test(doc.body?.textContent ?? '')) throw new Error('Zdroj je blokován nebo vyžaduje ověření.');
}
export function parseSearch(doc: Document, source: Source, base: string): SearchResult[] {
  check(doc);
  const selector = source === 'csfd' ? '#films h3 a[href^="/film/"], #series h3 a[href^="/film/"]' : 'a[href*="/title/tt"]';
  const seen = new Set<string>();
  return Array.from(doc.querySelectorAll<HTMLAnchorElement>(selector)).flatMap(a => {
    let url: URL;
    try { url = new URL(a.getAttribute('href') ?? '', base); } catch { return []; }
    if (url.protocol !== 'https:' || !(source === 'csfd' ? url.hostname === 'www.csfd.cz' && /^\/film\/\d+/.test(url.pathname) : ['www.imdb.com','imdb.com'].includes(url.hostname) && /^\/title\/tt\d+/.test(url.pathname))) return [];
    url.search = ''; url.hash = '';
    const title = a.textContent?.trim() ?? '';
    if (!title || seen.has(url.href)) return [];
    seen.add(url.href);
    const context = a.closest(source === 'csfd' ? 'h3' : 'li')?.textContent ?? '';
    const year = Number(context.match(/\b(19\d{2}|20\d{2})\b/)?.[1]) || undefined;
    const kind: MediaKind | undefined = /epizoda|episode/i.test(context) ? 'episode' : /seriál|series/i.test(context) ? 'series' : source === 'csfd' ? 'movie' : undefined;
    return [{url:url.href,title,year,kind}];
  }).slice(0, 20);
}
export function parseDetail(doc: Document, source: Source, url: string): RatingCandidate | undefined {
  check(doc);
  const parsed = new URL(url);
  const id = source === 'imdb' ? parsed.hostname.match(/^(?:www\.)?imdb\.com$/) && parsed.pathname.match(/^\/title\/(tt\d+)/)?.[1] : parsed.hostname === 'www.csfd.cz' && parsed.pathname.match(/^\/film\/(\d+)/)?.[1];
  if (!id || parsed.protocol !== 'https:') return undefined;
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const json = JSON.parse(script.textContent ?? '');
      const entries = Array.isArray(json) ? json : [json];
      for (const data of entries.flatMap((item: any) => item?.['@graph'] ?? [item])) {
        const type = Array.isArray(data?.['@type']) ? data['@type'].find((v: string) => ['Movie','TVSeries','TVEpisode'].includes(v)) : data?.['@type'];
        if (!['Movie','TVSeries','TVEpisode'].includes(type) || typeof data.name !== 'string') continue;
        const kind: MediaKind = type === 'TVSeries' ? 'series' : type === 'TVEpisode' ? 'episode' : 'movie';
        const year = Number(String(data.datePublished ?? data.dateCreated ?? '').slice(0,4));
        const rawRating = source === 'csfd' ? doc.querySelector('.film-rating-average, .rating-average')?.textContent?.match(/\b(100|[1-9]?\d)\s*%/)?.[1] : data.aggregateRating?.ratingValue;
        const ratingValue = rawRating == null ? NaN : Number(rawRating);
        const votes = Number(data.aggregateRating?.ratingCount);
        const scale = source === 'imdb' ? 10 : 100;
        return {source,sourceId:id,sourceUrl:url,canonicalTitle:data.name,year:year >= 1888 && year <= 2100 ? year : undefined,kind,rating:Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= scale ? {value:ratingValue,scale,votes:Number.isInteger(votes) && votes >= 0 ? votes : undefined,fetchedAt:new Date().toISOString()} : undefined,evidence:[`${source} detail page`]};
      }
    } catch { /* Ignore malformed or unrelated metadata. */ }
  }
  return undefined;
}
