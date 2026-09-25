import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDebounce } from "@/hooks/use-debounce";
import type { Blog } from "@/types";

const SEARCH_DEBOUNCE_MS = 400;
const CACHE_STALE_TIME_MS = 30_000;

/** Shape of `/api/blog/search`. Pages are 1-based, like `/blog?page=`. */
export type BlogSearchResponse = {
  hits: Blog[];
  nbHits: number;
  page: number;
  nbPages: number;
};

async function searchBlog(
  query: string,
  category: string,
  signal: AbortSignal
): Promise<BlogSearchResponse | null> {
  if (!query.trim()) {
    return null;
  }

  const params = new URLSearchParams({ q: query });
  if (category) {
    params.set("category", category);
  }
  const response = await fetch(`/api/blog/search?${params}`, { signal });

  if (!response.ok) {
    throw new Error("Failed to search");
  }

  return response.json() as Promise<BlogSearchResponse>;
}

/**
 * As-you-type search. `initialQuery` comes from the URL so the box starts in
 * the state the server rendered; further pages and the category are link
 * navigations, which keeps one code path for browsers with and without JS.
 */
export function useBlogSearch({
  initialQuery = "",
  category = "",
}: {
  initialQuery?: string;
  category?: string;
} = {}) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const debouncedQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);

  const hasQuery = debouncedQuery.trim().length > 0;
  const { data, isLoading, error } = useQuery({
    queryKey: ["blog-search", debouncedQuery, category],
    queryFn: ({ signal }) => searchBlog(debouncedQuery, category, signal),
    enabled: hasQuery,
    staleTime: CACHE_STALE_TIME_MS,
  });
  return {
    searchQuery,
    debouncedQuery,
    setSearchQuery,
    results: data?.hits ?? [],
    nbHits: data?.nbHits ?? 0,
    nbPages: data?.nbPages ?? 0,
    isSearching: isLoading,
    error,
    hasQuery,
  };
}
