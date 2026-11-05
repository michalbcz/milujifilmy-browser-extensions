// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseSearch, parseDetail } from '../src/source-pages.js';

describe('public source pages', () => {
  it('selects only source title links and records search metadata', () => {
    const doc = new DOMParser().parseFromString('<div id="series"><h3><a href="/film/1224558-helsinsky/prehled/">Helsinský syndrom</a> (2022) (seriál)</h3></div><a href="https://evil.test/film/1">bad</a>', 'text/html');
    expect(parseSearch(doc, 'csfd', 'https://www.csfd.cz/hledat/')).toEqual([{url:'https://www.csfd.cz/film/1224558-helsinsky/prehled/', title:'Helsinský syndrom', year:2022, kind:'series'}]);
  });
  it('reads rating metadata from IMDb JSON-LD', () => {
    const doc = new DOMParser().parseFromString('<script type="application/ld+json">{"@type":"Movie","name":"Example","datePublished":"2020-01-01","aggregateRating":{"ratingValue":7.5,"ratingCount":42}}</script>', 'text/html');
    expect(parseDetail(doc, 'imdb', 'https://www.imdb.com/title/tt12345/')).toMatchObject({source:'imdb',sourceId:'tt12345',canonicalTitle:'Example',year:2020,kind:'movie',rating:{value:7.5,scale:10,votes:42}});
  });
  it('rejects challenge pages', () => {
    const doc = new DOMParser().parseFromString('<body>Přístup zamítnut</body>', 'text/html');
    expect(() => parseSearch(doc, 'csfd', 'https://www.csfd.cz/hledat/')).toThrow();
  });
});
