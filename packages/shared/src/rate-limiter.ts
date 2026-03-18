/**
 * Simple rate limiter for API connectors.
 * Ensures a minimum interval between requests.
 */
export class RateLimiter {
  private lastRequest = 0;
  private readonly minIntervalMs: number;

  /** @param requestsPerSecond Maximum requests per second (e.g., 3 = 333ms between requests) */
  constructor(requestsPerSecond: number) {
    this.minIntervalMs = Math.ceil(1000 / requestsPerSecond);
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequest = Date.now();
  }
}
