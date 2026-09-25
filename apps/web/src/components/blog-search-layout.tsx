"use client";

import { cn } from "@workspace/tailwind-config/utils";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { SearchInput } from "@/components/blog-search";
import { BlogSearchResults } from "@/components/blog-search-results";
import { useBlogSearch } from "@/hooks/use-blog-search";

type BlogSearchLayoutProps = {
  activeCategory: string;
  categoryFilter: ReactNode;
  featured: ReactNode;
  list: ReactNode;
  /** The query the server already rendered `list` for (from `?q=`). */
  initialQuery?: string;
};

export function BlogSearchLayout({
  activeCategory,
  categoryFilter,
  featured,
  list,
  initialQuery = "",
}: Readonly<BlogSearchLayoutProps>) {
  const router = useRouter();
  const {
    searchQuery,
    debouncedQuery,
    setSearchQuery,
    results,
    nbHits,
    isSearching,
    hasQuery,
    error,
  } = useBlogSearch({ initialQuery, category: activeCategory });

  // The server rendered `list` for `initialQuery`. Live results only take over
  // once the typed text differs from it, so a hydrated page shows exactly the
  // HTML a browser without JavaScript received. Pages and categories are links.
  const isLive = hasQuery && debouncedQuery.trim() !== initialQuery;

  const clear = () => {
    setSearchQuery("");
    if (initialQuery) {
      router.push(
        activeCategory ? `/blog?category=${activeCategory}` : "/blog"
      );
    }
  };

  const isDeadEnd =
    isLive && !isSearching && (Boolean(error) || results.length === 0);

  const searchStatus = (() => {
    if (!isLive) {
      return "";
    }
    if (isSearching) {
      return "Searching…";
    }
    if (error) {
      return "Search failed";
    }
    if (results.length === 0) {
      return `No articles found for ${searchQuery}`;
    }
    const plural = nbHits === 1 ? "" : "s";
    return `${nbHits} article${plural} found for ${searchQuery}`;
  })();

  return (
    <>
      {featured && !hasQuery ? (
        <section aria-label="Featured posts" className="mt-10 grid gap-8">
          {featured}
        </section>
      ) : null}

      <div className="mt-10 grid gap-8 lg:mt-14 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <aside className="h-max bg-grid-dots p-4 text-zinc-800 lg:sticky lg:top-24 lg:self-start dark:text-zinc-50">
          <div className="flex flex-col gap-6 bg-background p-4">
            <SearchInput
              category={activeCategory}
              className="max-w-none"
              onChange={setSearchQuery}
              onClear={clear}
              placeholder="Search…"
              value={searchQuery}
            />
            {categoryFilter}
          </div>
        </aside>

        <div
          className={cn(
            "grid text-foreground",
            isDeadEnd ? "lg:h-0 lg:min-h-full" : "content-start"
          )}
        >
          <output className="sr-only">{searchStatus}</output>
          {isLive ? (
            <BlogSearchResults
              error={error}
              hasQuery={hasQuery}
              isSearching={isSearching}
              nbHits={nbHits}
              onClear={clear}
              results={results}
              searchQuery={searchQuery}
            />
          ) : (
            list
          )}
        </div>
      </div>
    </>
  );
}
