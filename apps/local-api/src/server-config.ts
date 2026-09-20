export function listenHost(environment: NodeJS.ProcessEnv = process.env) {
  return environment.MILUJU_FILMY_LISTEN_HOST ?? "127.0.0.1";
}

export function searchConfig(environment: NodeJS.ProcessEnv = process.env): { searxngUrl?: string } {
  const provider = environment.MILUJU_FILMY_SEARCH_PROVIDER ?? "searxng";
  if (provider === "none") return {};
  if (provider !== "searxng") throw new Error("MILUJU_FILMY_SEARCH_PROVIDER must be searxng or none");
  return { searxngUrl: environment.MILUJU_FILMY_SEARXNG_URL ?? "http://127.0.0.1:47322" };
}
