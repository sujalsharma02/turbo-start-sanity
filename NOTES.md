# Notes

Production site: https://turbo-start-sanity-web-swart.vercel.app
Sanity-hosted Studio (`npx sanity deploy`): https://turbo-start-sanity-sujal.sanity.studio
Sanity project `tzzuuieg`, dataset `production`. Algolia index `blog_posts`.

Time spent: roughly 9 and half hours across three evenings, plus the setup hour.

## 1. What I built and why

### Newsletter signup (task 1)

**Storage and dedupe.** A `subscriber` document type with just an email and a read-only
`subscribedAt`. The route derives the document id from the normalised address
(`subscriber-<sha256 of the lowercased, trimmed email>`) and writes it with
`createIfNotExists`, so a second signup with the same address is the same document and a
no-op. I chose this over "query, then create" because two concurrent submits would both find
nothing and both create; a deterministic id makes Sanity enforce uniqueness for me. Hashing
rather than embedding the address keeps it out of ids and URLs. Plus-tagged addresses are
deliberately distinct.

**The form.** The block already renders `<form action method>` with `<input name="email">`;
nobody passed it an action. I pass `action="/api/newsletter"` and `method="post"` from the
page builder, so the form is a plain browser post that works with JavaScript off. The route
therefore reads `formData()` for browsers and `json()` for curl, and answers a browser with a
303 back to the same-origin referring page (`?newsletter=ok|invalid|limited|error#subscribe`)
and a script with a status code. The call that could have gone the other way: a React server
action would keep the block's `useFormStatus` spinner alive; I preferred zero JavaScript on the
critical path and accepted losing the spinner. No on-page message either; the query value is
the feedback. Both are noted as follow-ups below.

**Validation.** A length cap and one regex, no library. `zod` is only resolvable inside the
env package, the browser already enforces `type="email"`, and the mail server is the real
validator. Invalid input is a 400 (or `?newsletter=invalid`), never a 500. Sanity failures
answer a generic 503; the reason goes to the log.

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

**Where the block lives.** SETUP.md says `/benchmark/nesting` already carries the block; in the
seed it does not (see section 2), so I appended one to that page.

### Search on Algolia (task 2c)

**The record.** Exactly the blog-card projection the existing `BlogCard` reads, keyed by the
Sanity `_id` as `objectID`, plus a flat `authorName` so it can be a searchable attribute. That
means Algolia hits satisfy the existing `Blog` type and render through the existing list with
no adapter. `searchableAttributes` is `["title", "description", "authorName"]` and
`attributesForFaceting` is `["filterOnly(category)"]`, set from code in the backfill.
`hitsPerPage` equals the blog index's page size so the existing pagination helpers and
component are reused unchanged.

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

**Keys.** Two clients: the search-only key for reads, the write key for the webhook and
backfill. The public route physically cannot write. Nothing Algolia-related is `NEXT_PUBLIC_`;
the browser talks to our route.

**Filter.** Category, because every seed post has one and the taxonomy already lives in one
shared file that both Studio and the site read. The existing sidebar links carry the query, so
filtering during a search is a plain navigation.

**Working without JavaScript.** The blog index is Partial Prerendering: a static page-one shell,
with the dynamic view streamed behind a Suspense fallback that React swaps in with an inline
script. With JavaScript off, that swap never happens, so `/blog?q=`, `?page=2` and `?category=`
all showed page one forever, on the untouched template too. I removed the shell for `/blog`
(`instant = false`, render the dynamic view directly) so the page blocks on its cached Sanity
read plus the Algolia call and sends one complete document. The search box is a plain GET form,
and category and page links carry `q`. With JavaScript, Enter no longer navigates (it wrote the
query into the URL in place, because a navigation repainted the shell), live results carry the
same page links, and clearing the box returns to the plain list. The trade is that `/blog`
loses its instant shell; the gain is a real 404 for out-of-range pages instead of the soft one
the file's own comment apologised for. Search result pages are `noindex`.

**Draft preview.** The old route searched drafts inside a Presentation session. Algolia holds
published documents only, so preview search now shows published hits. Deliberate.

### Backfill and settings (task 2b)

A secret-protected route, `POST /api/algolia/backfill`, rather than a script: it reuses the
env, the client and the record mapper with no cross-app imports, and one curl against
production proves it for VERIFY.md. Settings are set only when they differ from what the index
already has, because `setSettings` queues a full reindex that measured over three minutes on
the free plan and every later task waits behind it. Records are `saveObjects` upserts, so a
re-run rewrites identical records; nothing waits on Algolia task completion because Algolia
applies an index's tasks in arrival order and the outcome is decided once a call returns.

