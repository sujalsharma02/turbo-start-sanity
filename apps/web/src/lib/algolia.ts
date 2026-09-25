import { env } from "@workspace/env/server";
import { client } from "@workspace/sanity/client";
import {
  queryBlogSearchRecord,
  queryBlogSearchRecords,
} from "@workspace/sanity/query";
import type { QueryBlogSearchRecordResult } from "@workspace/sanity/types";
import { BLOG_CATEGORY_OPTIONS } from "@workspace/sanity-blocks/internal/blog-categories";
import { algoliasearch, type IndexSettings } from "algoliasearch";

import { createRateLimiter } from "@/lib/rate-limit";
import type { Blog } from "@/types";
import { BLOG_LIST_PAGE_SIZE } from "@/utils";

// Bounds on what one public request can ask for. Algolia caps `query` at 512
// bytes anyway; 100 characters is plenty for a blog search. `page` is capped
// the same way `lib/blog-index.ts` caps the blog index.
export const SEARCH_LIMITS = { maxQueryLength: 100, maxPage: 100 } as const;

// Every search is a billed Algolia operation and both entry points are public;
// a cache alone doesn't stop a loop of distinct queries. 30 a minute per IP
// allows typing through the hook's 400 ms debounce and blocks scripts. Shared
// by the JSON route and the server-rendered /blog?q= page.
export const isSearchRateLimited = createRateLimiter({
  limit: 30,
  windowMs: 60_000,
});

const SANITY_TIMEOUT_MS = 5_000;
const ALGOLIA_TIMEOUTS = { connect: 2_000, read: 5_000, write: 30_000 };

const {
  ALGOLIA_APP_ID: appId,
  ALGOLIA_INDEX_NAME: indexName,
  ALGOLIA_SEARCH_API_KEY: searchKey,
  ALGOLIA_ADMIN_API_KEY: adminKey,
} = env;

// Two clients, two keys: the search key can only read, so a bug in the public
// search route can never write to the index. Either is `null` until configured
// and callers fail closed (503 for search, 401 for writes).
const search =
  appId && indexName && searchKey
    ? algoliasearch(appId, searchKey, { timeouts: ALGOLIA_TIMEOUTS })
    : null;
const admin =
  appId && indexName && adminKey
    ? algoliasearch(appId, adminKey, { timeouts: ALGOLIA_TIMEOUTS })
    : null;

export const isSearchConfigured = search !== null;
export const isAdminConfigured = admin !== null;

// Reads that feed the index bypass the CDN (a webhook fires before the CDN
// catches up) and disable stega (the dev client embeds invisible characters).
const sanity = client.withConfig({ useCdn: false, stega: false });

type SearchRecordSource = NonNullable<QueryBlogSearchRecordResult>;

/** What lives in Algolia: the blog card projection keyed by the Sanity id. */
export type SearchRecord = Omit<
  SearchRecordSource,
  "seoHideFromLists" | "seoNoIndex"
> & { objectID: string };

// Set from code so the settings endpoint shows them and they survive a fresh
// index. Unset, Algolia searches every field, `objectID` and `slug` included.
export const INDEX_SETTINGS = {
  searchableAttributes: ["title", "description", "authorName"],
  attributesForFaceting: ["filterOnly(category)"],
  attributesToRetrieve: [
    "_type",
    "_id",
    "title",
    "description",
    "slug",
    "orderRank",
    "category",
    "image",
    "publishedAt",
    "authors",
  ],
  hitsPerPage: BLOG_LIST_PAGE_SIZE,
} satisfies IndexSettings;

export function isIndexable(
  doc: QueryBlogSearchRecordResult
): doc is SearchRecordSource {
  return Boolean(doc?.slug && !doc.seoHideFromLists && !doc.seoNoIndex);
}

export function toRecord({
  seoHideFromLists: _hidden,
  seoNoIndex: _noIndex,
  ...doc
}: SearchRecordSource): SearchRecord {
  return { objectID: doc._id, ...doc };
}

const CATEGORY_VALUES = new Set(BLOG_CATEGORY_OPTIONS.map((c) => c.value));

export type SearchInput = { q: string; page: number; category: string };

/** Bounded, whitelisted search input, or `null` when the request is junk. */
export function parseSearchParams(params: {
  q?: string | null;
  page?: string | null;
  category?: string | null;
}): SearchInput | null {
  const q = params.q?.trim() ?? "";
  if (!q || q.length > SEARCH_LIMITS.maxQueryLength) return null;
  const page = params.page ? Number(params.page) : 1;
  if (!Number.isInteger(page) || page < 1 || page > SEARCH_LIMITS.maxPage) {
    return null;
  }
  const category = params.category ?? "";
  if (category && !CATEGORY_VALUES.has(category)) return null;
  return { q, page, category };
}

