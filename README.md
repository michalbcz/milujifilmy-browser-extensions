# MilujuFilmy

Chrome/Edge extension for displaying IMDb and ČSFD ratings on supported streaming pages, including Netflix, Prime Video and iVysílání. The extension opens public search and title pages in background tabs, reads their rendered content, and leaves the tabs open. Results are cached in Chrome storage. Some titles may be ambiguous; check the source link and use “Změnit shodu” to correct a match. A blocked source is shown as unavailable.

## Development

Requires Node.js 22+ and pnpm 12.4.2. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @milujufilmy/contracts build
pnpm --filter @milujufilmy/extension exec wxt prepare
pnpm test
pnpm typecheck
pnpm build
```

Load `apps/extension/.output/chrome-mv3` as an unpacked extension in Chrome's developer mode. Reload the extension and streaming tabs after rebuilding. For development, `pnpm dev` produces `.output/chrome-mv3-dev`. No backend or pairing token is needed for the extension.

To run fixture browser tests, install Chromium with `pnpm --filter @milujufilmy/extension exec playwright install chromium` and run `pnpm --filter @milujufilmy/extension test:e2e`. `CHROMIUM_PATH` may select an existing Chromium executable for the fixture test. Source sites can change markup or block automated visits; fixture tests do not establish live-site availability. The old local API remains in the repository but is not used by the extension.
