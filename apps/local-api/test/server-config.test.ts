import { describe, expect, it } from "vitest";
import { listenHost } from "../src/server-config.js";

describe("listenHost", () => {
  it("allows the Docker service to bind its container interface", () => {
    expect(listenHost({ MILUJU_FILMY_LISTEN_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("keeps direct local starts on loopback by default", () => {
    expect(listenHost({})).toBe("127.0.0.1");
  });
});

import { searchConfig } from '../src/server-config.js';
describe('search configuration', () => {
  it('defaults to the local SearXNG endpoint and supports explicitly disabled search', () => {
    expect(searchConfig({})).toEqual({ searxngUrl: 'http://127.0.0.1:47322' });
    expect(searchConfig({ MILUJU_FILMY_SEARCH_PROVIDER: 'none' })).toEqual({});
    expect(searchConfig({ MILUJU_FILMY_SEARXNG_URL: 'http://searxng:8080' })).toEqual({ searxngUrl: 'http://searxng:8080' });
    expect(() => searchConfig({ MILUJU_FILMY_SEARCH_PROVIDER: 'ddg' })).toThrow();
  });
});
