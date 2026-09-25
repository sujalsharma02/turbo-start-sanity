# Notes

Production URL: _to be added after the Vercel deploy_

## 1. What I built and why

### Newsletter signup

**Rate limit.** `POST /api/newsletter` is limited to **5 requests per minute per client IP**.
The limiter is the shared helper in `apps/web/src/lib/rate-limit.ts` (lifted out of the
existing `/api/ask` route so both use one implementation), applied at the top of
`apps/web/src/app/api/newsletter/route.ts` before any parsing or Sanity write. Over the
limit, JSON callers get `429 { "error": "Too many signups in a short time…" }` and a
browser form post is redirected back to the page with `?newsletter=limited`. The IP is
the last hop of `x-forwarded-for`, which is the address Vercel's proxy saw. The window
is in memory and therefore per serverless instance: the effective ceiling is 5 × warm
instances and resets on a cold start. That stops casual scripts, not a distributed
attacker; a global limit belongs in a Vercel Firewall rule or a shared store.

### Blog search (Algolia)

**Rate limit and bounds.** `GET /api/blog/search` and the server-rendered `/blog?q=` page are
limited to **30 requests per minute per client IP**, sharing one bucket. The limiter is the same
helper, `apps/web/src/lib/rate-limit.ts`, instantiated as `isSearchRateLimited` in
`apps/web/src/lib/algolia.ts` and applied in `apps/web/src/app/api/blog/search/route.ts` and in
`apps/web/src/app/blog/page.tsx` before Algolia is called. Input is bounded in
`parseSearchParams`: `q` is trimmed and capped at 100 characters, `page` must be an integer from
1 to 100, and `category` must be one of the six values in the shared taxonomy. Anything else is
a 400 on the API and a 404 on the page. Over the limit, the API answers 429 and the page renders
its "Search failed" state. Same per-instance caveat as the newsletter limiter.

**Algolia unavailable.** The API answers a generic 503 and the page shows the existing
"Search failed" state; there is no fallback to a Sanity full scan, because that scan is the cost
this change removes. The unfiltered `/blog` list keeps working since it does not touch Algolia.

## 2. What I noticed

## 3. What I'd do with more time
