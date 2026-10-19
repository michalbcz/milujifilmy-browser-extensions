import { chromium, expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("live iVysílání titles resolve automatically through the persistent backend", async () => {
  test.skip(process.env.MILUJU_FILMY_LIVE_E2E !== "1", "Requires the local paired backend and public websites");
  test.setTimeout(120_000);
  const extension = resolve(".output/chrome-mv3");
  const context = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const token = (await readFile(resolve("../../data/pairing-token.txt"), "utf8")).trim();
    await worker.evaluate((token) => (globalThis as any).chrome.storage.local.set({ settings: { token } }), token);
    const page = await context.newPage();
    for (const [path, title, rating, imdb, csfdId] of [
      ["12905661003-strazce-zakona", "Strážce zákona", "73 %", "6,6/10", "228849"],
      ["17338616473-helsinsky-syndrom", "Helsinský syndrom", "78 %", "6,9/10", "1224558"],
      ["1001879362-strach-nad-mestem", "Strach nad městem", "76 %", "6,9/10", "32437"],
      ["15329267190-tohle-bude-bolet", "Tohle bude bolet", "83 %", "8,3/10", "1131100"],
    ]) {
      await page.goto(`https://www.ceskatelevize.cz/porady/${path}/`, { waitUntil: "domcontentloaded" });
      const primary = page.locator("#milujufilmy-panel").getByRole("region", { name: "Hlavní titul" });
      await expect(primary.getByRole("heading")).toHaveText(title, { timeout: 20_000 });
      await expect(primary).toContainText(rating, { timeout: 60_000 });
      await expect(primary).toContainText(imdb);
      await expect(primary.getByRole("link", { name: "ČSFD", exact: true })).toHaveAttribute("href", new RegExp(`^https://www\\.csfd\\.cz/film/${csfdId}(?:/|-)`));
      await expect(primary).not.toContainText("Možná chybná shoda");
      await page.screenshot({ path: `test-results/live-${path}.png` });
    }
    await page.goto("https://www.ceskatelevize.cz/porady/17338616473-helsinsky-syndrom/226388771040001/", { waitUntil: "domcontentloaded" });
    const epPrimary = page.locator("#milujufilmy-panel").getByRole("region", { name: "Hlavní titul" });
    await expect(epPrimary.getByRole("heading")).toHaveText("Helsinský syndrom", { timeout: 20_000 });
    await expect(epPrimary).toContainText("78 %", { timeout: 60_000 });
    await expect(epPrimary).not.toContainText("Možná chybná shoda");
    await expect(page.locator("#milujufilmy-panel").getByRole("region", { name: "Otevřená epizoda" }).getByRole("heading")).toHaveText("1. epizoda");
    await page.goto("https://www.ceskatelevize.cz/porady/10354229723-pripady-1-oddeleni/213512120200002/", { waitUntil: "domcontentloaded" });
    const episode = page.locator("#milujufilmy-panel").getByRole("region", { name: "Otevřená epizoda" });
    await expect(episode.getByRole("heading")).toHaveText("Fantom z Jižáku", { timeout: 20_000 });
    await expect(episode.getByRole("link", { name: "ČSFD", exact: true })).toHaveAttribute("href", /^https:\/\/www\.csfd\.cz\/film\/339773-[^/]+\/417726-/, { timeout: 60_000 });
    await expect(episode).not.toContainText("Možná chybná shoda");
    await expect(page.locator("#milujufilmy-panel").getByRole("region", { name: "Hlavní titul" }).getByRole("link", { name: "ČSFD", exact: true })).toHaveAttribute("href", /^https:\/\/www\.csfd\.cz\/film\/339773-/);
    await page.screenshot({ path: "test-results/live-episode-pripady.png" });
    // A later-season episode outside the visible episode list must not fall back to season 1.
    await page.goto("https://www.ceskatelevize.cz/porady/10354229723-pripady-1-oddeleni/220512120080013/", { waitUntil: "domcontentloaded" });
    const laterSeason = page.locator("#milujufilmy-panel").getByRole("region", { name: "Otevřená epizoda" });
    await expect(laterSeason.getByRole("heading")).toHaveText("Trik", { timeout: 20_000 });
    await expect(laterSeason).toContainText("S03E13");
    await expect(laterSeason.getByRole("link", { name: "ČSFD", exact: true })).toHaveAttribute("href", /^https:\/\/www\.csfd\.cz\/film\/339773-[^/]+\/1214793-/, { timeout: 60_000 });
    await page.goto("https://www.ceskatelevize.cz/porady/16373259302-gerta-schnirch/424233100041001/", { waitUntil: "domcontentloaded" });
    const gertaPrimary = page.locator("#milujufilmy-panel").getByRole("region", { name: "Hlavní titul" });
    await expect(gertaPrimary.getByRole("heading")).toHaveText("Gerta Schnirch", { timeout: 20_000 });
    await expect(gertaPrimary).toContainText("80 %", { timeout: 60_000 });
    await expect(gertaPrimary).not.toContainText("Možná chybná shoda");
  } finally { await context.close(); }
});
