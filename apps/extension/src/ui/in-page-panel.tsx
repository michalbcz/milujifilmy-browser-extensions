import { createRoot } from "react-dom/client";
import { RatingsPanel } from "./ratings-panel.js";
import type { TabState } from "../tab-state.js";
import css from "../../entrypoints/ui.css?inline";

export function createInPagePanel(options: { hidden: boolean; onHidden: (hidden: boolean) => void; onRefresh: () => void }) {
  const host = document.createElement("div");
  host.id = "milujufilmy-panel";
  host.setAttribute("data-milujufilmy-ui", "");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${css}\n:host{all:initial;position:fixed;inset:88px 16px auto auto;z-index:2147483646;width:min(360px,calc(100vw - 32px));color:#202124;font:14px/1.5 system-ui,sans-serif;color-scheme:light} .panel-shell{background:#fffaf4;border:1px solid #d7cbbc;border-radius:14px;box-shadow:0 8px 36px #0004;max-height:calc(100dvh - 110px);overflow:auto;overscroll-behavior:contain} main{max-width:none}.launcher{box-shadow:0 3px 18px #0004;float:right} :host([hidden]){display:none!important}`;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  document.documentElement.append(host);
  const root = createRoot(mount);
  let hidden = options.hidden;
  let state: TabState = { titles: [], results: [], loading: true };
  const setHidden = (value: boolean) => { hidden = value; options.onHidden(value); render(); };
  const render = () => {
    host.hidden = Boolean(document.fullscreenElement);
    root.render(hidden ? <button className="launcher" aria-label="Zobrazit panel MilujuFilmy" onClick={() => setHidden(false)}>MilujuFilmy · hodnocení</button>
      : <aside className="panel-shell" aria-label="MilujuFilmy"><RatingsPanel state={state} onHide={() => setHidden(true)} onRefresh={options.onRefresh} /></aside>);
  };
  render();
  return {
    update(value: TabState) { state = value; render(); },
    toggle() { setHidden(!hidden); },
    show() { setHidden(false); },
    fullscreen() { host.hidden = Boolean(document.fullscreenElement); },
    destroy() { root.unmount(); host.remove(); },
  };
}
