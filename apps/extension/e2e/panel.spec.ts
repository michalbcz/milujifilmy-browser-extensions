import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("automatic panel, hide/show, SPA navigation, stale responses, fullscreen and unavailable API", async () => {
  const extension = resolve(".output/chrome-mv3");
  const context = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ settings: { token: "fixture-token" } }));
    let fail = false;
    await context.route("http://127.0.0.1:47321/**", async (route) => {
      if (fail) return route.abort();
      const { items } = route.request().postDataJSON();
      // Delay the old title to exercise navigation while a real lookup is pending.
      if (items[0].title === "Starý titul") await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({ json: { results: items.map((title: any) => ({ requestId: title.requestId, candidates: [{ source: "csfd", sourceId: "1224558", sourceUrl: "https://www.csfd.cz/film/1224558/prehled/", canonicalTitle: title.title, kind: title.kind, year: 2022, rating: { value: 78, scale: 100, votes: 45, fetchedAt: "2026-09-20T00:00:00Z" }, evidence: ["fixture"] }] })) } });
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
