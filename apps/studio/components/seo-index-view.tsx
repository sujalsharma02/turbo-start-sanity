import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Label,
  Spinner,
  Stack,
  Text,
} from "@sanity/ui";
import { useEffect, useState } from "react";
import { getPublishedId, useClient } from "sanity";
import type { UserViewComponent } from "sanity/structure";

import {
  API_VERSION,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
} from "@/utils/constant";

// Bundled into the browser build by Vite (SANITY_STUDIO_ prefix): search-only key.
const ALGOLIA_APP_ID = process.env.SANITY_STUDIO_ALGOLIA_APP_ID;
const ALGOLIA_SEARCH_KEY = process.env.SANITY_STUDIO_ALGOLIA_SEARCH_KEY;
const ALGOLIA_INDEX = process.env.SANITY_STUDIO_ALGOLIA_INDEX;
const SITE_URL = process.env.SANITY_STUDIO_PRESENTATION_URL ?? "";

// Where a search result snippet is cut. The description bound is the blog
// schema's own rule; the title has no rule in the schema, so this is only the
// visual cut of the preview and is not reported as a check.
const TITLE_PREVIEW_CUT = 60;

/** The fields this tab reads; every one may be absent on a draft. */
type BlogDoc = {
  _rev?: string;
  title?: string;
  description?: string;
  slug?: { current?: string };
  image?: { asset?: { _ref?: string } };
  seoTitle?: string;
  seoDescription?: string;
  seoImage?: { asset?: { _ref?: string } };
  seoNoIndex?: boolean;
  seoHideFromLists?: boolean;
};

// Fallback rules from utils/seo-fields.ts: each override inherits from the
// main field when blank.
function resolveSeo(doc: BlogDoc) {
  return {
    title: doc.seoTitle?.trim() || doc.title?.trim() || "",
    description: doc.seoDescription?.trim() || doc.description?.trim() || "",
    imageRef: doc.seoImage?.asset?._ref || doc.image?.asset?._ref || "",
    imageSource: doc.seoImage?.asset?._ref ? "SEO image" : "main image",
    slug: doc.slug?.current ?? "",
  };
}

const count = (text: string) => Array.from(text).length;

const cut = (text: string, max: number) =>
  count(text) > max
    ? `${Array.from(text)
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : text;

/** `host › blog › slug`, the way a search engine prints the path. */
function crumbs(slug: string) {
  let host = SITE_URL;
  try {
    host = new URL(SITE_URL).host;
  } catch {
    // Not a URL in this environment; show it as-is.
  }
  return [host, ...slug.split("/").filter(Boolean)].join(" › ");
}

type Check = { label: string; ok: boolean; detail: string };

function runChecks(doc: BlogDoc, seo: ReturnType<typeof resolveSeo>): Check[] {
  const length = count(seo.description);
  let descriptionDetail = `${length} characters`;
  if (length === 0) descriptionDetail = "Description missing";
  else if (length < SEO_DESCRIPTION_MIN)
    descriptionDetail = `Description too short — ${length} characters, at least ${SEO_DESCRIPTION_MIN} needed`;
  else if (length > SEO_DESCRIPTION_MAX)
    descriptionDetail = `Description too long — ${length} characters, ${SEO_DESCRIPTION_MAX} at most`;

  return [
    {
      label: "Meta title",
      ok: seo.title.length > 0,
      detail: seo.title
        ? `Meta title set — ${count(seo.title)} characters${doc.seoTitle?.trim() ? "" : " (from the post title)"}`
        : "Meta title missing — add a title or an SEO title override",
    },
    {
      label: "Description",
      ok: length >= SEO_DESCRIPTION_MIN && length <= SEO_DESCRIPTION_MAX,
      detail: descriptionDetail,
    },
    {
      label: "Image",
      ok: seo.imageRef.length > 0,
      detail: seo.imageRef
        ? `Image set (${seo.imageSource})`
        : "Image missing — add a main image or an SEO image override",
    },
    {
      label: "Indexing",
      ok: doc.seoNoIndex !== true,
      detail:
        doc.seoNoIndex === true
          ? "Indexing blocked — “Do Not Index This Page” is switched on"
          : "Indexing allowed",
    },
  ];
}

type IndexState =
  | { kind: "unconfigured" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; record: { title?: string } | null; checkedAt: Date };

async function fetchRecord(objectID: string) {
  const res = await fetch(
    `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/${encodeURIComponent(objectID)}`,
    {
      headers: {
        "X-Algolia-Application-Id": ALGOLIA_APP_ID ?? "",
        "X-Algolia-API-Key": ALGOLIA_SEARCH_KEY ?? "",
      },
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Algolia responded ${res.status}`);
  return (await res.json()) as { title?: string };
}

