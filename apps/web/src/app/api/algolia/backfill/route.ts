import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { type NextRequest, NextResponse } from "next/server";

import { backfill, isAdminConfigured } from "@/lib/algolia";
import { secretsMatch } from "@/lib/secrets";

const logger = new Logger("AlgoliaBackfill");

// Settings plus a few dozen posts finish in seconds; Vercel's default function
// timeout is shorter than a large corpus needs.
export const maxDuration = 60;

/**
 * Fills the index from the current published posts. Re-runnable: every record
 * is an upsert keyed on the Sanity id. Guarded by the same secret as the sync
 * webhook because it writes to the index.
 */
export async function POST(req: NextRequest) {
  const expected = env.SANITY_WEBHOOK_SECRET;
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  // Fail closed: reject when the shared secret is unset or doesn't match.
  if (!(expected && secret) || !secretsMatch(secret, expected)) {
    logger.warn("Rejected unauthorized backfill request", {
      hasAuthHeader: Boolean(secret),
      secretConfigured: Boolean(expected),
    });
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isAdminConfigured) {
    return new Response("Algolia is not configured", { status: 503 });
  }

  try {
    const result = await backfill();
    logger.info("Backfill complete", result);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Backfill failed", error);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
