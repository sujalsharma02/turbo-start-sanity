import { Logger } from "@workspace/logger";
import { type NextRequest, NextResponse } from "next/server";

import {
  isSearchConfigured,
  isSearchRateLimited,
  parseSearchParams,
  searchBlogs,
} from "@/lib/algolia";
import { clientIp } from "@/lib/rate-limit";

const logger = new Logger("BlogSearch");

/**
 * JSON search for the as-you-type hook. The same `searchBlogs` serves the
 * server-rendered `/blog?q=` page, which is what a browser without JavaScript
 * uses. Response: `{ hits, nbHits, page, nbPages }`, pages 1-based like `/blog`.
 */
export async function GET(req: NextRequest) {
  if (isSearchRateLimited(clientIp(req.headers))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = req.nextUrl;
  const input = parseSearchParams({
    q: searchParams.get("q"),
    page: searchParams.get("page"),
    category: searchParams.get("category"),
  });
  if (!input) {
    return NextResponse.json(
      { error: "Invalid search parameters" },
      { status: 400 }
    );
  }
  if (!isSearchConfigured) {
    return NextResponse.json({ error: "Search unavailable" }, { status: 503 });
  }

  try {
    return NextResponse.json(await searchBlogs(input));
  } catch (error) {
    // Algolia down or slow: a generic 503, and the UI shows its failed state.
    // No fallback to a Sanity full scan; that is the cost this route replaced.
    logger.error("Search failed", error);
    return NextResponse.json({ error: "Search unavailable" }, { status: 503 });
  }
}
