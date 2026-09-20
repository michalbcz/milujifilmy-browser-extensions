import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLookup, openDatabase } from "../src/sources.js";
import type { DetectedTitle } from "@milujufilmy/contracts";
const dirs: string[] = [];
const live: LocalLookup[] = [];
afterEach(async () => { for (const lookup of live.splice(0)) await lookup.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });
const title: DetectedTitle = { requestId: "1", provider: "ivysilani", title: "Strach nad městem", originalTitle: "Peur sur la ville", year: 1975, kind: "movie", locale: "cs-CZ", pageRole: "primary" };
const html = readFileSync(new URL('./fixtures/strach.html', import.meta.url), 'utf8');
function setup(seed = true) {
  const dir = mkdtempSync(join(tmpdir(), "mf-discovery-")); dirs.push(dir);
  const path = join(dir, "test.sqlite"); const db = openDatabase(path);
  if (seed) db.prepare("INSERT INTO imdb_titles(id,title,normalized_title,original_title,year,kind) VALUES ('tt0073540','Fear over the City','fear over the city','Peur sur la ville',1975,'movie')").run();
  db.close();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ search: [], query: { search: [] } }), { headers: { 'content-type': 'application/json' } }));
  return path;
}
function create(path: string, options: any) { const lookup = new LocalLookup(path, { onlineSearch: true, ...options }); live.push(lookup); return lookup; }
function pages() { return { read: vi.fn(async () => html), searchCsfd: vi.fn(async () => []), status: () => ({}), close: async () => {} }; }
function search() { return { name: 'fixture', search: vi.fn(async () => [{ url: 'https://www.csfd.cz/film/32437/prehled/', title: 'Strach nad městem' }]), status: () => ({}) }; }

describe('discovery scheduling', () => {
  it('searches only missing CSFD when IMDb is already known', async () => {
    const path = setup(); const web = search(); const lookup = create(path, { pages: pages(), search: web });
    const found = await lookup.lookup(title);
    expect(found.map(x => x.sourceId).sort()).toEqual(['32437', 'tt0073540']);
    expect(found.find(x => x.source === 'imdb')?.aliases).toContain('Strach nad městem');
    expect(web.search.mock.calls.map(([query]) => query)).toEqual(['Peur sur la ville 1975 movie site:csfd.cz/film']);
  });
  it('serves related cards locally without suppressing an immediately following primary lookup', async () => {
    const path = setup(); const web = search(); const source = pages(); const lookup = create(path, { pages: source, search: web });
    const related = await lookup.lookup({ ...title, pageRole: 'related' });
    expect(related.map(x => x.sourceId)).toEqual(['tt0073540']);
    expect(source.searchCsfd).not.toHaveBeenCalled(); expect(web.search).not.toHaveBeenCalled();
    expect((await lookup.lookup(title)).map(x => x.sourceId).sort()).toEqual(['32437', 'tt0073540']);
  });
  it('reuses a confident source identity after restart and result-cache eviction', async () => {
    const path = setup(); const source = pages(); const web = search();
    const first = create(path, { pages: source, search: web }); await first.lookup(title);
    const db = openDatabase(path); db.prepare("DELETE FROM cache WHERE key NOT LIKE 'csfd-detail:%'").run(); db.close();
    const restarted = create(path, { pages: source, search: web });
    const found = await restarted.lookup({ ...title, provider: 'netflix' });
    expect(found.map(x => x.sourceId).sort()).toEqual(['32437', 'tt0073540']);
    expect(web.search).toHaveBeenCalledTimes(1); expect(source.searchCsfd).toHaveBeenCalledTimes(1);
  });
  it('uses Wikidata IMDb identity even when no CSFD link is available', async () => {
    const path = setup();
    vi.stubGlobal('fetch', async (input: string) => {
      const params = new URL(input).searchParams;
      return new Response(JSON.stringify(params.get('action') === 'wbsearchentities'
        ? { search: [{ id: 'Q42', label: 'Neznámý český alias' }] }
        : params.get('action') === 'wbgetentities'
          ? { entities: { Q42: { claims: { P345: [{ mainsnak: { datavalue: { value: 'tt0073540' } } }] } } } }
          : { query: { search: [] } }));
    });
    const web = search(); const lookup = create(path, { pages: pages(), search: web });
    const found = await lookup.lookup({ ...title, title: 'Neznámý český alias', originalTitle: undefined });
    expect(found.find(x => x.source === 'imdb')?.sourceId).toBe('tt0073540');
    expect(web.search.mock.calls.every(([q]) => !q.includes('site:imdb.com'))).toBe(true);
  });
});