/**
 * Compare what is published with what Algolia holds. Only the published
 * document decides what *should* be indexed; the form value is irrelevant here.
 */
function compare(
  published: BlogDoc | null,
  record: { title?: string } | null
): { tone: "positive" | "caution" | "critical" | "default"; text: string } {
  const shouldBeIndexed = Boolean(
    published?.slug?.current &&
      published.seoNoIndex !== true &&
      published.seoHideFromLists !== true
  );
  if (!published) {
    return record
      ? {
          tone: "critical",
          text: "Not published, but still in the search index. The sync did not remove it.",
        }
      : {
          tone: "default",
          text: "Post is unpublished, so it is not expected to appear in search.",
        };
  }
  if (shouldBeIndexed && !record) {
    return {
      tone: "critical",
      text: "Not found in Algolia — but this post is published. Something is out of sync.",
    };
  }
  if (!shouldBeIndexed && record) {
    return {
      tone: "critical",
      text:
        published.seoNoIndex === true
          ? "“Do Not Index” is switched on, but the post is still in the search index."
          : "Hidden from lists, but the post is still in the search index.",
    };
  }
  if (!shouldBeIndexed) {
    return {
      tone: "default",
      text:
        published.seoNoIndex === true
          ? "Marked “Do Not Index” and not in the search index. Expected."
          : "Hidden from lists and not in the search index. Expected.",
    };
  }
  if (record?.title !== published.title) {
    return {
      tone: "caution",
      text: `In the search index, but with an older title (“${record?.title ?? ""}”). The next publish will update it.`,
    };
  }
  return {
    tone: "positive",
    text: "In the search index and matches the published post.",
  };
}

function CheckRow({ check }: Readonly<{ check: Check }>) {
  return (
    <Card
      border
      padding={3}
      radius={2}
      tone={check.ok ? "positive" : "critical"}
    >
      <Flex align="flex-start" gap={3}>
        <Text size={1} weight="semibold">
          {check.ok ? "✓" : "✗"}
        </Text>
        <Text size={1}>{check.detail}</Text>
      </Flex>
    </Card>
  );
}

const CONFIGURED = Boolean(
  ALGOLIA_APP_ID && ALGOLIA_SEARCH_KEY && ALGOLIA_INDEX
);

