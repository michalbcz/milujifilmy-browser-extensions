import { describe, expect, it, vi } from "vitest";
import { createRefreshQueue } from "../src/refresh-queue.js";

describe("createRefreshQueue", () => {
  it("runs one follow-up lookup after a burst of DOM changes", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const queue = createRefreshQueue(refresh, 100);

    queue();
    queue();
    queue();
    vi.advanceTimersByTime(100);

    expect(refresh).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