export type SearchResult = {
  hits: Blog[];
  nbHits: number;
  page: number;
  nbPages: number;
};

// Never wrap this in "use cache": next.config.ts sets the default cacheLife to
// Sanity's one-year profile, which would pin results and mint one cache entry
// per query string. Cost is bounded by the rate limiter and SEARCH_LIMITS.
export async function searchBlogs({
  q,
  page,
  category,
}: SearchInput): Promise<SearchResult> {
  if (!(search && indexName)) throw new Error("Algolia search not configured");
  const res = await search.searchSingleIndex<SearchRecord>({
    indexName,
    searchParams: {
      query: q,
      page: page - 1, // Algolia pages are zero-based; ours match ?page= on /blog
      hitsPerPage: BLOG_LIST_PAGE_SIZE,
      filters: category ? `category:${category}` : undefined,
    },
  });
  return {
    hits: res.hits as Blog[],
    nbHits: res.nbHits ?? 0,
    page,
    nbPages: res.nbPages ?? 0,
  };
}

export type SyncAction = "upsert" | "delete" | "retry";

// Nothing below waits for an Algolia task to finish. Algolia applies an index's
// tasks strictly in the order it accepted them (rising taskIDs), so once a call
// returns the outcome is decided; and a settings change queues a reindex that
// measured at over three minutes on the free plan, which every later task waits
// behind. Blocking here would time out webhooks and the backfill for nothing.
// Callers get the taskID back and can poll /1/indexes/{index}/task/{taskID}.

/**
 * Converge one document. The webhook body is only trusted for the id; the
 * document is re-read from Sanity so publish, edit, unpublish, delete, hide and
 * no-index all reduce to "indexable now?". Upsert and delete are keyed on the
 * same objectID, so a duplicate delivery changes nothing.
 */
export async function syncBlog(
  id: string,
  operation: string | undefined
): Promise<{ action: SyncAction; taskID?: number }> {
  if (!(admin && indexName)) throw new Error("Algolia admin not configured");
  const doc = await sanity.fetch(
    queryBlogSearchRecord,
    { id },
    { signal: AbortSignal.timeout(SANITY_TIMEOUT_MS) }
  );
  // A create/update whose document can't be read yet is a delivery that beat
  // the write; ask Sanity to retry rather than deleting a fresh post.
  if (!doc && operation !== "delete") return { action: "retry" };

  if (isIndexable(doc)) {
    const { taskID } = await admin.saveObject({
      indexName,
      body: toRecord(doc),
    });
    return { action: "upsert", taskID };
  }
  const { taskID } = await admin.deleteObject({ indexName, objectID: id });
  return { action: "delete", taskID };
}

const SETTINGS_KEYS = Object.keys(
  INDEX_SETTINGS
) as (keyof typeof INDEX_SETTINGS)[];

/**
 * Settings (only when they differ from what the index already has), then every
 * indexable published post as an upsert. Safe to run twice: same objectIDs,
 * same records, and an unchanged settings call is skipped rather than queueing
 * another reindex. Not atomic against the webhook: a publish between the fetch
 * below and saveObjects can be overwritten by this older snapshot until its
 * next publish; Algolia applies writes in arrival order. replaceAllObjects
 * would widen that window to the whole run, so per-object upserts are used.
 */
// ponytail: in-request backfill; move to a queue/script if the corpus outgrows the function timeout
export async function backfill(): Promise<{
  indexed: number;
  settingsTaskID: number | null;
  taskIDs: number[];
}> {
  if (!(admin && indexName)) throw new Error("Algolia admin not configured");

  let settingsTaskID: number | null = null;
  // A brand-new index 404s on getSettings; treat that as "nothing set yet".
  const current: Partial<IndexSettings> = await admin
    .getSettings({ indexName })
    .catch(() => ({}));
  const unchanged = SETTINGS_KEYS.every(
    (key) =>
      JSON.stringify(current[key]) === JSON.stringify(INDEX_SETTINGS[key])
  );
  if (!unchanged) {
    const res = await admin.setSettings({
      indexName,
      indexSettings: INDEX_SETTINGS,
    });
    settingsTaskID = res.taskID;
  }

  const docs = await sanity.fetch(queryBlogSearchRecords);
  const responses = await admin.saveObjects({
    indexName,
    objects: docs.map(toRecord),
    batchSize: 1000,
  });
  return {
    indexed: docs.length,
    settingsTaskID,
    taskIDs: responses.map((r) => r.taskID),
  };
}