/** Read-only: asks Algolia for the record and compares it with the published document. */
function IndexStatus({
  objectID,
  published,
}: Readonly<{ objectID: string; published: BlogDoc | null }>) {
  const [index, setIndex] = useState<IndexState>({
    kind: CONFIGURED ? "loading" : "unconfigured",
  });
  const [recheck, setRecheck] = useState(0);
  const publishedRev = published?._rev;

  // Re-check when a different document opens, the published version changes,
  // or the editor asks for it; never on a keystroke, which cannot change what
  // is in the index.
  // biome-ignore lint/correctness/useExhaustiveDependencies: publishedRev and recheck only trigger the re-check; the fetch needs neither
  useEffect(() => {
    if (!CONFIGURED) return;
    setIndex({ kind: "loading" });
    fetchRecord(objectID)
      .then((record) =>
        setIndex({ kind: "loaded", record, checkedAt: new Date() })
      )
      .catch(() => setIndex({ kind: "error" }));
  }, [objectID, publishedRev, recheck]);

  const verdict =
    index.kind === "loaded" ? compare(published, index.record) : null;

  return (
    <Stack gap={3}>
      <Flex align="center" justify="space-between">
        <Label muted size={1}>
          Search index
        </Label>
        {CONFIGURED && (
          <Button
            disabled={index.kind === "loading"}
            fontSize={1}
            mode="ghost"
            onClick={() => setRecheck((n) => n + 1)}
            padding={2}
            text="Re-check"
          />
        )}
      </Flex>
      {index.kind === "unconfigured" && (
        <Card border padding={3} radius={2} tone="caution">
          <Text size={1}>
            Search index not configured for this Studio (SANITY_STUDIO_ALGOLIA_*
            variables).
          </Text>
        </Card>
      )}
      {index.kind === "loading" && (
        <Flex align="center" gap={3} padding={3}>
          <Spinner muted />
          <Text muted size={1}>
            Checking Algolia…
          </Text>
        </Flex>
      )}
      {index.kind === "error" && (
        <Card border padding={3} radius={2} tone="caution">
          <Text size={1}>Could not reach Algolia. Try again in a moment.</Text>
        </Card>
      )}
      {index.kind === "loaded" && verdict && (
        <Stack gap={2}>
          <Card border padding={3} radius={2} tone={verdict.tone}>
            <Flex align="flex-start" gap={3}>
              <Badge tone={index.record ? "positive" : "default"}>
                {index.record ? "Indexed" : "Not indexed"}
              </Badge>
              <Text size={1}>{verdict.text}</Text>
            </Flex>
          </Card>
          <Text muted size={0}>
            Object ID {objectID} · checked{" "}
            {index.checkedAt.toLocaleTimeString()} ·{" "}
            {published ? "published" : "never published"}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}

export const SeoIndexView: UserViewComponent = ({ document, documentId }) => {
  // `displayed` is the live form value, unsaved keystrokes included, so the
  // preview and counts move as the editor types. `published` is what visitors
  // and the search index actually see.
  const displayed = document.displayed as BlogDoc;
  const published = (document.published as BlogDoc | null) ?? null;
  const seo = resolveSeo(displayed);
  const checks = runChecks(displayed, seo);
  const objectID = getPublishedId(documentId);
  const client = useClient({ apiVersion: API_VERSION });

  const [siteTitle, setSiteTitle] = useState<string>("");
  useEffect(() => {
    // The live site renders the tab title as "Title / Site title" (lib/seo.ts).
    client
      .fetch<string | null>('*[_type == "settings"][0].siteTitle')
      .then((value) => setSiteTitle(value ?? ""))
      .catch(() => setSiteTitle(""));
  }, [client]);

  const fullTitle =
    siteTitle && !seo.title.includes(siteTitle)
      ? `${seo.title} / ${siteTitle}`
      : seo.title;

  return (
    <Box padding={4}>
      <Stack gap={5}>
        <Stack gap={3}>
          <Label muted size={1}>
            Search preview
          </Label>
          <Card border padding={4} radius={2}>
            <Stack gap={3}>
              <Text muted size={1}>
                {crumbs(seo.slug)}
              </Text>
              <Text size={3} weight="medium">
                {seo.title
                  ? cut(
                      fullTitle,
                      TITLE_PREVIEW_CUT + (fullTitle.length - seo.title.length)
                    )
                  : "Untitled"}
              </Text>
              <Text muted size={1}>
                {seo.description
                  ? cut(seo.description, SEO_DESCRIPTION_MAX)
                  : "No description yet."}
              </Text>
            </Stack>
          </Card>
          <Flex gap={4} wrap="wrap">
            <Text muted size={1}>
              Title: {count(seo.title)} characters
              {count(seo.title) > TITLE_PREVIEW_CUT
                ? ` (cut at ${TITLE_PREVIEW_CUT})`
                : ""}
            </Text>
            <Text muted size={1}>
              Description: {count(seo.description)} / {SEO_DESCRIPTION_MAX}{" "}
              characters
            </Text>
          </Flex>
        </Stack>

        <Stack gap={3}>
          <Label muted size={1}>
            Checks
          </Label>
          <Stack gap={2}>
            {checks.map((c) => (
              <CheckRow check={c} key={c.label} />
            ))}
          </Stack>
        </Stack>

        <IndexStatus objectID={objectID} published={published} />
      </Stack>
    </Box>
  );
};
