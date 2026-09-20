export default {
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "MilujuFilmy",
    description: "IMDb a ČSFD hodnocení u podporovaných videoték (osobní použití).",
    permissions: ["storage", "sidePanel", "tabs"],
    host_permissions: [
      "http://127.0.0.1:47321/*",
      "*://*.netflix.com/*", "*://*.max.com/*", "*://*.disneyplus.com/*", "*://*.primevideo.com/*",
      "*://*.oneplay.cz/*", "*://*.iprima.cz/*", "*://*.primaplus.cz/*", "*://*.ceskatelevize.cz/*", "*://*.stream.cz/*",
    ],
    action: { default_title: "Otevřít MilujuFilmy" },
    side_panel: { default_path: "sidepanel.html" },
    options_ui: { page: "options.html", open_in_tab: true },
  },
};
