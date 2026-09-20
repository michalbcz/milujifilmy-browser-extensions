import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";
import { browser } from "wxt/browser";

const API_URL = "http://127.0.0.1:47321";
const SETTINGS_KEY = "settings";

export interface ExtensionSettings { token?: string; }
export interface LookupResult { requestId: string; candidates: RatingCandidate[]; warnings?: string[]; }

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return (stored[SETTINGS_KEY] as ExtensionSettings | undefined) ?? {};
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function lookupBatch(items: DetectedTitle[]): Promise<LookupResult[]> {
  const { token } = await getSettings();
  if (!token) throw new Error("Nejdřív vložte párovací token v nastavení rozšíření.");
  const response = await fetch(`${API_URL}/v1/lookup/batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-milujufilmy-client": "extension" },
    body: JSON.stringify({ items: items.slice(0, 25) }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Párovací token není platný." : "Lokální backend není dostupný.");
  return (await response.json() as { results: LookupResult[] }).results;
}

export async function saveCsfdUrl(detected: DetectedTitle, url: string): Promise<void> {
  const { token } = await getSettings();
  const response = await fetch(`${API_URL}/v1/matches/csfd`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-milujufilmy-client": "extension" },
    body: JSON.stringify({ detected, url }), signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "ČSFD není dostupné.");
}

export async function saveOverride(detected: DetectedTitle, selected: RatingCandidate): Promise<void> {
  const { token } = await getSettings();
  if (!token) throw new Error("Nejdřív vložte párovací token v nastavení rozšíření.");
  const response = await fetch(`${API_URL}/v1/matches/override`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-milujufilmy-client": "extension" },
    body: JSON.stringify({ detected, selected }),
  });
  if (!response.ok) throw new Error("Ruční opravu se nepodařilo uložit.");
}
