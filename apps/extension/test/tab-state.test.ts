import { describe, expect, it } from "vitest";
import { resolveRequestedTabId, tabStateStorageKey } from "../src/tab-state.js";

describe("tab-specific side-panel state", () => {
  it("uses the panel's explicit tab before sender and active-tab fallbacks", () => {
    expect(resolveRequestedTabId(73, 41, 12)).toBe(73);
    expect(resolveRequestedTabId(undefined, 41, 12)).toBe(41);
    expect(resolveRequestedTabId(undefined, undefined, 12)).toBe(12);
  });

  it("uses a stable session-storage key per tab", () => {
    expect(tabStateStorageKey(73)).toBe("tab-state:73");
  });
});
