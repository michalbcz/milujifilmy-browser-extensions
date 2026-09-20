import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";
import { browser } from "wxt/browser";
import { bestCandidate } from "../src/matching.js";
import { extractVisibleTitles, providerForUrl } from "../src/providers.js";
import { createRefreshQueue } from "../src/refresh-queue.js";
import { createInPagePanel } from "../src/ui/in-page-panel.js";
import type { TabState } from "../src/tab-state.js";

const BADGE_ATTRIBUTE = "data-milujufilmy-badge";

function badgeText(title: DetectedTitle, candidates: RatingCandidate[]): string {
  const matchTitle = title.originalTitle ?? title.title;
  const imdb = bestCandidate(matchTitle, title.year, candidates.filter((candidate) => candidate.source === "imdb"));
  const csfd = bestCandidate(matchTitle, title.year, candidates.filter((candidate) => candidate.source === "csfd"));
  const format = (value: typeof imdb, label: string) => value?.candidate.rating ? `${label} ${value.candidate.rating.value}${value.candidate.rating.scale === 100 ? "%" : "/10"}${value.uncertain ? " ?" : ""}` : "";
  return [format(imdb, "IMDb"), format(csfd, "ČSFD")].filter(Boolean).join(" · ");
}

function addBadge(target: Element, title: DetectedTitle, candidates: RatingCandidate[], open: () => void): void {
  target.querySelector(`:scope > [${BADGE_ATTRIBUTE}]`)?.remove();
  const text = badgeText(title, candidates);
  if (!text) return;
  const host = document.createElement("span");
  host.setAttribute(BADGE_ATTRIBUTE, "true");
  host.style.cssText = "position:absolute;z-index:2147483647;top:8px;left:8px;display:block";
  const root = host.attachShadow({ mode: "closed" });
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", `Hodnocení ${title.title}`);
  button.style.cssText = "all:initial;font:600 12px/1.2 system-ui,sans-serif;color:#fff;background:#171717e8;border:1px solid #ffffff66;border-radius:5px;padding:5px 7px;cursor:pointer";
  button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); open(); });
  root.append(button);
  const position = getComputedStyle(target).position;
  if (position === "static") (target as HTMLElement).style.position = "relative";
  target.append(host);
}

export default defineContentScript({
  matches: ["*://*.netflix.com/*", "*://*.max.com/*", "*://*.disneyplus.com/*", "*://*.primevideo.com/*", "*://*.oneplay.cz/*", "*://*.iprima.cz/*", "*://*.primaplus.cz/*", "*://*.ceskatelevize.cz/*", "*://*.stream.cz/*"],
  runAt: "document_idle",
  async main(ctx) {
    const adapter = providerForUrl(new URL(location.href));
    if (!adapter) return;
    const resolvedAdapter = adapter;
    let pageUrl = location.href;
    let signature = "";
    let generation = 0;
    let titles: DetectedTitle[] = [];
    const preference = await browser.runtime.sendMessage({ type: "panel-preference" }) as { hidden?: boolean };
    if (ctx.isInvalid) return;
    const panel = createInPagePanel({ hidden: preference?.hidden ?? false,
      onHidden: (hidden) => { void browser.runtime.sendMessage({ type: "panel-preference", hidden }); },
      onRefresh: () => { signature = ""; void refresh(); },
    });
    const clearBadges = () => document.querySelectorAll(`[${BADGE_ATTRIBUTE}]`).forEach((badge) => badge.remove());
    const update = (state: TabState) => {
      if (state.url !== location.href || (state.titles[0]?.requestId !== titles[0]?.requestId)) return;
      panel.update(state);
      if (document.fullscreenElement) return;
      for (const card of document.querySelectorAll(resolvedAdapter.cardSelectors.join(","))) {
        const label = (card.querySelector("img[alt]")?.getAttribute("alt") ?? card.getAttribute("aria-label") ?? "").replace(/\s+/g, " ");
        const title = titles.find((item) => item.title === label);
        const result = title && state.results.find((item) => item.requestId === title.requestId);
        if (title && result) addBadge(card, title, result.candidates, () => panel.show());
      }
    };
    async function refresh() {
      if (ctx.isInvalid || document.fullscreenElement) return;
      const found = extractVisibleTitles(document, new URL(location.href), resolvedAdapter).slice(0, 25);
      const next = JSON.stringify([location.href, found.map(({ requestId, ...title }) => title)]);
      if (next === signature) return;
      signature = next;
      const request = ++generation;
      titles = found;
      clearBadges();
      const state: TabState = { titles, results: [], url: location.href, loading: Boolean(titles.length) };
      panel.update(state);
      try {
        const response = await browser.runtime.sendMessage({ type: "lookup", items: titles, url: state.url }) as TabState & { stale?: boolean };
        if (request === generation && !response?.stale) update(response as TabState);
      } catch (error) {
        if (request === generation) panel.update({ ...state, loading: false, error: error instanceof Error ? error.message : "Backend není dostupný." });
      }
    }
    const queueRefresh = createRefreshQueue(() => void refresh(), 250);
    const navigate = () => {
      if (location.href === pageUrl) return;
      pageUrl = location.href; signature = ""; generation++; titles = [];
      clearBadges(); panel.update({ titles: [], results: [], url: pageUrl, loading: true });
      queueRefresh();
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) queueRefresh();
    }, { threshold: 0.05 });
    const observed = new WeakSet<Element>();
    const observeCards = () => document.querySelectorAll(resolvedAdapter.cardSelectors.join(",")).forEach((card) => {
      if (!observed.has(card)) { observed.add(card); observer.observe(card); }
    });
    observeCards();
    const mutations = new MutationObserver((records) => {
      navigate();
      observeCards();
      const own = (node: Node) => node instanceof Element && (node.hasAttribute(BADGE_ATTRIBUTE) || node.hasAttribute("data-milujufilmy-ui"));
      if (records.some((record) => record.type !== "childList" || [...record.addedNodes, ...record.removedNodes].some((node) => !own(node)))) queueRefresh();
    });
    mutations.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "alt", "aria-label", "content"] });
    const onMessage = (message: any) => {
      if (message?.type === "toggle-panel") panel.toggle();
      if (message?.type === "refresh-panel") { signature = ""; void refresh(); }
      if (message?.type === "navigation") navigate();
      if (message?.type === "tab-state-updated") update(message.state as TabState);
    };
    browser.runtime.onMessage.addListener(onMessage);
    const fullscreen = () => { panel.fullscreen(); clearBadges(); if (!document.fullscreenElement) { signature = ""; void refresh(); } };
    document.addEventListener("fullscreenchange", fullscreen);
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    const urlTimer = window.setInterval(navigate, 300);
    ctx.onInvalidated(() => { generation++; mutations.disconnect(); observer.disconnect(); clearInterval(urlTimer); document.removeEventListener("fullscreenchange", fullscreen); window.removeEventListener("popstate", navigate); window.removeEventListener("hashchange", navigate); browser.runtime.onMessage.removeListener(onMessage); panel.destroy(); clearBadges(); });
    void refresh();
  },
});
