import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("automatic panel, hide/show, SPA navigation, stale responses, fullscreen and unavailable API", async () => {
  const extension = resolve(".output/chrome-mv3");
  const context = await chromium.launchPersistentContext("", { channel: "chromium", ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 8000 });
    expect(worker.url()).toContain("background.js");
    let fail = false;
    await context.route("https://www.imdb.com/**", async (route) => {
      if (fail) return route.fulfill({body: "Access denied"});
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/find")) return route.fulfill({contentType:"text/html",body:`<li><a href="/title/tt1234567/">${url.searchParams.get("q")}</a> (2022)</li>`});
      return route.fulfill({contentType:"text/html",body:'<script type="application/ld+json">{"@type":"TVSeries","name":"Helsinský syndrom","datePublished":"2022-01-01","aggregateRating":{"ratingValue":7.8}}</script>'});
    });
    await context.route("https://www.csfd.cz/**", async (route) => {
      if (fail) return route.fulfill({body:"Přístup zamítnut"});
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/hledat")) return route.fulfill({contentType:"text/html",body:`<div id="series"><h3><a href="/film/1224558/prehled/">${url.searchParams.get("q")}</a> (2022) (seriál)</h3></div>`});
      return route.fulfill({contentType:"text/html",body:'<div class="film-rating-average">78 %</div><script type="application/ld+json">{"@type":"TVSeries","name":"Helsinský syndrom","dateCreated":"2022-01-01"}</script>'});
    });
    await context.route("https://www.ceskatelevize.cz/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="cs"><meta charset="utf-8"><body><main><script id="metadata" type="application/ld+json">{"@type":"TVSeries","name":"Helsinský syndrom"}</script><h1>Helsinský syndrom</h1><a href="/porady/2-strach-nad-mestem/" style="display:block;width:200px;height:100px"><img alt="Strach nad městem"></a><button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Fullscreen</button></main></body></html>` }));
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error("Extension page error:", error.message));
    page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
    await page.goto("https://www.ceskatelevize.cz/porady/17338616473-helsinsky-syndrom/");
    const panel = page.locator("#milujufilmy-panel");
    const primary = panel.getByRole("region", { name: "Hlavní titul" });
    await expect(primary.getByRole("heading", { name: "Helsinský syndrom" })).toBeVisible();
    await expect(primary).toContainText("78 %");
    await expect(panel.getByRole("heading", { name: /Další nalezené filmy/ })).toBeVisible();
    await panel.getByRole("button", { name: "Skrýt panel MilujuFilmy" }).click();
    await expect(primary).toHaveCount(0);
    await page.reload();
    await expect(panel.getByRole("button", { name: "Zobrazit panel MilujuFilmy" })).toBeVisible();
    await panel.getByRole("button", { name: "Zobrazit panel MilujuFilmy" }).click();
    const navigate = async (name: string, path: string) => page.evaluate(({ name, path }) => {
      history.pushState({}, "", path);
      document.querySelector("#metadata")!.textContent = JSON.stringify({ "@type": "Movie", name });
      document.querySelector("h1")!.textContent = name;
    }, { name, path });
    await navigate("Starý titul", "/porady/3-stary/");
    await expect(primary).toContainText("Starý titul");
    await navigate("Strach nad městem", "/porady/1001879362-strach-nad-mestem/");
    await expect(primary.getByRole("heading")).toHaveText("Strach nad městem");
    await expect(primary).toContainText("78 %");
    await page.waitForTimeout(1100);
    await expect(primary.getByRole("heading")).toHaveText("Strach nad městem");
    await page.locator("#fullscreen").click();
    await expect(panel).toBeHidden();
    await page.evaluate(() => document.exitFullscreen());
    await expect(panel).toBeVisible();
    fail = true;
    await navigate("Nedostupný film", "/porady/4-nedostupny/");
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(primary).toContainText("nedostupné");
  } finally { await context.close(); }
});
