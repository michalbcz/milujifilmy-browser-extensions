import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type { TabState } from "../tab-state.js";
import { RatingsPanel } from "./ratings-panel.js";
import "../../entrypoints/ui.css";

function App() {
  const [state, setState] = useState<TabState>({ titles: [], results: [] });
  const [tabId, setTabId] = useState<number>();
  useEffect(() => {
    let current: number | undefined;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (request !== revision) return;
      current = tabs[0]?.id; setTabId(current); setState({ titles: [], results: [], loading: true });
      const value = await browser.runtime.sendMessage({ type: "tab-state", tabId: current });
      if (request === revision) setState(value as TabState);
    };
    const onMessage = (message: any) => {
      if (message?.type === "tab-state-updated" && message.tabId === current) setState(message.state as TabState);
    };
    browser.runtime.onMessage.addListener(onMessage);
    browser.tabs.onActivated.addListener(load);
    void load();
    return () => { revision++; browser.runtime.onMessage.removeListener(onMessage); browser.tabs.onActivated.removeListener(load); };
  }, []);
  return <RatingsPanel state={state} onRefresh={() => { if (tabId !== undefined) void browser.tabs.sendMessage(tabId, { type: "refresh-panel" }); }} />;
}

createRoot(document.getElementById("root")!).render(<App />);
