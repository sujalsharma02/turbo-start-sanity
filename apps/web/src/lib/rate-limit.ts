/**
 * Sliding-window request limiter keyed on client IP.
 *
 * Per server instance only: on Vercel every warm function instance has its own
 * Map, so the effective ceiling is `limit` × instances and it resets on a cold
 * start. It stops casual loops and scripts, not a distributed attacker; use a
 * Vercel Firewall rule (or a shared store) for a global limit.
 */
export function createRateLimiter({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}) {
  const recentRequests = new Map<string, number[]>();

  return function isRateLimited(ip: string): boolean {
    const now = Date.now();
    // Drop idle keys so the map cannot grow without bound.
    for (const [key, times] of recentRequests) {
      if (now - (times.at(-1) ?? 0) >= windowMs) recentRequests.delete(key);
    }
    const recent = (recentRequests.get(ip) ?? []).filter(
      (time) => now - time < windowMs
    );
    const limited = recent.length >= limit;
    if (!limited) recent.push(now);
    recentRequests.set(ip, recent);
    return limited;
  };
}

/**
 * The last hop of `x-forwarded-for` is the address Vercel's proxy saw; earlier
 * hops are client-supplied and spoofable. Local dev has no proxy, so everything
 * shares one bucket.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
}
