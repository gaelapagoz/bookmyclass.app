import { describe, expect, it, vi } from "vitest";
import { createInMemoryTtlCache } from "../../src/lib/cache/in-memory-ttl-cache";

describe("createInMemoryTtlCache", () => {
  it("returns cached value within TTL and reloads after expiration", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.useFakeTimers();
    const cache = createInMemoryTtlCache<number>({ defaultTtlMs: 50 });
    let value = 0;
    const loader = vi.fn(async () => {
      value += 1;
      return value;
    });

    await expect(cache.getOrLoad("k", loader)).resolves.toBe(1);
    await expect(cache.getOrLoad("k", loader)).resolves.toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(51);
    await expect(cache.getOrLoad("k", loader)).resolves.toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("deduplicates concurrent loads for the same key", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const cache = createInMemoryTtlCache<string>({ defaultTtlMs: 50 });
    const loader = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "value";
    });

    const [first, second] = await Promise.all([cache.getOrLoad("k", loader), cache.getOrLoad("k", loader)]);
    expect(first).toBe("value");
    expect(second).toBe("value");
    expect(loader).toHaveBeenCalledTimes(1);
    process.env.NODE_ENV = originalNodeEnv;
  });
});
