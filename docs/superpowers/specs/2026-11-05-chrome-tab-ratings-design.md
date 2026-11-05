# Chrome tab ratings design

## Goal
Display IMDb and ČSFD ratings on supported streaming pages with a standalone Chrome extension, without the local API, Docker, pairing, or IMDb dataset import.

## Approach
Use extension-owned background tabs to open public search pages, select suitable results, open movie or series pages, and read rendered page metadata through content scripts. Keep the tabs open as requested. A direct HTTP transport would avoid tabs but does not meet the requested workflow. A backend would continue to require the service the user wants removed.

## Behavior
Reuse existing streaming title detection and panel. Prioritize the current title and process related cards sequentially with bounded requests to avoid opening an uncontrolled number of tabs. Match by title, original title, year, and media type, flag uncertain matches, and retain source identity. Store results and manual corrections in Chrome storage, with expiration and short retry for failures. Report blocked, challenged, or unavailable sources without treating them as empty results. Never automate CAPTCHA resolution or access private APIs. Show source links and allow correction using a source page URL. Do not close tabs opened by the extension. Preserve navigation cancellation and existing panel behavior.

## Verification
Use representative saved HTML fixtures and tests for source parsing, matching, caching, blocked pages, and navigation; run unit tests, typecheck, build, and extension browser E2E. Check live public source pages where access permits and report limitations separately.
