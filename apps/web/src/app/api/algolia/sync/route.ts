import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { type NextRequest, NextResponse } from "next/server";

import { isAdminConfigured, syncBlog } from "@/lib/algolia";
import { SIGNATURE_HEADER, verifySanityWebhook } from "@/lib/sanity-webhook";

const logger = new Logger("AlgoliaSync");

// One document per delivery; the projection is `{ _id, _type, operation }`, so
// anything bigger than this is not a delivery from our webhook.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ID_LENGTH = 200;

type Delivery = { _id: string; _type: string; operation?: string };

function parseDelivery(raw: string): Delivery | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const { _id, _type, operation } = (body ?? {}) as Partial<
    Record<keyof Delivery, unknown>
  >;
  if (typeof _id !== "string" || _id.length > MAX_ID_LENGTH) return null;
  if (typeof _type !== "string") return null;
  return {
    _id,
    _type,
    operation: typeof operation === "string" ? operation : undefined,
  };
}

/**
 * Receives Sanity's GROQ-powered webhook (API → Webhooks, filter
 * `_type == "blog"`, projection `{ _id, _type, "operation": delta::operation() }`)
 * and converges the Algolia record for that id. Only the id is trusted from
 * the body; the document itself is re-read from Sanity.
 */
export async function POST(req: NextRequest) {
  const secret = env.SANITY_WEBHOOK_SECRET;
  // Fail closed: no secret configured means nothing gets through.
  if (!secret) {
    logger.warn("Rejected webhook: secret not configured");
    return new Response("Unauthorized", { status: 401 });
  }

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return new Response("Payload Too Large", { status: 413 });
  }

  // Raw bytes: the signature is over exactly what Sanity sent.
  const raw = await req.text();
  const verified = verifySanityWebhook(
    raw,
    req.headers.get(SIGNATURE_HEADER),
    secret
  );
  if (!verified.ok) {
    // The reason stays in the log; a caller only learns that it failed.
    logger.warn("Rejected webhook", { reason: verified.reason });
    return new Response("Unauthorized", { status: 401 });
  }

  const delivery = parseDelivery(raw);
  if (!delivery) {
    return new Response("Bad Request: expected { _id, _type }", {
      status: 400,
    });
  }

  // The webhook filter should already exclude these, but the route must not
  // depend on the dashboard being configured correctly.
  if (delivery._type !== "blog") {
    return NextResponse.json({ ignored: "type" });
  }
  // Drafts and release versions are never indexed; only the published
  // document (plain id) is. Both are prefixes, so no library needed.
  if (
    delivery._id.startsWith("drafts.") ||
    delivery._id.startsWith("versions.")
  ) {
    return NextResponse.json({ ignored: "draft" });
  }

  if (!isAdminConfigured) {
    logger.error("Webhook received but Algolia is not configured");
    return new Response("Service Unavailable", { status: 503 });
  }

  try {
    const { action, taskID } = await syncBlog(delivery._id, delivery.operation);
    if (action === "retry") {
      // Delivery beat the document; a non-2xx makes Sanity redeliver later.
      logger.warn("Document not readable yet, asking for retry", {
        id: delivery._id,
      });
      return NextResponse.json({ retry: true }, { status: 503 });
    }
    logger.info("Synced", { id: delivery._id, action, taskID });
    return NextResponse.json({ objectID: delivery._id, action, taskID });
  } catch (error) {
    // Sanity retries on 5xx; the operation is idempotent so that is safe.
    logger.error("Sync failed", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
