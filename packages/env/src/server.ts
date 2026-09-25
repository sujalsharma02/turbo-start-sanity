import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-nextjs/presets-zod";
import { z } from "zod/v4";

const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },

  server: {
    SANITY_API_READ_TOKEN: z.string().min(1),
    SANITY_API_WRITE_TOKEN: z.string().min(1),
    // Shared secret for the `/api/revalidate-sync-tags` webhook. Optional so
    // existing deployments still boot; the webhook fails closed when unset.
    SANITY_REVALIDATE_SECRET: z.string().min(1).optional(),
    // FAQ ask box; `/api/ask` returns 503 until both are set.
    SANITY_CONTEXT_ENDPOINT: z.url().optional(),
    SANITY_CONTEXT_TOKEN: z.string().min(1).optional(),
    // Algolia search index. All optional so a deployment without search still
    // boots; `/api/blog/search` answers 503 and the sync/backfill routes 401
    // until they are set. The admin key is server-only and never NEXT_PUBLIC_.
    ALGOLIA_APP_ID: z.string().min(1).optional(),
    ALGOLIA_ADMIN_API_KEY: z.string().min(1).optional(),
    ALGOLIA_SEARCH_API_KEY: z.string().min(1).optional(),
    ALGOLIA_INDEX_NAME: z.string().min(1).optional(),
    // Shared secret for the Sanity -> Algolia webhook (`/api/algolia/sync`)
    // and the backfill route. Both fail closed when unset.
    SANITY_WEBHOOK_SECRET: z.string().min(1).optional(),
  },

  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },

  // Treat empty env strings (e.g. `SANITY_REVALIDATE_SECRET=` in .env.example)
  // as unset, so `.optional()` vars don't fail `.min(1)` on a blank value.
  emptyStringAsUndefined: true,

  extends: [vercel()],
});

export { env };
