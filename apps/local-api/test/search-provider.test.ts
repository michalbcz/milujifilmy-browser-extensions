import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearxngSearch } from '../src/search-provider.js';
import { SourceScheduler, type JsonStore } from '../src/source-scheduler.js';
function store(): JsonStore { const values = new Map<string, unknown>(); return { get: key => values.get(key), set: (key, value) => { values.set(key, value); }, entries: () => [...values] }; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function response(results: unknown[] = [], unresponsive_engines: unknown[] = []) { return new Response(JSON.stringify({ query: 'Test', number_of_results: results.length, results, unresponsive_engines }), { headers: { 'content-type': 'application/json' } }); }
function provider(state = store()) { return new SearxngSearch('http://searxng:8080', new SourceScheduler(state, 0), state); }

describe('SearXNG search', () => {
  it('requests JSON and caches one normalized query across concurrent calls and restart', async () => {
    const calls: URL[] = []; const state = store();
    vi.stubGlobal('fetch', async (input: URL, init: RequestInit) => { calls.push(new URL(input)); expect(init.redirect).toBe('error'); return response([{ url: 'https://www.csfd.cz/film/32437/prehled/', title: 'Strach nad městem' }]); });
    const web = provider(state);
    const [a,b] = await Promise.all([web.search('Strach nad městem site:csfd.cz/film'), web.search('Strach nad městem site:csfd.cz/film')]);
    expect(a).toEqual([{ url: 'https://www.csfd.cz/film/32437/prehled/', title: 'Strach nad městem' }]); expect(b).toEqual(a);
    expect(await provider(state).search('Strach nad městem site:csfd.cz/film')).toEqual(a);
    expect(calls).toHaveLength(1); expect(calls[0].pathname).toBe('/search'); expect(calls[0].searchParams.get('format')).toBe('json');
  });
  it('persists cooldown after HTTP 429 and honors Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const state = store(); let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '1200' } }); });
    await expect(provider(state).search('one')).rejects.toThrow();
    vi.setSystemTime(Date.now()+10*60_000);
    await expect(provider(state).search('two')).rejects.toThrow(); expect(calls).toBe(1);
    vi.setSystemTime(Date.now()+11*60_000);
    vi.stubGlobal('fetch', async () => { calls++; return response(); });
    expect(await provider(state).search('two')).toEqual([]); expect(calls).toBe(2);
  });
  it('does not cache an upstream outage as an empty successful search', async () => {
    const web = provider(); vi.stubGlobal('fetch', async () => response([], [['brave','CAPTCHA']]));
    await expect(web.search('one')).rejects.toThrow(); expect(Object.values(web.status()).some((value: any) => value.error)).toBe(true);
  });
  it('keeps partial results but reports unavailable engines', async () => {
    const web = provider(); vi.stubGlobal('fetch', async () => response([{ url: 'https://www.imdb.com/title/tt0073540/', title: 'Film' }], [['brave','timeout']]));
    expect(await web.search('one')).toHaveLength(1); expect(Object.values(web.status()).some((value: any) => value.error)).toBe(true);
  });
  it('filters deceptive source URLs and rejects malformed successful payloads', async () => {
    const web = provider(); vi.stubGlobal('fetch', async () => response([
      { url: 'https://evil.example/imdb.com/title/tt42', title: 'Bad' }, { url: 'https://www.csfd.cz.evil.example/film/1', title: 'Bad' },
      { url: 'http://127.0.0.1/film/1', title: 'Bad' }, { url: 'https://u:p@www.csfd.cz/film/1', title: 'Bad' },
      { url: 'https://www.csfd.cz/film/32437/prehled/', title: 'Good' }
    ]));
    expect(await web.search('one')).toEqual([{ url: 'https://www.csfd.cz/film/32437/prehled/', title: 'Good' }]);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ unrelated: [] })));
    await expect(web.search('two')).rejects.toThrow();
  });
});

describe('source scheduling', () => {
  it('serializes requests and spaces them even after a restart', async () => {
    vi.useFakeTimers(); const state = store(); const starts: number[] = []; const initial = Date.now();
    const first = new SourceScheduler(state, 1000);
    const a = first.run('csfd', async () => { starts.push(Date.now()-initial); });
    const b = first.run('csfd', async () => { starts.push(Date.now()-initial); });
    await vi.runAllTimersAsync(); await Promise.all([a,b]);
    const c = new SourceScheduler(state, 1000).run('csfd', async () => { starts.push(Date.now()-initial); });
    await vi.runAllTimersAsync(); await c;
    expect(starts).toEqual([0,1000,2000]);
  });
});
