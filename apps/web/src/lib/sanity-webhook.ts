import { createHmac } from "node:crypto";

import { secretsMatch } from "@/lib/secrets";

/** Header Sanity signs GROQ-powered webhook deliveries with. */
export const SIGNATURE_HEADER = "sanity-webhook-signature";

// A captured delivery can be replayed until this window closes. Five minutes
// tolerates clock skew between Sanity and Vercel and still bounds replays to a
// span too short to be useful.
const MAX_AGE_MS = 5 * 60_000;

// `t=<unix ms>,v1=<base64url HMAC-SHA256>`; Sanity's own parser also accepts a
// space after the comma, so this does too.
const HEADER_PATTERN = /^t=(\d+)[, ]+v1=([^, ]+)$/;

export type Verification =
  | { ok: true }
  | { ok: false; reason: "malformed" | "stale" | "mismatch" };

/**
 * Verifies a Sanity webhook delivery. The signature covers the timestamp and
 * the raw request body (`${t}.${body}`), so the body must be the exact bytes
 * received, not a re-serialised JSON object. The reason is for logs only;
 * callers answer every failure with the same 401.
 */
export function verifySanityWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  now = Date.now()
): Verification {
  const match = header?.match(HEADER_PATTERN);
  if (!match) return { ok: false, reason: "malformed" };
  const timestamp = match[1] ?? "";
  const signature = match[2] ?? "";

  if (Math.abs(now - Number(timestamp)) > MAX_AGE_MS) {
    return { ok: false, reason: "stale" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("base64url");
  return secretsMatch(signature, expected)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}
