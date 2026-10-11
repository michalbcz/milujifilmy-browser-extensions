# MilujuFilmy agent guide

## Scope and working conventions

- Personal, non-commercial Chrome/Edge MV3 extension with a local Docker backend. Czech is the primary UI language. Firefox/Safari, store publication, and commercial distribution are outside v1 unless explicitly requested.
- Read [README.md](README.md) for user setup and deployment. Treat current source and fresh command output as authoritative over old task summaries.
- Check `git status --short` first, preserve unrelated user changes, and keep edits scoped. Do not commit, push, publish, or reinstall the user's extension unless requested.
- Use the pnpm version declared in `package.json`; do not introduce npm/yarn lockfiles. Keep `pnpm-lock.yaml` updated with dependency changes.
- If the user invokes `/graphify`, use the installed graphify skill. Do not create a knowledge graph as a prerequisite for ordinary development.

## Where to work

- `packages/contracts/src/index.ts`: shared Zod schemas and TypeScript contracts. Update producers and consumers together when changing API payloads.
- `apps/extension/src/providers.ts`: provider registry and public DOM/URL title detection.
- `apps/extension/entrypoints/catalog.content.ts`: page observers, badges, embedded panel, and navigation lifecycle.
- `apps/extension/entrypoints/background.ts`: primary-first lookup scheduling, per-tab session state, and message routing.
- `apps/extension/src/ui/`: shared ratings UI, embedded/native panels, and pairing options.
- `apps/local-api/src/app.ts`: Fastify routes and authorization; `server.ts`: configuration and process lifecycle.
- `apps/local-api/src/sources.ts`: SQLite, matching, persistent cache, manual corrections, and IMDb import.
- `apps/local-api/src/browser-sources.ts`: public HTML/browser source transports, parsing, throttling, and backoff.
- Workspace `test/` directories contain Vitest tests; `apps/extension/e2e/` contains Playwright tests.

## Commands (run from the repository root)

Use Node.js 22+, pnpm, and Docker Desktop for backend work. `justfile` provides convenience wrappers; the pnpm commands below also work without `just`.

```sh
pnpm install
pnpm --filter @milujufilmy/contracts build
pnpm --filter @milujufilmy/extension exec wxt prepare
pnpm test
pnpm typecheck
pnpm build
pnpm package
```

The contracts package exports generated JavaScript, and extension TypeScript configuration extends generated `.wxt/tsconfig.json`. Prepare both on a fresh checkout; do not commit those generated files. Root `pnpm test` builds contracts before running tests.

- `just dev` / `pnpm dev`: extension development server.
- `just backend-up` / `docker compose up -d --build local-api`: build and start the backend. Host TypeScript builds alone do not update the running container.
- `just backend-down` / `docker compose down`: stop the backend without deleting local data.
- `pnpm --filter @milujufilmy/extension exec playwright install chromium`: install the isolated E2E browser when needed.
- `just test-e2e`: build the extension and run browser tests; on a fresh checkout, build contracts first. Without `just`, run the extension's `build` and then `test:e2e` scripts via `pnpm --filter @milujufilmy/extension`.
- `MILUJU_FILMY_LIVE_E2E=1 pnpm --filter @milujufilmy/extension test:e2e`: opt-in real-site test. Requires a current extension build, running backend, `data/pairing-token.txt`, external network access, and an IMDb snapshot for IMDb assertions.

## Verification

- Add a regression test for a behavior change, reproducing the failure before fixing it. Prefer synthetic DOM/HTML fixtures and temporary SQLite databases over network-dependent unit tests.
- For code changes, run `pnpm test`, `pnpm typecheck`, and `pnpm build`. For panel/content-script/navigation changes, also run fixture E2E. Run `pnpm package` when delivering an installable ZIP.
- For docs-only changes, check referenced paths/commands and whitespace; do not report application tests as freshly passing unless actually run.
- Live E2E covers Strážce zákona (MR 73, 2008), Helsinský syndrom, Strach nad městem, and Tohle bude bolet. Preserve assertions on source identity, not just numeric ratings. If a rating snapshot changes, verify the source before updating the expectation.
- Keep four claims separate: local tests, isolated browser E2E, public-site live tests, and the user's installed Chrome extension. None proves broad acceptance across all providers or logged-in playback.
- After provider changes, report which services were actually checked. The broader manual UAT target is 3 movies, 3 series, and 2 episodes per service, including SPA navigation and fullscreen.

## Data and source invariants

- Keep the API host binding on `127.0.0.1:47321`; `0.0.0.0` inside the Docker container is intentional, with loopback-only host port publishing.
- Retain bearer-token and `x-milujufilmy-client` authorization for lookups and mutations. Do not broaden browser origins or host permissions to make a failing test pass.
- Never print, commit, embed in builds, or distribute the pairing token, `.env` secrets, user browser profiles, or `data/`. Do not delete the user's database, rotate their token, or trigger a large IMDb sync as routine test setup.
- The backend owns an on-demand persistent cache: read SQLite first; resolve a miss; persist the result. Repeated/concurrent lookups should reuse results. Keep source detail caching, stale-data fallback with original timestamps, and short negative-cache retries.
- Manual corrections are source-specific, survive restarts, and must not leak into automatic mappings shared by other providers. Dataset replacement must preserve cache and corrections; a failed import must preserve usable prior data.
- Known original titles and production years take precedence over ambiguous translated names. In particular, Strážce zákona / MR 73 (2008) must not become Lawman (1971). Preserve movie/series/episode distinctions and uncertainty warnings below 0.80.
- When changing matching semantics, consider the versioned automatic cache key so old incorrect matches are not replayed. Do not invalidate manual corrections indiscriminately.
- IMDb comes from official non-commercial datasets, not IMDb web scraping. ČSFD currently uses direct search/detail HTML with isolated Chromium rendering as fallback; Wikidata and DuckDuckGo are fallback sources.
- Treat CAPTCHA, DDG HTTP 202 challenge pages, and access-denied HTML as unavailable sources, not valid empty results or rating data. Keep serial throttling and exponential backoff; do not solve or bypass challenges automatically or reuse user cookies.

## Extension invariants and delivery

- Read public DOM metadata and URLs only; do not intercept provider private APIs, cookies, profiles, or browsing history. Send only the minimal title metadata needed for lookup.
- Prioritize the primary title, then visible related cards, with API batches no larger than 25. Ignore late responses for obsolete tab/page generations and clean up observers and old badges.
- Keep styles isolated in Shadow DOM. The automatic panel is embedded in the page; do not depend on gesture-restricted native side-panel opening for automatic display.
- Preserve hide/show state per tab session, URL/SPA refresh, the prominent primary-title section, and “Další nalezené filmy na stránce”. Hide the panel and badges during player fullscreen without disturbing playback controls.
- Production unpacked output is `apps/extension/.output/chrome-mv3`; development output is `apps/extension/.output/chrome-mv3-dev`. Edit source, never generated output.
- A new build does not itself reload an installed extension. Reload it through an allowed mechanism and refresh provider tabs; if browser automation denies an action, explain the specific blocker and request the minimal manual step rather than bypassing it or claiming deployment succeeded.
- Reinstalling after removal requires pairing again. Refer the user to the local token file instead of sending its contents in chat. Keep test screenshots and reports in ignored output directories.