The call that could have gone the other way: `replaceAllObjects` would also prune records for
deleted posts. I did not use it because its temporary-index swap discards every webhook write
that lands during the whole run. With per-object upserts the race is narrower but real: a
publish between the backfill's fetch and its `saveObjects` can be overwritten by the older
snapshot until the next publish. It is seconds wide, the Studio tab shows the mismatch, and a
re-publish or re-run repairs it.

### Sync webhook (task 2a)

A GROQ-powered webhook (`_type == "blog"`, create/update/delete, drafts excluded, projection
`{_id, _type, "operation": delta::operation()}`) posting to `/api/algolia/sync`. The route
verifies `sanity-webhook-signature` itself: HMAC-SHA256 over `"<timestamp>.<raw body>"` with
the shared secret, compared with `timingSafeEqual`, rejected when older than five minutes,
and refused outright when the secret is unset. I did not use `parseBody` from
`next-sanity/webhook`: the installed `@sanity/webhook` compares signatures with a plain `!==`,
`parseBody` sleeps three seconds by default, and it returns `null` rather than `false` when the
header is missing. Ten lines of `node:crypto` met the bar the revalidate route sets.

Only the id is trusted from the body. The document is re-read from Sanity with the published
perspective, `useCdn: false` (the webhook fires before the CDN catches up) and `stega: false`
(the dev client embeds invisible characters). "Indexable" means published, has a slug, not
`seoHideFromLists`, not `seoNoIndex`; indexable means upsert, anything else means delete, both
keyed on the same object id, so a duplicate delivery changes nothing. Drafts and release
versions (`drafts.`, `versions.`) are acknowledged and ignored; other types answer 200 without
work. One guard I added deliberately: a create or update whose document cannot be read yet
answers 503 so Sanity redelivers, instead of deleting a post that was published a moment ago.

The webhook was created through Sanity's management API, the same endpoint the manage UI uses,
because the CLI's `hook create` is interactive and cannot set a GROQ filter or projection. It
is visible under API → Webhooks with its delivery log.

### SEO & Index tab (task 3)

Registered through `structureTool`'s `defaultDocumentNode` for the blog type only; the blog
index singleton keeps its own views. Built from `@sanity/ui` primitives so it looks like the
rest of Studio. The preview and checks read `document.displayed`, the live form value, which is
why they move on every keystroke before anything is saved. The index status reads
`document.published`, because only the published document decides what should be in Algolia,
and looks up the published `_id` over a plain `fetch` with the search-only key from
`SANITY_STUDIO_*` variables (Vite bundles those into the browser, so the admin key is never
there; I grepped the built bundle to be sure).