describe('persistent source transport', () => {
  it('keeps SearXNG backoff after closing and reopening SQLite', async () => {
    const path = setup(false); let searches = 0;
    vi.stubGlobal('fetch', async (input: URL | string) => {
      const url = new URL(input);
      if (url.hostname === 'searxng') { searches++; return new Response('', { status: 429 }); }
      if (url.hostname === 'www.wikidata.org') return new Response(JSON.stringify({ search: [] }));
      throw new Error('Unexpected remote source');
    });
    const first = create(path, { pages: pages(), searxngUrl: 'http://searxng:8080' });
    await first.lookup({ ...title, originalTitle: undefined });
    expect(searches).toBe(1); expect(first.sourceWarnings().join(' ')).toContain('SearXNG');
    await first.close(); live.splice(live.indexOf(first), 1);
    const restarted = create(path, { pages: pages(), searxngUrl: 'http://searxng:8080' });
    await restarted.lookup({ ...title, title: 'Jiný titul', originalTitle: undefined });
    expect(searches).toBe(1); expect(restarted.sourceWarnings().join(' ')).toContain('SearXNG');
  });
});

describe('identity reconciliation and manual corrections', () => {
  it('replaces a provisional AKA match when CSFD resolves another original title', async () => {
    const path = setup(false); const db = openDatabase(path);
    for (const [id, original] of [['tt0001', 'Wrong Original'], ['tt0002', 'Correct Original']]) {
      db.prepare("INSERT INTO imdb_titles(id,title,normalized_title,original_title,year,kind) VALUES (?,?,?,?,2008,'movie')").run(id, original, original.toLowerCase(), original);
      db.prepare('INSERT INTO imdb_aliases(imdb_id,title,normalized_title) VALUES (?,?,?)').run(id, 'Shared Name', 'shared name');
    }
    db.close(); const source = pages();
    source.searchCsfd.mockImplementation(async () => [{ url: 'https://www.csfd.cz/film/42/prehled/', title: 'Shared Name', year: 2008, kind: 'movie' as const }]);
    source.read.mockImplementation(async () => '<script type="application/ld+json">{"@type":"Movie","name":"Shared Name","dateCreated":"2008"}</script><ul class="film-names"><li>Correct Original</li></ul>');
    const lookup = create(path, { pages: source, search: search() });
    const found = await lookup.lookup({ ...title, title: 'Shared Name', year: 2008, originalTitle: undefined });
    expect(found.find(x => x.source === 'imdb')?.sourceId).toBe('tt0002');
    const state = openDatabase(path);
    expect(JSON.stringify(state.prepare("SELECT payload FROM source_matches WHERE source='imdb'").all())).not.toContain('tt0001'); state.close();
  });
  it('allows an explicit URL to correct detected year and kind without sharing the manual mapping', async () => {
    const path = setup(false); const source = pages(); const lookup = create(path, { pages: source, search: search() });
    const wrong: DetectedTitle = { ...title, title: 'Špatně rozpoznaný titul', originalTitle: undefined, year: 2008, kind: 'series', providerContentId: 'manual' };
    const corrected = await lookup.saveCsfdUrl(wrong, 'https://www.csfd.cz/film/32437/prehled/');
    expect(corrected).toMatchObject({ sourceId: '32437', year: 1975, kind: 'movie' });
    expect((await lookup.lookup(wrong)).find(x => x.source === 'csfd')).toMatchObject({ sourceId: '32437', year: 1975, kind: 'movie' });
    const elsewhere = await lookup.lookup({ ...wrong, provider: 'netflix', pageRole: 'related' });
    expect(elsewhere).toEqual([]);
    const state = openDatabase(path); expect(state.prepare('SELECT * FROM source_matches').all()).toEqual([]); state.close();
  });
});
