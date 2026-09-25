import { Logger } from "@workspace/logger";
import { getDynamicFetchOptions } from "@workspace/sanity/live";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  BlogPageContent,
  type BlogSearchPage,
} from "@/components/blog-page-content";
import { PageBuilderJsonLd } from "@/components/page-builder-json-ld";
import { PageBuilder } from "@/components/pagebuilder";
import {
  type BlogIndexPageData,
  fetchBlogIndexPage,
  parseBlogPageParam,
} from "@/lib/blog-index";
import {
  isSearchRateLimited,
  parseSearchParams,
  type SearchInput,
  searchBlogs,
} from "@/lib/algolia";
import { clientIp } from "@/lib/rate-limit";
import { seoFromDocument } from "@/lib/seo";
import { calculateBlogPaginationMetadata } from "@/utils";

const logger = new Logger("BlogIndex");

type BlogPageProps = Readonly<{
  searchParams: Promise<{
    page?: string;
    category?: string;
    q?: string;
  }>;
}>;

/**
 * The server-side half of search, so `/blog?q=` renders results without
 * JavaScript. Deliberately not cached (see lib/algolia.ts) and rate limited
 * like the JSON route; failures become a state the page renders, not a 500.
 */
async function runSearch(input: SearchInput): Promise<BlogSearchPage> {
  const empty = { q: input.q, hits: [], nbHits: 0, nbPages: 0 };
  if (isSearchRateLimited(clientIp(await headers()))) {
    return { ...empty, error: "limited" };
  }
  try {
    const { hits, nbHits, nbPages } = await searchBlogs(input);
    return { q: input.q, hits, nbHits, nbPages };
  } catch (error) {
    logger.error("Search failed", error);
    return { ...empty, error: "unavailable" };
  }
}

export async function generateMetadata({
  searchParams,
}: BlogPageProps): Promise<Metadata> {
  const [{ page, category, q }, { perspective }] = await Promise.all([
    searchParams,
    getDynamicFetchOptions(),
  ]);
  const currentPage = parseBlogPageParam(page);
  if (currentPage === null) {
    notFound();
  }

  const data = await fetchBlogIndexPage({
    currentPage,
    category: category ?? "",
    perspective,
    stega: false,
  });
  // No index document is a 404, matching the view's behavior.
  if (!data) {
    notFound();
  }

  // Search result pages: the page count is Algolia's, not Sanity's, so the
  // range check below doesn't apply, and internal search results are noindex
  // so they never compete with the blog index in search engines.
  const query = q?.trim();
  if (query) {
    return seoFromDocument(
      { ...data, seoTitle: `Search: ${query}`, seoNoIndex: true },
      { slug: "/blog" }
    );
  }

  // 404 out-of-range pages here, not in the view: metadata resolves before the
  // status commits, while `notFound()` inside the Suspense boundary only
  // streams a soft 404 after PPR flushed a 200 shell. `totalPages` floors at
  // 1, so page 1 of an empty blog or category always survives.
  const { totalPages } = calculateBlogPaginationMetadata(
    data.total,
    currentPage
  );
  if (currentPage > totalPages) {
    notFound();
  }

  return seoFromDocument(data, { slug: "/blog" });
}

export default function BlogIndexPage({ searchParams }: BlogPageProps) {
  // Deliberately unkeyed: a key would remount the boundary and repaint the
  // fallback on every pagination click; unkeyed, the previous posts stay on
  // screen until the new page resolves, so the fallback only paints on a
  // fresh load.
  return (
    <Suspense fallback={<BlogIndexShell />}>
      <BlogIndexView searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * The static shell: real published page-1 content, no loading state. A deep
 * link like `?page=2` shows page 1 until the right page resolves.
 */
async function BlogIndexShell() {
  const data = await fetchBlogIndexPage({
    currentPage: 1,
    category: "",
    perspective: "published",
    stega: false,
  });

  if (!data) {
    return null;
  }

  return <BlogIndexBody activeCategory="" currentPage={1} data={data} />;
}

async function BlogIndexView({ searchParams }: BlogPageProps) {
  const [{ page, category, q }, { perspective, stega }] = await Promise.all([
    searchParams,
    getDynamicFetchOptions(),
  ]);
  const currentPage = parseBlogPageParam(page);
  if (currentPage === null) {
    notFound();
  }
  const activeCategory = category ?? "";

  const data = await fetchBlogIndexPage({
    currentPage,
    category: activeCategory,
    perspective,
    stega,
  });
  if (!data) {
    notFound();
  }

  let search: BlogSearchPage | undefined;
  const query = q?.trim();
  if (query) {
    // An over-long query or a junk page/category is a bogus URL, like ?page=0.
    const input = parseSearchParams({
      q: query,
      page,
      category: activeCategory,
    });
    if (!input) {
      notFound();
    }
    search = await runSearch(input);
    if (search.nbPages > 0 && currentPage > search.nbPages) {
      notFound();
    }
  } else {
    // Past the last page is a dead URL, not an empty list — the real 404 status
    // was already sent by `generateMetadata`; this keeps the body consistent.
    const { totalPages } = calculateBlogPaginationMetadata(
      data.total,
      currentPage
    );
    if (currentPage > totalPages) {
      notFound();
    }
  }

  return (
    <BlogIndexBody
      activeCategory={activeCategory}
      currentPage={currentPage}
      data={data}
      search={search}
    />
  );
}

function BlogIndexBody({
  data,
  activeCategory,
  currentPage,
  search,
}: Readonly<{
  data: BlogIndexPageData;
  activeCategory: string;
  currentPage: number;
  search?: BlogSearchPage;
}>) {
  const paginationMetadata = calculateBlogPaginationMetadata(
    search ? search.nbHits : data.total,
    currentPage
  );

  return (
    <>
      <PageBuilderJsonLd pageBuilder={data.pageBuilder} />
      <BlogPageContent
        activeCategory={activeCategory}
        blogs={data.blogs}
        featuredBlogs={data.featuredBlogs}
        indexPageData={data}
        paginationMetadata={paginationMetadata}
        search={search}
      >
        {data.pageBuilder && data.pageBuilder.length > 0 ? (
          <div className="pb-16">
            <PageBuilder
              id={data._id}
              pageBuilder={data.pageBuilder}
              type={data._type}
            />
          </div>
        ) : null}
      </BlogPageContent>
    </>
  );
}
