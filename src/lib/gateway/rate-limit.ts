export interface RateLimiter {
  /** Returns true if the key is allowed another hit inside the window. */
  hit(key: string): Promise<boolean>;
}

/**
 * Sliding-window limiter kept in process memory. Good enough for a single
 * Sanad instance; swap for the Valkey-backed implementation when the worker
 * process lands (SPEC §6.1: 20 messages / 5 min).
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = 20,
    private readonly windowMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async hit(key: string): Promise<boolean> {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    recent.push(t);
    this.hits.set(key, recent);
    return recent.length <= this.limit;
  }
}
