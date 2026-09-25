import type { QueryBlogIndexPageResult } from "@workspace/sanity/types";
import type { ReactNode } from "react";

import { BlogHeader, FeaturedBlogCard } from "@/components/blog-card";
import { BlogCategoryFilter } from "@/components/blog-category-filter";
import { BlogList } from "@/components/blog-list";
import { BlogPagination } from "@/components/blog-pagination";
import { BlogSearchLayout } from "@/components/blog-search-layout";
import {
  EmptySearchState,
  ErrorState,
  SearchResultsHeader,
  StateFrame,
} from "@/components/blog-search-results";
import { Breadcrumbs } from "@/components/breadcrumbs";
import type { Blog } from "@/types";
import type { PaginationMetadata } from "@/utils";

/** A search the server ran for `?q=`, rendered without needing JavaScript. */
export type BlogSearchPage = {
  q: string;
  hits: Blog[];
  nbHits: number;
  nbPages: number;
  error?: "limited" | "unavailable";
};

type BlogPageContentProps = {
  indexPageData: NonNullable<QueryBlogIndexPageResult>;
  blogs: Blog[];
  // Already excluded from `blogs` by the query, so the two never overlap.
  featuredBlogs: Blog[];
  paginationMetadata: PaginationMetadata;
  activeCategory: string;
  search?: BlogSearchPage;
  children?: ReactNode;
};

function SearchResultsPage({
  search,
  activeCategory,
  paginationMetadata,
}: Readonly<{
  search: BlogSearchPage;
  activeCategory: string;
  paginationMetadata: PaginationMetadata;
}>) {
  const clearHref = activeCategory
    ? `/blog?category=${activeCategory}`
    : "/blog";
  if (search.error) {
    return (
      <StateFrame>
        <ErrorState query={search.q} />
      </StateFrame>
    );
  }
  if (search.hits.length === 0) {
    return (
      <StateFrame>
        <EmptySearchState clearHref={clearHref} query={search.q} />
      </StateFrame>
    );
  }
  return (
    <section className="grid gap-6">
      <SearchResultsHeader count={search.nbHits} query={search.q} />
      <BlogList blogs={search.hits} />
      {paginationMetadata.totalPages > 1 && (
        <BlogPagination
          category={activeCategory}
          className="mt-12"
          currentPage={paginationMetadata.currentPage}
          hasNextPage={paginationMetadata.hasNextPage}
          hasPreviousPage={paginationMetadata.hasPreviousPage}
          q={search.q}
          totalPages={paginationMetadata.totalPages}
        />
      )}
    </section>
  );
}

export function BlogPageContent({
  indexPageData,
  blogs,
  featuredBlogs,
  paginationMetadata,
  activeCategory,
  search,
  children,
}: BlogPageContentProps) {
  const { title, description } = indexPageData;

  const showFeatured =
    !search && paginationMetadata.currentPage === 1 && featuredBlogs.length > 0;

  return (
    <main className="bg-background">
      <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Blog" }]} />
      <div className="container mt-8 mb-16 md:my-16">
        <BlogHeader description={description} title={title} />

        {/* Keyed on the query so a navigation to a new ?q= resets the box. */}
        <BlogSearchLayout
          activeCategory={activeCategory}
          categoryFilter={
            <BlogCategoryFilter activeCategory={activeCategory} q={search?.q} />
          }
          initialQuery={search?.q}
          key={search?.q ?? ""}
          featured={
            showFeatured
              ? featuredBlogs.map((blog) => (
                  <FeaturedBlogCard blog={blog} key={blog._id} />
                ))
              : null
          }
          list={
            search ? (
              <SearchResultsPage
                activeCategory={activeCategory}
                paginationMetadata={paginationMetadata}
                search={search}
              />
            ) : (
              <>
                <BlogList blogs={blogs} />
                {paginationMetadata.totalPages > 1 && (
                  <BlogPagination
                    category={activeCategory}
                    className="mt-12"
                    currentPage={paginationMetadata.currentPage}
                    hasNextPage={paginationMetadata.hasNextPage}
                    hasPreviousPage={paginationMetadata.hasPreviousPage}
                    totalPages={paginationMetadata.totalPages}
                  />
                )}
              </>
            )
          }
        />
      </div>

      {children}
    </main>
  );
}
