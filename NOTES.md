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

## 2. What I noticed

## 3. What I'd do with more time
