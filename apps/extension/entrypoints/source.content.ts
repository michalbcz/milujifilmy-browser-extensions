import { browser } from 'wxt/browser';
import { parseDetail, parseSearch, type Source } from '../src/source-pages.js';

export default defineContentScript({
  matches: ['https://*.imdb.com/*', 'https://www.csfd.cz/*'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message: any) => {
      if (message?.type !== 'read-source-page') return;
      const source: Source = location.hostname.endsWith('imdb.com') ? 'imdb' : 'csfd';
      try { return Promise.resolve({ value: message.page === 'search' ? parseSearch(document, source, location.href) : parseDetail(document, source, location.href) }); }
      catch (error) { return Promise.resolve({error: error instanceof Error ? error.message : 'Zdroj není dostupný.'}); }
    });
  },
});
