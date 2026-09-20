# Reliable film lookup implementation plan

> Implementation uses executing-plans and test-driven-development in this worktree. User approved steps 1, 2, 3 with SearXNG in chat. User subsequently requested a commit and push on the feature branch. Deployment, extension reload and full IMDb download remain outside this task.

**Goal:** Resolve more Czech titles locally and replace direct DDG scraping with a private SearXNG fallback.
**Architecture:** Local aliases and durable automatic source identities precede online discovery. Source ratings retain their own age. A replaceable search provider uses SearXNG JSON; source queues persist backoff in SQLite. Related cards use local/cached data only, and cannot suppress a primary lookup.
**Tech stack:** TypeScript, SQLite, Vitest, existing pnpm workspace, Docker Compose.
**Spec:** Approved recommendation in this conversation (steps 1–3).

## Constraints and decisions
- Preserve source-specific manual overrides, bearer/client authorization, loopback binding and no-user-profile transport.
- IMDb basics/episodes/ratings plus filtered Czech, Slovak and English AKAs; original title/year/kind/episode remain authoritative.
- Atomic dataset table replacement leaves all cache, mappings, overrides and source backoff intact.
- Persist only confident automatic source mappings; never derive globally shared mappings from a manual correction.
- SearXNG is private in Docker networking, JSON enabled, explicitly selected engines; no direct DDG scraping fallback.
- Related cards do not trigger network discovery; primary requests can upgrade the same title immediately.
- No live IMDb sync or replacement of the running user's stack during verification.

## Review focus
1. Wrong same-name film or episode must not gain confidence from an unrelated alias.
2. A partial lookup must retry its missing source without repeating successful source searches.
3. Manual corrections must not leak through global mappings or enriched IMDb aliases.
4. Source outage, partial SearXNG failure and process restart must not erase stale ratings or reset backoff.
5. Failed/repeated dataset import must preserve prior data and not close an active lookup connection.

## Tasks
- [x] 1. Write alias/import regressions; verify red. Add filtered AKA import, alias matching and transactional dataset replacement. Verify local API suite.
- [x] 2. Write resolver regressions for missing-source-only search, related/primary separation, durable identity, Wikidata ID linkage, stale data and manual isolation; verify red. Implement lookup ordering and cache boundaries.
- [x] 3. Write transport regressions for JSON requests, bounded/validated responses, challenge/rate limit persistence, partial failures and cache reuse; verify red. Implement search-provider abstraction and shared persistent source scheduler.
- [x] 4. Wire configuration and private Docker SearXNG; update Czech README and commands. Check compose configuration and isolated container startup if Docker is available.
- [x] 5. Run pnpm test, pnpm typecheck, pnpm build; independently review worktree diff and fix important findings with regressions. Record actual results below.

## Execution evidence

- Alias import: 2 regressions RED -> GREEN. Backend suite 28/28.
- Discovery: 4 regressions RED -> GREEN; SQLite backoff restart and Czech display alias added RED -> GREEN.
- Search transport: 6 tests passed; full backend suite 40/40; TypeScript verified.
- Ruling: user explicitly requested implementation of the prior proposal; proceed inline without another approval loop. Commit and push were deferred until the user explicitly requested them.
- Ruling: related cards use local/cache only; primary promotion is independent. Cost: unseen related cards may have no rating until opened.

- Independent reviewer reproduced two important issues: provisional AKA identity not reconciled with CSFD original; manual CSFD URL rejected when detected year/kind was wrong. Both fixed with failing regression -> passing regression, full suite 63/63.
- Final verification: pnpm test 63/63 (contracts 2, extension 19, API 42), pnpm typecheck, pnpm build, Docker backend build, compose config and sh -n passed.
- Isolated Chromium fixture E2E: 1 passed; public iVysilani live suite intentionally skipped.
- Isolated SearXNG image healthy, only Bing/Brave enabled. Public Strach nad mestem query returned CSFD 32437 with no unresponsive engines; final Node adapter reproduced the correct source identity through the Docker network. API health reported searxng, unauthenticated lookup returned 401.
- Not established: complete IMDb download/import performance, broad provider coverage, installed user extension acceptance, historical legacy-override migration. These are verification boundaries, not grounds for changing live data during this task.
- No deferred code-review findings. Implementation is isolated on codex/search-alternatives; existing deployment and dataset were not changed.
