"use client";

import { cn } from "@workspace/tailwind-config/utils";
import { Input } from "@workspace/ui/components/input";
import { Search, X } from "lucide-react";
import Form from "next/form";

export function SearchInput({
  className,
  placeholder,
  value,
  category,
  onChange,
  onClear,
}: {
  className?: string;
  placeholder: string;
  value: string;
  /** Active category, carried along so a submit keeps the filter. */
  category?: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className={cn("w-full max-w-sm", className)}>
      {/* A real GET form: Enter navigates to /blog?q=… whether or not
          JavaScript runs, and the server renders the results. With JS,
          next/form makes that a client navigation and the hook still
          fetches as you type. */}
      <Form action="/blog" className="relative" role="search">
        <label className="sr-only" htmlFor="blog-search-input">
          {placeholder}
        </label>

        <Search
          aria-hidden="true"
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
        />

        <Input
          className="h-auto rounded-none border-border bg-transparent py-1.5 pr-10 pl-9.5 text-sm shadow-none"
          id="blog-search-input"
          name="q"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
        {category ? (
          <input name="category" type="hidden" value={category} />
        ) : null}
        <button className="sr-only" type="submit">
          Search
        </button>

        {value && (
          <button
            aria-label="Clear search"
            className="focus-ring -translate-y-1/2 absolute top-1/2 right-2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={onClear}
            type="button"
          >
            <X className="size-4" />
          </button>
        )}
      </Form>
    </div>
  );
}
