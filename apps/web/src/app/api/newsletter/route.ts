import { createHash } from "node:crypto";
import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { type NextRequest, NextResponse } from "next/server";

import { clientIp, createRateLimiter } from "@/lib/rate-limit";

const logger = new Logger("Newsletter");

// Public POST with no login in front of it, so a script can fill the dataset
// with junk. Five signups a minute per address is generous for a human.
const REQUESTS_PER_MINUTE = 5;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 path limit
// Deliberately loose: one "@", no whitespace, a dot in the domain. Whether the
// mailbox exists is the mail server's problem; this only rejects obvious junk.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Outcome = "ok" | "invalid" | "limited" | "error";

const STATUS: Record<Outcome, number> = {
  ok: 200,
  invalid: 400,
  limited: 429,
  error: 503,
};
const MESSAGE: Record<Outcome, string> = {
  ok: "Subscribed",
  invalid: "Enter a valid email address",
  limited: "Too many signups in a short time. Please try again in a minute.",
  error: "Signups are temporarily unavailable. Please try again later.",
};

const isRateLimited = createRateLimiter({
  limit: REQUESTS_PER_MINUTE,
  windowMs: 60_000,
});

// The shared client is read-only and CDN-backed; writes need the token and a
// direct connection. `stega: false` because the dev client embeds invisible
// visual-editing characters in strings, and we never want those in a mutation.
const writeClient = client.withConfig({
  token: env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
  stega: false,
});

function isJson(req: NextRequest) {
  return req.headers.get("content-type")?.includes("application/json") ?? false;
}

// A browser form posts urlencoded or multipart; curl and scripts post JSON.
// Anything unparsable is a bad request, never a 500.
async function readEmail(req: NextRequest): Promise<unknown> {
  try {
    if (isJson(req)) {
      const body = (await req.json()) as { email?: unknown } | null;
      return body?.email;
    }
    return (await req.formData()).get("email");
  } catch {
    return undefined;
  }
}

// Lowercased and trimmed before hashing so `Foo@x.com ` and `foo@x.com` share
// one document. Plus-tagged addresses stay distinct on purpose.
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email)
    ? email
    : null;
}

// Form submits go back to the page they came from. Only a same-origin Referer
// is trusted, so this can't be turned into an open redirect.
function respond(req: NextRequest, outcome: Outcome) {
  if (isJson(req)) {
    return NextResponse.json(
      outcome === "ok" ? { ok: true } : { error: MESSAGE[outcome] },
      { status: STATUS[outcome] }
    );
  }
  let path = "/";
  try {
    const referer = new URL(req.headers.get("referer") ?? "");
    if (referer.origin === req.nextUrl.origin) path = referer.pathname;
  } catch {
    // No or malformed Referer: land on the home page.
  }
  return NextResponse.redirect(
    new URL(`${path}?newsletter=${outcome}#subscribe`, req.nextUrl.origin),
    303
  );
}

export async function POST(req: NextRequest) {
  if (isRateLimited(clientIp(req.headers))) {
    return respond(req, "limited");
  }

  const email = normalizeEmail(await readEmail(req));
  if (!email) {
    return respond(req, "invalid");
  }

  // The id is derived from the address, so a second signup with the same
  // address is the same document and `createIfNotExists` is a no-op. No
  // query-then-create race, and the address itself never appears in an id.
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 32);
  try {
    await writeClient.createIfNotExists({
      _id: `subscriber-${hash}`,
      _type: "subscriber",
      email,
      subscribedAt: new Date().toISOString(),
    });
  } catch (error) {
    // The caller learns that it failed, not why; the reason goes to the log.
    logger.error("Subscribe failed", error);
    return respond(req, "error");
  }

  // Same answer whether the address was new or already known, so the endpoint
  // can't be used to check who is subscribed.
  return respond(req, "ok");
}
