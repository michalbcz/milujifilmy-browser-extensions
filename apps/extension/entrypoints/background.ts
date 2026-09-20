import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";
import { browser } from "wxt/browser";
import { lookupBatch, saveOverride, saveCsfdUrl } from "../src/api.js";
import { LatestRequests, resolveRequestedTabId, tabStateStorageKey, type TabState } from "../src/tab-state.js";

const tabs = new Map<number, TabState>();
const requests = new LatestRequests();

async function readTabState(tabId: number): Promise<TabState> {
  const key = tabStateStorageKey(tabId);
  const stored = await browser.storage.session.get(key);
  return (stored[key] as TabState | undefined) ?? tabs.get(tabId) ?? { titles: [], results: [] };
}

async function writeTabState(tabId: number, state: TabState): Promise<void> {
  tabs.set(tabId, state);
  await browser.storage.session.set({ [tabStateStorageKey(tabId)]: state });
  void browser.tabs.sendMessage(tabId, { type: "tab-state-updated", state }).catch(() => undefined);
  try {
    await browser.runtime.sendMessage({ type: "tab-state-updated", tabId, state });
  } catch {
    // The panel is closed; session storage still preserves the state.
  }
}

async function openPanel(tabId: number): Promise<void> {
  const api = (globalThis as unknown as { chrome?: { sidePanel?: { open: (options: { tabId: number }) => Promise<void> } } }).chrome?.sidePanel;
  if (api) await api.open({ tabId });
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id !== undefined) {
      try { await browser.tabs.sendMessage(tab.id, { type: "toggle-panel" }); }
      catch { await openPanel(tab.id); }
    }
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url) return;
    requests.begin(tabId);
    void writeTabState(tabId, { titles: [], results: [], url: change.url, loading: true });
    void browser.tabs.sendMessage(tabId, { type: "navigation" }).catch(() => undefined);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    tabs.delete(tabId);
    requests.remove(tabId);
    void browser.storage.session.remove(tabStateStorageKey(tabId));
    void browser.storage.session.remove(`panel-hidden:${tabId}`);
  });
  browser.runtime.onMessage.addListener(async (message: any, sender: any) => {
    const tabId = sender.tab?.id;
    if (message?.type === "panel-preference" && tabId !== undefined) {
      const key = `panel-hidden:${tabId}`;
      if (typeof message.hidden === "boolean") await browser.storage.session.set({ [key]: message.hidden });
      return { hidden: Boolean((await browser.storage.session.get(key))[key]) };
    }
    if (message?.type === "open-panel" && tabId !== undefined) return openPanel(tabId);
    if (message?.type === "tab-state") {
      const active = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      const requestedTabId = resolveRequestedTabId(
        typeof message.tabId === "number" ? message.tabId : undefined,
        tabId,
        active[0]?.id,
      );
      return requestedTabId === undefined ? { titles: [], results: [] } : readTabState(requestedTabId);
    }
    if ((message?.type === "override" || message?.type === "csfd-url") && message.detected) {
      try {
        if (message.type === "override") await saveOverride(message.detected as DetectedTitle, message.selected as RatingCandidate);
        else await saveCsfdUrl(message.detected as DetectedTitle, message.url);
        return { ok: true };
      } catch (error) { return { error: error instanceof Error ? error.message : "Uložení se nezdařilo." }; }
    }
    if (message?.type !== "lookup" || !Array.isArray(message.items) || tabId === undefined) return undefined;
    const titles = (message.items as DetectedTitle[]).slice(0, 25);
    const revision = requests.begin(tabId);
    const state: TabState = { titles, results: [], url: message.url, loading: Boolean(titles.length) };
    await writeTabState(tabId, state);
    try {
      const primary = titles.filter((title) => title.pageRole === "primary");
      const related = titles.filter((title) => title.pageRole !== "primary");
      for (const batch of [primary, related].filter((items) => items.length)) {
        const fresh = await lookupBatch(batch);
        if (!requests.isCurrent(tabId, revision)) return { stale: true };
        state.results.push(...fresh);
        state.loading = state.results.length < titles.length;
        await writeTabState(tabId, { ...state });
      }
      return state;
    } catch (error) {
      if (!requests.isCurrent(tabId, revision)) return { stale: true };
      state.loading = false;
      state.error = error instanceof Error ? error.message : "Lookup se nezdařil.";
      await writeTabState(tabId, state);
      return state;
    }
  });
});