Decisions: the description check reuses the blog schema's 140–160 rule, now lifted into one
constant that the schema and the tab both read. The schema has no title limit, so the tab
enforces none; the preview cuts the title visually at 60 characters (roughly Google's 600 px)
and says so next to the count, and that is display, not a check. The index check runs when the
document or its published revision changes and on a button, never per keystroke. The tab only
appears when a post is opened through Structure; the Presentation tool captures edit intents
and shows the form alone (section 2).

### Dependency pin

Adding `algoliasearch` re-resolved the lockfile and deduped the Sanity CLI's `@sanity/codegen`
to 8.1.0, which rebuilt its config schema with valibot while `@sanity/cli` 8.3.0 still calls
the zod `.parse` on it. `sanity dev` died with `configDefinition.parse is not a function`;
`sanity build` did not, which is why it took a while to notice. A selector override pins the
CLI alone back to 8.0.0.

## 2. What I noticed

Things I would raise with a teammate. Where I could tell, I say whether I think it is a bug
or deliberate.

1. **SETUP.md versions contradict the repo.** SETUP.md says Node 22.12 and pnpm 10.32.1; the
   repo pins Node 24 and pnpm 11.24.0, and CI uses Node 24.21. Drift, not intent.
2. **The seed page does not carry the newsletter block.** SETUP.md says `/benchmark/nesting`
   already has it; the seed's page builder has hero, CTA, feature cards and FAQ. Stale seed.
3. **The seed hero has no media.** The hero block now renders from `video.light/dark` (poster,
   Mux or file variants), but the seeded home page hero only has a legacy top-level `image`
   the schema no longer defines, so the first thing a fresh install shows is an empty
   viewport-height banner. The `hero-media-type` migration suggests the seed predates the
   change. Stale seed, and the biggest LCP element on the page is painting nothing.
4. **`rule.warning("A page title is required")` never fires.** In `seo-fields.ts` and
   `og-fields.ts` the warning has no `.required()` before it, so no constraint is attached.
   Looks like a bug; the intent was probably `rule.required().warning(...)`.
5. **`SANITY_API_WRITE_TOKEN` was required but unused.** CLAUDE.md admits it. Deliberate
   placeholder; task 1 is its first consumer.
6. **The `/api/ask` limiter is per instance.** Its comment says so. Deliberate, and I kept the
   same honesty for mine.
7. **The old search cached the whole dataset per perspective inside `"use cache"` and searched
   drafts in preview sessions.** Fine for 21 posts, surprising at 4,000. The brief's premise.
8. **The one-year default `cacheLife` is a trap for third-party reads.** `next.config.ts` sets
   `cacheLife.default` to Sanity's profile, so any `"use cache"` around an Algolia call would
   pin results for a year and mint one entry per query string. Deliberate for Sanity, and worth
   a comment for the next person who caches something else.
9. **The blog index did not work without JavaScript.** Page 2 and the category filter are
   links, but the dynamic view streams behind the page-one shell, so a no-JS visitor saw page
   one for every URL. The file's own comment acknowledges the soft-404 half of this. Deliberate
   trade for an instant shell; I reversed it for `/blog` only.
10. **`@sanity/webhook` compares signatures with a plain `!==`, and `parseBody` sleeps 3 s.**
    Vendor, not repo, but the reason not to reach for it here.
11. **`@sanity/codegen` 8.1.0 breaks `@sanity/cli` 8.3.0 inside a `^8.0.0` range.** Vendor
    regression; pinned (section 1).
12. **`BLOG_LIST_PAGE_SIZE` was module-private and the description limits lived in two schema
    files.** Small; both now shared.
13. **The Logger is not structured.** The brief calls the revalidate route's logging
    "structured"; the class prints prefixed strings. Fine for Vercel's log viewer, not
    machine-parseable. Naming more than a bug.
14. **`/api/revalidate-sync-tags` echoes the caller's `syncTags` back.** Harmless reflection.
15. **Presentation captures edit intents.** Opening a post from global search or from the site
    lands in the Presentation panel, which never shows custom document views. Editors who never
    use Structure will not see the SEO tab. Deliberate configuration (`locations` and
    `mainDocuments`), but worth knowing before promising an editor a tab.
16. **Production pages are cached for a year and only refreshed by a redeploy** unless the
    `invalidate-tags` Sanity Function is deployed, which a fork does not do by default. A
    content edit shows locally and not on the deployed site. Deliberate architecture, sharp edge
    for a fork.
17. **Next 16 dev writes `apps/web/AGENTS.md` and `CLAUDE.md` on every start.** Tooling
    output; I git-ignored them.
18. **Studio shows "This version of Sanity Studio can lose some rich text edits".** The pinned
    `sanity` 6.11 has a known Portable Text bug; an upgrade is due.
19. **Vercel warns that `SANITY_E2E_*` variables are not in `turbo.json`.** They are
    Playwright-only and the template never listed them. Cosmetic.
20. **Vercel Web Analytics is mounted unconditionally**, so a project without analytics
    enabled logs a `script.js` syntax error from the 404 page. Template choice.
21. **Mux credentials live in the dataset.** The README explains why; deliberate.

## 3. What I'd do with more time

- **Prune on backfill**: browse the index and delete object ids the fetch did not return, or
  a queue-backed reindex, so a backfill also repairs records the webhook missed.
- **A shared-store rate limiter** (Upstash or a Vercel Firewall rule) so the limit is global
  rather than per instance.
- **Newsletter feedback and spinner**: a server action for the pending state and a small
  `useSearchParams` message under the form, keeping the native post as the no-JS path.
- **Index the body**: `pt::text(richText)` truncated to a few kilobytes as a lower-priority
  searchable attribute, once relevance on title and description proves insufficient.
- **A Presentation-side inspector** for the SEO tab, so editors who never open Structure see it.
- **Fix the seed**: give the hero a poster so a fresh install has an LCP image, and put the
  newsletter block where SETUP.md says it is.
- **Playwright coverage** for `/api/blog/search`, `/blog?q=` with JavaScript off, and the
  newsletter post, on the existing e2e fixtures.
- **The PageSpeed bonus**, starting from the empty hero, which is the obvious first fix.
- **Upgrade `sanity`** past the rich-text bug and re-check the codegen pin.
