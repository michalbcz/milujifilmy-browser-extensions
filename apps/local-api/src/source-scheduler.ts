export interface JsonStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  entries(): [string, unknown][];
}
export class MemoryStore implements JsonStore {
  private values = new Map<string, unknown>();
  get(key: string) { return this.values.get(key); }
  set(key: string, value: unknown) { this.values.set(key, value); }
  entries(): [string, unknown][] { return [...this.values]; }
}
export interface SourceState { count: number; retryAt: number; nextAt: number; error?: string; }
export class SourceUnavailable extends Error {
  constructor(message: string, readonly retryAfterMs = 0) { super(message); }
}
export function retryAfterMs(response: Response): number {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const milliseconds = /^\d+$/.test(value) ? Number(value)*1000 : Date.parse(value)-Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

/** Serial, polite per-source queues; persisted state survives process restarts. */
export class SourceScheduler {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private readonly store: JsonStore = new MemoryStore(), private readonly intervalMs = 1000) {}
  status(source?: string): Record<string, SourceState> {
    return Object.fromEntries(this.store.entries().filter(([key, value]) => key.startsWith('backoff:')
      && (!source || key === `backoff:${source}`) && (value as SourceState).error)
      .map(([key, value]) => [key.slice(8), value as SourceState]));
  }
  run<T>(source: string, work: () => Promise<T>): Promise<T> {
    const key = `backoff:${source}`;
    const task = (this.queues.get(source) ?? Promise.resolve()).then(async () => {
      const previous = this.store.get(key) as SourceState | undefined;
      if (previous && previous.retryAt > Date.now()) throw new SourceUnavailable(previous.error ?? 'Zdroj není dostupný.');
      const delay = (previous?.nextAt ?? 0)-Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      const nextAt = Date.now()+this.intervalMs;
      this.store.set(key, { ...previous, nextAt });
      try {
        const result = await work();
        this.store.set(key, { count: 0, retryAt: 0, nextAt });
        return result;
      } catch (error) {
        const count = (previous?.count ?? 0)+1;
        const delayMs = Math.max(Math.min(3_600_000, 30_000*2**Math.min(count-1, 10)), error instanceof SourceUnavailable ? error.retryAfterMs : 0);
        this.store.set(key, { count, nextAt, retryAt: Date.now()+delayMs,
          error: error instanceof Error ? error.message : 'Zdroj není dostupný.' });
        throw error;
      }
    });
    this.queues.set(source, task.catch(() => undefined));
    return task;
  }
}
