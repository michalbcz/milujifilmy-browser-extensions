import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";
export interface TabState {
  titles: DetectedTitle[];
  results: Array<{ requestId: string; candidates: RatingCandidate[]; warnings?: string[] }>;
  url?: string;
  loading?: boolean;
  error?: string;
}

export class LatestRequests {
  private ids = new Map<number, number>();
  begin(tabId: number): number {
    const id = (this.ids.get(tabId) ?? 0) + 1;
    this.ids.set(tabId, id);
    return id;
  }
  isCurrent(tabId: number, id: number) { return this.ids.get(tabId) === id; }
  remove(tabId: number) { this.ids.delete(tabId); }
}

export function tabStateStorageKey(tabId: number): string {
  return `tab-state:${tabId}`;
}

export function resolveRequestedTabId(
  explicitTabId: number | undefined,
  senderTabId: number | undefined,
  activeTabId: number | undefined,
): number | undefined {
  return explicitTabId ?? senderTabId ?? activeTabId;
}
