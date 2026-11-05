# Chrome Tab Ratings Implementation Plan

> Implement in this session using test-driven development.

**Goal:** Replace local API lookups with public IMDb and ČSFD pages opened in Chrome tabs.

**Architecture:** Parse source pages in an isolated content script, orchestrate search/detail tabs from the background, store cached results and corrections locally, and keep the existing streaming UI. Leave all opened source tabs in place.

**Tech Stack:** TypeScript, WXT, Chrome MV3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-chrome-tab-ratings-design.md`

## Tasks

1. Add fixture-based tests and source page parsers for search, JSON-LD details, missing ratings and challenges. Match safe URLs, title, year and type.
2. Implement sequential tab orchestration, sender validation, timeout, cancellation, caching, manual overrides and source-specific warnings. Test the matching and caching decisions.
3. Remove backend/pairing dependency from the extension UI and permissions; retain streaming-page behavior and update documentation.
4. Run tests, typecheck, build and representative browser tests, diagnose failures, and create a PR describing verified behavior and limitations.
